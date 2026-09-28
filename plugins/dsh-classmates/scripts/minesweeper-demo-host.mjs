import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
const root = resolve('.test-output/minesweeper');
const home = join(root, 'home');
const profile = join(home, 'profiles', 'minesweeper');
const workspace = resolve('demo/minesweeper');
const evidence = resolve('demo/recordings');
await mkdir(workspace, { recursive: true });
await mkdir(evidence, { recursive: true });
process.env.DSH_HOME = home;
process.env.DSH_TELEMETRY_DISABLED = '1';
let receipts = { startedAt: new Date().toISOString(), requests: [], wire: [], tools: [], turns: [], boots: [] };
try { receipts = JSON.parse(await readFile(join(evidence, 'minesweeper-live-evidence.json'), 'utf8')); } catch {}
(receipts.boots ??= []).push(new Date().toISOString());
const persist = () => writeFile(join(evidence, 'minesweeper-live-evidence.json'), JSON.stringify(receipts, null, 2));
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('http://127.0.0.1:19042/') && typeof init?.body === 'string') {
    const body = JSON.parse(init.body);
    receipts.wire.push({ at: new Date().toISOString(), model: body.model, effort: body.reasoning_effort ?? null, maxTokens: body.max_tokens ?? null });
  }
  return realFetch(input, init);
};
const { initProfile, loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot');
const { runProfile } = await import('@deepseek-ai/dsh/profile-boot');
initProfile(profile, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-experimental-agent-team-profile', '@klarkxy/dsh-classmates']);
process.chdir(workspace);
const { ctx, shutdown } = await runProfile({ environment: loadLayeredEnv('classmates-minesweeper', workspace), profile: 'minesweeper', patchFiles: [], args: ['--host', '127.0.0.1', '--port', '19432', '--no-open'] });
ctx.on('session/event', (session, event) => {
  if (event.type === 'request/header') {
    const config = event.data.header.config;
    receipts.requests.push({ session: session.id, provider: config.provider, model: config.model, effort: config.reasoningEffort ?? null });
  }
  if (event.type === 'assistant/message') for (const block of event.data.message.content) if (block.type === 'tool-call')
    receipts.tools.push({ session: session.id, callId: block.id, name: block.name });
  if (event.type === 'tool/result') receipts.tools.push({ session: session.id, callId: event.data.message.toolCallId, isError: event.data.message.isError });
  if (event.type === 'turn/end') receipts.turns.push({ session: session.id, reason: event.data.reason.kind });
});
const interval = setInterval(() => { void persist(); }, 5000);
console.log(`MINESWEEPER_READY workspace=${workspace}`);
for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === 'stop') { clearInterval(interval); await persist(); await shutdown.shutdown(0); break; }
  if (line.trim() === 'state') {
    try {
      console.log(JSON.stringify({ agents: ctx.agents.list().map(agent => ({ id: agent.id, role: ctx.agentTeams.tryMembership(agent)?.role, members: ctx.agentTeams.tryMembership(agent)?.role === 'lead' ? ctx.agentTeams.listMembers(agent) : undefined })), requests: receipts.requests.length, recentTools: receipts.tools.slice(-10), turns: receipts.turns.slice(-5) }));
    } catch (error) { console.log('STATUS_ERROR', error.message); }
  }
}
process.exit(0);
