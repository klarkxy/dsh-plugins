// Export only synthetic acceptance metadata, never credentials or full sessions.
import { Context } from '@deepseek-ai/cordis';
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { acceptanceVersions } from './acceptance-versions.mjs';
const root = resolve('.test-output');
const previous = JSON.parse(await readFile(`${root}/live-state.json`, 'utf8'));
const teamLeadId = process.env.DSH_TEAM_LEAD_ID;
if (!teamLeadId) throw Error('Set DSH_TEAM_LEAD_ID to the synthetic model-driven acceptance session');
const ctx = new Context();
await ctx.plugin(Persistence, { root: `${root}/clean-home/sessions` });
async function events(id) {
  const handle = await ctx.sessionPersistence.open(id, 'read');
  try { return (await handle.read()).events; } finally { await handle.close(); }
}
function summarize(id, rows) {
  const calls = new Map();
  const requests = [], turns = [], markers = new Set(), results = [];
  for (const event of rows) {
    if (event.type === 'request/header') {
      const config = event.data.header.config;
      requests.push({ provider: config.provider, model: config.model, effort: config.reasoningEffort ?? null });
    }
    if (event.type === 'assistant/message') for (const block of event.data.message.content) {
      if (block.type === 'tool-call') calls.set(block.id, block.name);
      if (block.type === 'text') for (const marker of ['ACCEPTED_1', 'ACCEPTED_2', 'ACCEPTED_3', 'RECOVERED', 'TASK_CREATED', 'ACK_RECEIVED', 'TEAM_PROOF_COMPLETE'])
        if (block.text.includes(marker)) markers.add(marker);
    }
    if (event.type === 'tool/result') results.push({ name: calls.get(event.data.message.toolCallId), error: event.data.message.isError });
    if (event.type === 'turn/end') turns.push(event.data.reason.kind);
  }
  return { id, requests, toolResults: results, markers: [...markers], turns };
}
try {
  const members = [];
  for (const member of previous.members.filter(row => row.role === 'teammate')) members.push(summarize(member.id, await events(member.id)));
  assert.equal(members.length, 3);
  for (const [index, model] of ['mimo-v2.6-flash', 'minimax-m3', 'step-5-preview'].entries()) {
    const member = members.find(row => row.requests[0]?.model === model);
    assert(member?.markers.includes(`ACCEPTED_${index + 1}`));
    assert(member.turns.includes('completed'));
  }
  const writer = members.find(row => row.requests[0]?.model === 'minimax-m3');
  assert(writer.markers.includes('RECOVERED'));
  assert(writer.requests.every(row => row.model === 'minimax-m3' && row.effort === 'high'));
  const leadEvents = await events(teamLeadId);
  const lead = summarize(teamLeadId, leadEvents);
  assert(lead.markers.includes('TEAM_PROOF_COMPLETE'));
  for (const name of ['classmates_list', 'classmates_spawn', 'send_message']) assert(lead.toolResults.some(row => row.name === name && !row.error));
  let childId;
  for (const event of leadEvents.filter(row => row.type === 'tool/result' && !row.data.message.isError)) {
    for (const block of event.data.message.content) if (block.type === 'text') {
      try { const data = JSON.parse(block.text); if (data.member?.provider === 'classmates-spawn') childId = data.member.id; } catch {}
    }
  }
  assert(childId);
  const child = summarize(childId, await events(childId));
  for (const name of ['team_task_create', 'send_message']) assert(child.toolResults.some(row => row.name === name && !row.error));
  assert(child.markers.includes('ACK_RECEIVED'));
  const recovery = JSON.parse(await readFile(`${root}/recovery-receipts.json`, 'utf8'));
  assert(recovery.wire.some(row => row.model === 'minimax-m3' && row.reasoning_effort === 'high'));
  const team = JSON.parse(await readFile(`${root}/team-state.json`, 'utf8'));
  assert.equal(team.leadId, teamLeadId, 'Team acceptance does not match the selected session');
  const versions = acceptanceVersions(previous, recovery, team);
  const report = { verifiedAt: new Date().toISOString(), ...versions, models: members, modelDrivenTeam: { lead, child }, recoveryWire: recovery.wire.map(({ model, reasoning_effort }) => ({ model, reasoning_effort })), limits: ['One local OCG provider; no direct cross-provider claim.', 'Effort transport acceptance does not prove internal reasoning compute.'] };
  await mkdir('docs/evidence', { recursive: true });
  await writeFile('docs/evidence/live-acceptance.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ verified: true, modelCount: members.length, teamLead: teamLeadId, member: childId }));
} finally { await ctx.fiber.dispose(); }
