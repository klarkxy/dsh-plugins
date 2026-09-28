// Development-only real DSH Web host. Credentials are inherited, never written.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';

const wire = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('http://127.0.0.1:19042/') && typeof init?.body === 'string') {
    const body = JSON.parse(init.body);
    wire.push({ model: body.model, reasoning_effort: body.reasoning_effort ?? null, tools: body.tools?.map(tool => tool.function?.name) ?? [] });
  }
  return realFetch(input, init);
};

const root = resolve('.test-output');
process.env.DSH_HOME = join(root, 'clean-home');
process.env.DSH_TELEMETRY_DISABLED = '1';
const profileDir = join(process.env.DSH_HOME, 'profiles', 'acceptance');
const workspace = join(root, 'scratch');
await mkdir(workspace, { recursive: true });
const { initProfile, loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot');
const { runProfile } = await import('@deepseek-ai/dsh/profile-boot');
initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-experimental-agent-team-profile', '@klarkxy/dsh-classmates']);
const { ctx, shutdown } = await runProfile({
  environment: loadLayeredEnv('classmates-acceptance', workspace),
  profile: 'acceptance', patchFiles: [], args: ['--host', '127.0.0.1', '--port', '19431', '--no-open'],
});
const { SessionId } = await import('@deepseek-ai/dsh-session');
const { ToolCallId, createUserMessage } = await import('@deepseek-ai/dsh-llm');
const receiptPath = join(root, 'live-receipts.json');
const records = [];
ctx.on('session/event', (session, event) => {
  if (event.type === 'request/header') {
    const config = event.data.header.config;
    records.push({ session: session.id, provider: config.provider, model: config.model, effort: config.reasoningEffort ?? null });
  }
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() > deadline) throw Error('Acceptance timed out'); await sleep(100); }
}
async function tool(agent, name, args) {
  const result = await agent.ctx.tools.execute({ agent, callId: ToolCallId(crypto.randomUUID()), name, arguments: args, signal: AbortSignal.timeout(180000) });
  if (result.isError) throw Error(JSON.stringify(result.content));
  return result;
}
async function saveReceipts(extra = {}) {
  await writeFile(receiptPath, JSON.stringify({ at: new Date().toISOString(), records, wire, ...extra }, null, 2));
}
async function command(input) {
  if (input === 'state') {
    const state = await ctx.get('classmatesController').load();
    return { roles: state.roles.map(({ id, revision, enabled, model }) => ({ id, revision, enabled, model })), models: state.models, settingsRevision: state.settingsRevision };
  }
  if (input === 'run') {
    const controller = ctx.get('classmatesController');
    let state = await controller.load();
    const models = ['mimo-v2.6-flash', 'minimax-m3', 'step-5-preview'];
    for (let index = 0; index < 3; index++) {
      const source = state.roles.find(role => role.id === ['researcher', 'writer', 'verifier'][index]);
      if (!source) throw Error('Restore three presets before running live acceptance');
      state = await controller.save({ ...source, enabled: true, model: { provider: 'ocg', id: models[index], ...(index === 1 ? { reasoningEffort: 'high' } : {}) }, instructions: `Classmates acceptance role ${source.id}. When asked to reply, provide the requested short text. Do not use tools unless explicitly requested. Literal marker: {{classmates_literal}}` }, state.settingsRevision);
    }
    const leadId = `classmates-live-${Date.now()}`;
    const handle = await ctx.agents.create({ sessionId: SessionId(leadId), meta: { cwd: workspace }, agentOptions: { provider: 'ocg', model: models[0], maxTokens: 1024 } });
    const lead = handle.agent;
    const directory = await tool(lead, 'classmates_list', {});
    const names = [];
    for (const [index, role] of state.roles.entries()) {
      if (index >= 3) break;
      const name = `check-${role.id}`;
      names.push(name);
      await tool(lead, 'classmates_spawn', { classmate_id: role.id, revision: role.revision, name, task: `Reply with exactly ACCEPTED_${index + 1}. This is a short connectivity check. Do not call tools.` });
    }
    await waitFor(() => ctx.agentTeams.listMembers(lead).filter(row => row.role === 'teammate').every(row => row.status === 'inactive'));
    await lead.whenIdle();
    const members = ctx.agentTeams.listMembers(lead);
    await ctx.sessions.flush(lead.session);
    await writeFile(join(root, 'live-state.json'), JSON.stringify({ leadId, names, roles: state.roles, members }, null, 2));
    await saveReceipts({ leadId, members, directory });
    return { leadId, members, requests: records, wire };
  }
  if (input === 'recover') {
    const previous = JSON.parse(await readFile(join(root, 'live-state.json'), 'utf8'));
    const { agent: lead } = await ctx.agents.resume({ resumeSessionId: SessionId(previous.leadId), agentOptions: { provider: 'ocg', model: 'mimo-v2.6-flash', maxTokens: 1024 } });
    let state = await ctx.get('classmatesController').load();
    const role = state.roles.find(item => item.id === 'writer');
    if (role) state = await ctx.get('classmatesController').remove(role.id, role.revision, state.settingsRevision);
    const result = await ctx.agentTeams.sendMessage(lead, { target: 'check-writer', content: [{ type: 'text', text: 'After restart, reply exactly RECOVERED. Do not call tools.' }], signal: AbortSignal.timeout(180000) });
    await waitFor(() => records.some(row => row.session === previous.members.find(row => row.name === 'check-writer').id));
    await waitFor(() => ctx.agentTeams.listMembers(lead).find(row => row.name === 'check-writer')?.status === 'inactive');
    await saveReceipts({ phase: 'independent-process-recovery', leadId: previous.leadId, delivery: result });
    return { delivery: result, requests: records };
  }
  if (input === 'empty') {
    const controller = ctx.get('classmatesController');
    let state = await controller.load();
    const saved = structuredClone(state.roles);
    const { agent } = await ctx.agents.create({ sessionId: SessionId(`classmates-empty-${Date.now()}`), meta: { cwd: workspace }, agentOptions: { provider: 'ocg', model: 'mimo-v2.6-flash' } });
    const names = () => agent.ctx.tools.schemas(agent).map(tool => tool.name).filter(name => name.startsWith('classmates_'));
    await waitFor(() => names().length === 2);
    for (const role of state.roles) state = await controller.save({ ...role, enabled: false }, state.settingsRevision);
    await waitFor(() => names().length === 0);
    const emptyTools = names();
    for (const role of saved) {
      const current = state.roles.find(item => item.id === role.id);
      state = await controller.save({ ...role, revision: current.revision }, state.settingsRevision);
    }
    await waitFor(() => names().length === 2);
    return { emptyTools, restoredTools: names(), requestsForLead: records.filter(row => row.session === agent.id).length };
  }
  if (input === 'team') {
    const leadId = `classmates-team-${Date.now()}`;
    const { agent: lead } = await ctx.agents.create({ sessionId: SessionId(leadId), meta: { cwd: workspace }, agentOptions: { provider: 'ocg', model: 'mimo-v2.6-flash', maxTokens: 1024 } });
    lead.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'I explicitly authorize one Classmates teammate for this test. Use classmates_list then classmates_spawn to create the Researcher role as team-proof. Its task: use team_task_create to create a shared task titled Classmates live proof with description Verify native task and message tools, then send_message to lead containing TASK_CREATED and its task id. Do not modify files or call shell tools. As Lead, wait for the teammate, send it exactly one message asking to acknowledge with ACK_RECEIVED (no further message tools needed). Wait for its reply, then finish with TEAM_PROOF_COMPLETE. Do not create other teammates or tasks.' }] }));
    await waitFor(() => ctx.agentTeams.listMembers(lead).some(row => row.role === 'teammate'));
    await waitFor(() => ctx.agentTeams.listMembers(lead).filter(row => row.role === 'teammate').every(row => row.status === 'inactive'));
    await lead.whenIdle();
    await ctx.sessions.flush(lead.session);
    const members = ctx.agentTeams.listMembers(lead);
    const tasks = await ctx.agentTeams.listTasks(lead, {});
    await writeFile(join(root, 'team-state.json'), JSON.stringify({ leadId, members, tasks }, null, 2));
    await saveReceipts({ phase: 'model-driven-team', leadId, members, tasks });
    return { leadId, members, tasks, requestCount: records.length };
  }
  if (input === 'stop') { await shutdown.shutdown(0); return { stopped: true }; }
  throw Error('Unknown acceptance command');
}
console.log('CLASSMATES_HOST_READY http://127.0.0.1:19431');
for await (const line of createInterface({ input: process.stdin })) {
  try { console.log('CLASSMATES_RESULT ' + JSON.stringify(await command(line.trim()))); }
  catch (error) { console.log('CLASSMATES_ERROR ' + (error instanceof Error ? error.message : String(error))); }
  if (line.trim() === 'stop') break;
}
process.exit(0);
