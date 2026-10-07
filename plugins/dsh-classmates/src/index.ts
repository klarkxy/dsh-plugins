import { resolve, join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type {} from '@deepseek-ai/dsh-app-boot';
import { BindingStore } from './bindings.js';
import { RoleConfig, validateRoles } from './config.js';
import { validateModelProfiles } from './model-profiles.js';
import { validateProtectedModels } from './model-protection.js';
import { ClassmatesController } from './controller.js';
import { installNative } from './native.js';
import { createPresets } from './presets.js';
import { ClassmateTools } from './tools.js';
import { installRoleManagement, isCreatorRoot } from './role-management.js';
import { installLiteralRolePersonas, SubagentRoles } from './subagent-roles.js';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';

export const name = 'classmates';
export const inject = ['agents', 'subagents', 'llm', 'settings', 'profileContext', 'systemPrompt'];

const roleSchema = z.object({
  schemaVersion: z.const(1), id: z.string().required(), revision: z.number().min(0).step(1).required(),
  name: z.string().required(), description: z.string().required(), instructions: z.string().required(),
  enabled: z.boolean().required(),
  reasoningEffort: z.string(),
  // Legacy input field: validateRole migrates it into a strong profile reference.
  recommendedModelProfileId: z.string(),
  // Discriminated members must come first: strict union resolution strips
  // undeclared keys, so a legacy-first match would drop kind/effort.
  model: z.union([
    z.const(null),
    z.object({ kind: z.const('inherit') }),
    z.object({ kind: z.const('profile'), profileId: z.string().required() }),
    z.object({ kind: z.const('fixed'), provider: z.string().required(), id: z.string().required(), effort: z.string() }),
    z.object({ provider: z.string().required(), id: z.string().required(), reasoningEffort: z.string() }),
  ]),
});
const modelProfileSchema = z.object({
  id: z.string().required(), revision: z.number().min(0).step(1).required(),
  name: z.string().required(), description: z.string().required(),
  enabled: z.boolean().required(),
  model: z.object({ provider: z.string().required(), id: z.string().required(), reasoningEffort: z.string() }),
});
export const Config = z.object({
  roles: z.transform(z.array(roleSchema), validateRoles).default(createPresets()).volatile(),
  modelProfiles: z.transform(z.array(modelProfileSchema), validateModelProfiles).default([]).volatile(),
  protectedModels: z.transform(z.array(z.object({ provider: z.string().required(), id: z.string().required() })), validateProtectedModels).default([]).volatile(),
});

export async function apply(ctx: Context): Promise<void> {
  const profile = ctx.profileContext;
  const profileId = resolve(profile.dir);
  const store = new BindingStore(join(profileId, 'data', 'classmates'), profileId);
  const namespace = ctx.fiber.entry?.options.id ?? name;
  const roles = new RoleConfig(ctx, namespace);
  ctx.effect(() => ctx.settings.configure({ auto: false }));
  new ClassmatesController(ctx, roles, store);
  let tools: ClassmateTools | undefined;
  const subagentRoles = new SubagentRoles(ctx, roles, store);
  ctx.effect(() => installLiteralRolePersonas(ctx));
  let teamScope: Context | undefined;
  type Agent = Parameters<ClassmateTools['install']>[0];
  const installed = new Map<Agent, () => void>();
  const configurationTools = new Map<Agent, () => void>();
  const generations = new WeakMap<Agent, number>();
  let stopped = false;
  const refresh = async (agent: Agent) => {
    if (stopped || ctx.agents.get(agent.id) !== agent) return;
    // Configuration must remain available with an empty or entirely disabled library.
    if (isCreatorRoot(ctx, agent)) {
      if (!configurationTools.has(agent)) configurationTools.set(agent, installRoleManagement(ctx, agent));
    } else {
      configurationTools.get(agent)?.();
      configurationTools.delete(agent);
    }
    const generation = (generations.get(agent) ?? 0) + 1;
    generations.set(agent, generation);
    let available = false;
    if (tools && teamScope?.agentTeams.tryMembership(agent)?.role === 'lead') {
      try { available = (await tools.list(agent)).roles.length > 0; }
      catch (error) { ctx.logger.warn('classmates: role tools unavailable: %s', error instanceof Error ? error.message : String(error)); }
    }
    if (stopped || generations.get(agent) !== generation || ctx.agents.get(agent.id) !== agent) return;
    if (available && tools && !installed.has(agent)) installed.set(agent, tools.install(agent));
    else if (!available) { installed.get(agent)?.(); installed.delete(agent); }
    await subagentRoles.refresh(agent);
  };
  const refreshAll = () => { for (const agent of ctx.agents.list()) void refresh(agent).catch(error => ctx.logger.warn('classmates: refresh failed: %s', String(error))); };
  ctx.inject(['agentTeams'], scope => {
    scope.effect(() => installNative(scope, store));
    teamScope = scope;
    tools = new ClassmateTools(scope, roles, store);
    refreshAll();
    scope.effect(() => () => {
      teamScope = undefined;
      tools = undefined;
      for (const dispose of installed.values()) dispose();
      installed.clear();
    });
  });
  ctx.on('agent/created', async ({ agent }) => { await refresh(agent); return undefined; });
  ctx.on('agent/disposed', ({ agent }) => { generations.set(agent, (generations.get(agent) ?? 0) + 1); installed.get(agent)?.(); installed.delete(agent); configurationTools.get(agent)?.(); configurationTools.delete(agent); void subagentRoles.remove(agent); return undefined; });
  ctx.on('loader/volatile-update', refreshAll);
  ctx.on('llm/adapters-updated', refreshAll);
  let refreshQueued = false;
  ctx.on('tools/change', () => {
    // Registration emits synchronously, including while management tools install.
    if (refreshQueued || stopped) return;
    refreshQueued = true;
    queueMicrotask(() => { refreshQueued = false; if (!stopped) refreshAll(); });
  });
  ctx.on('agent-preset/selected', sessionId => {
    const agent = ctx.agents.get(sessionId);
    if (agent) void refresh(agent).catch(error => ctx.logger.warn('classmates: refresh failed: %s', String(error)));
  });
  // Settings omits initializing fibers. Reconcile existing Leads once this
  // plugin becomes active, including hot installation with persisted roles.
  ctx.on('internal/status', fiber => { if (fiber === ctx.fiber && fiber.state === 2) refreshAll(); });
  ctx.effect(() => async () => { stopped = true; for (const dispose of installed.values()) dispose(); installed.clear(); for (const dispose of configurationTools.values()) dispose(); configurationTools.clear(); await subagentRoles.dispose(); });
  await Promise.all(ctx.agents.list().map(refresh));
}
