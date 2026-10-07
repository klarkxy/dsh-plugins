import { afterEach, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createScope, scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope';
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { CREATOR_PRESET_ID, type ModelRoute } from '../src/contracts.js';
import * as Management from '../src/role-management.js';

const SIGNAL = new AbortController().signal;
const contexts: Context[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose();
});

function jsonOutput() {
  return {
    schema: { type: 'json' as const },
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
  };
}

function fakeAgent(ctx: Context, id: string): Agent {
  return {
    id: SessionId(id),
    ctx,
    session: { header: { origin: undefined, delegationDepth: undefined, parentSession: undefined } },
  } as unknown as Agent;
}

function call(name: string, agent: Agent, args: Record<string, unknown> = {}) {
  return {
    callId: ToolCallId(`${name}-${agent.id}`),
    name,
    arguments: args,
    agent,
    signal: SIGNAL,
  };
}

async function boot() {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx);
  const presetKey = {};
  const outsider = fakeAgent(ctx, 'outsider');
  const creator = fakeAgent(ctx, 'creator');
  const preset = createScope(ctx, presetKey);
  const agentScope = createScope(ctx, creator, { parent: presetKey });
  const outsiderScope = createScope(ctx, outsider);
  (creator as { ctx: Context }).ctx = agentScope.ctx;
  (outsider as { ctx: Context }).ctx = outsiderScope.ctx;
  let mode = CREATOR_PRESET_ID;
  let teammate = false;
  ctx.provide('agentTeams', { tryMembership: () => ({ role: teammate ? 'teammate' : 'lead' }) });
  ctx.provide('agentPresets', {
    composedPreset: (scope: Context) => {
      const key = scopeOf(scope);
      if (key === presetKey) return undefined;
      if (key === creator || (key !== undefined && scopeParentOf(key) === presetKey)) return mode;
      return 'standard';
    },
  });
  let batched: unknown;
  let profileBatched: unknown;
  let profileBatchRoles: unknown[] = [];
  let protectedModels: ModelRoute[] = [];
  ctx.provide('classmatesController', {
    load: async () => ({
      roles: [],
      modelProfiles: [],
      protectedModels,
      models: [{
        provider: 'test', id: 'one', name: 'One', description: 'Catalog model blurb',
        efforts: [{ id: 'high', name: 'High', description: 'Think longer' }],
      }],
      settingsRevision: 3,
      writable: true,
      currentModel: { provider: 'deepseek-official', id: 'invented-from-load' },
      modelAvailabilityNotice: 'forged',
    }),
    batch: async (changes: unknown, expected: number) => {
      batched = { changes, expected };
      return { roles: [], modelProfiles: [], models: [], settingsRevision: expected + 1, writable: true };
    },
    batchModelProfiles: async (changes: unknown, expected: number) => {
      profileBatched = { changes, expected };
      return { roles: profileBatchRoles, modelProfiles: [], models: [], settingsRevision: expected + 1, writable: true };
    },
    setModelProtection: async (model: ModelRoute, required: boolean, expected: number) => {
      if (expected !== 3) throw new Error('revision conflict');
      protectedModels = required ? [model] : [];
      return { roles: [], modelProfiles: [], protectedModels, models: [], settingsRevision: 3, writable: true };
    },
  });
  let dispose = () => {};
  await agentScope.ctx.plugin({
    name: 'creator-owner-services', inject: ['tools', 'systemPrompt'],
    apply(scope: Context) {
      (creator as { ctx: Context }).ctx = scope;
      dispose = Management.installRoleManagement(ctx, creator);
      scope.effect(() => dispose);
    },
  });
  return { ctx, preset, agentScope, creator, outsider, dispose, setMode: (value: string) => { mode = value; }, setTeammate: (value: boolean) => { teammate = value; }, getBatched: () => batched, getProfileBatched: () => profileBatched, setProfileBatchRoles: (roles: unknown[]) => { profileBatchRoles = roles; }, getProtected: () => protectedModels };
}

it('permits Creator locking but requires native approval for unlocking and rechecks caller after approval', async () => {
  const { ctx, creator, outsider, getProtected, setMode } = await boot();
  const model = { provider: 'test', id: 'one' };
  const args = { model, required: true, expected: 3 };
  expect((await ctx.tools.execute(call('classmates_model_protection', outsider, args))).isError).toBe(true);
  expect((await ctx.tools.execute(call('classmates_model_protection', creator, args))).isError).toBe(false);
  expect(getProtected()).toEqual([model]);
  let outcome = 'rejected';
  let changeMode = false;
  let asks = 0;
  ctx.provide('approval', { request: async () => { asks++; if (changeMode) setMode('standard'); return outcome; } });
  const unlock = () => ctx.tools.execute(call('classmates_model_protection', creator, { ...args, required: false }));
  expect((await unlock()).isError).toBe(true);
  expect(getProtected()).toEqual([model]);
  outcome = 'allowed-once';
  changeMode = true;
  expect((await unlock()).isError).toBe(true);
  expect(getProtected()).toEqual([model]);
  changeMode = false;
  setMode(CREATOR_PRESET_ID);
  expect((await unlock()).isError).toBe(false);
  expect(getProtected()).toEqual([]);
  expect(asks).toBe(3);
});

it('registers only on the eligible creator agent scope, including an empty library', async () => {
  const { ctx, agentScope, creator } = await boot();
  const scope = scopeOf(agentScope.ctx);
  expect(ctx.tools.get('classmates_read', scope)?.name).toBe('classmates_read');
  expect(ctx.tools.get('classmates_batch', scope)?.name).toBe('classmates_batch');
  expect(ctx.tools.get('classmates_models_batch', scope)?.name).toBe('classmates_models_batch');
  const read = await ctx.tools.execute(call('classmates_read', creator));
  expect(read.isError).toBe(false);
  if (!read.isError) {
    expect(read.value).toMatchObject({
      roles: [],
      modelProfiles: [],
      settingsRevision: 3,
      currentModel: null,
      modelAvailabilityNotice: Management.MODEL_AVAILABILITY_NOTICE,
      models: [{
        description: 'Catalog model blurb',
        efforts: [{ id: 'high', name: 'High', description: 'Think longer' }],
      }],
    });
    expect(read.value).not.toMatchObject({ currentModel: { id: 'invented-from-load' } });
  }
});

it('rejects ordinary agents and subagents even if they obtain the tool', async () => {
  const { ctx, outsider, creator, getBatched, getProfileBatched } = await boot();
  const hidden = await ctx.tools.execute(call('classmates_read', outsider));
  expect(hidden.isError).toBe(true);
  expect((await ctx.tools.execute(call('classmates_models_batch', outsider, { changes: [], expected: 3 }))).isError).toBe(true);
  const header = creator.session.header as { origin?: string; delegationDepth?: number };
  header.origin = 'subagent';
  header.delegationDepth = 1;
  const denied = await ctx.tools.execute(call('classmates_read', creator));
  expect(denied.isError).toBe(true);
  if (denied.isError) expect(denied.error.message).toMatch(/创造模式的主智能体/);
  expect((await ctx.tools.execute(call('classmates_models_batch', creator, { changes: [], expected: 3 }))).isError).toBe(true);
  header.origin = undefined;
  header.delegationDepth = undefined;
  const applied = await ctx.tools.execute(call('classmates_batch', creator, { changes: [], expected: 3 }));
  expect(applied.isError).toBe(false);
  expect(getBatched()).toEqual({ changes: [], expected: 3 });
  const profiles = await ctx.tools.execute(call('classmates_models_batch', creator, { changes: [], expected: 3 }));
  expect(profiles.isError).toBe(false);
  expect(getProfileBatched()).toEqual({ changes: [], expected: 3 });
});

it('preserves Creator execution tools and team policy while adding configuration guidance', async () => {
  const { ctx, agentScope, creator } = await boot();
  await agentScope.ctx.plugin({
    name: 'fake-team-tools',
    inject: ['tools', 'systemPrompt'],
    apply(scope: Context) {
      scope.tools.register(defineTool({
        name: 'spawn_teammate',
        description: 'Create a teammate.',
        parameters: { name: { type: 'string', required: true } },
        output: jsonOutput(),
        execute: async () => ({ spawned: true }),
      }));
      scope.systemPrompt.section({ name: 'team:policy', order: 600, text: 'Create teammates freely.' });
    },
  });
  const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(agentScope.ctx) });
  expect(assembly.tools.map(tool => tool.name)).toContain('classmates_read');
  expect(assembly.tools.map(tool => tool.name)).toContain('spawn_teammate');
  expect(assembly.sections.some(section => section.name === 'team:policy')).toBe(true);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/or invent model prices or capability rankings/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/Call classmates_read first/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/complete set of complementary roles/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/without an extra approval step/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/Do not overwrite unseen changes/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/Do not inspect or configure credentials/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/frozen at creation/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/independent model-use presets/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/do not require a user model selection/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/classmates_models_batch/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/silently migrate/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/compatibility only/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/recommendedModelProfileId/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/pairing hint/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/disabled Advisor preset/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).toMatch(/Lead may work alone/);
  expect(assembly.sections.find(section => section.name === 'classmates:configuration')?.text).not.toMatch(/\p{Script=Han}/u);
  expect(JSON.stringify(assembly.tools)).not.toMatch(/最强|推荐排名|定价/);
  const denied = await ctx.tools.execute(call('spawn_teammate', creator, { name: 'reviewer' }));
  expect(denied.isError).toBe(false);
});

it('denies parentSession-only children at installation and captured tool dispatch', async () => {
  const { ctx, creator, getBatched, getProfileBatched, dispose } = await boot();
  const read = creator.ctx.tools.get('classmates_read', creator)!;
  (creator.session.header as { parentSession?: string }).parentSession = 'parent-creator';
  expect(Management.isCreatorRoot(ctx, creator)).toBe(false);
  await expect(read.execute({}, { agent: creator } as never)).rejects.toThrow(/创造模式的主智能体/);
  expect((await ctx.tools.execute(call('classmates_batch', creator, { changes: [], expected: 3 }))).isError).toBe(true);
  expect((await ctx.tools.execute(call('classmates_models_batch', creator, { changes: [], expected: 3 }))).isError).toBe(true);
  dispose();
  Management.installRoleManagement(ctx, creator);
  expect(creator.ctx.tools.get('classmates_read', creator)).toBeUndefined();
  expect(getBatched()).toBeUndefined();
  expect(getProfileBatched()).toBeUndefined();
});

it('does not install global configuration tools or an execution guard without a Creator binding', async () => {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx);
  ctx.provide('classmatesController', { load: async () => ({}) });
  ctx.tools.register(defineTool({
    name: 'spawn_teammate',
    description: 'Create a teammate.',
    parameters: {},
    output: jsonOutput(),
    execute: async () => ({ spawned: true }),
  }));
  Management.installRoleManagement(ctx, fakeAgent(ctx, 'not-creator'));
  expect(ctx.tools.get('classmates_read')).toBeUndefined();
  const allowed = await ctx.tools.execute({
    callId: ToolCallId('spawn-global'), name: 'spawn_teammate', arguments: {}, signal: SIGNAL,
  });
  expect(allowed.isError).toBe(false);
});

it('exposes a concrete first-role schema so the model need not guess field shapes', async () => {
  const { ctx, agentScope, creator, getBatched } = await boot();
  const schema = JSON.stringify(ctx.tools.get('classmates_batch', scopeOf(agentScope.ctx))?.parameters ?? {});
  expect(schema).not.toMatch(/"type":"json"/);
  expect(schema).toMatch(/"schemaVersion"/);
  expect(schema).toMatch(/"const":1/);
  expect(schema).toMatch(/新建为 0/);
  expect(schema).toMatch(/\[a-z0-9\]/);
  expect(schema).toMatch(/"enabled"/);
  expect(schema).toMatch(/"instructions"/);
  expect(schema).toMatch(/"provider"/);
  expect(schema).toMatch(/跟随当前聊天模型/);
  expect(schema).toMatch(/"kind"/);
  expect(schema).toMatch(/强引用/);
  expect(schema).toMatch(/recommendedModelProfileId/);
  expect(schema).toMatch(/migratedRecommendation/);
  const first = {
    schemaVersion: 1,
    id: 'reviewer',
    revision: 0,
    name: 'Reviewer',
    description: 'reviews drafts',
    instructions: 'Review the draft.',
    enabled: false,
    model: { kind: 'inherit' },
  };
  const applied = await ctx.tools.execute(call('classmates_batch', creator, {
    changes: [{ op: 'upsert', role: first }],
    expected: 3,
  }));
  expect(applied.isError).toBe(false);
  expect(getBatched()).toEqual({ changes: [{ op: 'upsert', role: first }], expected: 3 });

  // The legacy recommendation input stays accepted and is forwarded for migration.
  const hinted = { ...first, model: null, recommendedModelProfileId: 'coding-high' };
  const migrated = await ctx.tools.execute(call('classmates_batch', creator, {
    changes: [{ op: 'upsert', role: hinted }],
    expected: 3,
  }));
  expect(migrated.isError).toBe(false);
  expect(getBatched()).toEqual({ changes: [{ op: 'upsert', role: hinted }], expected: 3 });
});

it('lists roles referencing a removed or disabled preset without blocking the operation', async () => {
  const { ctx, creator, setProfileBatchRoles } = await boot();
  const referencing = {
    schemaVersion: 1,
    id: 'reviewer',
    revision: 1,
    name: 'Reviewer',
    description: 'reviews drafts',
    instructions: 'Review the draft.',
    enabled: true,
    model: { kind: 'profile', profileId: 'coding-high' },
  };
  setProfileBatchRoles([referencing]);
  const removed = await ctx.tools.execute(call('classmates_models_batch', creator, {
    changes: [{ op: 'remove', id: 'coding-high', revision: 1 }],
    expected: 3,
  }));
  expect(removed.isError).toBe(false);
  if (!removed.isError) expect((removed.value as { referencingRoles?: string[] }).referencingRoles).toEqual(['Reviewer']);

  const disabled = await ctx.tools.execute(call('classmates_models_batch', creator, {
    changes: [{ op: 'upsert', profile: { id: 'coding-high', revision: 1, name: 'Deep', description: 'careful', enabled: false, model: { provider: 'test', id: 'one' } } }],
    expected: 3,
  }));
  expect(disabled.isError).toBe(false);
  if (!disabled.isError) expect((disabled.value as { referencingRoles?: string[] }).referencingRoles).toEqual(['Reviewer']);

  // Unrelated edits attach no referencingRoles field at all.
  const plain = await ctx.tools.execute(call('classmates_models_batch', creator, {
    changes: [{ op: 'upsert', profile: { id: 'coding-low', revision: 1, name: 'Fast', description: 'cheap', enabled: true, model: { provider: 'test', id: 'one' } } }],
    expected: 3,
  }));
  expect(plain.isError).toBe(false);
  if (!plain.isError) expect(plain.value).not.toHaveProperty('referencingRoles');
});

it('exposes a strict model-use preset schema and reuses the profile batch RPC', async () => {
  const { ctx, agentScope, creator, getProfileBatched } = await boot();
  const schema = JSON.stringify(ctx.tools.get('classmates_models_batch', scopeOf(agentScope.ctx))?.parameters ?? {});
  expect(schema).not.toMatch(/"type":"json"/);
  expect(schema).toMatch(/"profile"/);
  expect(schema).toMatch(/新建为 0/);
  expect(schema).toMatch(/\[a-z0-9\]/);
  expect(schema).toMatch(/模型的默认强度/);
  expect(schema).not.toMatch(/"schemaVersion"/);
  const first = {
    id: 'coding-high',
    revision: 0,
    name: 'Deep coding',
    description: 'careful implementation',
    enabled: true,
    model: { provider: 'test', id: 'one', reasoningEffort: 'high' },
  };
  const applied = await ctx.tools.execute(call('classmates_models_batch', creator, {
    changes: [{ op: 'upsert', profile: first }],
    expected: 3,
  }));
  expect(applied.isError).toBe(false);
  expect(getProfileBatched()).toEqual({ changes: [{ op: 'upsert', profile: first }], expected: 3 });
});

function requestHeader(seq: number, provider: string, model: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'request/header',
    seq,
    data: { header: { config: { provider, model, ...extra } }, reason: 'initial' },
  };
}

it('attaches the calling agent own request route and ignores inherited or option fallbacks', async () => {
  const { ctx, creator } = await boot();
  const session = creator.session as unknown as {
    inheritedEventCount?: number;
    events?: unknown[];
    ownEvents?: () => unknown[];
    requestHeader?: () => unknown;
    header: { origin?: string; parentSession?: string };
  };
  (creator as { options?: { provider: string; model: string } }).options = {
    provider: 'deepseek-official',
    model: 'deepseek-chat',
  };
  session.inheritedEventCount = 2;
  session.requestHeader = () => ({ config: { provider: 'deepseek-official', model: 'deepseek-chat' } });
  const inherited = [
    requestHeader(0, 'deepseek-official', 'deepseek-chat'),
    requestHeader(1, 'ocg', 'parent-only'),
  ];
  session.events = inherited;
  session.ownEvents = () => inherited;

  const unseen = await ctx.tools.execute(call('classmates_read', creator));
  expect(unseen.isError).toBe(false);
  if (!unseen.isError) {
    expect(unseen.value).toMatchObject({
      currentModel: null,
      modelAvailabilityNotice: Management.MODEL_AVAILABILITY_NOTICE,
    });
    expect(JSON.stringify(unseen.value)).toMatch(/不代表连通或可完成请求/);
    expect(JSON.stringify(unseen.value)).toMatch(/不代表模型在本机推理/);
  }

  session.events = [
    ...inherited,
    requestHeader(2, 'ocg', 'step-5-preview', { reasoningEffort: 'high' }),
  ];
  session.ownEvents = () => [requestHeader(2, 'ocg', 'step-5-preview', { reasoningEffort: 'high' })];
  const seen = await ctx.tools.execute(call('classmates_read', creator));
  expect(seen.isError).toBe(false);
  if (!seen.isError) {
    expect(seen.value).toMatchObject({
      currentModel: {
        provider: 'ocg',
        id: 'step-5-preview',
        reasoningEffort: 'high',
      },
    });
  }
});

it('does not treat a malformed own header or session storage header as the current route', async () => {
  const { ctx, creator } = await boot();
  const session = creator.session as unknown as {
    inheritedEventCount?: number;
    events?: unknown[];
    header: Record<string, unknown>;
  };
  session.inheritedEventCount = 0;
  session.header.config = { provider: 'ocg', model: 'from-session-header' };
  session.events = [
    { type: 'request/header', seq: 0, data: { header: { config: { provider: ['ocg'], model: 'bad' } } } },
    { type: 'request/header', seq: 1, data: { header: { config: { provider: 'ocg', model: ' '.repeat(3) } } } },
  ];
  const read = await ctx.tools.execute(call('classmates_read', creator));
  expect(read.isError).toBe(false);
  if (!read.isError) expect(read.value).toMatchObject({ currentModel: null });
});



it('checks live preset and teammate identity at dispatch and removes registrations on dispose', async () => {
  const { ctx, creator, outsider, setMode, setTeammate, dispose } = await boot();
  const captured = ctx.tools.get('classmates_batch', creator)!;
  setMode('standard');
  expect((await ctx.tools.execute(call('classmates_batch', creator, { changes: [], expected: 3 }))).isError).toBe(true);
  setMode(CREATOR_PRESET_ID);
  setTeammate(true);
  expect((await ctx.tools.execute(call('classmates_read', creator))).isError).toBe(true);
  setTeammate(false);
  await expect(captured.execute({ changes: [], expected: 3 }, call('classmates_batch', outsider) as never)).rejects.toThrow(/创造模式/);
  expect((await ctx.tools.execute(call('classmates_read', creator))).isError).toBe(false);
  dispose();
  expect(ctx.tools.get('classmates_read', creator)).toBeUndefined();
  expect(ctx.tools.get('classmates_batch', creator)).toBeUndefined();
  expect(ctx.tools.get('classmates_models_batch', creator)).toBeUndefined();
  await expect(captured.execute({ changes: [], expected: 3 }, call('classmates_batch', creator) as never)).rejects.toThrow(/创造模式/);
  const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(creator.ctx) });
  expect(assembly.sections.some(section => section.name === 'classmates:configuration')).toBe(false);
});
