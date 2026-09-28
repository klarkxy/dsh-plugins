// Isolated installed-profile acceptance. Real DSH runtime, local mock model.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
const repo = resolve('.');
const installed = process.env.DSH_ENHANCEMENT_INSTALLED === '1';
const nativeOnly = installed && process.env.DSH_ENHANCEMENT_NATIVE_ONLY === '1';
const profileName = installed ? 'package-check' : 'enhancement';
const root = resolve(process.env.DSH_ENHANCEMENT_ROOT ?? (installed ? '.test-output/enhancement-install' : '.test-output/enhancement'));
const workspace = join(root, 'workspace');
process.env.DSH_HOME = join(root, 'home');
process.env.DSH_TELEMETRY_DISABLED = '1';
process.env.NO_UPDATE_NOTIFIER = '1';
const profile = join(process.env.DSH_HOME, 'profiles', profileName);
await mkdir(workspace, { recursive: true });
// Loader associates a file plugin with its nearest package. Give the fixture
// its own package boundary so it never advertises Classmates' browser entry.
const mockRoot = join(root, 'mock-runtime');
await mkdir(mockRoot, { recursive: true });
await writeFile(join(mockRoot, 'package.json'), JSON.stringify({ name: 'classmates-acceptance-mock', private: true, type: 'module' }));
const mockPath = join(mockRoot, 'index.mjs');
await cp(join(repo, 'scripts/enhancement-mock.mjs'), mockPath);
const { requests } = await import(pathToFileURL(mockPath).href);
const { initProfile, loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot');
const { runProfile } = await import('@deepseek-ai/dsh/profile-boot');
const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-experimental-agent-team-profile', '@klarkxy/dsh-classmates'];
if (nativeOnly) bundles.pop();
initProfile(profile, bundles);
if (!installed) {
  const manifestPath = join(profile, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.dependencies = { ...manifest.dependencies, '@klarkxy/dsh-classmates': 'file:' + repo.replaceAll('\\', '/') };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}
const localPlugin = join(profile, 'node_modules', '@klarkxy', 'dsh-classmates');
if (installed) {
  // Enable the required official Web/Teams bundles in this isolated CLI-created
  // profile. Keep the tarball-installed plugin untouched for package acceptance.
  const manifestPath = join(profile, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.dsh.profile.bundles = bundles;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
} else {
  await mkdir(localPlugin, { recursive: true });
  for (const item of ['dist', 'package.json', 'cordis.patch.yml', 'icon.svg', 'locale']) await cp(join(repo, item), join(localPlugin, item), { recursive: true });
}
const roles = [
  { id: 'designer', name: '界面制作同学', description: '实现清晰易用的页面和交互', model: { provider: 'fixture', id: 'design-model' } },
  { id: 'reviewer', name: '独立审查同学', description: '检查实现、提出具体问题', model: { provider: 'fixture', id: 'review-model', reasoningEffort: 'high' } },
].map(role => ({ schemaVersion: 1, revision: 1, enabled: true, instructions: '这是一项本地验收任务，只需简短回复，无需调用工具。', ...role }));
await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([
  { id: 'agent-default-model', config: { provider: 'fixture', model: 'lead-model' } },
  { id: 'session-title-llm', disabled: true },
  ...nativeOnly ? [] : [{ id: 'classmates', config: { roles } }],
  { id: 'ui-theme', config: { preference: 'light' } },
  { id: 'ui-settings-general', name: '@deepseek-ai/dsh-client-ui-settings-general', config: { welcomeNoticeVersion: '2026-08-13.1' } },
  { insert: [{ id: 'enhancement-mock', name: pathToFileURL(mockPath).href }] },
], null, 2));
// Do not implicitly load the repository's cordis.patch.yml as a project patch.
process.chdir(workspace);
const { ctx, shutdown } = await runProfile({ environment: loadLayeredEnv('classmates-enhancement', workspace), profile: profileName, patchFiles: [], args: ['--host', '127.0.0.1', '--port', process.env.DSH_ACCEPTANCE_PORT ?? (installed ? '19443' : '19441'), '--no-open'] });
const { SessionId } = await import('@deepseek-ai/dsh-session');
const { createUserMessage, ToolCallId } = await import('@deepseek-ai/dsh-llm');
const text = value => [{ type: 'text', text: value }];
async function invoke(agent, name, args) {
  return agent.ctx.tools.execute({ agent, callId: ToolCallId(crypto.randomUUID()), name, arguments: args, signal: AbortSignal.timeout(10000) });
}
async function creatorCheck() {
  const presets = await ctx.agentPresets.list();
  assert.ok(presets.some(preset => preset.id === 'cordis'));
  assert.ok(!presets.some(preset => preset.id === 'classmates-manager'));
  const workspaceEntry = await ctx.workspaceRegistry.create(workspace, '创造模式配置验收');
  const { sessionId } = await ctx.sessionController.create({ workspaceId: workspaceEntry.id, agentPreset: 'cordis' });
  const resolved = await ctx.sessionController.resolveAgent(sessionId);
  if ('error' in resolved) throw Error(JSON.stringify(resolved.error));
  const agent = resolved.agent;
  const read = await invoke(agent, 'classmates_read', {});
  assert.equal(read.isError, false, JSON.stringify(read));
  const state = read.value;
  const stamp = Date.now();
  const make = (id, model, reasoningEffort) => ({ schemaVersion: 1, revision: 0, id, name: id, description: '本地角色配置验收', instructions: 'Reply briefly.', enabled: true, model, reasoningEffort });
  const first = make('audit-a-' + stamp, { provider: 'fixture', id: 'design-model' }, 'high');
  const second = make('audit-b-' + stamp, null, 'low');
  const saved = await invoke(agent, 'classmates_batch', { expected: state.settingsRevision, changes: [{ op: 'upsert', role: first }, { op: 'upsert', role: second }] });
  assert.equal(saved.isError, false, JSON.stringify(saved));
  assert.equal(saved.value.roles.length, state.roles.length + 2);
  assert.equal(saved.value.roles.find(role => role.id === first.id).reasoningEffort, 'high');
  const stale = await invoke(agent, 'classmates_batch', { expected: state.settingsRevision, changes: [{ op: 'remove', id: first.id, revision: 1 }] });
  assert.equal(stale.isError, true);
  const invalid = await invoke(agent, 'classmates_batch', { expected: saved.value.settingsRevision, changes: [
    { op: 'remove', id: second.id, revision: 1 },
    { op: 'upsert', role: { ...first, revision: 1, reasoningEffort: 'not-supported' } },
  ] });
  assert.equal(invalid.isError, true);
  const afterInvalid = await invoke(agent, 'classmates_read', {});
  assert.equal(afterInvalid.value.settingsRevision, saved.value.settingsRevision);
  assert.equal(afterInvalid.value.roles.length, saved.value.roles.length);
  const updated = await invoke(agent, 'classmates_batch', { expected: saved.value.settingsRevision, changes: [
    { op: 'upsert', role: { ...first, revision: 1, model: { provider: 'fixture', id: 'review-model' }, reasoningEffort: 'low' } },
  ] });
  assert.equal(updated.isError, false, JSON.stringify(updated));
  assert.deepEqual(updated.value.roles.find(role => role.id === first.id).model, { provider: 'fixture', id: 'review-model' });
  const spawn = await invoke(agent, 'classmates_spawn', { classmate_id: first.id, revision: 2, name: 'creator-boundary', task: 'Reply briefly.' });
  assert.equal(spawn.isError, false, JSON.stringify(spawn));
  const child = ctx.agents.get(spawn.value.member.id);
  assert.ok(child);
  await child.whenIdle();
  assert.equal((await invoke(child, 'classmates_read', {})).isError, true);
  assert.equal((await invoke(child, 'classmates_batch', { expected: updated.value.settingsRevision, changes: [] })).isError, true);
  const before = requests.length;
  agent.followup(createUserMessage({ content: text('检查创造模式提供的角色配置工具。'), source: { kind: 'user' } }));
  await agent.whenIdle();
  assert.ok(requests.length > before);
  const modelTools = requests.at(-1).tools;
  assert.ok(modelTools.includes('classmates_read') && modelTools.includes('classmates_batch'));
  assert.ok(modelTools.includes('spawn_teammate') && modelTools.includes('classmates_spawn'));
  const cleared = await invoke(agent, 'classmates_batch', { expected: updated.value.settingsRevision, changes: [{ op: 'remove', id: first.id, revision: 2 }, { op: 'remove', id: second.id, revision: 1 }] });
  assert.equal(cleared.isError, false, JSON.stringify(cleared));
  const normal = await ctx.sessionController.create({ workspaceId: workspaceEntry.id, agentPreset: 'standard' });
  const ordinary = await ctx.sessionController.resolveAgent(normal.sessionId);
  if ('error' in ordinary) throw Error(JSON.stringify(ordinary.error));
  assert.equal((await invoke(ordinary.agent, 'classmates_batch', { expected: cleared.value.settingsRevision, changes: [] })).isError, true);
  await ctx.agentPresets.select(ordinary.agent, 'cordis');
  assert.equal((await invoke(ordinary.agent, 'classmates_read', {})).isError, false);
  const held = ordinary.agent.ctx.tools.get('classmates_batch', ordinary.agent);
  await ctx.agentPresets.select(ordinary.agent, 'standard');
  assert.equal((await invoke(ordinary.agent, 'classmates_read', {})).isError, true);
  assert.equal(ordinary.agent.ctx.tools.get('classmates_read', ordinary.agent), undefined);
  await assert.rejects(() => held.execute({ changes: [], expected: cleared.value.settingsRevision }, { agent: ordinary.agent }), /创造模式/);
  const evidence = { checkedAt: new Date().toISOString(), remoteModelCalls: 0, modelTools, checks: ['official Creator preset with no separate manager preset', 'model catalog and atomic role creation', 'model and effort update', 'stale writes rejected', 'invalid effort rejects entire batch', 'normal Creator collaboration preserved', 'child configuration access denied', 'standard-Creator-standard revokes tools and captured handlers', 'batch cleanup'], sessionId };
  await writeFile(join(root, 'creator-runtime.json'), JSON.stringify(evidence, null, 2));
  return evidence;
}
async function coldCheck() {
  const seed = JSON.parse(await readFile(join(root, 'seed.json'), 'utf8'));
  const before = ctx.agents.list().map(agent => agent.id).sort();
  const count = requests.length;
  const details = await ctx.get('classmatesController').team(seed.leadId);
  assert.equal(details.members.filter(member => member.roleName === '界面制作同学').length, 2);
  assert.equal(details.members.find(member => member.memberName === 'mobile-designer').lastUsedModel.id, 'design-model');
  assert.deepEqual(ctx.agents.list().map(agent => agent.id).sort(), before);
  assert.equal(requests.length, count);
  const evidence = { checkedAt: new Date().toISOString(), remoteModelCalls: 0, liveAgentsBefore: before.length, members: details.members, checks: ['official persisted Session query after process restart', 'frozen role and actual request model recovered', 'metadata reads do not wake agents or issue model requests'] };
  await writeFile(join(root, 'cold-runtime.json'), JSON.stringify(evidence, null, 2));
  return evidence;
}
async function seed() {
  const leadId = SessionId(`enhancement-${Date.now()}`);
  const workspaceEntry = await ctx.workspaceRegistry.create(workspace, 'Classmates 验收');
  await ctx.sessionController.create({ sessionId: leadId, workspaceId: workspaceEntry.id });
  const resolved = await ctx.sessionController.resolveAgent(leadId);
  if ('error' in resolved) throw Error(JSON.stringify(resolved.error));
  const lead = resolved.agent;
  lead.followup(createUserMessage({ content: text('团队界面验收：两个界面成员与一位审查成员'), source: { kind: 'user' } }));
  await lead.whenIdle();
  for (const [name, roleId] of [['desktop-designer', 'designer'], ['mobile-designer', 'designer'], ['independent-reviewer', 'reviewer']]) {
    const result = await lead.ctx.tools.execute({ agent: lead, callId: ToolCallId(crypto.randomUUID()), name: 'classmates_spawn', arguments: { classmate_id: roleId, revision: 1, name, task: `请完成 ${name} 的简短本地测试回复。` }, signal: AbortSignal.timeout(10000) });
    if (result.isError) throw Error(JSON.stringify(result.content));
  }
  await ctx.agentTeams.spawnTeammate(lead, { name: 'native-helper', description: '原生助手', context: 'fresh', provider: 'spawn', prompt: text('原生助手测试'), signal: AbortSignal.timeout(10000) });
  const task = await ctx.agentTeams.createTask(lead, { subject: '优化手机端棋盘', description: '调整触摸区域并验证键盘操作。', writeScopes: ['src/ui'] });
  await ctx.agentTeams.updateTask(lead, { taskId: task.id, expectedRevision: task.revision, action: 'reassign', owner: 'mobile-designer' });
  const followup = await ctx.agentTeams.createTask(lead, { subject: '复核界面交付', description: '验证窄屏显示与身份模型信息。', blockedBy: [task.id] });
  await ctx.sessions.flush(lead.session);
  await writeFile(join(root, 'seed.json'), JSON.stringify({ leadId, members: ctx.agentTeams.listMembers(lead), remoteCalls: 0 }, null, 2));
  return { leadId };
}
console.log('ENHANCEMENT_READY');
for await (const line of createInterface({ input: process.stdin })) {
  try {
    if (line.trim() === 'stop') { await shutdown.shutdown(0); break; }
    if (line.trim() === 'seed') console.log(JSON.stringify(await seed()));
    if (line.trim() === 'creator') console.log(JSON.stringify(await creatorCheck()));
    if (line.trim() === 'cold') console.log(JSON.stringify(await coldCheck()));
    if (line.trim() === 'state') console.log(JSON.stringify(await ctx.get('classmatesController').load()));
  } catch (error) { console.error(error); }
}
process.exit(0);
