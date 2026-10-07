import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ClassmateTools, type SpawnInput } from '../src/tools.js';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { createUserMessage, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { validateRole, type RoleConfig } from '../src/config.js';
import type { ModelProfile } from '../src/contracts.js';
import { createRuntime, modelProfile, requestText, role, SIGNAL, type Runtime } from './helpers/harness.js';
import type { CaptureAdapter } from './helpers/capture-adapter.js';

const runtimes: Runtime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.ctx.fiber.dispose();
    for (const path of [runtime.bindingsRoot, runtime.storageRoot]) rmSync(path, { recursive: true, force: true });
  }
});

type SpawnArgs = SpawnInput & { model_profile?: string };

function childTaskRequests(adapter: CaptureAdapter) {
  return adapter.requests.filter(request => requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS'));
}

function specialistChildRequests(adapter: CaptureAdapter, effort?: string) {
  return adapter.requests.filter(request => (
    request.model === 'specialist-a'
    && requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS')
    && (effort === undefined || request.reasoningEffort === effort)
  ));
}

async function setup(modelProfiles: ModelProfile[] = []) {
  const runtime = await createRuntime({ bindingsRoot: mkdtempSync(join(tmpdir(), 'classmates-tools-')) });
  runtimes.push(runtime);
  const definition = role({ id: 'test', revision: 1, name: 'Test', description: 'Short directory description', instructions: 'SECRET_LONG_ROLE_INSTRUCTIONS', model: { provider: 'mock', id: 'specialist-a' } });
  const state = { roles: [definition], modelProfiles, protectedModels: [] as { provider: string; id: string }[] };
  // Fixtures stay in the legacy write shape; reads normalize like the real RoleConfig.
  const config = { read: () => ({ ...state, roles: state.roles.map(item => validateRole(item)) }) } as unknown as RoleConfig;
  const tools = new ClassmateTools(runtime.ctx, config, runtime.store);
  return { ...runtime, tools, state };
}

it('requires fresh approval for new Team attempts and reuses an existing member without another approval', async () => {
  const { ctx, tools, lead, state, adapter } = await setup();
  state.protectedModels = [{ provider: 'mock', id: 'specialist-a' }];
  const input = { classmate_id: 'test', revision: 1, name: 'protected', task: 'Review once' };
  await expect(tools.spawn(lead, input, SIGNAL)).rejects.toThrow('审批');
  let asks = 0;
  let outcome = 'rejected';
  ctx.provide('approval', { request: async () => { asks++; return outcome; } });
  await expect(tools.spawn(lead, input, SIGNAL)).rejects.toThrow('拒绝');
  expect(adapter.requests).toHaveLength(0);
  expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1);
  outcome = 'allowed-once';
  expect((await tools.spawn(lead, input, SIGNAL)).reused).toBe(false);
  expect((await tools.spawn(lead, input, SIGNAL)).reused).toBe(true);
  expect(asks).toBe(2);
  await vi.waitFor(() => expect(adapter.requests.filter(request => request.model === 'specialist-a')).toHaveLength(1));
});

it('checks newly added protection after binding preparation and rejects cancellation after approval', async () => {
  const { ctx, tools, lead, state, store, adapter } = await setup();
  const prepare = store.prepare.bind(store);
  vi.spyOn(store, 'prepare').mockImplementation(async (...args) => {
    const value = await prepare(...args);
    state.protectedModels = [{ provider: 'mock', id: 'specialist-a' }];
    return value;
  });
  const abort = new AbortController();
  let asks = 0;
  ctx.provide('approval', { request: async () => { asks++; abort.abort(); return 'allowed-once'; } });
  await expect(tools.spawn(lead, { classmate_id: 'test', revision: 1, name: 'protected', task: 'Do not start' }, abort.signal)).rejects.toThrow();
  expect(asks).toBe(1);
  expect(adapter.requests).toHaveLength(0);
  expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1);
});

it('lists only valid enabled roles without long instructions and creates nothing', async () => {
  const { tools, lead, ctx, state } = await setup();
  const result = await tools.list(lead);
  expect(result.roles).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain('SECRET_LONG_ROLE_INSTRUCTIONS');
  expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1);
  state.roles[0].enabled = false;
  expect((await tools.list(lead)).roles).toEqual([]);
});

it('reuses an identical lost-receipt retry without another task and rejects conflicts', async () => {
  const { tools, lead, ctx, adapter, state } = await setup();
  const input = { classmate_id: 'test', revision: 1, name: 'specialist', task: 'One initial task' };
  const receipts = await Promise.all([tools.spawn(lead, input, SIGNAL), tools.spawn(lead, input, SIGNAL)]);
  expect(receipts.map(item => item.reused)).toEqual([false, true]);
  expect(receipts[0].member.id).toBe(receipts[1].member.id);
  await vi.waitFor(() => expect(adapter.requests.filter(request => request.model === 'specialist-a')).toHaveLength(1));
  expect(ctx.agentTeams.listMembers(lead)).toHaveLength(2);
  await expect(tools.spawn(lead, { ...input, task: 'Different task' }, SIGNAL)).rejects.toThrow('不同');
  state.roles = [];
  expect((await tools.spawn(lead, input, SIGNAL)).reused).toBe(true);
  expect(adapter.requests.filter(request => request.model === 'specialist-a')).toHaveLength(1);
});

it('rejects stale revisions and cancellation before creating a roster member', async () => {
  const { tools, lead, ctx } = await setup();
  const input = { classmate_id: 'test', revision: 0, name: 'specialist', task: 'Do not start' };
  await expect(tools.spawn(lead, input, SIGNAL)).rejects.toThrow('重新调用');
  await expect(tools.spawn(lead, { ...input, revision: 1 }, AbortSignal.abort())).rejects.toThrow();
  expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1);
});

it.each([
  { model: null, reasoningEffort: undefined, expectedModel: 'mock', expectedEffort: 'high' },
  { model: null, reasoningEffort: 'low', expectedModel: 'mock', expectedEffort: 'low' },
  { model: { provider: 'mock', id: 'specialist-a' }, reasoningEffort: undefined, expectedModel: 'specialist-a', expectedEffort: 'high' },
  { model: { provider: 'mock', id: 'specialist-a' }, reasoningEffort: 'low', expectedModel: 'specialist-a', expectedEffort: 'low' },
])('resolves independent overrides into the actual first request: $expectedModel/$expectedEffort', async ({ model, reasoningEffort, expectedModel, expectedEffort }) => {
  const { tools, lead, adapter, state, store } = await setup();
  state.roles[0].model = model;
  state.roles[0].reasoningEffort = reasoningEffort;
  expect((await tools.list(lead)).roles).toHaveLength(1);
  const result = await tools.spawn(lead, { classmate_id: 'test', revision: 1, name: 'inherited', task: 'Run inherited task' }, SIGNAL);
  expect(result.selected).toEqual({ provider: 'mock', id: expectedModel, reasoningEffort: expectedEffort });
  await vi.waitFor(() => expect(adapter.requests.filter(request => requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS'))).toHaveLength(1));
  expect(adapter.requests.find(request => requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS'))).toMatchObject({ model: expectedModel, reasoningEffort: expectedEffort });
  expect((await store.read(lead.id, 'inherited'))?.role.model).toEqual(result.selected);
});

it('uses the current request route after a chat model switch and freezes it through cold resume', async () => {
  const first = await setup();
  first.state.roles[0].model = null;
  installModelSelection(first.lead.ctx, { current: { provider: 'mock', model: 'specialist-b', reasoningEffort: ReasoningEffortId('low') }, assembled: undefined });
  first.lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Select the new chat model' }], source: { kind: 'user' } }));
  await first.lead.whenIdle();
  const input = { classmate_id: 'test', revision: 1, name: 'frozen', task: 'Inherited frozen task' };
  const receipt = await first.tools.spawn(first.lead, input, SIGNAL);
  expect(receipt.selected).toEqual({ provider: 'mock', id: 'specialist-b', reasoningEffort: 'low' });
  await vi.waitFor(() => expect(first.adapter.requests.filter(request => requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS'))).toHaveLength(1));
  first.ctx.agentTeams.interrupt(first.lead, 'frozen');
  await vi.waitFor(() => expect(first.ctx.agents.get(receipt.member.id)).toBeUndefined());
  await first.ctx.fiber.dispose();
  const second = await createRuntime({ bindingsRoot: first.bindingsRoot, storageRoot: first.storageRoot, resumeLead: true });
  runtimes.push(second);
  await second.ctx.agentTeams.sendMessage(second.lead, { target: 'frozen', content: [{ type: 'text', text: 'Resume frozen model' }], signal: SIGNAL });
  await vi.waitFor(() => expect(second.adapter.requests.filter(request => requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS'))).toHaveLength(1));
  expect(second.adapter.requests.find(request => requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS'))).toMatchObject({ model: 'specialist-b', reasoningEffort: 'low' });
});

it('inherits conversation effort for a fixed Team role with the UI empty-effort selection', async () => {
  const { tools, lead, state, adapter } = await setup();
  state.roles[0].model = { kind: 'fixed', provider: 'mock', id: 'specialist-a' } as never;
  const receipt = await tools.spawn(lead, { classmate_id: 'test', revision: 1, name: 'inherited', task: 'Use current effort' }, SIGNAL);
  expect(receipt.selected).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'high' });
  await vi.waitFor(() => expect(childTaskRequests(adapter)[0]).toMatchObject({ model: 'specialist-a', reasoningEffort: 'high' }));
});

it('rejects unsupported inherited effort before preparing a binding or creating a member', async () => {
  const { tools, lead, ctx, adapter, store } = await setup();
  const resolve = ctx.llm.resolveModelInfo.bind(ctx.llm);
  vi.spyOn(ctx.llm, 'resolveModelInfo').mockImplementation(async (provider, model) => ({ ...await resolve(provider, model), reasoning: undefined }));
  await expect(tools.spawn(lead, { classmate_id: 'test', revision: 1, name: 'unsupported', task: 'Must not run' }, SIGNAL)).rejects.toThrow('明确选择兼容');
  expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1);
  expect(await store.read(lead.id, 'unsupported')).toBeUndefined();
  expect(adapter.requests).toHaveLength(0);
});

it('reuses a prepared snapshot after cancellation before native admission even when the chat changes', async () => {
  const { tools, lead, ctx, adapter, state, store } = await setup();
  state.roles[0].model = null;
  const abort = new AbortController();
  const prepare = store.prepare.bind(store);
  vi.spyOn(store, 'prepare').mockImplementationOnce(async (...args) => {
    const snapshot = await prepare(...args);
    abort.abort();
    return snapshot;
  });
  const input = { classmate_id: 'test', revision: 1, name: 'prepared', task: 'Prepared retry' };
  await expect(tools.spawn(lead, input, abort.signal)).rejects.toThrow();
  expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1);
  installModelSelection(lead.ctx, { current: { provider: 'mock', model: 'specialist-b', reasoningEffort: ReasoningEffortId('low') }, assembled: undefined });
  lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Switch before retry' }], source: { kind: 'user' } }));
  await lead.whenIdle();
  await expect(tools.spawn(lead, { ...input, task: 'Conflicting task' }, SIGNAL)).rejects.toThrow('不同');
  const receipt = await tools.spawn(lead, input, SIGNAL);
  expect(receipt.selected).toEqual({ provider: 'mock', id: 'mock', reasoningEffort: 'high' });
  await vi.waitFor(() => expect(adapter.requests.find(request => requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS'))).toMatchObject({ model: 'mock', reasoningEffort: 'high' }));
});

const LOW = modelProfile({
  id: 'coding-low',
  name: 'Fast coding',
  description: 'cheap draft pass',
  model: { provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' },
});
const HIGH = modelProfile({
  id: 'coding-high',
  name: 'Deep coding',
  description: 'careful review pass',
  model: { provider: 'mock', id: 'specialist-a', reasoningEffort: 'high' },
});
const DEFAULT_ROUTE = modelProfile({
  id: 'coding-default',
  name: 'Default coding',
  description: 'use the selected model default effort',
  model: { provider: 'mock', id: 'mock' },
});
const PARKED = modelProfile({
  id: 'coding-parked',
  enabled: false,
  name: 'Parked coding',
  description: 'disabled purpose',
  model: { provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' },
});
const LOW_ALIAS = modelProfile({
  id: 'coding-low-alias',
  name: 'Also fast',
  description: 'same route as coding-low, different purpose',
  model: { provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' },
});

it('lists enabled model profiles for Team discovery and exposes model_profile on spawn', async () => {
  const { tools, lead, ctx, state } = await setup([LOW, HIGH, PARKED]);
  const listed = await tools.list(lead) as Awaited<ReturnType<ClassmateTools['list']>> & { modelProfiles?: ModelProfile[] };
  expect(listed.roles).toHaveLength(1);
  expect(listed.modelProfiles).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'coding-low', description: 'cheap draft pass', model: LOW.model }),
    expect.objectContaining({ id: 'coding-high', description: 'careful review pass', model: HIGH.model }),
  ]));
  expect(listed.modelProfiles?.map(item => item.id)).not.toContain('coding-parked');
  const dispose = tools.install(lead);
  try {
    const schema = JSON.stringify(ctx.tools.get('classmates_spawn', lead)?.parameters ?? {});
    expect(schema).toMatch(/model_profile/);
    expect(schema).not.toMatch(/list_subagent_models/);
    const names = ctx.tools.schemas(lead).map(tool => tool.name);
    expect(names).toContain('classmates_spawn');
    expect(names).not.toContain('list_subagent_models');
  } finally {
    dispose();
  }
  state.modelProfiles = [];
  const empty = await tools.list(lead) as { modelProfiles?: ModelProfile[] };
  expect(empty.modelProfiles ?? []).toEqual([]);
});

it('spawns a Team member on the selected profile route and keeps the snapshot after the preset is removed', async () => {
  const { tools, lead, ctx, adapter, store, state } = await setup([LOW, DEFAULT_ROUTE]);
  const input: SpawnArgs = { classmate_id: 'test', revision: 1, name: 'specialist', task: 'One initial task', model_profile: 'coding-low' };
  const receipt = await tools.spawn(lead, input as SpawnInput, SIGNAL);
  expect(receipt.reused).toBe(false);
  expect(receipt.selected).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' });
  await vi.waitFor(() => expect(adapter.requests.find(request => requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS'))).toMatchObject({
    model: 'specialist-a',
    reasoningEffort: 'low',
  }));
  expect((await store.read(lead.id, 'specialist'))?.role.model).toEqual(receipt.selected);
  state.modelProfiles = [];
  state.roles[0].model = { provider: 'mock', id: 'specialist-b', reasoningEffort: 'high' };
  expect((await store.read(lead.id, 'specialist'))?.role.model).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' });
  expect(ctx.agentTeams.listMembers(lead).map(member => member.name)).toEqual(expect.arrayContaining(['lead', 'specialist']));
});

it('rejects a different profile under the same member name and reuses an identical selection', async () => {
  const { tools, lead, ctx, adapter } = await setup([LOW, HIGH]);
  const input: SpawnArgs = { classmate_id: 'test', revision: 1, name: 'specialist', task: 'One initial task', model_profile: 'coding-low' };
  const first = await tools.spawn(lead, input as SpawnInput, SIGNAL);
  expect(first.selected).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' });
  await vi.waitFor(() => expect(specialistChildRequests(adapter, 'low')).toHaveLength(1));
  const rosterAfterFirst = ctx.agentTeams.listMembers(lead).map(member => member.id).sort();
  const childTasksAfterFirst = childTaskRequests(adapter).length;
  expect(ctx.agentTeams.listMembers(lead).map(member => member.name).sort()).toEqual(['lead', 'specialist']);
  expect(specialistChildRequests(adapter, 'high')).toHaveLength(0);

  await expect(tools.spawn(lead, { ...input, model_profile: 'coding-high' } as SpawnInput, SIGNAL)).rejects.toThrow('不同');
  expect(ctx.agentTeams.listMembers(lead).map(member => member.id).sort()).toEqual(rosterAfterFirst);
  expect(ctx.agentTeams.listMembers(lead).filter(member => member.name === 'specialist')).toHaveLength(1);
  expect(childTaskRequests(adapter)).toHaveLength(childTasksAfterFirst);
  expect(specialistChildRequests(adapter, 'high')).toHaveLength(0);
  expect(specialistChildRequests(adapter)).toEqual(specialistChildRequests(adapter, 'low'));

  const again = await tools.spawn(lead, input as SpawnInput, SIGNAL);
  expect(again.reused).toBe(true);
  expect(again.member.id).toBe(first.member.id);
  expect(again.selected).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' });
  expect(ctx.agentTeams.listMembers(lead).map(member => member.id).sort()).toEqual(rosterAfterFirst);
  expect(childTaskRequests(adapter)).toHaveLength(childTasksAfterFirst);
  expect(specialistChildRequests(adapter, 'high')).toHaveLength(0);
});

it('rejects unknown and disabled Team profile selection without a member or automatic retry', async () => {
  const { tools, lead, ctx, adapter, store } = await setup([LOW, PARKED]);
  const base = { classmate_id: 'test', revision: 1, name: 'specialist', task: 'Must not run' };
  await expect(tools.spawn(lead, { ...base, model_profile: 'coding-missing' } as SpawnInput, SIGNAL)).rejects.toThrow();
  await expect(tools.spawn(lead, { ...base, model_profile: 'coding-parked' } as SpawnInput, SIGNAL)).rejects.toThrow();
  await expect(tools.spawn(lead, { ...base, model_profile: 'coding-missing' } as SpawnInput, SIGNAL)).rejects.toThrow();
  expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1);
  expect(await store.read(lead.id, 'specialist')).toBeUndefined();
  expect(adapter.requests).toHaveLength(0);
});

it('overrides a high parent and high template with a profile that omits effort', async () => {
  const { tools, lead, adapter, state } = await setup([DEFAULT_ROUTE]);
  state.roles[0].model = { provider: 'mock', id: 'mock', reasoningEffort: 'high' };
  const receipt = await tools.spawn(lead, {
    classmate_id: 'test',
    revision: 1,
    name: 'inherited',
    task: 'Run inherited task',
    model_profile: 'coding-default',
  } as SpawnInput, SIGNAL);
  expect(receipt.selected).toEqual({ provider: 'mock', id: 'mock' });
  expect(receipt.selected?.reasoningEffort).toBeUndefined();
  await vi.waitFor(() => expect(adapter.requests.find(request => requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS'))).toMatchObject({
    model: 'mock',
  }));
  expect(adapter.requests.find(request => requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS'))?.reasoningEffort).toBeUndefined();
});

it('rejects Team configuration tools from a different caller identity', async () => {
  const { tools, lead, ctx } = await setup([LOW]);
  const outsider = await ctx.agentLoop.create(SessionId('outsider'), {
    provider: 'mock',
    model: 'mock',
    reasoningEffort: ReasoningEffortId('high'),
  });
  const dispose = tools.install(lead);
  try {
    const listTool = lead.ctx.tools.get('classmates_list', lead);
    const spawnTool = lead.ctx.tools.get('classmates_spawn', lead);
    expect(listTool?.name).toBe('classmates_list');
    expect(spawnTool?.name).toBe('classmates_spawn');
    const listed = await listTool!.execute({}, {
      callId: ToolCallId('list-lead'),
      name: 'classmates_list',
      arguments: {},
      agent: lead,
      signal: SIGNAL,
    } as never);
    expect(listed).toMatchObject({
      roles: [{ id: 'test' }],
      modelProfiles: [expect.objectContaining({ id: 'coding-low' })],
    });
    await expect(listTool!.execute({}, {
      callId: ToolCallId('list-outsider'),
      name: 'classmates_list',
      arguments: {},
      agent: outsider,
      signal: SIGNAL,
    } as never)).rejects.toThrow(/identity|mismatch|LEAD_ONLY|只有 Team Lead/);
    await expect(spawnTool!.execute({
      classmate_id: 'test',
      revision: 1,
      name: 'specialist',
      task: 'Must not run',
      model_profile: 'coding-low',
    }, {
      callId: ToolCallId('spawn-outsider'),
      name: 'classmates_spawn',
      arguments: {},
      agent: outsider,
      signal: SIGNAL,
    } as never)).rejects.toThrow(/identity|mismatch|LEAD_ONLY|只有 Team Lead/);
    expect(ctx.agentTeams.listMembers(lead).map(member => member.name)).toEqual(['lead']);
  } finally {
    dispose();
  }
});

it('reuses an identical profile spawn from the frozen instance after the preset is edited, disabled, or removed', async () => {
  const { tools, lead, ctx, adapter, store, state } = await setup([LOW]);
  const input: SpawnArgs = { classmate_id: 'test', revision: 1, name: 'specialist', task: 'One initial task', model_profile: 'coding-low' };
  const first = await tools.spawn(lead, input as SpawnInput, SIGNAL);
  expect(first.reused).toBe(false);
  expect(first.selected).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' });
  await vi.waitFor(() => expect(specialistChildRequests(adapter, 'low')).toHaveLength(1));
  const roster = ctx.agentTeams.listMembers(lead).map(member => member.id).sort();
  const childTasks = childTaskRequests(adapter).length;
  expect(ctx.agentTeams.listMembers(lead).map(member => member.name).sort()).toEqual(['lead', 'specialist']);

  state.modelProfiles = [{ ...LOW, model: { provider: 'mock', id: 'specialist-b', reasoningEffort: 'high' } }];
  const afterEdit = await tools.spawn(lead, input as SpawnInput, SIGNAL);
  expect(afterEdit.reused).toBe(true);
  expect(afterEdit.member.id).toBe(first.member.id);
  expect(afterEdit.selected).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' });
  expect((await store.read(lead.id, 'specialist'))?.role.model).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' });

  state.modelProfiles = [{ ...LOW, enabled: false }];
  const afterDisable = await tools.spawn(lead, input as SpawnInput, SIGNAL);
  expect(afterDisable.reused).toBe(true);
  expect(afterDisable.member.id).toBe(first.member.id);
  expect(afterDisable.selected).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' });

  state.modelProfiles = [];
  const afterRemove = await tools.spawn(lead, input as SpawnInput, SIGNAL);
  expect(afterRemove.reused).toBe(true);
  expect(afterRemove.member.id).toBe(first.member.id);
  expect(afterRemove.selected).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' });
  expect(ctx.agentTeams.listMembers(lead).map(member => member.id).sort()).toEqual(roster);
  expect(childTaskRequests(adapter)).toHaveLength(childTasks);
  expect(specialistChildRequests(adapter, 'high')).toHaveLength(0);
  expect(adapter.requests.filter(request => request.model === 'specialist-b')).toHaveLength(0);

  await expect(tools.spawn(lead, { ...input, name: 'newcomer' } as SpawnInput, SIGNAL)).rejects.toThrow();
  expect(ctx.agentTeams.listMembers(lead).filter(member => member.name === 'newcomer')).toHaveLength(0);
  expect(childTaskRequests(adapter)).toHaveLength(childTasks);
});

it('reuses a prepared profile snapshot after cancellation and later preset removal', async () => {
  const { tools, lead, ctx, adapter, store, state } = await setup([LOW]);
  const abort = new AbortController();
  const prepare = store.prepare.bind(store);
  vi.spyOn(store, 'prepare').mockImplementationOnce(async (...args) => {
    const snapshot = await prepare(...args);
    abort.abort();
    return snapshot;
  });
  const input: SpawnArgs = { classmate_id: 'test', revision: 1, name: 'prepared', task: 'Prepared retry', model_profile: 'coding-low' };
  await expect(tools.spawn(lead, input as SpawnInput, abort.signal)).rejects.toThrow();
  expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1);
  expect((await store.read(lead.id, 'prepared'))?.role.model).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' });
  expect((await store.read(lead.id, 'prepared'))?.childId).toBeUndefined();
  expect(adapter.requests.filter(request => requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS'))).toHaveLength(0);

  state.modelProfiles = [];
  const receipt = await tools.spawn(lead, input as SpawnInput, SIGNAL);
  expect(receipt.reused).toBe(false);
  expect(receipt.selected).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' });
  expect((await store.read(lead.id, 'prepared'))?.role.model).toEqual(receipt.selected);
  await vi.waitFor(() => expect(specialistChildRequests(adapter, 'low')).toHaveLength(1));
  expect(childTaskRequests(adapter)).toHaveLength(1);
  expect(requestText(specialistChildRequests(adapter, 'low')[0])).toContain('Prepared retry');
  expect(ctx.agentTeams.listMembers(lead).map(member => member.name).sort()).toEqual(['lead', 'prepared']);
  expect(specialistChildRequests(adapter, 'high')).toHaveLength(0);
});

it('rejects a different profile id under the same member name even when the routes match', async () => {
  const { tools, lead, ctx, adapter } = await setup([LOW, LOW_ALIAS]);
  const input: SpawnArgs = { classmate_id: 'test', revision: 1, name: 'specialist', task: 'One initial task', model_profile: 'coding-low' };
  const first = await tools.spawn(lead, input as SpawnInput, SIGNAL);
  expect(first.selected).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' });
  await vi.waitFor(() => expect(specialistChildRequests(adapter, 'low')).toHaveLength(1));
  const roster = ctx.agentTeams.listMembers(lead).map(member => member.id).sort();
  const childTasks = childTaskRequests(adapter).length;

  await expect(tools.spawn(lead, { ...input, model_profile: 'coding-low-alias' } as SpawnInput, SIGNAL)).rejects.toThrow('不同');
  expect(ctx.agentTeams.listMembers(lead).map(member => member.id).sort()).toEqual(roster);
  expect(ctx.agentTeams.listMembers(lead).filter(member => member.name === 'specialist')).toHaveLength(1);
  expect(childTaskRequests(adapter)).toHaveLength(childTasks);
  expect(specialistChildRequests(adapter, 'low')).toHaveLength(1);
  expect(specialistChildRequests(adapter, 'high')).toHaveLength(0);
});

it('cancels Team profile dispatch before a member exists', async () => {
  const { tools, lead, ctx, adapter, store } = await setup([LOW]);
  await expect(tools.spawn(lead, {
    classmate_id: 'test',
    revision: 1,
    name: 'specialist',
    task: 'Do not start',
    model_profile: 'coding-low',
  } as SpawnInput, AbortSignal.abort())).rejects.toThrow();
  expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1);
  expect(await store.read(lead.id, 'specialist')).toBeUndefined();
  expect(adapter.requests).toHaveLength(0);
});

it('keeps a raw JSON task distinct from a profiled creation request', async () => {
  const { tools, lead, store, adapter } = await setup([LOW]);
  const input: SpawnInput = { classmate_id: 'test', revision: 1, name: 'specialist',
    task: JSON.stringify({ task: 'Review', model_profile: LOW.id }) };
  await tools.spawn(lead, input, SIGNAL);
  await vi.waitFor(() => expect(childTaskRequests(adapter)).toHaveLength(1));
  expect((await store.read(lead.id, input.name))?.modelProfileId).toBeUndefined();
  await expect(tools.spawn(lead, { ...input, task: 'Review', model_profile: LOW.id }, SIGNAL)).rejects.toThrow('不同');
  await expect(tools.spawn(lead, { ...input, model_profile: LOW.id }, SIGNAL)).rejects.toThrow('不同');
  expect(childTaskRequests(adapter)).toHaveLength(1);
});

it('prefers a legacy fixed model over a recommendation and lists the migration note', async () => {
  const { tools, lead, adapter, state, store } = await setup([LOW, HIGH, PARKED]);
  state.roles[0].recommendedModelProfileId = 'coding-high';
  state.roles[0].model = { provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' };
  const listed = await tools.list(lead);
  expect(listed.roles[0]).toMatchObject({
    model: { kind: 'fixed', provider: 'mock', id: 'specialist-a', effort: 'low' },
    migratedRecommendation: 'coding-high',
  });
  expect(listed.roles[0]).not.toHaveProperty('recommendedModelProfile');
  expect(JSON.stringify(listed.roles[0])).not.toContain('careful review pass');
  const omitted = await tools.spawn(lead, { classmate_id: 'test', revision: 1, name: 'legacy', task: 'Keep role route' }, SIGNAL);
  expect(omitted.selected).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' });
  expect((await store.read(lead.id, 'legacy'))?.role).not.toHaveProperty('recommendedModelProfileId');
  await vi.waitFor(() => expect(adapter.requests.find(request => requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS'))).toMatchObject({
    model: 'specialist-a', reasoningEffort: 'low',
  }));

  const override = await tools.spawn(lead, {
    classmate_id: 'test', revision: 1, name: 'override', task: 'Use explicit profile', model_profile: 'coding-low',
  } as SpawnInput, SIGNAL);
  expect(override.selected).toEqual(LOW.model);

  const dispose = tools.install(lead);
  try {
    const assembly = await lead.ctx.systemPrompt.assemble({ scope: lead });
    const text = assembly.sections.map(section => section.text).join('\n');
    expect(text).toMatch(/strong preset reference/);
    expect(text).toMatch(/Lead may work alone/);
    expect(JSON.stringify(lead.ctx.tools.get('classmates_spawn', lead)?.parameters ?? '')).toMatch(/Highest-priority one-call override/);
  } finally {
    dispose();
  }
});

it('migrates a recommendation-only role into a strong profile reference used on omitted dispatch', async () => {
  const { tools, lead, adapter, state, store } = await setup([LOW, HIGH, PARKED]);
  state.roles[0].model = null;
  state.roles[0].recommendedModelProfileId = 'coding-high';
  const listed = await tools.list(lead);
  expect(listed.roles[0]).toMatchObject({ model: { kind: 'profile', profileId: 'coding-high' } });
  expect(listed.roles[0]).not.toHaveProperty('migratedRecommendation');

  const receipt = await tools.spawn(lead, { classmate_id: 'test', revision: 1, name: 'strong', task: 'Use the bound profile' }, SIGNAL);
  expect(receipt.selected).toEqual({ provider: 'mock', id: 'specialist-a', reasoningEffort: 'high' });
  expect((await store.read(lead.id, 'strong'))?.role.model).toEqual(receipt.selected);
  await vi.waitFor(() => expect(adapter.requests.find(request => requestText(request).includes('SECRET_LONG_ROLE_INSTRUCTIONS'))).toMatchObject({
    model: 'specialist-a', reasoningEffort: 'high',
  }));
});

it.each([
  { profiles: [] as ModelProfile[], message: '预设 coding-low 不存在，请在角色 Test 的模型设置中改选或改为跟随主控' },
  { profiles: [modelProfile({ id: 'coding-low', enabled: false })], message: '预设 coding-low 已停用，请在角色 Test 的模型设置中改选或改为跟随主控' },
])('hard-fails a strong profile reference when the preset is missing or disabled', async ({ profiles, message }) => {
  const { tools, lead, ctx, adapter, state, store } = await setup(profiles);
  state.roles[0].model = null;
  state.roles[0].recommendedModelProfileId = 'coding-low';
  expect((await tools.list(lead)).roles[0]).toMatchObject({ model: { kind: 'profile', profileId: 'coding-low' } });
  const input = { classmate_id: 'test', revision: 1, name: 'strong', task: 'Must not run' };
  await expect(tools.spawn(lead, input, SIGNAL)).rejects.toThrow(message);
  await expect(tools.spawn(lead, input, SIGNAL)).rejects.toThrow(message);
  expect(ctx.agentTeams.listMembers(lead)).toHaveLength(1);
  expect(await store.read(lead.id, 'strong')).toBeUndefined();
  expect(adapter.requests).toHaveLength(0);

  // The one-call override still wins over the broken strong reference.
  state.modelProfiles = [...state.modelProfiles, HIGH];
  const override = await tools.spawn(lead, { ...input, name: 'override', model_profile: 'coding-high' } as SpawnInput, SIGNAL);
  expect(override.selected).toEqual(HIGH.model);
});

function hasUndefinedOwn(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  return Object.values(value).some(item => item === undefined || hasUndefinedOwn(item));
}

it('official tools.execute lists a recommendation-only role as a strong profile reference with no undefined own properties', async () => {
  const { tools, lead, ctx, state } = await setup([HIGH]);
  state.roles[0].model = null;
  delete state.roles[0].reasoningEffort;
  state.roles[0].recommendedModelProfileId = 'coding-high';
  const dispose = tools.install(lead);
  try {
    const result = await ctx.tools.execute({
      agent: lead,
      name: 'classmates_list',
      arguments: {},
      callId: ToolCallId(crypto.randomUUID()),
      signal: SIGNAL,
    });
    expect(result.isError, JSON.stringify(result)).toBe(false);
    const listed = result.value as {
      roles: Array<Record<string, unknown>>;
    };
    expect(listed.roles[0]).toMatchObject({
      id: 'test',
      model: { kind: 'profile', profileId: 'coding-high' },
    });
    expect(listed.roles[0]).not.toHaveProperty('reasoningEffort');
    expect(listed.roles[0]).not.toHaveProperty('recommendedModelProfile');
    expect(listed.roles[0]).not.toHaveProperty('recommendedModelProfileId');
    expect(listed.roles[0]).not.toHaveProperty('migratedRecommendation');
    expect(JSON.parse(JSON.stringify(listed))).toEqual(listed);
    expect(hasUndefinedOwn(listed)).toBe(false);
  } finally {
    dispose();
  }
});

