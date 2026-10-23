import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// Real JSON backend round-trip: DomainFacility + JsonStorageBackend over a
// temp dir, opened/closed/reopened like a host restart. Deps resolve through
// @klarkxy/dsh-plugin-kit's devDeps — safe-auto deliberately keeps no devDep
// on dsh-storage-json.
const require = createRequire(new URL('../../dsh-plugin-kit/package.json', import.meta.url));
const { DomainFacility } = require('@deepseek-ai/dsh-storage-domain');
const { JsonStorageBackend } = require('@deepseek-ai/dsh-storage-json');

const { openAudit } = await import('../src/audit.js');

const roots = [];
const hosts = [];
test.after(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Fake Context routes the json backend and swallows domain events/logs. */
function openHost(root) {
  const backend = new JsonStorageBackend(root);
  const facility = new DomainFacility({
    storage: { backend: { get: name => {
      if (name !== 'json') throw new Error(`backend-not-found: ${name}`);
      return backend;
    } } },
    logger: { error() {}, warn() {} },
    emit() {},
  }, { backend: 'json' });
  hosts.push({ facility, backend });
  return { facility, backend };
}

function* allFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* allFiles(p);
    else yield p;
  }
}

const rec = () => ({
  sessionId: 'sess-persist', agentId: 'agent-p', callId: 'call-p', tool: 'pwsh', turn: 2,
  trigger: { kind: 'dangerous-command', rule: 'rm-rf', reason: 'recursive delete' },
  action: '{"tool":"pwsh","arguments":{"command":"rm -rf /tmp/x"}}',
  settings: { timeoutMs: 90000, outputTokens: 4096, maxTranscriptBytes: 48000, reviewerPrompt: 'be strict' },
});

test('real json backend: writes durably reopen with input/settings/rationale; stale pending interrupted; no secrets on disk', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-safe-auto-audit-'));
  roots.push(root);

  // Leg 1: open, begin (sparse), prepare (full review payload), finish.
  const host1 = openHost(root);
  const store1 = await openAudit(host1.facility);
  const doneId = await store1.begin(rec());
  const staleId = await store1.begin(rec());            // stays pending -> interrupted on reopen
  const unconfirmedId = await store1.begin({ ...rec(), callId: 'call-unconfirmed' });
  await store1.prepare(doneId, {
    input: 'actual review prompt sent to model',
    environment: '{"cwd":"C:/work","sandbox":"workspace-write"}',
    reviewer: { provider: 'prov', model: 'rev-model', reasoningEffort: 'low' },
    attempts: [{ attempt: 1, startedAt: '2026-10-23T08:00:00.000Z', finishedAt: '2026-10-23T08:00:01.000Z', response: '{"outcome":"allow","risk":"low"}' }],
  });
  await store1.finish(doneId, {
    outcome: 'allowed-once', code: 'ALLOWED', risk: 'low',
    authorization: 'high', rationale: 'reversible in /tmp', durationMs: 900,
  });
  // The host confirmed the one-call grant.
  await store1.approval(doneId, { outcome: 'allowed-once' });
  // A grant the host never confirmed: the reviewer allowed it, but no native
  // decision was observed, so it must not read as a confirmed grant.
  await store1.finish(unconfirmedId, { outcome: 'allowed-once', code: 'ALLOWED', risk: 'low', rationale: 'granted in review' });
  await store1.execution(doneId, { state: 'succeeded', completedAt: '2026-10-23T08:00:05.000Z' });
  await store1.close();
  await host1.backend.close();

  // Medium must hold real files.
  const files = [...allFiles(root)];
  assert.ok(files.length > 0, 'json backend wrote nothing');
  const disk = files.map(f => readFileSync(f, 'utf8')).join('\n');
  assert.ok(files.some(f => f.includes('dsh_safe_auto_audit')), 'no audit unit files on disk');
  assert.match(disk, /actual review prompt sent to model/);

  // Leg 2: fresh backend+facility over the same root — simulates host restart.
  const host2 = openHost(root);
  const store2 = await openAudit(host2.facility);
  const done = store2.get({ id: doneId });
  assert.equal(done.outcome, 'allowed-once');
  assert.equal(done.approvalState, 'allowed-once');
  assert.equal(done.input, 'actual review prompt sent to model');
  assert.equal(done.environment, '{"cwd":"C:/work","sandbox":"workspace-write"}');
  assert.equal(done.reviewer.model, 'rev-model');
  assert.equal(done.settings.outputTokens, 4096);           // metadata numbers survive
  assert.equal(done.settings.reviewerPrompt, 'be strict');
  assert.equal(done.rationale, 'reversible in /tmp');
  assert.equal(done.authorization, 'high');
  assert.equal(done.attempts[0].response, '{"outcome":"allow","risk":"low"}');
  assert.equal(done.execution.state, 'succeeded');
  assert.equal(done.execution.completedAt, '2026-10-23T08:00:05.000Z');
  // The row that never finished is interrupted, not pending/reviewed.
  const stale = store2.get({ id: staleId });
  assert.equal(stale.outcome, 'interrupted');
  assert.equal(stale.interrupted, true);
  // A grant the host never confirmed is not a confirmed grant: it is
  // reported as interrupted, and the reviewer's own verdict is preserved.
  const unconfirmed = store2.get({ id: unconfirmedId });
  assert.equal(unconfirmed.outcome, 'interrupted');
  assert.equal(unconfirmed.unconfirmed, true);
  assert.equal(unconfirmed.approvalState, 'not-observed');
  assert.equal(unconfirmed.code, 'ALLOWED');
  assert.equal(unconfirmed.risk, 'low');
  assert.equal(unconfirmed.rationale, 'granted in review');
  assert.equal(store2.list({ outcome: 'interrupted' }).total, 2);
  await store2.close();
  await host2.backend.close();

  // Leg 3: secrets planted into free-text fields must not reach the medium.
  const host3 = openHost(root);
  const store3 = await openAudit(host3.facility);
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const sid = await store3.begin({ ...rec(),
    input: `cmd with "apiKey":"sk-proj-a1b2c3d4e5f6" and Bearer ${jwt}`,
    rationale: 'n/a' });
  await store3.finish(sid, { outcome: 'rejected', rationale: 'denied password=hunter2', authorization: 'turn' });
  // A long unquoted secret and a credential-shaped environment variable.
  const longSecret = 'L'.repeat(600);
  const envSecret = 'ENVVALUEPLAINTEXT';
  const gid = await store3.begin({ ...rec(), callId: 'call-env',
    input: `export AWS_SECRET_ACCESS_KEY=${envSecret} GITHUB_TOKEN=${envSecret}`,
    action: JSON.stringify({ tool: 'pwsh', arguments: { command: `token=${longSecret}` } }) });
  await store3.finish(gid, { outcome: 'rejected', code: 'DENIED' });
  await store3.close();
  await host3.backend.close();
  const disk2 = [...allFiles(root)].map(f => readFileSync(f, 'utf8')).join('\n');
  assert.equal(disk2.includes('sk-proj-a1b2c3d4e5f6'), false);
  assert.equal(disk2.includes(jwt), false);
  assert.equal(disk2.includes('password=hunter2'), false);
  assert.equal(disk2.includes('hunter2'), false);
  // The credential-shaped environment variable's value never reaches the
  // medium (the variable name may remain: it names the field, not the secret).
  assert.equal(disk2.includes(envSecret), false);
  assert.match(disk2, /AWS_SECRET_ACCESS_KEY=\[REDACTED\]/);
  // A long unquoted value is masked whole, not up to a prefix.
  assert.equal(disk2.includes(longSecret), false);
  assert.equal(disk2.includes(longSecret.slice(512)), false);
});
