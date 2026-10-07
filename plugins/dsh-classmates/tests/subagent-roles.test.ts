import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { createUserMessage, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent';
import * as NativeTool from '@deepseek-ai/dsh-tool-subagent';
import * as NativeSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import SettingsForms from '@deepseek-ai/dsh-settings';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import type { Context } from '@deepseek-ai/cordis';
import type { ClassmateDefinition, ModelProfile } from '../src/contracts.js';
import { BindingStore } from '../src/bindings.js';
import * as SourceClassmates from '../src/index.js';
import { pathToFileURL } from 'node:url';

// Run the same behavioral acceptance against an unpacked build when requested.
const Classmates: typeof SourceClassmates = process.env.CLASSMATES_TEST_PACKAGE
  ? await import(pathToFileURL(process.env.CLASSMATES_TEST_PACKAGE).href) : SourceClassmates;
import { roleToolName } from '../src/subagent-roles.js';
import { createPresets } from '../src/presets.js';
import { createRuntime, modelProfile, requestText, role, SIGNAL, type Runtime } from './helpers/harness.js';

const roots: string[] = [];
const runtimes: Runtime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0).reverse()) await runtime.ctx.fiber.dispose();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function setup(options: {
  definition?: Partial<ClassmateDefinition>;
  modelProfiles?: ModelProfile[];
  protectedModels?: { provider: string; id: string }[];
  root?: string;
  resume?: boolean;
  team?: boolean;
} = {}) {
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'classmates-subagents-'));
  if (!options.root) roots.push(root);
  const runtime = await createRuntime({ bindingsRoot: join(root, 'bindings'), storageRoot: join(root, 'sessions'), install: false, team: options.team ?? false, resumeLead: options.resume });
  runtimes.push(runtime);
  const { ctx, lead } = runtime;
  const base = ctx.plugin(NativeTool, { provider: 'spawn', toolName: 'subagent', backgroundMode: 'continuable' });
  await base;
  const definition = role({ id: 'reviewer', revision: 1, name: 'Reviewer', description: 'Review changes', instructions: 'ROLE_LITERAL {{not_a_variable}} {{ broken ref }}', model: { provider: 'mock', id: 'specialist-a' }, ...options.definition });
  const config = { roles: [definition], modelProfiles: options.modelProfiles ?? [], protectedModels: options.protectedModels ?? [] };
  const entry = { id: 'classmates', options: { id: 'classmates', config }, fiber: undefined as Context['fiber'] | undefined };
  ctx.provide('profileContext', { dir: root, home: root, name: 'test' } as never);
  ctx.provide('loader', { await: async () => {} } as never);
  ctx.provide('configEditor', { configuration: () => entry.fiber ? [{ entry, inherited: config, override: config }] : [] } as never);
  await ctx.plugin(SettingsForms);
  await ctx.plugin(TypertRegistry);
  const plugin = ctx.plugin({ ...Classmates, async apply(scope: Context) { entry.fiber = scope.fiber; await Classmates.apply(scope); } }, config);
  await plugin;
  const toolName = roleToolName(definition.id);
  await vi.waitFor(() => expect(ctx.tools.get(toolName, lead)).toBeDefined());
  const call = (background = true, signal = SIGNAL, extra: Record<string, unknown> = {}) => ctx.tools.execute({
    callId: ToolCallId(crypto.randomUUID()),
    name: toolName,
    arguments: { description: 'Role review', prompt: 'Check the change', run_in_background: background, ...extra },
    agent: lead,
    signal,
  });
  const update = (next: ClassmateDefinition[], profiles?: ModelProfile[]) => {
    config.roles = next;
    (entry.fiber!.config as typeof config).roles = next;
    if (profiles !== undefined) {
      config.modelProfiles = profiles;
      (entry.fiber!.config as typeof config).modelProfiles = profiles;
    }
    ctx.emit('llm/adapters-updated');
  };
  const protect = (models: { provider: string; id: string }[]) => {
    config.protectedModels = models;
    (entry.fiber!.config as typeof config).protectedModels = models;
  };
  const parentToolNames = () => ctx.tools.schemas(lead).map(tool => tool.name).sort();
  return { ...runtime, root, config, definition, toolName, call, update, protect, plugin, base, parentToolNames };
}

function deferNativePreflight(runtime: Runtime) {
  const resolve = runtime.ctx.llm.resolveCallConfig.bind(runtime.ctx.llm);
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  let entered!: () => void;
  const reached = new Promise<void>(done => { entered = done; });
  vi.spyOn(runtime.ctx.llm, 'resolveCallConfig').mockImplementationOnce(async (...args) => {
    entered();
    await gate;
    return resolve(...args);
  });
  return { reached, release };
}

function childId(result: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['call']>>): string {
  expect(result.isError, JSON.stringify(result)).toBe(false);
  if (result.isError) throw new Error(result.error.message);
  const value = result.value as { subagentId: string };
  expect(value.subagentId).toBeTypeOf('string');
  return value.subagentId;
}

/**
 * Capture the current role tool so a later update can be awaited precisely:
 * the reinstall gap (old removed, new not yet registered) must not resolve.
 */
function reinstallMarker(runtime: Awaited<ReturnType<typeof setup>>) {
  const previous = runtime.ctx.tools.get(runtime.toolName, runtime.lead);
  return () => vi.waitFor(() => {
    const current = runtime.ctx.tools.get(runtime.toolName, runtime.lead);
    expect(current).toBeDefined();
    expect(current).not.toBe(previous);
  });
}

it.each(['rejected', 'cancelled', 'unavailable', 'missing'])('does not create a protected role child when approval is %s', async outcome => {
  const runtime = await setup({ protectedModels: [{ provider: 'mock', id: 'specialist-a' }] });
  if (outcome !== 'missing') runtime.ctx.provide('approval', { request: async () => outcome });
  expect((await runtime.call(false)).isError).toBe(true);
  expect(runtime.adapter.requests).toHaveLength(0);
});

it.each(['low', 'high', 'inherit'])('protects the route across profile efforts and inheritance: %s', async choice => {
  const profile = modelProfile({ id: 'protected', model: { provider: 'mock', id: 'specialist-a', reasoningEffort: choice === 'low' ? 'low' : 'high' } });
  const inherited = choice === 'inherit';
  const runtime = await setup({ definition: { model: inherited ? null : { provider: 'mock', id: 'specialist-b' } },
    modelProfiles: [profile], protectedModels: [{ provider: 'mock', id: inherited ? 'mock' : 'specialist-a' }] });
  let asks = 0;
  runtime.ctx.provide('approval', { request: async () => { asks++; return 'rejected'; } });
  expect((await runtime.call(false, SIGNAL, inherited ? {} : { model_profile: 'protected' })).isError).toBe(true);
  expect(asks).toBe(1);
  expect(runtime.adapter.requests).toHaveLength(0);
});

it('approves each new native child once and never prompts for its continuation', async () => {
  const runtime = await setup({ protectedModels: [{ provider: 'mock', id: 'specialist-a' }] });
  let asks = 0;
  runtime.ctx.provide('approval', { request: async () => { asks++; return 'allowed-once'; } });
  const id = childId(await runtime.call());
  // Count by child-persona/request content: the parent's completion-notification
  // turn also produces adapter requests and must not confuse these assertions.
  await vi.waitFor(() => expect(runtime.adapter.requests.filter(request => requestText(request).includes('ROLE_LITERAL'))).toHaveLength(1));
  await vi.waitFor(() => expect(runtime.ctx.agents.get(SessionId(id))).toBeUndefined());
  await runtime.ctx.subagents.sendMessage(runtime.lead, SessionId(id), [{ type: 'text', text: 'Continue' }], { signal: SIGNAL });
  await vi.waitFor(() => expect(runtime.adapter.requests.filter(request => requestText(request).includes('Continue'))).toHaveLength(1));
  expect(asks).toBe(1);
  expect((await runtime.call(false)).isError).toBe(false);
  expect(asks).toBe(2);
});

it('does not launch after cancellation or role withdrawal during approval', async () => {
  const runtime = await setup({ protectedModels: [{ provider: 'mock', id: 'specialist-a' }] });
  const abort = new AbortController();
  let cancel = true;
  runtime.ctx.provide('approval', { request: async () => {
    if (cancel) abort.abort(); else runtime.update([]);
    return 'allowed-once';
  } });
  expect((await runtime.call(false, abort.signal)).isError).toBe(true);
  cancel = false;
  expect((await runtime.call(false)).isError).toBe(true);
  expect(runtime.adapter.requests).toHaveLength(0);
});

it.each([false, true])('rechecks protection enabled during native preflight (background=%s)', async background => {
  const runtime = await setup();
  const approval = vi.fn(async () => 'rejected');
  runtime.ctx.provide('approval', { request: approval });
  const preflight = deferNativePreflight(runtime);
  const pending = runtime.call(background);
  await preflight.reached;
  expect(approval).not.toHaveBeenCalled();
  runtime.protect([{ provider: 'mock', id: 'specialist-a' }]);
  preflight.release();
  expect((await pending).isError).toBe(true);
  expect(approval).toHaveBeenCalledTimes(1);
  expect(runtime.adapter.requests).toHaveLength(0);
  expect(runtime.ctx.agents.list().map(agent => agent.id)).toEqual([runtime.lead.id]);
  expect(runtime.lead.session.snapshotEvents().filter(event => event.type === 'subagent/catalog')).toEqual([]);
});

it.each([false, true])('rejects a role withdrawn during native preflight (background=%s)', async background => {
  const runtime = await setup();
  const approval = vi.fn(async () => 'allowed-once');
  runtime.ctx.provide('approval', { request: approval });
  const preflight = deferNativePreflight(runtime);
  const pending = runtime.call(background);
  await preflight.reached;
  runtime.protect([{ provider: 'mock', id: 'specialist-a' }]);
  runtime.update([]);
  await vi.waitFor(() => expect(runtime.ctx.tools.get(runtime.toolName, runtime.lead)).toBeUndefined());
  preflight.release();
  expect((await pending).isError).toBe(true);
  expect(approval).not.toHaveBeenCalled();
  expect(runtime.adapter.requests).toHaveLength(0);
  expect(runtime.ctx.agents.list().map(agent => agent.id)).toEqual([runtime.lead.id]);
  expect(runtime.lead.session.snapshotEvents().filter(event => event.type === 'subagent/catalog')).toEqual([]);
});

it.each([false, true])('honors cancellation during native preflight (background=%s)', async background => {
  const runtime = await setup({ protectedModels: [{ provider: 'mock', id: 'specialist-a' }] });
  const approval = vi.fn(async () => 'allowed-once');
  runtime.ctx.provide('approval', { request: approval });
  const abort = new AbortController();
  const preflight = deferNativePreflight(runtime);
  const pending = runtime.call(background, abort.signal);
  await preflight.reached;
  abort.abort();
  preflight.release();
  expect((await pending).isError).toBe(true);
  expect(approval).not.toHaveBeenCalled();
  expect(runtime.adapter.requests).toHaveLength(0);
});

it.each([false, true])('rejects a native provider replaced while approval waits (background=%s)', async background => {
  const runtime = await setup({ protectedModels: [{ provider: 'mock', id: 'specialist-a' }] });
  const provider = runtime.ctx.subagents.getProvider('spawn')!;
  await runtime.ctx.registry.delete(NativeSpawn);
  const unregister = runtime.ctx.subagents.registerProvider(provider);
  await vi.waitFor(() => expect(runtime.ctx.tools.get(runtime.toolName, runtime.lead)).toBeDefined());
  let entered!: () => void;
  const reached = new Promise<void>(done => { entered = done; });
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  runtime.ctx.provide('approval', { request: async () => { entered(); await gate; return 'allowed-once'; } });
  const pending = runtime.call(background);
  await reached;
  const replacement = {
    name: provider.name,
    capabilities: provider.capabilities,
    inheritsParentContext: provider.inheritsParentContext,
    start: vi.fn(provider.start.bind(provider)),
    prepareContinuable: vi.fn(provider.prepareContinuable!.bind(provider)),
  };
  // Replace synchronously so ordinary role reconciliation sees a live provider
  // and does not happen to reject this call merely due to transient withdrawal.
  unregister();
  runtime.ctx.subagents.registerProvider(replacement);
  release();
  expect((await pending).isError).toBe(true);
  expect(replacement.start).not.toHaveBeenCalled();
  expect(replacement.prepareContinuable).not.toHaveBeenCalled();
  expect(runtime.adapter.requests).toHaveLength(0);
  expect(runtime.lead.session.snapshotEvents().filter(event => event.type === 'subagent/catalog')).toEqual([]);
});

it.each([false, true])('approves the frozen profile after preflight despite later profile edits (background=%s)', async background => {
  const runtime = await setup({ modelProfiles: [LOW] });
  const approval = vi.fn(async () => 'allowed-once');
  runtime.ctx.provide('approval', { request: approval });
  const preflight = deferNativePreflight(runtime);
  const pending = runtime.call(background, SIGNAL, { model_profile: LOW.id });
  await preflight.reached;
  runtime.update([runtime.definition], [{ ...LOW, revision: 2, model: { provider: 'mock', id: 'specialist-b', reasoningEffort: 'high' } }]);
  runtime.protect([{ provider: 'mock', id: 'specialist-a' }]);
  preflight.release();
  expect((await pending).isError).toBe(false);
  expect(approval).toHaveBeenCalledTimes(1);
  expect(approval.mock.calls[0]).toEqual([expect.objectContaining({
    reason: expect.stringContaining('"model":{"provider":"mock","id":"specialist-a","reasoningEffort":"low"}'),
  })]);
  // Filter by the child persona: background completion also turns the parent.
  await vi.waitFor(() => expect(runtime.adapter.requests.filter(request => requestText(request).includes('ROLE_LITERAL'))).toHaveLength(1));
  expect(runtime.adapter.requests.find(request => requestText(request).includes('ROLE_LITERAL'))).toMatchObject({ model: 'specialist-a', reasoningEffort: 'low' });
});

it.each([
  { model: null, reasoningEffort: undefined, expectedModel: 'mock', expectedEffort: 'high' },
  { model: null, reasoningEffort: 'low', expectedModel: 'mock', expectedEffort: 'low' },
  { model: { provider: 'mock', id: 'specialist-a' }, reasoningEffort: undefined, expectedModel: 'specialist-a', expectedEffort: 'high' },
  { model: { provider: 'mock', id: 'specialist-a' }, reasoningEffort: 'low', expectedModel: 'specialist-a', expectedEffort: 'low' },
])('uses native foreground execution without Teams: $expectedModel/$expectedEffort', async ({ model, reasoningEffort, expectedModel, expectedEffort }) => {
  const runtime = await setup({ definition: { model, reasoningEffort } });
  expect(runtime.ctx.get('agentTeams')).toBeUndefined();
  const result = await runtime.call(false);
  expect(result.isError, JSON.stringify(result)).toBe(false);
  if (!result.isError) {
    expect(result.value).toMatchObject({ kind: 'foreground' });
    expect(runtime.ctx.agents.get(SessionId((result.value as { runId: string }).runId))).toBeUndefined();
  }
  expect(runtime.adapter.requests).toHaveLength(1);
  expect(runtime.adapter.requests[0]).toMatchObject({ model: expectedModel, reasoningEffort: expectedEffort });
  expect(requestText(runtime.adapter.requests[0])).toContain(runtime.definition.instructions);
});

it('freezes native background composition across role deletion, restart and follow-up', async () => {
  const first = await setup({ definition: { model: null } });
  installModelSelection(first.lead.ctx, { current: { provider: 'mock', model: 'specialist-b', reasoningEffort: ReasoningEffortId('low') }, assembled: undefined });
  first.lead.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Switch the parent model' }] }));
  await first.lead.whenIdle();
  const id = childId(await first.call());
  await vi.waitFor(() => expect(first.adapter.requests.find(request => requestText(request).includes('ROLE_LITERAL'))).toBeDefined());
  await vi.waitFor(() => expect(first.ctx.agents.get(SessionId(id))).toBeUndefined());
  first.update([]);
  await vi.waitFor(() => expect(first.ctx.tools.get(first.toolName, first.lead)).toBeUndefined());
  await first.ctx.fiber.dispose();
  const second = await setup({ root: first.root, resume: true });
  second.update([]);
  await vi.waitFor(() => expect(second.ctx.tools.get(second.toolName, second.lead)).toBeUndefined());
  await second.ctx.subagents.sendMessage(second.lead, SessionId(id), [{ type: 'text', text: 'Continue the review' }], { signal: SIGNAL });
  await vi.waitFor(() => expect(second.adapter.requests.filter(request => requestText(request).includes('ROLE_LITERAL'))).toHaveLength(1));
  const restored = second.adapter.requests.find(request => requestText(request).includes('ROLE_LITERAL'))!;
  expect(restored).toMatchObject({ model: 'specialist-b', reasoningEffort: 'low' });
  expect(requestText(restored)).toContain(first.definition.instructions);
});

it('updates future tools, preserves current children, and uses native interruption', async () => {
  const runtime = await setup();
  runtime.adapter.hold = true;
  const id = childId(await runtime.call());
  await vi.waitFor(() => expect(runtime.adapter.requests).toHaveLength(1));
  const child = runtime.ctx.agents.get(SessionId(id))!;
  const descriptor = foldSubagentDescriptor(child.session.snapshotEvents());
  expect(descriptor).toMatchObject({ provider: 'spawn', mode: 'continuable', agentModel: 'specialist-a' });
  const previous = runtime.ctx.tools.get(runtime.toolName, runtime.lead);
  runtime.update([{ ...runtime.definition, revision: 2, model: { provider: 'mock', id: 'specialist-b' }, instructions: 'UPDATED_INSTRUCTIONS' }]);
  await vi.waitFor(() => expect(runtime.ctx.tools.get(runtime.toolName, runtime.lead)).not.toBe(previous));
  runtime.ctx.subagents.interrupt(SessionId(id), { kind: 'ancestor', agent: runtime.lead });
  await vi.waitFor(() => expect(runtime.ctx.agents.get(SessionId(id))).toBeUndefined());
  runtime.adapter.hold = false;
  expect((await runtime.call(false)).isError).toBe(false);
  expect(runtime.adapter.requests.at(-1)).toMatchObject({ model: 'specialist-b' });
  expect(requestText(runtime.adapter.requests.at(-1)!)).toContain('UPDATED_INSTRUCTIONS');
  expect(descriptor).toMatchObject({ agentModel: 'specialist-a' });
});

it('honors cancellation, native depth settings and tool restrictions', async () => {
  const runtime = await setup();
  expect((await runtime.call(false, AbortSignal.abort())).isError).toBe(true);
  vi.spyOn(runtime.ctx.subagents, 'resolveMaxDepth').mockReturnValue(0);
  expect((await runtime.call(false)).isError).toBe(true);
  expect(runtime.adapter.requests).toHaveLength(0);
  const release = runtime.lead.ctx.tools.guard(exec => exec.name === runtime.toolName ? 'role delegation denied' : undefined);
  expect((await runtime.call(false)).isError).toBe(true);
  release();
  const restrictBase = runtime.lead.ctx.tools.restrict({ deny: ['subagent'] });
  await vi.waitFor(() => expect(runtime.ctx.tools.get(runtime.toolName, runtime.lead)).toBeUndefined());
  const prompt = await runtime.ctx.systemPrompt.assemble({ scope: runtime.lead });
  expect(prompt.sections.find(section => section.name === 'classmates:subagent-roles')?.text ?? '').not.toContain(runtime.toolName);
  restrictBase();
  await vi.waitFor(() => expect(runtime.ctx.tools.get(runtime.toolName, runtime.lead)).toBeDefined());
  await runtime.plugin.dispose();
  expect(runtime.ctx.tools.get(runtime.toolName, runtime.lead)).toBeUndefined();
  expect(runtime.ctx.tools.get('subagent', runtime.lead)).toBeDefined();
});

it('rejects an incompatible inherited effort before native child creation', async () => {
  const runtime = await setup();
  vi.spyOn(runtime.ctx.llm, 'resolveCallConfig').mockRejectedValue(new Error('unsupported reasoning effort high'));
  const result = await runtime.call(false);
  expect(result.isError).toBe(true);
  expect(runtime.adapter.requests).toHaveLength(0);
  expect(runtime.lead.session.snapshotEvents().filter(event => event.type === 'subagent/catalog')).toEqual([]);
});

it('keeps supported long ids within the native tool-name limit', () => {
  const first = roleToolName('a'.repeat(80));
  expect(first.length).toBeLessThanOrEqual(64);
  expect(first).toBe(roleToolName('a'.repeat(80)));
  expect(first).not.toBe(roleToolName('a'.repeat(79) + 'b'));
});


it('uses a built-in role in an ordinary native child without requiring Team messages', async () => {
  const explorer = createPresets().find(role => role.id === 'explorer')!;
  const runtime = await setup({ definition: { ...explorer, revision: 1, enabled: true } });
  expect((await runtime.call(false)).isError).toBe(false);
  expect(requestText(runtime.adapter.requests[0])).toContain('Use native subagent messages for ordinary delegation');
  expect(requestText(runtime.adapter.requests[0])).toContain('do not assume Team membership');
});

it('withdraws role tools when the original delegation tool disappears and restores them when it returns', async () => {
  const runtime = await setup();
  await runtime.base.dispose();
  await vi.waitFor(() => expect(runtime.ctx.tools.get(runtime.toolName, runtime.lead)).toBeUndefined());
  await runtime.ctx.plugin(NativeTool, { provider: 'spawn', toolName: 'subagent', backgroundMode: 'continuable' });
  await vi.waitFor(() => expect(runtime.ctx.tools.get(runtime.toolName, runtime.lead)).toBeDefined());
  expect(runtime.ctx.tools.schemas(runtime.lead).filter(tool => tool.name === runtime.toolName)).toHaveLength(1);
});


it('keeps the dispatch route stable while native model validation awaits', async () => {
  const runtime = await setup({ definition: { model: null } });
  const resolve = runtime.ctx.llm.resolveCallConfig.bind(runtime.ctx.llm);
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  let entered!: () => void;
  const reached = new Promise<void>(done => { entered = done; });
  vi.spyOn(runtime.ctx.llm, 'resolveCallConfig').mockImplementationOnce(async (...args) => { entered(); await gate; return resolve(...args); });
  const pending = runtime.call(false);
  await reached;
  installModelSelection(runtime.lead.ctx, { current: { provider: 'mock', model: 'specialist-b', reasoningEffort: ReasoningEffortId('low') }, assembled: undefined });
  runtime.lead.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Switch while child validates' }] }));
  await runtime.lead.whenIdle();
  release();
  expect((await pending).isError).toBe(false);
  const request = runtime.adapter.requests.find(item => requestText(item).includes('ROLE_LITERAL'))!;
  expect(request).toMatchObject({ model: 'mock', reasoningEffort: 'high' });
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
const PARENT_DEFAULT = modelProfile({
  id: 'coding-default',
  name: 'Default coding',
  description: 'use the selected model default effort',
  model: { provider: 'mock', id: 'mock' },
});
const TEMPLATE_DEFAULT = modelProfile({
  id: 'specialist-default',
  name: 'Specialist default',
  description: 'same route as the template without a stored effort',
  model: { provider: 'mock', id: 'specialist-a' },
});
const PARKED = modelProfile({
  id: 'coding-parked',
  enabled: false,
  name: 'Parked coding',
  description: 'disabled purpose must stay hidden',
  model: { provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' },
});

it('captures concurrent low and high profile selections on one template as separate requests', async () => {
  const runtime = await setup({ modelProfiles: [LOW, HIGH] });
  expect(JSON.stringify(runtime.ctx.tools.get(runtime.toolName, runtime.lead)?.parameters ?? {})).toMatch(/model_profile/);
  const baseline = runtime.parentToolNames();
  expect(baseline).toContain(runtime.toolName);
  expect(baseline).not.toContain('list_subagent_models');
  const results = await Promise.all([
    runtime.call(false, SIGNAL, { model_profile: 'coding-low' }),
    runtime.call(false, SIGNAL, { model_profile: 'coding-high' }),
  ]);
  expect(results.every(result => result.isError === false)).toBe(true);
  expect(runtime.parentToolNames()).toEqual(baseline);
  const captured = runtime.adapter.requests.filter(request => requestText(request).includes('ROLE_LITERAL'));
  expect(captured).toHaveLength(2);
  expect(captured.map(request => request.model).sort()).toEqual(['specialist-a', 'specialist-a']);
  expect(captured.map(request => String(request.reasoningEffort)).sort()).toEqual(['high', 'low']);
});

it('uses a profile as a model+effort unit and never inherits parent or template high when effort is omitted', async () => {
  const runtime = await setup({
    definition: { model: { provider: 'mock', id: 'specialist-a', reasoningEffort: 'high' } },
    modelProfiles: [PARENT_DEFAULT, TEMPLATE_DEFAULT],
  });
  expect(runtime.lead.options).toMatchObject({ model: 'mock', reasoningEffort: 'high' });

  expect((await runtime.call(false)).isError).toBe(false);
  const inherited = runtime.adapter.requests.find(request => requestText(request).includes('ROLE_LITERAL'))!;
  expect(inherited).toMatchObject({ model: 'specialist-a', reasoningEffort: 'high' });

  expect((await runtime.call(false, SIGNAL, { model_profile: 'coding-default' })).isError).toBe(false);
  const parentDefault = runtime.adapter.requests.filter(request => requestText(request).includes('ROLE_LITERAL')).at(-1)!;
  expect(parentDefault.model).toBe('mock');
  expect(parentDefault.reasoningEffort).toBeUndefined();

  expect((await runtime.call(false, SIGNAL, { model_profile: 'specialist-default' })).isError).toBe(false);
  const templateDefault = runtime.adapter.requests.filter(request => requestText(request).includes('ROLE_LITERAL')).at(-1)!;
  expect(templateDefault.model).toBe('specialist-a');
  expect(templateDefault.reasoningEffort).toBeUndefined();
});

it('shows enabled model profiles on the ordinary native prompt without Team', async () => {
  const runtime = await setup({ modelProfiles: [LOW, HIGH, PARKED] });
  expect(runtime.ctx.get('agentTeams')).toBeUndefined();
  const assembly = await runtime.ctx.systemPrompt.assemble({ scope: runtime.lead });
  const prompt = assembly.sections.map(section => section.text).join('\n');
  expect(prompt).toContain('coding-low');
  expect(prompt).toContain('cheap draft pass');
  expect(prompt).toContain('coding-high');
  expect(prompt).toContain('careful review pass');
  expect(prompt).toContain('specialist-a');
  expect(prompt).toMatch(/low/);
  expect(prompt).toMatch(/high/);
  expect(prompt).not.toContain('coding-parked');
  expect(prompt).not.toContain('disabled purpose must stay hidden');
  expect(assembly.tools.map(tool => tool.name)).toContain(runtime.toolName);
  expect(assembly.tools.map(tool => tool.name)).not.toContain('list_subagent_models');
});

it('updates ordinary primary guidance when only model profiles change', async () => {
  const runtime = await setup({ modelProfiles: [LOW] });
  expect(runtime.ctx.get('agentTeams')).toBeUndefined();
  const readPrompt = async () => {
    const assembly = await runtime.ctx.systemPrompt.assemble({ scope: runtime.lead });
    return assembly.sections.map(section => section.text).join('\n');
  };
  const initial = await readPrompt();
  expect(initial).toContain('coding-low');
  expect(initial).toContain('cheap draft pass');
  expect(initial).not.toContain('coding-high');
  expect(initial).not.toContain('careful review pass');

  runtime.update([runtime.definition], [HIGH]);
  const afterReplace = await readPrompt();
  expect(afterReplace).toContain('coding-high');
  expect(afterReplace).toContain('careful review pass');
  expect(afterReplace).toContain('specialist-a');
  expect(afterReplace).toMatch(/high/);
  expect(afterReplace).not.toContain('coding-low');
  expect(afterReplace).not.toContain('cheap draft pass');
  expect(runtime.ctx.tools.get(runtime.toolName, runtime.lead)).toBeDefined();

  runtime.update([runtime.definition], [PARKED]);
  const afterDisable = await readPrompt();
  expect(afterDisable).not.toContain('coding-high');
  expect(afterDisable).not.toContain('coding-parked');
  expect(afterDisable).not.toContain('disabled purpose must stay hidden');
});

it('keeps a background child continuable after the temporary dispatch scope is gone and after profile deletion', async () => {
  const first = await setup({ modelProfiles: [LOW] });
  const baseline = first.parentToolNames();
  const id = childId(await first.call(true, SIGNAL, { model_profile: 'coding-low' }));
  await vi.waitFor(() => expect(first.adapter.requests.find(request => requestText(request).includes('ROLE_LITERAL'))).toMatchObject({
    model: 'specialist-a',
    reasoningEffort: 'low',
  }));
  expect(first.parentToolNames()).toEqual(baseline);
  await vi.waitFor(() => expect(first.ctx.agents.get(SessionId(id))).toBeUndefined());
  await first.ctx.subagents.sendMessage(first.lead, SessionId(id), [{ type: 'text', text: 'Continue after dispatch scope closed' }], { signal: SIGNAL });
  await vi.waitFor(() => expect(first.adapter.requests.filter(request => requestText(request).includes('Continue after dispatch scope closed'))).toHaveLength(1));
  expect(first.adapter.requests.find(request => requestText(request).includes('Continue after dispatch scope closed'))).toMatchObject({
    model: 'specialist-a',
    reasoningEffort: 'low',
  });
  first.update([], []);
  await vi.waitFor(() => expect(first.ctx.tools.get(first.toolName, first.lead)).toBeUndefined());
  await first.ctx.fiber.dispose();
  const second = await setup({ root: first.root, resume: true, modelProfiles: [] });
  second.update([], []);
  await vi.waitFor(() => expect(second.ctx.tools.get(second.toolName, second.lead)).toBeUndefined());
  await second.ctx.subagents.sendMessage(second.lead, SessionId(id), [{ type: 'text', text: 'Resume after profile deletion' }], { signal: SIGNAL });
  await vi.waitFor(() => expect(second.adapter.requests.filter(request => requestText(request).includes('Resume after profile deletion'))).toHaveLength(1));
  expect(second.adapter.requests.find(request => requestText(request).includes('Resume after profile deletion'))).toMatchObject({
    model: 'specialist-a',
    reasoningEffort: 'low',
  });
  expect(requestText(second.adapter.requests.find(request => requestText(request).includes('Resume after profile deletion'))!)).toContain(first.definition.instructions);
});

it('denies outer pre-execute and cancellation before any child or leftover temporary tool', async () => {
  const runtime = await setup({ modelProfiles: [LOW] });
  const baseline = runtime.parentToolNames();
  expect((await runtime.call(false, AbortSignal.abort(), { model_profile: 'coding-low' })).isError).toBe(true);
  expect(runtime.adapter.requests).toHaveLength(0);
  expect(runtime.ctx.agents.list().map(agent => agent.id)).toEqual([runtime.lead.id]);
  expect(runtime.parentToolNames()).toEqual(baseline);
  const release = runtime.lead.ctx.tools.guard(exec => exec.name === runtime.toolName ? 'role delegation denied' : undefined);
  expect((await runtime.call(false, SIGNAL, { model_profile: 'coding-low' })).isError).toBe(true);
  release();
  expect(runtime.adapter.requests).toHaveLength(0);
  expect(runtime.ctx.agents.list().map(agent => agent.id)).toEqual([runtime.lead.id]);
  expect(runtime.parentToolNames()).toEqual(baseline);
  expect(runtime.parentToolNames()).not.toContain('list_subagent_models');
});

it('rejects unknown and disabled profiles without creating a child or retrying another route', async () => {
  const runtime = await setup({ modelProfiles: [LOW, PARKED] });
  const unknown = await runtime.call(false, SIGNAL, { model_profile: 'coding-missing' });
  expect(unknown.isError).toBe(true);
  const disabled = await runtime.call(false, SIGNAL, { model_profile: 'coding-parked' });
  expect(disabled.isError).toBe(true);
  const unknownAgain = await runtime.call(false, SIGNAL, { model_profile: 'coding-missing' });
  expect(unknownAgain.isError).toBe(true);
  expect(runtime.adapter.requests).toHaveLength(0);
  expect(runtime.ctx.agents.list().map(agent => agent.id)).toEqual([runtime.lead.id]);
});

it('prefers a legacy fixed model over a recommendation and keeps it on omitted calls', async () => {
  const runtime = await setup({
    definition: {
      recommendedModelProfileId: 'coding-high',
      model: { provider: 'mock', id: 'specialist-a', reasoningEffort: 'low' },
    },
    modelProfiles: [LOW, HIGH, PARKED],
  });
  const assembly = await runtime.ctx.systemPrompt.assemble({ scope: runtime.lead });
  const prompt = assembly.sections.map(section => section.text).join('\n');
  // The legacy recommendation migrated to a note; a fixed role shows no binding line.
  expect(prompt).not.toContain('bound model_profile');
  expect(prompt).toMatch(/highest-priority one-call override/);
  expect(prompt).toMatch(/Lead may work alone/);
  expect((await runtime.call(false)).isError).toBe(false);
  expect(runtime.adapter.requests.find(request => requestText(request).includes('ROLE_LITERAL'))).toMatchObject({
    model: 'specialist-a', reasoningEffort: 'low',
  });
  expect((await runtime.call(false, SIGNAL, { model_profile: 'coding-high' })).isError).toBe(false);
  expect(runtime.adapter.requests.filter(request => requestText(request).includes('ROLE_LITERAL')).at(-1)).toMatchObject({
    model: 'specialist-a', reasoningEffort: 'high',
  });
});

it('shows a bound profile on the role line and uses it on omitted calls', async () => {
  const runtime = await setup({
    definition: {
      recommendedModelProfileId: 'coding-high',
      model: null,
    },
    modelProfiles: [LOW, HIGH, PARKED],
  });
  const readPrompt = async () => {
    const assembly = await runtime.ctx.systemPrompt.assemble({ scope: runtime.lead });
    return assembly.sections.map(section => section.text).join('\n');
  };
  const prompt = await readPrompt();
  expect(prompt).toMatch(/bound model_profile coding-high \(Deep coding; available\)/);
  const roleLine = prompt.split('\n').find(line => line.includes(runtime.toolName));
  expect(roleLine).toContain('coding-high');
  expect(roleLine).not.toContain('cheap draft pass');
  expect((await runtime.call(false)).isError).toBe(false);
  expect(runtime.adapter.requests.find(request => requestText(request).includes('ROLE_LITERAL'))).toMatchObject({
    model: 'specialist-a', reasoningEffort: 'high',
  });

  // A disabled bound preset hard-fails with guidance; a deleted one also hard-fails.
  const waitDisabled = reinstallMarker(runtime);
  runtime.update([{ ...runtime.definition, model: null, recommendedModelProfileId: 'coding-parked' }], [PARKED]);
  await waitDisabled();
  await vi.waitFor(async () => {
    expect(await readPrompt()).toMatch(/bound model_profile coding-parked \(Parked coding\); unavailable \(disabled\)/);
  });
  const disabled = await runtime.call(false);
  expect(disabled.isError).toBe(true);
  if (disabled.isError) expect(disabled.error.message).toContain('预设 coding-parked 已停用，请在角色 Reviewer 的模型设置中改选或改为跟随主控');
  const waitMissing = reinstallMarker(runtime);
  runtime.update([{ ...runtime.definition, model: null, recommendedModelProfileId: 'gone-profile' }], []);
  await waitMissing();
  await vi.waitFor(async () => {
    expect(await readPrompt()).toMatch(/bound model_profile gone-profile; unavailable \(missing\)/);
  });
  const missing = await runtime.call(false);
  expect(missing.isError).toBe(true);
  if (missing.isError) expect(missing.error.message).toContain('预设 gone-profile 不存在，请在角色 Reviewer 的模型设置中改选或改为跟随主控');
  expect(runtime.adapter.requests.filter(request => requestText(request).includes('ROLE_LITERAL'))).toHaveLength(1);

  // The one-call override still wins over the broken strong reference.
  runtime.update([{ ...runtime.definition, model: null, recommendedModelProfileId: 'gone-profile' }], [LOW]);
  await vi.waitFor(() => expect(runtime.ctx.tools.get(runtime.toolName, runtime.lead)).toBeDefined());
  expect((await runtime.call(false, SIGNAL, { model_profile: 'coding-low' })).isError).toBe(false);
  expect(runtime.adapter.requests.filter(request => requestText(request).includes('ROLE_LITERAL')).at(-1)).toMatchObject({
    model: 'specialist-a', reasoningEffort: 'low',
  });
});

function pluginStore(root: string): BindingStore {
  // Same root/profileId derivation as src/index.ts apply().
  return new BindingStore(join(root, 'data', 'classmates'), resolve(root));
}

it('inherits conversation effort for a fixed role with the UI empty-effort selection', async () => {
  const runtime = await setup({
    definition: { model: { kind: 'fixed', provider: 'mock', id: 'specialist-a' } as never },
  });
  expect((await runtime.call(false)).isError).toBe(false);
  expect(runtime.adapter.requests.find(request => requestText(request).includes('ROLE_LITERAL'))).toMatchObject({
    model: 'specialist-a', reasoningEffort: 'high',
  });
});

it('keeps a new-shape fixed role exact through settings validation and dispatch', async () => {
  // Strict zod union resolution strips undeclared keys; the discriminated
  // member must match before the legacy object member or effort is lost.
  const runtime = await setup({
    definition: { model: { kind: 'fixed', provider: 'mock', id: 'specialist-a', effort: 'low' } as never },
  });
  expect((await runtime.call(false)).isError).toBe(false);
  expect(runtime.adapter.requests.find(request => requestText(request).includes('ROLE_LITERAL'))).toMatchObject({
    model: 'specialist-a', reasoningEffort: 'low',
  });
  const store = pluginStore(runtime.root);
  const id = childId(await runtime.call());
  await vi.waitFor(async () => expect((await store.listSubagentBindings(runtime.lead.id)).bindings).toHaveLength(1));
  expect((await store.listSubagentBindings(runtime.lead.id)).bindings[0]).toMatchObject({
    childId: id,
    modelSource: 'fixed',
    model: { provider: 'mock', id: 'specialist-a', effort: 'low' },
  });
});

it('writes a complete subagent binding after a background dispatch and never for a foreground one-shot', async () => {
  const runtime = await setup();
  const store = pluginStore(runtime.root);
  expect((await store.listSubagentBindings(runtime.lead.id)).bindings).toHaveLength(0);

  expect((await runtime.call(false)).isError).toBe(false);
  expect((await store.listSubagentBindings(runtime.lead.id)).bindings).toHaveLength(0);

  const id = childId(await runtime.call());
  await vi.waitFor(async () => expect((await store.listSubagentBindings(runtime.lead.id)).bindings).toHaveLength(1));
  const { bindings, warnings } = await store.listSubagentBindings(runtime.lead.id);
  expect(warnings).toBe(0);
  expect(bindings[0]).toMatchObject({
    kind: 'subagent',
    childId: id,
    parentSessionId: runtime.lead.id,
    role: { id: 'reviewer', revision: 1, name: 'Reviewer', description: 'Review changes' },
    modelSource: 'fixed',
    model: { provider: 'mock', id: 'specialist-a', effort: 'high' },
  });
  expect(bindings[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(bindings[0].checksum).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(bindings[0])).not.toContain('ROLE_LITERAL');
  // Enumerating another parent session never leaks the row.
  expect((await store.listSubagentBindings('another-parent')).bindings).toHaveLength(0);
});

it('records inherit, override, and profile model sources on their bindings', async () => {
  const runtime = await setup({ definition: { model: null }, modelProfiles: [LOW] });
  const store = pluginStore(runtime.root);

  const inheritedId = childId(await runtime.call());
  await vi.waitFor(async () => expect((await store.listSubagentBindings(runtime.lead.id)).bindings).toHaveLength(1));
  const inherited = (await store.listSubagentBindings(runtime.lead.id)).bindings.find(row => row.childId === inheritedId);
  expect(inherited).toMatchObject({
    modelSource: 'inherit',
    model: { provider: 'mock', id: 'mock', effort: 'high' },
  });
  expect(inherited).not.toHaveProperty('modelProfileId');

  const overriddenId = childId(await runtime.call(true, SIGNAL, { model_profile: 'coding-low' }));
  await vi.waitFor(async () => expect((await store.listSubagentBindings(runtime.lead.id)).bindings).toHaveLength(2));
  const overridden = (await store.listSubagentBindings(runtime.lead.id)).bindings.find(row => row.childId === overriddenId);
  expect(overridden).toMatchObject({
    modelSource: 'override',
    modelProfileId: 'coding-low',
    model: { provider: 'mock', id: 'specialist-a', effort: 'low' },
  });

  const waitProfiled = reinstallMarker(runtime);
  runtime.update([{ ...runtime.definition, model: null, recommendedModelProfileId: 'coding-low' }], [LOW]);
  await waitProfiled();
  const profiledId = childId(await runtime.call());
  await vi.waitFor(async () => expect((await store.listSubagentBindings(runtime.lead.id)).bindings).toHaveLength(3));
  const profiled = (await store.listSubagentBindings(runtime.lead.id)).bindings.find(row => row.childId === profiledId);
  expect(profiled).toMatchObject({
    modelSource: 'profile',
    modelProfileId: 'coding-low',
    model: { provider: 'mock', id: 'specialist-a', effort: 'low' },
  });
});
