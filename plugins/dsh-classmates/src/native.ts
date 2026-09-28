import type { Agent, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import type { Context } from '@deepseek-ai/cordis';
import type { TeamService } from '@deepseek-ai/dsh-experimental-agent-team';
import { ReasoningEffortId, type LlmCallConfig, type LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import {
  foldSubagentDescriptor,
  SubagentError,
  type ContinuableCreateRequest,
  type ContinuableCreateSpec,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
  type SubagentRun,
} from '@deepseek-ai/dsh-subagent';
import type { BindingSnapshot, BindingStore } from './bindings.js';
import { PROVIDER, type ModelBinding } from './contracts.js';

const INSTRUCTIONS_SECTION = 'classmates:instructions';
const INSTRUCTIONS_ORDER = 2500;

function teamsOf(ctx: Context): TeamService {
  const teams = ctx.get('agentTeams');
  if (teams === undefined) {
    throw new Error('classmates: Agent Teams service is required');
  }
  return teams;
}

function llmOf(ctx: Context): LlmRuntime {
  const llm = ctx.get('llm');
  if (llm === undefined) {
    throw new Error('classmates: LLM catalog is required');
  }
  return llm;
}

function suffixEvents(agent: Agent): readonly SessionEvent[] {
  return agent.session.snapshotEvents(agent.session.inheritedEventCount);
}

function identifyClassmate(
  ctx: Context,
  agent: Agent,
): { leadId: SessionId; name: string } | undefined {
  const descriptor = foldSubagentDescriptor(suffixEvents(agent));
  if (descriptor === undefined || descriptor.provider !== PROVIDER) return undefined;
  if (descriptor.mode !== 'continuable') {
    throw new Error(`classmates: ${PROVIDER} child ${agent.id} descriptor is not continuable`);
  }
  const teams = teamsOf(ctx);
  const membership = teams.tryMembership(agent);
  if (membership === undefined || membership.role !== 'teammate') {
    throw new Error(`classmates: ${PROVIDER} child ${agent.id} is not a Team teammate`);
  }
  const row = teams.listMembers(agent).find(
    member => member.id === agent.id && member.name === membership.name,
  );
  if (row === undefined) {
    throw new Error(`classmates: roster id mismatch for ${membership.name}`);
  }
  if (row.provider !== PROVIDER) {
    throw new Error(`classmates: roster provider mismatch for ${membership.name}`);
  }
  if (row.context !== 'fresh') {
    throw new Error(`classmates: ${membership.name} is not a fresh ${PROVIDER} teammate`);
  }
  return { leadId: membership.root.id, name: membership.name };
}

function modelSelection(model: ModelBinding): ModelSelection {
  return {
    provider: model.provider,
    model: model.id,
    ...model.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(model.reasoningEffort) },
  };
}

async function validateModel(ctx: Context, model: ModelBinding): Promise<void> {
  const info = await llmOf(ctx).resolveModelInfo(model.provider, model.id);
  if (model.reasoningEffort === undefined) return;
  const efforts = info.reasoning?.efforts ?? [];
  if (!efforts.some(effort => effort.id === model.reasoningEffort)) {
    throw new Error(
      `classmates: reasoning effort "${model.reasoningEffort}" is not valid for ${model.provider}/${model.id}`,
    );
  }
}

function assertRequestRoute(config: LlmCallConfig, snapshot: BindingSnapshot): void {
  const model = snapshot.role.model;
  if (model === null) {
    throw new Error(`classmates: binding for ${snapshot.name} has no model`);
  }
  if (config.provider !== model.provider || config.model !== model.id) {
    throw new Error(
      `classmates: request route ${config.provider}/${config.model} conflicts with binding ${model.provider}/${model.id}`,
    );
  }
  if (model.reasoningEffort === undefined) {
    if (config.reasoningEffort !== undefined) {
      throw new Error(
        `classmates: request retained effort "${config.reasoningEffort}" after binding selected the model default`,
      );
    }
    return;
  }
  if (config.reasoningEffort !== model.reasoningEffort) {
    throw new Error(
      `classmates: request effort ${String(config.reasoningEffort)} conflicts with binding ${model.reasoningEffort}`,
    );
  }
}

function assemble(
  agent: Agent,
  snapshot: BindingSnapshot,
  assemblies: Map<Agent, () => void>,
): void {
  if (assemblies.has(agent)) return;
  const model = snapshot.role.model;
  if (model === null) {
    throw new Error(`classmates: binding for ${snapshot.name} has no model`);
  }
  const selection: ModelSelectionRef = {
    current: modelSelection(model),
    assembled: undefined,
  };
  const disposeSelection = installModelSelection(agent.ctx, selection);
  const disposeSection = agent.ctx.systemPrompt.section({
    name: INSTRUCTIONS_SECTION,
    order: INSTRUCTIONS_ORDER,
    text: snapshot.role.instructions,
    interpolate: false,
  });
  const disposeGuard = agent.ctx.on(
    'agent/request',
    async (_payload, next): Promise<LlmCallConfig> => {
      const resolved = await next();
      if (selection.assembled === undefined) {
        throw new Error(`classmates: model selection missing for ${snapshot.name}`);
      }
      assertRequestRoute(resolved, snapshot);
      return resolved;
    },
    { prepend: true },
  );
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    disposeGuard();
    disposeSection();
    disposeSelection();
    assemblies.delete(agent);
  };
  assemblies.set(agent, dispose);
  agent.ctx.effect(() => dispose);
}

async function attach(
  ctx: Context,
  store: BindingStore,
  agent: Agent,
  assemblies: Map<Agent, () => void>,
): Promise<void> {
  const identity = identifyClassmate(ctx, agent);
  if (identity === undefined) return;
  const binding = await store.read(identity.leadId, identity.name);
  if (binding === undefined) {
    throw new Error(`classmates: missing binding for ${identity.name}`);
  }
  if (binding.role.model === null) {
    throw new Error(`classmates: binding for ${identity.name} has no model`);
  }
  await validateModel(ctx, binding.role.model);
  const claimed = await store.claim(identity.leadId, identity.name, agent.id);
  assemble(agent, claimed, assemblies);
}

class ClassmatesSpawnProvider implements SubagentProvider {
  readonly name = PROVIDER;
  readonly inheritsParentContext = false;
  readonly capabilities: SubagentCapabilities = {
    agentOptions: false,
    outputSchema: false,
    depthLimit: false,
    toolFilter: false,
    persona: false,
  };

  start(_request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    return Promise.reject(
      new SubagentError(
        `${PROVIDER} is continuable-only; ordinary one-shot start is rejected`,
        'UNSUPPORTED_CAPABILITY',
      ),
    );
  }

  prepareContinuable(_request: ContinuableCreateRequest): Promise<ContinuableCreateSpec> {
    return Promise.resolve({});
  }
}

function refuseHotInstall(ctx: Context): void {
  for (const agent of ctx.agents.list()) {
    const descriptor = foldSubagentDescriptor(suffixEvents(agent));
    if (descriptor?.provider !== PROVIDER) continue;
    if (descriptor.mode !== 'continuable') {
      throw new Error(
        `classmates: refuse hot install onto already-loaded ${PROVIDER} agent ${agent.id}; install before resume`,
      );
    }
    throw new Error(
      `classmates: refuse hot install onto already-loaded ${PROVIDER} agent ${agent.id}; install before resume`,
    );
  }
}

/** Register the classmates-spawn provider and awaited created assembly. */
export function installNative(ctx: Context, store: BindingStore): () => void {
  teamsOf(ctx);
  refuseHotInstall(ctx);
  const dispose = ctx.effect(() => {
    const assemblies = new Map<Agent, () => void>();
    const disposeProvider = ctx.subagents.registerProvider(new ClassmatesSpawnProvider());
    const disposeCreated = ctx.on('agent/created', async ({ agent }) => {
      await attach(ctx, store, agent, assemblies);
    });
    return () => {
      disposeCreated();
      disposeProvider();
      for (const release of [...assemblies.values()]) release();
      assemblies.clear();
    };
  }, 'classmates.installNative()');
  return () => {
    void dispose();
  };
}
