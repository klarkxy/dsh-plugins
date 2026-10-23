import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openAudit, auditRedact, auditedCapture, auditDomain, AUDIT_DOMAIN_NAME } from '../src/audit.js';

/*
 * Minimal durable table mock matching the storage-domain KvTable contract the
 * store relies on: synchronous get/entries, `put` resolving only after a
 * durable write (a rejection leaves reads untouched), atomic serialized
 * `update` read-modify-write rejecting missing keys, and a draining close.
 * Reopening is simulated by building a fresh store over the same `saved` map.
 */
function fakeBackend(saved = new Map()) {
  let failing = null;
  let chain = Promise.resolve();
  const enqueue = op => {
    const run = chain.then(op, op);
    chain = run.then(() => {}, () => {});
    return run;
  };
  const writes = [];
  const table = {
    get: key => saved.get(key),
    entries: () => [...saved.entries()][Symbol.iterator](),
    keys: () => saved.keys(),
    get size() { return saved.size; },
    put: (key, value) => enqueue(async () => {
      if (failing) throw new Error(failing);
      writes.push({ op: 'put', key });
      saved.set(key, structuredClone(value));
    }),
    update: (key, fn) => enqueue(async () => {
      if (!saved.has(key)) { const e = new Error(`missing-key ${key}`); e.code = 'missing-key'; throw e; }
      const next = fn(structuredClone(saved.get(key)));
      if (failing) throw new Error(failing);
      writes.push({ op: 'update', key });
      saved.set(key, structuredClone(next));
      return next;
    }),
  };
  let closed = 0;
  const storageDomain = {
    open: async spec => {
      assert.equal(spec, auditDomain);
      assert.equal(spec.name, AUDIT_DOMAIN_NAME);
      assert.equal(spec.layout, 'per-record');
      return { table: name => (assert.equal(name, 'records'), table), close: async () => { await chain; closed++; } };
    },
  };
  return { storageDomain, saved, writes, fail: reason => { failing = reason; }, closed: () => closed };
}

const baseRecord = () => ({
  sessionId: 'session-1',
  agentId: 'agent-1',
  callId: 'call-1',
  tool: 'pwsh',
  turn: 3,
  trigger: { kind: 'dangerous-command', rule: 'rm-rf', reason: 'recursive delete' },
  action: '{"tool":"pwsh","arguments":{"command":"rm -rf /tmp/x"}}',
});

test('begin persists a pending record and get returns it whole', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin(baseRecord());
  assert.match(id, /^[0-9a-f-]{36}$/);
  const row = store.get({ id });
  assert.equal(row.outcome, 'pending');
  assert.equal(row.status, 'pending');
  assert.equal(row.executionState, 'not-observed');
  assert.match(row.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(row.turn, 3);
  assert.equal(row.trigger.rule, 'rm-rf');
  await store.close();
});

test('begin allows missing review fields; prepare fills them before the call and persists attempts', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin({ sessionId: 's', tool: 'pwsh', turn: null, trigger: { kind: 'approval', reason: 'r' } });
  assert.equal(store.get({ id }).input, undefined);
  await store.prepare(id, { input: 'review me', environment: '{"cwd":"/x"}', reviewer: { provider: 'p', model: 'm', reasoningEffort: 'low' } });
  await store.prepare(id, { attempts: [{ attempt: 1, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: 'timeout' }] });
  const row = store.get({ id });
  assert.equal(row.input, 'review me');
  assert.equal(row.reviewer.model, 'm');
  assert.equal(row.attempts[0].error, 'timeout');
  assert.equal(row.finishedAt, undefined);
  await store.close();
});

test('prepare rejects unknown fields and finished records', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin(baseRecord());
  await assert.rejects(store.prepare(id, { outcome: 'allowed-once' }), /cannot set outcome/);
  await store.finish(id, { outcome: 'allowed-once', code: 'ALLOWED' });
  await assert.rejects(store.prepare(id, { input: 'too late' }), /already finished/);
  await store.close();
});

test('finish merges the verdict patch and sets finishedAt; execution updates afterwards', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin(baseRecord());
  await store.finish(id, {
    outcome: 'allowed-once', code: 'ALLOWED', risk: 'low', authorization: 'high',
    rationale: 'reversible in /tmp', durationMs: 42,
    attempts: [{ attempt: 1, startedAt: '2026-10-23T00:00:00Z', finishedAt: '2026-10-23T00:00:01Z', response: '{"outcome":"allow"}' }],
  });
  let row = store.get({ id });
  assert.equal(row.status, 'finished');
  assert.equal(row.outcome, 'allowed-once');
  assert.equal(row.authorization, 'high');
  assert.ok(row.finishedAt);
  assert.equal(row.executionState, 'not-observed');
  await store.execution(id, { state: 'failed', error: 'spawn EACCES' });
  row = store.get({ id });
  assert.equal(row.execution.state, 'failed');
  assert.equal(row.executionState, 'failed');
  assert.equal(row.execution.error, 'spawn EACCES');
  assert.ok(row.execution.completedAt);
  await store.close();
});

test('finish rejects bad outcomes and oversized scalars', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin(baseRecord());
  await assert.rejects(store.finish(id, { outcome: 'pending' }), /outcome/);
  await assert.rejects(store.finish(id, { outcome: 'approved' }), /outcome/);
  await assert.rejects(store.finish(id, { outcome: 'rejected', code: 'x'.repeat(300) }), /code/);
  await assert.rejects(store.finish(id, { outcome: 'rejected', sessionId: 'x' }), /cannot set/);
  await assert.rejects(store.execution(id, { state: 'skipped' }), /succeeded or failed/);
  await assert.rejects(store.execution('missing', { state: 'succeeded' }), /missing-key/);
  await store.close();
});

test('list filters, bounds, stable keyset pagination across concurrent inserts', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const ids = [];
  for (let i = 0; i < 5; i++) {
    ids.push(await store.begin({ ...baseRecord(), sessionId: i % 2 ? 's2' : 's1', tool: i === 3 ? 'bash' : 'pwsh', turn: i }));
  }
  await store.finish(ids[0], { outcome: 'rejected', code: 'DENIED', risk: 'high' });
  await store.finish(ids[1], { outcome: 'allowed-once', code: 'ALLOWED', risk: 'low' });

  // Field filters.
  assert.equal(store.list({ sessionId: 's2' }).total, 2);
  assert.equal(store.list({ tool: 'bash' }).total, 1);
  assert.equal(store.list({ outcome: 'rejected' }).total, 1);
  assert.equal(store.list({ risk: 'low' }).total, 1);
  assert.equal(store.list({ query: 'recursive delete' }).total, 5);
  assert.equal(store.list({ query: 'ALLOWED' }).total, 1);
  const far = '2099-01-01T00:00:00.000Z';
  const past = '2000-01-01T00:00:00.000Z';
  assert.equal(store.list({ from: far }).total, 0);
  assert.equal(store.list({ to: past }).total, 0);
  assert.equal(store.list({ from: past, to: far }).total, 5);

  // Summaries omit heavy fields.
  const item = store.list({ outcome: 'allowed-once' }).items[0];
  assert.equal(item.outcome, 'allowed-once');
  for (const heavy of ['action', 'environment', 'input', 'policy', 'capture', 'attempts', 'settings']) {
    assert.equal(Object.hasOwn(item, heavy), false, heavy);
  }
  assert.equal(Object.hasOwn(store.get({ id: ids[1] }), 'action'), true);

  // Pagination: newest first, limit honoured, cursor continues.
  const p1 = store.list({ limit: 2 });
  assert.equal(p1.items.length, 2);
  assert.equal(p1.total, 5);
  assert.ok(p1.nextCursor);
  // A concurrent insert lands mid-pagination; the keyset cursor stays stable.
  const extra = await store.begin({ ...baseRecord(), callId: 'late-call' });
  const p2 = store.list({ limit: 2, cursor: p1.nextCursor });
  assert.equal(p2.items.length, 2);
  const p3 = store.list({ limit: 2, cursor: p2.nextCursor });
  assert.equal(p3.items.length, 1);
  assert.equal(p3.nextCursor, undefined);
  const seen = [...p1.items, ...p2.items, ...p3.items].map(r => r.id);
  assert.equal(new Set(seen).size, 5);
  assert.ok(seen.includes(ids[4]) && !seen.includes(extra));
  // The fresh insert is reachable on a new first page.
  assert.equal(store.list({ limit: 1 }).items[0].id, extra);

  // Validation.
  await assert.throws(() => store.list({ limit: 0 }));
  await assert.throws(() => store.list({ limit: 101 }));
  await assert.throws(() => store.list({ outcome: 'bogus' }));
  await assert.throws(() => store.list({ cursor: '!!!not-base64!!!' }));
  await assert.throws(() => store.list({ unknown: 1 }));
  await assert.throws(() => store.list({ from: 'not-a-date' }));
  await assert.throws(() => store.list({ from: '1' }));                       // strict ISO, not bare Date.parse
  await assert.throws(() => store.list({ from: far, to: past }), /from.*after to/);
  await store.close();
});

test('reopen marks persisted pending rows interrupted while fresh pending stays pending', async () => {
  const medium = new Map();
  const first = await openAudit(fakeBackend(medium).storageDomain);
  const stale = await first.begin(baseRecord());
  const done = await first.begin(baseRecord());
  await first.finish(done, { outcome: 'cancelled', code: 'REVIEW_CANCELLED' });
  await first.close();

  // Reopen over the same durable medium: the unfinished review is
  // interrupted, not pending — it was never answered and must not read as
  // reviewed. Rows begun in this process honestly stay pending.
  const second = await openAudit(fakeBackend(medium).storageDomain);
  const row = second.get({ id: stale });
  assert.equal(row.outcome, 'interrupted');
  assert.equal(row.interrupted, true);
  assert.equal(second.get({ id: done }).outcome, 'cancelled');
  assert.equal(second.list({ outcome: 'interrupted' }).total, 1);
  assert.equal(second.list({ outcome: 'pending' }).total, 0);
  const fresh = await second.begin(baseRecord());
  assert.equal(second.get({ id: fresh }).outcome, 'pending');
  assert.equal(second.list({ outcome: 'pending' }).total, 1);
  // A finished row re-opening is unaffected.
  assert.equal(second.get({ id: done }).interrupted, undefined);
  await second.close();
});

test('auditRedact masks credential shapes; full-key match keeps metadata numbers', async () => {
  const value = {
    password: 'hunter2', apiKey: 'abc', token: 't', cookie: 'c', private_key: 'k',
    nested: { secret: 's', ok: 'keep', Authorization: 'Bearer xyz' },
    // Grant scope at record level is restored by the store's redactPatch,
    // but a nested authorization header inside arbitrary data is masked.
    authorization: 'high',
    // Full-key sensitivity only: numeric metadata keys are NOT credentials.
    settings: { outputTokens: 4096, maxTranscriptBytes: 48000, timeoutMs: 90000 },
    cmd: 'curl -H "Authorization: Bearer sk-proj-1234567890abc" https://u:p@h/x',
    pem: '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----',
    list: ['Bearer AAAABBBB', 'safe'],
  };
  const out = auditRedact(value);
  assert.equal(out.password, '[REDACTED]');
  assert.equal(out.apiKey, '[REDACTED]');
  assert.equal(out.nested.secret, '[REDACTED]');
  assert.equal(out.nested.ok, 'keep');
  assert.equal(out.nested.Authorization, '[REDACTED]'); // header key, masked
  assert.equal(out.authorization, '[REDACTED]');        // generic data: masked
  // Substring 'token'/'key' must never turn metadata into a string.
  assert.equal(out.settings.outputTokens, 4096);
  assert.equal(out.settings.maxTranscriptBytes, 48000);
  assert.equal(typeof out.settings.timeoutMs, 'number');
  assert.equal(out.cmd.includes('sk-proj-1234567890abc'), false); // header credential masked
  assert.match(out.cmd, /https:\/\/\[REDACTED\]@h/);
  // Record-level authorization survives persistence via redactPatch restore.
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin(baseRecord());
  await store.finish(id, { outcome: 'allowed-once', authorization: 'high' });
  assert.equal(store.get({ id }).authorization, 'high');
  await store.close();
});

test('persisted records carry no raw secrets even when the caller forgets', async () => {
  const { storageDomain, saved } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin({
    ...baseRecord(),
    input: 'run with API_KEY=sk-proj-topsecret12345678 and Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dbsjfslkdjf',
  });
  const raw = JSON.stringify(saved.get(id));
  assert.ok(!raw.includes('sk-proj-topsecret'), raw);
  assert.ok(!raw.includes('eyJhbGci'));
  assert.match(raw, /REDACTED/);
  const row = store.get({ id });
  assert.match(row.input, /\[REDACTED\]/);
  await store.finish(id, { outcome: 'rejected', rationale: 'denied token=abcdef', authorization: 'turn' });
  const raw2 = JSON.stringify(saved.get(id));
  assert.equal(raw2.includes('token=abcdef'), false, raw2);
  assert.equal(store.get({ id }).authorization, 'turn');
  await store.close();
});

test('auditedCapture snapshots with sha256-truncation marker, never silently', () => {
  assert.equal(auditedCapture(undefined), undefined);
  assert.equal(auditedCapture('short'), 'short');
  assert.equal(auditedCapture({ a: 1 }), '{"a":1}');
  const big = 'x'.repeat(2 * 1024 * 1024);
  const out = auditedCapture(big, 100_000);
  assert.ok(Buffer.byteLength(out) <= 100_000 + 200);
  assert.match(out, /truncated: original \d+ bytes, sha256=[0-9a-f]{64}/);
  const digest = createHash('sha256').update(big).digest('hex');
  assert.ok(out.includes(digest));
});

test('oversize review fields move a tagged snapshot into capture', async () => {
  const { storageDomain, saved } = fakeBackend();
  const store = await openAudit(storageDomain);
  const huge = 'A'.repeat(400 * 1024);
  const id = await store.begin({ ...baseRecord(), input: huge });
  const row = store.get({ id });
  assert.match(row.input, /over the \d+-byte audit field limit.*sha256=[0-9a-f]{64}/);
  assert.match(row.capture, /--- input \(/);
  assert.match(row.capture, /sha256=/);
  // Capture stays bounded.
  assert.ok(Buffer.byteLength(row.capture) <= 1024 * 1024 + 8192);
  // The stored medium row matches and validates.
  assert.deepEqual(row.input, saved.get(id).input);
  await store.close();
});

test('a rejected durable write leaves reads untouched and does not advance memory', async () => {
  const backend = fakeBackend();
  const store = await openAudit(backend.storageDomain);
  const id = await store.begin(baseRecord());
  backend.fail('disk full');
  await assert.rejects(store.finish(id, { outcome: 'rejected', code: 'DENIED' }), /disk full/);
  // Reads still show the last durable state — no divergence.
  assert.equal(store.get({ id }).outcome, 'pending');
  backend.fail(null);
  await store.finish(id, { outcome: 'rejected', code: 'DENIED' });
  assert.equal(store.get({ id }).outcome, 'rejected');
  await store.close();
});

test('close drains queued writes into the medium and is idempotent', async () => {
  const backend = fakeBackend();
  const store = await openAudit(backend.storageDomain);
  const id = await store.begin(baseRecord());
  const finishing = store.finish(id, { outcome: 'allowed-once', code: 'ALLOWED' });
  await store.close();
  await finishing;
  assert.equal(backend.saved.get(id).outcome, 'allowed-once');
  assert.equal(backend.closed(), 1);
  await store.close();
  assert.equal(backend.closed(), 2);
});

test('concurrent begin/finish/execution serialize in call order', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin(baseRecord());
  await Promise.all([
    store.prepare(id, { input: 'i1' }),
    store.finish(id, { outcome: 'allowed-once', code: 'ALLOWED' }),
    store.execution(id, { state: 'succeeded' }),
  ]);
  const row = store.get({ id });
  assert.equal(row.input, 'i1');
  assert.equal(row.outcome, 'allowed-once');
  assert.equal(row.execution.state, 'succeeded');
  await store.close();
});

test('a finished allowed-once may be overwritten to cancelled by the final re-check', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin(baseRecord());
  await store.finish(id, { outcome: 'allowed-once', code: 'ALLOWED' });
  await store.finish(id, { outcome: 'cancelled', code: 'REVIEW_CANCELLED' });
  const row = store.get({ id });
  assert.equal(row.outcome, 'cancelled');
  assert.equal(row.code, 'REVIEW_CANCELLED');
  assert.equal(row.status, 'finished');
  await store.close();
});

test('execution accepts a caller-supplied completedAt', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin(baseRecord());
  await store.finish(id, { outcome: 'allowed-once', code: 'ALLOWED' });
  await store.execution(id, { state: 'succeeded', completedAt: '2026-10-23T08:00:00.000Z' });
  assert.equal(store.get({ id }).execution.completedAt, '2026-10-23T08:00:00.000Z');
  await store.close();
});

test('get on an unknown id throws audit record not found', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin(baseRecord());
  assert.throws(() => store.get({ id: 'nope' }), /record not found/);
  assert.equal(store.get({ id }).tool, 'pwsh');
  await store.close();
});

test('get/list return deep copies that cannot mutate the authoritative row', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin({ ...baseRecord(), action: '{"k":1}' });
  const got = store.get({ id });
  got.trigger.rule = 'tampered'; got.execution.state = 'failed'; got.action = 'x';
  const again = store.get({ id });
  assert.equal(again.trigger.rule, 'rm-rf');
  assert.equal(again.execution.state, 'not-observed');
  assert.equal(again.action, '{"k":1}');
  const item = store.list({}).items.find(r => r.id === id);
  item.outcome = 'tampered';
  assert.equal(store.get({ id }).outcome, 'pending');
  await store.close();
});

test('finish transition guard: only pending, or allowed-once rewritten to cancelled', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const a = await store.begin(baseRecord());
  await store.finish(a, { outcome: 'rejected', code: 'DENIED' });
  await assert.rejects(store.finish(a, { outcome: 'allowed-once' }), /cannot finish/);
  await assert.rejects(store.finish(a, { outcome: 'rejected' }), /cannot finish/);
  const b = await store.begin(baseRecord());
  await store.finish(b, { outcome: 'allowed-once', code: 'ALLOWED' });
  await assert.rejects(store.finish(b, { outcome: 'rejected' }), /cannot finish/);
  await store.finish(b, { outcome: 'cancelled', code: 'REVIEW_CANCELLED' });
  assert.equal(store.get({ id: b }).outcome, 'cancelled');
  await assert.rejects(store.finish(b, { outcome: 'cancelled' }), /cannot finish/);
  await store.close();
});

test('quoted JSON keys inside action/input strings are redacted', async () => {
  const { storageDomain, saved } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin({
    ...baseRecord(),
    action: '{"tool":"x","apiKey":"sk-secret-999","args":{"token":"t0"}}',
    input: '{"env":{"password":"p4ss"},"note":"keep"}',
  });
  const raw = JSON.stringify(saved.get(id));
  assert.equal(raw.includes('sk-secret-999'), false, raw);
  assert.equal(raw.includes('"password":"p4ss"'), false, raw);
  assert.match(raw, /apiKey[^\\]*REDACTED|apiKey.{0,12}REDACTED/);
  // JSON structure preserved enough to re-parse the action.
  const action = JSON.parse(store.get({ id }).action);
  assert.equal(action.args.token, '[REDACTED]');
  await store.close();
});

test('from/to compare on epoch across offset formats', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  await store.begin(baseRecord());
  const started = store.list({}).items[0].startedAt;
  const epoch = Date.parse(started);
  const shifted = new Date(epoch - 1).toISOString();        // 1ms before
  const after = new Date(epoch + 60_000).toISOString();
  assert.equal(store.list({ from: shifted }).total, 1);
  assert.equal(store.list({ to: shifted }).total, 0);
  assert.equal(store.list({ from: started, to: started }).total, 1);
  // Same instant written with a +08:00 offset compares on epoch, not lexically.
  const offsetDate = new Date(epoch + 8 * 3600_000);
  const offsetForm = offsetDate.toISOString().replace('Z', '+08:00'); // +08:00 wall-time form of the same instant
  assert.equal(Date.parse(offsetForm), epoch); // same instant, different string
  assert.equal(store.list({ from: offsetForm }).total, 1);
  await store.close();
});

test('redaction covers escaped JSON values and normalized header key names', () => {
  // Escaped value inside a JSON-quoted pair must still mask.
  const s1 = auditRedact('{"apiKey":"abc\\def","x":"1"}');
  assert.equal(s1.includes('abc\\def'), false);
  assert.equal(s1.includes('[REDACTED]'), true);
  // x-api-key / proxy-authorization normalize to set entries.
  const o = auditRedact({ 'x-api-key': 'K', 'proxy-authorization': 'P', 'WWW-Authenticate': 'W' });
  assert.equal(o['x-api-key'], '[REDACTED]');
  assert.equal(o['proxy-authorization'], '[REDACTED]');
  assert.equal(o['WWW-Authenticate'], '[REDACTED]');
  // Whole-string JSON payloads get structural redaction (string -> parse -> redact -> stringify).
  const j = auditRedact('{"env":{"token":"t1","keep":"v"},"list":[{"secret":"s"}]}');
  assert.equal(JSON.parse(j).env.token, '[REDACTED]');
  assert.equal(JSON.parse(j).env.keep, 'v');
  assert.equal(JSON.parse(j).list[0].secret, '[REDACTED]');
  // Non-JSON strings still take the regex path.
  assert.equal(auditRedact('plain text, no braces'), 'plain text, no braces');
});

test('auditedCapture truncation is byte-bounded at code-point boundaries (multibyte)', () => {
  // 3-byte CJK + 4-byte emoji: the cut must never split a code point.
  const unit = '界🙂'; // 3 + 4 = 7 bytes per repeat
  const big = unit.repeat(200_000); // ~1.4 MB
  const t0 = Date.now();
  const out = auditedCapture(big, 100_000);
  const ms = Date.now() - t0;
  assert.ok(ms < 500, `truncation took ${ms}ms`);
  const markerIdx = out.indexOf('…[audit capture truncated:');
  assert.ok(markerIdx > 0);
  const prefix = out.slice(0, markerIdx).replace(/\n$/, '');
  // Whole code points only: the prefix must round-trip and end on a complete
  // character of the repeat unit (either 界 or 🙂), never a broken surrogate.
  assert.ok(prefix.endsWith('界') || prefix.endsWith('🙂'), `cut landed mid code point: ${JSON.stringify(prefix.slice(-4))}`);
  assert.ok(Buffer.byteLength(out) <= 100_000 + 256);
  // No U+FFFD replacement characters from a broken sequence.
  assert.equal(prefix.includes('�'), false);
  // A pure-emoji cut: 4-byte chars must also land cleanly.
  const emoji = '🙂'.repeat(300_000);
  const out2 = auditedCapture(emoji, 50_000);
  const prefix2 = out2.slice(0, out2.indexOf('…[audit capture truncated:')).replace(/\n$/, '');
  assert.equal([...prefix2].every(c => c === '🙂'), true);
  assert.equal(prefix2.includes('�'), false);
});

test('credential key segments are masked while numeric review metadata survives', () => {
  // Common credential environment names: the key names a credential through
  // its segments, not through an exact match.
  const env = auditRedact({
    env: {
      AWS_SECRET_ACCESS_KEY: 'envvalueone',
      GITHUB_TOKEN: 'envvaluetwo',
      OPENAI_API_KEY: 'envvaluethree',
      NPM_TOKEN: 'envvaluefour',
      DB_PASSWORD: 'envvaluefive',
      X_Custom_Token: 'envvaluesix',
      openaiApiKey: 'envvalueseven',
      privateKey: 'envvalueeight',
    },
  });
  for (const [key, value] of Object.entries(env.env)) {
    assert.equal(value, '[REDACTED]', `${key} was not masked`);
  }
  // Numeric review metadata is not a credential and keeps its numbers.
  const meta = auditRedact({
    settings: { outputTokens: 4096, maxTranscriptBytes: 48000, timeoutMs: 90000, reasoningEffort: 'low' },
    sessionId: 'session-1', agentId: 'agent-1', callId: 'call-1', tool: 'pwsh', turn: 3,
  });
  assert.equal(meta.settings.outputTokens, 4096);
  assert.equal(meta.settings.maxTranscriptBytes, 48000);
  assert.equal(meta.settings.timeoutMs, 90000);
  assert.equal(meta.settings.reasoningEffort, 'low');
  assert.equal(meta.sessionId, 'session-1');
  assert.equal(meta.agentId, 'agent-1');
  assert.equal(meta.callId, 'call-1');
  assert.equal(meta.tool, 'pwsh');
  assert.equal(meta.turn, 3);
  // A plain word that merely contains a credential word is not one.
  const plain = auditRedact({ tokenizer: 'stemmer', secretion: 'public', primaryKey: 'id-1' });
  assert.equal(plain.tokenizer, 'stemmer');
  assert.equal(plain.secretion, 'public');
  assert.equal(plain.primaryKey, 'id-1');
});

test('a long unquoted credential value is masked whole, not up to a prefix', () => {
  const long = 'L'.repeat(600);
  const tail = long.slice(512);
  // Free text.
  const text = auditRedact(`curl -H token=${long} https://example.test`);
  assert.equal(text.includes(long), false);
  assert.equal(text.includes(tail), false, 'the tail of the secret survived');
  assert.match(text, /token=\[REDACTED\]/);
  // A nested string (depth > 0) takes the same path.
  const nested = auditRedact({ note: `token=${long}` }).note;
  assert.equal(nested.includes(tail), false, 'the tail of the secret survived');
  // Inside a serialized action payload the value is masked by key.
  const action = auditRedact({ action: JSON.stringify({ tool: 'pwsh', arguments: { command: `token=${long}` } }) }).action;
  assert.equal(action.includes(tail), false, 'the tail of the secret survived');
  assert.match(action, /token=\[REDACTED\]/);
  // A short value is still masked, and a quoted one keeps its quotes.
  assert.match(auditRedact('token=short'), /token=\[REDACTED\]/);
  assert.match(auditRedact('"token":"short"'), /"token":"\[REDACTED\]"/);
});

test('the native approval decision is recorded apart from the reviewer verdict', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  const id = await store.begin(baseRecord());
  assert.equal(store.get({ id }).approvalState, 'not-observed');
  await store.finish(id, { outcome: 'allowed-once', code: 'ALLOWED', risk: 'low' });
  // The reviewer verdict alone is not a confirmed grant.
  assert.equal(store.get({ id }).outcome, 'allowed-once');
  assert.equal(store.get({ id }).approvalState, 'not-observed');
  // The host's decision is recorded on its own field.
  await store.approval(id, { outcome: 'allowed-once' });
  assert.equal(store.get({ id }).approvalState, 'allowed-once');
  assert.equal(store.get({ id }).outcome, 'allowed-once');
  await assert.rejects(store.approval(id, { outcome: 'maybe' }), /approval outcome/);
  await assert.rejects(store.approval('missing', { outcome: 'allowed-once' }), /missing-key/);
  await store.close();
});

test('a grant nobody confirmed is reported as interrupted once the store reopens', async () => {
  const medium = new Map();
  const first = await openAudit(fakeBackend(medium).storageDomain);
  const granted = await first.begin(baseRecord());
  await first.finish(granted, { outcome: 'allowed-once', code: 'ALLOWED', risk: 'low', authorization: 'high', rationale: 'granted' });
  const confirmed = await first.begin({ ...baseRecord(), callId: 'call-2' });
  await first.finish(confirmed, { outcome: 'allowed-once', code: 'ALLOWED' });
  await first.approval(confirmed, { outcome: 'allowed-once' });
  await first.close();

  const second = await openAudit(fakeBackend(medium).storageDomain);
  const unconfirmed = second.get({ id: granted });
  assert.equal(unconfirmed.outcome, 'interrupted');
  assert.equal(unconfirmed.unconfirmed, true);
  assert.equal(unconfirmed.reviewOutcome, 'allowed-once');
  assert.equal(unconfirmed.approvalState, 'not-observed');
  // The reviewer's own details survive: the reviewer did allow the action.
  assert.equal(unconfirmed.code, 'ALLOWED');
  assert.equal(unconfirmed.risk, 'low');
  assert.equal(unconfirmed.authorization, 'high');
  assert.equal(unconfirmed.rationale, 'granted');
  // A confirmed grant keeps its outcome.
  const ok = second.get({ id: confirmed });
  assert.equal(ok.outcome, 'allowed-once');
  assert.equal(ok.approvalState, 'allowed-once');
  assert.equal(ok.unconfirmed, undefined);
  assert.equal(second.list({ outcome: 'interrupted' }).total, 1);
  await second.close();
});

test('the list summary copies the lightweight fields and searches the heavy ones in full', async () => {
  const { storageDomain } = fakeBackend();
  const store = await openAudit(storageDomain);
  // A marker far inside a heavy field: the query must reach it.
  const marker = 'needle-at-the-end';
  const id = await store.begin({ ...baseRecord(), input: `${'x'.repeat(200_000)}${marker}` });
  const item = store.list({}).items.find(row => row.id === id);
  assert.ok(item, 'the record is listed');
  assert.equal(Object.hasOwn(item, 'input'), false);
  assert.equal(Object.hasOwn(item, 'action'), false);
  // The summary is a copy: a caller cannot reach the authoritative row.
  item.trigger.rule = 'tampered';
  item.execution.state = 'failed';
  assert.equal(store.get({ id }).trigger.rule, 'rm-rf');
  assert.equal(store.get({ id }).execution.state, 'not-observed');
  // The free-text query covers the whole stored field, not a prefix.
  assert.equal(store.list({ query: marker }).total, 1);
  assert.equal(store.list({ query: 'needle-at-the' }).total, 1);
  assert.equal(store.list({ query: marker.toUpperCase() }).total, 1);
  assert.equal(store.list({ query: 'no-such-needle' }).total, 0);
  await store.close();
});