import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { createScope } from '@deepseek-ai/dsh-scope';
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent';
import * as SubagentTool from '@deepseek-ai/dsh-tool-subagent';
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { ClassmatesError, type RoleConfig, validateRole } from './config.js';
import type { ClassmateDefinition, ModelBinding, ModelProfile, ModelRoute } from './contracts.js';
import { lookupModelProfile, profileModelBinding } from './model-profiles.js';
import { isModelProtected, requestModelApproval } from './model-protection.js';

/** Native tool names are limited to 64 characters; saved role ids may be longer. */
export function roleToolName(id: string): string {
  const suffix = id.length <= 55 ? id : `${id.slice(0, 42)}_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`;
  return `subagent_${suffix}`;
}

const PERSONA_PREFIX = /^Classmates role \[[a-z0-9]+(?:-[a-z0-9]+)*@\d+\]\n\n/u;

/** DSH persists the complete persona. Only our marked personas are literal text. */
export function installLiteralRolePersonas(ctx: Context): () => void {
  return ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next();
    return { ...assembly, sections: assembly.sections.map(section =>
      section.name === 'deployment:persona-prefix' && PERSONA_PREFIX.test(section.text)
        ? { ...section, interpolate: false } : section) };
  });
}

export function enabledModelProfiles(profiles: readonly ModelProfile[] | undefined): ModelProfile[] {
  if (!Array.isArray(profiles)) return [];
  return profiles.filter((profile): profile is ModelProfile => Boolean(
    profile && profile.enabled === true && typeof profile.id === 'string' && profile.id.trim()
    && typeof profile.name === 'string' && typeof profile.description === 'string'
    && profile.model && typeof profile.model.provider === 'string' && typeof profile.model.id === 'string',
  ));
}

/** Snapshot a profile, then materialize an advertised model default when effort was omitted. */
export async function resolveProfileSelection(ctx: Context, profile: ModelProfile, signal: AbortSignal): Promise<ModelBinding> {
  const binding = profileModelBinding(profile);
  if (!ctx.llm.listProviders().some(provider => provider.id === binding.provider)) {
    throw new ClassmatesError('MODEL_UNAVAILABLE', '模型供应商未配置');
  }
  const info = await ctx.llm.resolveModelInfo(binding.provider, binding.id, signal);
  signal.throwIfAborted();
  if (binding.reasoningEffort !== undefined) {
    if (!info.reasoning?.efforts.some(effort => effort.id === binding.reasoningEffort)) {
      throw new ClassmatesError('INVALID_EFFORT', `模型 ${binding.provider}/${binding.id} 不支持思考强度 ${binding.reasoningEffort}`);
    }
    return binding;
  }
  const advertised = info.reasoning?.defaultEffort;
  if (typeof advertised === 'string' && advertised.length > 0) {
    return { provider: binding.provider, id: binding.id, reasoningEffort: advertised };
  }
  return binding;
}

interface RoleCall {
  description: string;
  prompt: string;
  run_in_background?: boolean;
  model_profile?: string;
}

function rolePersona(role: ClassmateDefinition): string {
  return `Classmates role [${role.id}@${role.revision}]\n\n${role.instructions}

Delegation context: you are an ordinary DSH subagent. The Lead in role instructions means your delegating parent. Use native subagent communication and return your result to that parent; do not assume Team membership.`;
}

function fallbackChildOptions(agent: Agent, role: ClassmateDefinition): AgentOptions {
  const parent = parentAgentOptionsForDelegation(agent);
  const provider = role.model?.provider ?? parent.provider;
  const model = role.model?.id ?? parent.model;
  const effort = role.reasoningEffort ?? role.model?.reasoningEffort ?? parent.reasoningEffort;
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }),
  };
}

function explicitChildOptions(model: ModelBinding): AgentOptions {
  const route = { provider: model.provider, model: model.id };
  if (model.reasoningEffort === undefined) {
    // Native copies this own undefined over the parent effort, including when
    // the profile route is the parent's route. Preflight may still validate
    // that parent effort; the child request omits it.
    return { ...route, reasoningEffort: undefined };
  }
  return { ...route, reasoningEffort: ReasoningEffortId(model.reasoningEffort) };
}

function nativeArguments(args: RoleCall): { description: string; prompt: string; run_in_background?: boolean } {
  return {
    description: args.description,
    prompt: args.prompt,
    ...(args.run_in_background === undefined ? {} : { run_in_background: args.run_in_background }),
  };
}

function nativeResultText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const result = value as { kind?: unknown; jobId?: unknown; subagentId?: unknown; output?: unknown };
  if (result.kind === 'background' && typeof result.jobId === 'string') return `started background subagent job ${result.jobId}`;
  if (result.kind === 'continuable' && typeof result.subagentId === 'string') return `started subagent ${result.subagentId}`;
  if (result.kind !== 'foreground' || !Array.isArray(result.output)) return '';
  return result.output.filter((block): block is { type: 'text'; text: string } => (
    typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text' && typeof (block as { text?: unknown }).text === 'string'
  )).map(block => block.text).join('');
}

function profileGuidance(profiles: readonly ModelProfile[]): string {
  if (profiles.length === 0) return '';
  const lines = profiles.map(profile => {
    const effort = profile.model.reasoningEffort ?? 'model default';
    return `- ${profile.id}: ${profile.name} — ${profile.description} (${profile.model.provider}/${profile.model.id}, ${effort})`;
  });
  return '\n\nEnabled model profiles are independent of role templates. Choose model_profile from the task when one fits. Omit model_profile to keep the role\'s fixed model and effort, or the spawning chat\'s model and effort when the role leaves them unset. A profile that omits effort uses that model\'s default effort. The profile model replaces the role model for this call. The call returns an ordinary native subagent result, and you decide the next step.\n'
    + lines.join('\n');
}

async function executeNativeRole(
  agent: Agent,
  visible: ToolDefinition,
  toolName: string,
  args: RoleCall,
  exec: ToolRunContext,
  agentOptions: AgentOptions,
  persona: string,
  beforeSpawn: <T>(spawn: () => Promise<T>) => Promise<T>,
): Promise<unknown> {
  const key = {};
  const scope = createScope(agent.ctx, key, { parent: agent });
  try {
    await scope.ctx.inject(['tools', 'subagents', 'systemPrompt', 'sessionProjections'], injected => {
      // Native execute awaits route preflight before calling these entry points.
      // Guard that boundary in this call's scope, without modifying the shared
      // service or taking ownership of native child execution/continuation.
      const subagents = injected.subagents;
      const provider = subagents.getProvider('spawn');
      const assertProvider = () => {
        // Approval adds an await after native preflight's identity check.
        if (!provider || subagents.getProvider('spawn') !== provider) {
          throw new ClassmatesError('ROLE_UNAVAILABLE', '原生子智能体供应器已变化，请重新派发');
        }
      };
      const nativeContext = injected.isolate('subagents');
      // An empty target keeps Cordis from unwrapping the host service's own
      // context-shadow metadata and thereby bypassing these method guards.
      nativeContext.provide('subagents', new Proxy({} as typeof subagents, {
        get(_target, property) {
          if (property === 'start') return ((...args: Parameters<typeof subagents.start>) =>
            beforeSpawn(() => { assertProvider(); return subagents.start(...args); }));
          if (property === 'startContinuable') return ((...args: Parameters<typeof subagents.startContinuable>) =>
            beforeSpawn(() => { assertProvider(); return subagents.startContinuable(...args); }));
          const value = Reflect.get(subagents, property, subagents);
          return typeof value === 'function' ? value.bind(subagents) : value;
        },
      }));
      SubagentTool.apply(nativeContext, {
        provider: 'spawn',
        toolName,
        backgroundMode: 'continuable',
        enableRunInBackground: true,
        modelSelectionSettings: false,
        agentOptions,
        persona,
      });
    });
    const native = scope.ctx.tools.get(toolName, key);
    if (!native || native === visible) throw new ClassmatesError('ROLE_UNAVAILABLE', '角色派发已不可用，请重新查看可用工具');
    // The continuable child is owned by exec.agent. Dispose only the temporary tool.
    return await native.execute(nativeArguments(args), exec);
  } finally {
    await scope.dispose();
  }
}

const ROLE_TOOL_PARAMETERS = {
  description: {
    type: 'string',
    required: true,
    description: 'A short (3-5 word) description of the delegated task, for display.',
  },
  prompt: {
    type: 'string',
    required: true,
    description: 'The complete, self-contained task for the subagent. It does not share this conversation\'s context, so include everything it needs.',
  },
  run_in_background: {
    type: 'boolean',
    description: 'Defaults to true. Set false only when your next action depends on the result.',
  },
  model_profile: {
    type: 'string',
    description: 'Optional enabled model profile id from the role guidance. Omit to use this role\'s configured model and effort. Replaces the role model for this call, including when the saved model is unusable. A profile that omits effort uses that model\'s default effort.',
  },
} as const;

interface Installation {
  signature: string;
  dispose(): Promise<void>;
}

/** Compose official tools; DSH owns every child and its execution lifecycle. */
export class SubagentRoles {
  private readonly installed = new Map<Agent, Installation>();
  private readonly pending = new Map<Agent, Promise<void>>();
  private stopped = false;

  constructor(private readonly ctx: Context, private readonly roles: RoleConfig) {}

  refresh(agent: Agent): Promise<void> {
    const operation = (this.pending.get(agent) ?? Promise.resolve()).catch(() => {}).then(() => this.reconcile(agent));
    this.pending.set(agent, operation);
    void operation.finally(() => { if (this.pending.get(agent) === operation) this.pending.delete(agent); }).catch(() => {});
    return operation;
  }

  private eligible(agent: Agent): boolean {
    // A preset which does not offer ordinary delegation must not gain it from roles.
    return !this.stopped && this.ctx.agents.get(agent.id) === agent
      && agent.ctx.tools.get('subagent', agent) !== undefined;
  }

  private async dispatch(
    agent: Agent,
    role: ClassmateDefinition,
    active: () => boolean,
    visible: () => ToolDefinition | undefined,
    toolName: string,
    args: RoleCall,
    exec: ToolRunContext,
  ): Promise<unknown> {
    const assertCurrent = () => {
      if (!active() || !this.eligible(agent)) throw new ClassmatesError('ROLE_UNAVAILABLE', '角色派发已不可用，请重新查看可用工具');
      const current = this.roles.read().roles.find(item => item.id === role.id);
      if (!current?.enabled || current.revision !== role.revision) throw new ClassmatesError('ROLE_CONFLICT', '角色已停用或版本改变，请重新查看可用工具');
    };
    assertCurrent();
    const persona = rolePersona(role);
    let options: AgentOptions;
    if (args.model_profile !== undefined) {
      if (typeof args.model_profile !== 'string' || !args.model_profile.trim()) throw new ClassmatesError('INVALID_PROFILE', 'model_profile 必须是已启用模型用途预设的标识');
      const profile = lookupModelProfile(this.roles.read().modelProfiles ?? [], args.model_profile);
      if (!profile?.enabled) throw new ClassmatesError('INVALID_PROFILE', '模型用途预设不存在或未启用，请重新查看可用工具');
      const selected = await resolveProfileSelection(this.ctx, profile, exec.signal);
      assertCurrent();
      options = explicitChildOptions(selected);
    } else {
      options = fallbackChildOptions(agent, role);
    }
    exec.signal.throwIfAborted();
    assertCurrent();
    const registered = visible();
    if (!registered) throw new ClassmatesError('ROLE_UNAVAILABLE', '角色派发已不可用，请重新查看可用工具');
    if (!options.provider || !options.model) throw new ClassmatesError('MODEL_REQUIRED', '无法确定子智能体的模型，请先选择当前聊天模型');
    const model: ModelBinding = { provider: options.provider, id: options.model,
      ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }) };
    // Freeze omitted effort too: a parent model change during approval must not
    // silently change the child parameters that were shown in that approval.
    options = { ...options, reasoningEffort: options.reasoningEffort };
    return executeNativeRole(agent, registered, toolName, args, exec, options, persona, async spawn => {
      exec.signal.throwIfAborted();
      assertCurrent();
      if (isModelProtected(this.roles.read().protectedModels, model)) {
        await requestModelApproval(this.ctx, agent, { model, roleName: role.name, task: args.prompt,
          toolName, callId: exec.callId, signal: exec.signal });
      }
      exec.signal.throwIfAborted();
      assertCurrent();
      // Do not await another callback between this check and native admission.
      return spawn();
    });
  }

  private async reconcile(agent: Agent): Promise<void> {
    let definitions: ClassmateDefinition[];
    try { definitions = this.eligible(agent) ? this.roles.read().roles.filter(role => role.enabled).map(validateRole) : []; }
    catch (error) {
      // Settings excludes initializing fibers; activation will reconcile again.
      if (error instanceof ClassmatesError && error.code === 'SETTINGS_UNAVAILABLE') return;
      throw error;
    }
    const signature = JSON.stringify(definitions);
    if (this.installed.get(agent)?.signature === signature) return;
    await this.remove(agent);
    if (!definitions.length || !this.eligible(agent)) return;
    let active = true;
    const fiber = agent.ctx.inject(['tools', 'subagents', 'systemPrompt', 'sessionProjections'], scope => {
      for (const role of definitions) {
        const toolName = roleToolName(role.id);
        let visible: ToolDefinition | undefined;
        visible = defineTool({
          name: toolName,
          description: 'Delegate a self-contained task to this role, a native DSH subagent with its own context. Runs in the background by default and returns a subagent id you can continue with send_message; set run_in_background to false to wait for a one-shot result. Optional model_profile selects an enabled model profile for this call.',
          parameters: ROLE_TOOL_PARAMETERS,
          output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: nativeResultText(value) }],
          },
          isConcurrencySafe: () => true,
          execute: (args, exec) => this.dispatch(agent, role, () => active, () => visible, toolName, args, exec) as Promise<never>,
        });
        scope.tools.register(visible);
      }
      scope.systemPrompt.section({
        name: 'classmates:subagent-roles', order: 611, interpolate: false,
        text: context => {
          const visible = definitions.filter(role => scope.tools.get(roleToolName(role.id), context.scope));
          if (!visible.length || !this.eligible(agent)) return '';
          let profiles: ModelProfile[] = [];
          let protectedModels: ModelRoute[] = [];
          try {
            const state = this.roles.read();
            profiles = enabledModelProfiles(state.modelProfiles ?? []);
            protectedModels = state.protectedModels ?? [];
          }
          catch (error) {
            if (!(error instanceof ClassmatesError) || error.code !== 'SETTINGS_UNAVAILABLE') throw error;
          }
          return 'For ordinary delegation, use the matching configured role tool below. These are native DSH subagents: provide description and prompt; background execution supports native subagent messages and interruption, while run_in_background=false waits for a one-shot result. Follow the existing delegation permissions and depth limits. Use Team collaboration only when shared Team messages or tasks are needed.\n'
            + visible.map(role => `- ${roleToolName(role.id)}: ${role.name} — ${role.description}`).join('\n')
            + profileGuidance(profiles)
            + '\n\nRoutes requiring native approval for each new Classmates child (all profiles and efforts): '
            + JSON.stringify(protectedModels)
            + '. Existing child continuations are unaffected. On rejection, decide the next step; do not remove protection or automatically retry approval.';
        },
      });
    });
    const installation: Installation = { signature, dispose: async () => { active = false; await fiber.dispose(); } };
    this.installed.set(agent, installation);
    try { await fiber; }
    catch (error) { if (this.installed.get(agent) === installation) await this.remove(agent); throw error; }
    if (!this.eligible(agent) && this.installed.get(agent) === installation) await this.remove(agent);
  }

  async remove(agent: Agent): Promise<void> {
    const previous = this.installed.get(agent);
    this.installed.delete(agent);
    await previous?.dispose();
  }

  async dispose(): Promise<void> {
    this.stopped = true;
    await Promise.all([...this.installed.keys()].map(agent => this.remove(agent)));
    await Promise.allSettled(this.pending.values());
  }
}
