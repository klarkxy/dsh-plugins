// Isolated real Web host for model-profile acceptance; no upstream calls or credentials.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const repo = resolve('.');
const root = resolve(process.env.CLASSMATES_PROOF_ROOT ?? '.test-output/model-profiles');
if (!root.startsWith(join(repo, '.test-output') + '\\') && !root.startsWith(join(repo, '.test-output') + '/')) {
  throw new Error('Acceptance root must be under this plugin .test-output');
}
const workspace = join(root, 'workspace');
process.env.DSH_HOME = join(root, 'home');
process.env.DSH_TELEMETRY_DISABLED = '1';
process.env.NO_UPDATE_NOTIFIER = '1';
const profileName = 'model-profiles';
const profile = join(process.env.DSH_HOME, 'profiles', profileName);
await mkdir(workspace, { recursive: true });
const mockRoot = join(root, 'mock-runtime');
await mkdir(mockRoot, { recursive: true });
await writeFile(join(mockRoot, 'package.json'), JSON.stringify({ name: 'classmates-model-profile-mock', private: true, type: 'module' }));
const mockPath = join(mockRoot, 'index.mjs');
await cp(join(repo, 'scripts/enhancement-mock.mjs'), mockPath);
const mock = await import(pathToFileURL(mockPath).href);
const { initProfile, loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot');
const { runProfile } = await import('@deepseek-ai/dsh/profile-boot');
const { ToolCallId } = await import('@deepseek-ai/dsh-llm');
initProfile(profile, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-experimental-agent-team-profile', '@klarkxy/dsh-classmates']);
const manifestPath = join(profile, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.dependencies = { ...manifest.dependencies, '@klarkxy/dsh-classmates': 'file:' + repo.replaceAll('\\', '/') };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
const localPlugin = join(profile, 'node_modules', '@klarkxy', 'dsh-classmates');
await mkdir(localPlugin, { recursive: true });
for (const item of ['dist', 'package.json', 'cordis.patch.yml', 'icon.svg', 'locale']) {
  await cp(join(repo, item), join(localPlugin, item), { recursive: true });
}
await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([
  { id: 'agent-default-model', config: { provider: 'fixture', model: 'lead-model' } },
  { id: 'session-title-llm', disabled: true },
  { id: 'ui-theme', config: { preference: 'light' } },
  { id: 'ui-settings-general', name: '@deepseek-ai/dsh-client-ui-settings-general', config: { welcomeNoticeVersion: '2026-08-13.1' } },
  { insert: [{ id: 'model-profile-mock', name: pathToFileURL(mockPath).href }] },
], null, 2));
process.chdir(workspace);
const { ctx, shutdown } = await runProfile({ environment: loadLayeredEnv('model-profile-proof', workspace), profile: profileName, patchFiles: [], args: ['--host', '127.0.0.1', '--port', '19449', '--no-open'] });
const workspaceEntry = await ctx.workspaceRegistry.create(workspace, '模型配置验收');
console.log('MODEL_PROFILES_READY');
let approvalAgent;
let approvalRun = 0;
let approvalPrompt = '';
async function approvalProofStart() {
  let state = await ctx.classmatesController.load();
  const existing = state.roles.find(item => item.id === 'approval-check');
  state = await ctx.classmatesController.save({ schemaVersion: 1, id: 'approval-check',
    revision: existing?.revision ?? 0, name: '审批验收', description: '本地审批流程验收',
    instructions: 'Return the local fixture response.', enabled: true,
    model: { provider: 'fixture', id: 'review-model', reasoningEffort: 'high' } }, state.settingsRevision);
  await ctx.classmatesController.setModelProtection({ provider: 'fixture', id: 'review-model' }, true, state.settingsRevision);
  approvalAgent = undefined;
  approvalPrompt = `请创建审批验收子智能体，第 ${++approvalRun} 次。`;
  mock.queueToolCall('subagent_approval-check', { description: '本地模型审批验收', prompt: approvalPrompt, run_in_background: true }, approvalPrompt);
  console.log('APPROVAL_PROOF_STARTED ' + JSON.stringify({ prompt: approvalPrompt }));
}
async function creatorProof() {
  const { sessionId } = await ctx.sessionController.create({ workspaceId: workspaceEntry.id, agentPreset: 'cordis' });
  const resolved = await ctx.sessionController.resolveAgent(sessionId);
  if ('error' in resolved) throw Error(JSON.stringify(resolved.error));
  const invoke = (agent, name, args) => agent.ctx.tools.execute({ agent, name, arguments: args,
    callId: ToolCallId(crypto.randomUUID()), signal: AbortSignal.timeout(10000) });
  const read = await invoke(resolved.agent, 'classmates_read', {});
  assert.equal(read.isError, false, JSON.stringify(read));
  const profile = { id: 'creator-review', revision: 0, name: '创造模式审查', description: '通过创造模式工具保存的用途',
    enabled: true, model: { provider: 'fixture', id: 'review-model', reasoningEffort: 'high' } };
  const save = await invoke(resolved.agent, 'classmates_models_batch', {
    changes: [{ op: 'upsert', profile }], expected: read.value.settingsRevision,
  });
  assert.equal(save.isError, false, JSON.stringify(save));
  assert.deepEqual(save.value.roles, read.value.roles);
  assert.ok(save.value.modelProfiles.some(item => item.id === profile.id));
  const ordinary = await ctx.sessionController.create({ workspaceId: workspaceEntry.id, agentPreset: 'standard' });
  const normal = await ctx.sessionController.resolveAgent(ordinary.sessionId);
  if ('error' in normal) throw Error(JSON.stringify(normal.error));
  assert.equal((await invoke(normal.agent, 'classmates_models_batch', { changes: [], expected: save.value.settingsRevision })).isError, true);
  const evidence = { checks: ['compiled plugin Creator root saves model profile without editing templates', 'ordinary session cannot mutate model profiles'], upstreamCalls: 0 };
  await writeFile(join(root, 'creator-result.json'), JSON.stringify(evidence, null, 2));
  console.log('CREATOR_MODEL_PROOF ' + JSON.stringify(evidence));
}
for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === 'stop') { await shutdown.shutdown(0); break; }
  if (line.trim() === 'state') console.log('MODEL_PROFILES_STATE ' + JSON.stringify(await ctx.classmatesController.load()));
  if (line.trim() === 'creator-proof') await creatorProof();
  if (line.trim() === 'approval-start') await approvalProofStart();
  if (line.trim() === 'hide-review' || line.trim() === 'show-review') {
    mock.setReviewVisible(line.trim() === 'show-review');
    console.log('REVIEW_VISIBILITY_UPDATED');
  }
  if (line.trim() === 'approval-state') {
    approvalAgent ??= ctx.agents.list().toReversed().find(agent => agent.session.snapshotEvents().some(event =>
      event.type === 'tool/call' && event.data.name === 'subagent_approval-check' && event.data.arguments.includes(approvalPrompt)));
    console.log('APPROVAL_PROOF_STATE ' + JSON.stringify({
      requests: mock.requests, events: approvalAgent?.session.snapshotEvents().filter(event => /approval|tool\/|error|subagent/.test(event.type)) ?? [],
    }));
  }
}
process.exit(0);
