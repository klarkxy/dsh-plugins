import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-experimental-agent-team';
import type {} from '@deepseek-ai/dsh-tools';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import { ClassmatesError, currentModelFromOwnRequestHeaders, RoleConfig, validateModel, validateRole } from './config.js';
import type { ClassmateDefinition, ModelBinding, ModelProfile } from './contracts.js';
import { MEMBER_NAME, PROVIDER } from './contracts.js';
import type { BindingStore } from './bindings.js';
import { lookupModelProfile } from './model-profiles.js';
import { enabledModelProfiles, resolveProfileSelection } from './subagent-roles.js';
import { isModelProtected, requestModelApproval } from './model-protection.js';

export interface SpawnInput { classmate_id: string; revision: number; name: string; task: string; model_profile?: string }

function sameSpawnIdentity(binding: { role: ClassmateDefinition; taskHash: string; modelProfileId?: string }, input: SpawnInput, taskHash: string): boolean {
  return binding.role.id === input.classmate_id && binding.role.revision === input.revision
    && binding.taskHash === taskHash && binding.modelProfileId === input.model_profile;
}

function publishedProfile(profile: ModelProfile) {
  const model = profile.model.reasoningEffort === undefined
    ? { provider: profile.model.provider, id: profile.model.id }
    : { provider: profile.model.provider, id: profile.model.id, reasoningEffort: profile.model.reasoningEffort };
  return { id: profile.id, revision: profile.revision, name: profile.name, description: profile.description, enabled: true, model };
}

/** Resolve once before persistence. Stored instances always contain a concrete route. */
export async function resolveRoleForSpawn(ctx: Context, agent: Agent, role: ClassmateDefinition, profileModel?: ModelBinding): Promise<ClassmateDefinition> {
  const { reasoningEffort: roleEffort, ...definition } = role;
  if (profileModel) {
    const model: ModelBinding = profileModel.reasoningEffort === undefined
      ? { provider: profileModel.provider, id: profileModel.id }
      : { provider: profileModel.provider, id: profileModel.id, reasoningEffort: profileModel.reasoningEffort };
    const resolved = { ...definition, model };
    try { await validateModel(ctx, resolved); }
    catch (error) {
      if (error instanceof ClassmatesError && error.code === 'INVALID_EFFORT') {
        throw new ClassmatesError('INVALID_EFFORT', `模型 ${model.provider}/${model.id} 不支持思考强度 ${model.reasoningEffort}，请为此预设明确选择兼容的思考强度`);
      }
      throw error;
    }
    return resolved;
  }
  const current = currentModelFromOwnRequestHeaders(agent.session.snapshotEvents(), agent.session.inheritedEventCount)
    ?? { provider: agent.options.provider, id: agent.options.model, reasoningEffort: agent.options.reasoningEffort };
  const route = role.model ?? current;
  if (!route.provider || !route.id) throw new ClassmatesError('MODEL_REQUIRED', '当前聊天没有可继承的模型，请先选择聊天模型');
  const reasoningEffort = roleEffort ?? role.model?.reasoningEffort ?? current.reasoningEffort;
  const model: ModelBinding = { provider: route.provider, id: route.id, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
  const resolved = { ...definition, model };
  try { await validateModel(ctx, resolved); }
  catch (error) {
    if (error instanceof ClassmatesError && error.code === 'INVALID_EFFORT') {
      throw new ClassmatesError('INVALID_EFFORT', `模型 ${model.provider}/${model.id} 不支持思考强度 ${reasoningEffort}，请为此角色明确选择兼容的思考强度`);
    }
    throw error;
  }
  return resolved;
}

export class ClassmateTools {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly ctx: Context, private readonly roles: RoleConfig, private readonly store: BindingStore) {}

  private lead(agent: Agent) {
    const membership = this.ctx.agentTeams.membership(agent);
    if (membership.role !== 'lead') throw new ClassmatesError('LEAD_ONLY', '只有 Team Lead 能创建 Classmate');
    return membership;
  }

  async list(agent: Agent) {
    this.lead(agent);
    const state = this.roles.read();
    const modelProfiles = enabledModelProfiles(state.modelProfiles ?? []);
    const result = [];
    for (const role of state.roles) {
      if (!role.enabled) continue;
      let fixedModelUsable = true;
      try { await validateModel(this.ctx, role); }
      catch { fixedModelUsable = false; }
      if (!fixedModelUsable && modelProfiles.length === 0) continue;
      result.push({ id: role.id, revision: role.revision, name: role.name, description: role.description, model: role.model, reasoningEffort: role.reasoningEffort ?? role.model?.reasoningEffort });
    }
    return { roles: result, modelProfiles: modelProfiles.map(publishedProfile), protectedModels: state.protectedModels ?? [] };
  }

  async spawn(agent: Agent, input: SpawnInput, signal: AbortSignal, callId?: ToolRunContext['callId']) {
    input = { ...input };
    this.lead(agent);
    if (!input || typeof input.name !== 'string' || !MEMBER_NAME.test(input.name) || input.name === 'lead' || input.name.length > 64 || typeof input.task !== 'string' || !input.task.trim() || input.task.length > 64000 || typeof input.classmate_id !== 'string' || !Number.isSafeInteger(input.revision)) throw new ClassmatesError('INVALID_SPAWN', '必须提供 classmates_list 返回的 classmate_id 和 revision；name 须为小写英文、数字、连字符且不超过 64 字符，不能为 lead；task 必须非空且不超过 64000 字符');
    if (input.model_profile !== undefined && (typeof input.model_profile !== 'string' || !input.model_profile.trim())) throw new ClassmatesError('INVALID_PROFILE', 'model_profile 必须是已启用模型用途预设的标识');
    const key = JSON.stringify([agent.id, input.name]);
    const before = this.pending.get(key) ?? Promise.resolve();
    const operation = before.catch(() => {}).then(async () => {
      signal.throwIfAborted();
      this.lead(agent);
      // Compare the original request before consulting mutable template/profile data.
      const taskHash = createHash('sha256').update(input.task).digest('hex');
      const member = this.ctx.agentTeams.listMembers(agent).find(row => row.name === input.name);
      if (member) {
        const binding = await this.store.read(agent.id, input.name);
        if (!binding || member.provider !== PROVIDER || binding.childId !== member.id || !sameSpawnIdentity(binding, input, taskHash)) throw new ClassmatesError('NAME_CONFLICT', '此成员名已用于不同的创建请求');
        if (member.status === 'provisioning' || member.status === 'failed') throw new ClassmatesError('CREATE_UNRESOLVED', '官方成员创建未成功完成，请检查 Team 状态；不会重复投递首任务');
        return { target: member.name, member, classmate_id: binding.role.id, revision: binding.role.revision, selected: binding.role.model, requestObserved: false, reused: true };
      }
      const found = this.roles.read().roles.find(row => row.id === input.classmate_id);
      if (!found || !found.enabled || found.revision !== input.revision) throw new ClassmatesError('ROLE_CONFLICT', '角色已停用或版本改变，请重新调用 classmates_list');
      const role = validateRole(found);
      const assertCurrent = () => {
        signal.throwIfAborted();
        this.lead(agent);
        if (this.ctx.agents.get(agent.id) !== agent) throw new ClassmatesError('LEAD_ONLY', '调用方已不再可用');
        const current = this.roles.read().roles.find(row => row.id === role.id);
        if (!current?.enabled || current.revision !== role.revision) throw new ClassmatesError('ROLE_CONFLICT', '角色已停用或版本改变，请重新调用 classmates_list');
      };
      const prepared = await this.store.read(agent.id, input.name);
      if (prepared && (prepared.childId !== undefined || !sameSpawnIdentity(prepared, input, taskHash))) {
        throw new ClassmatesError('NAME_CONFLICT', '此成员名已用于不同的创建请求');
      }
      let selected: ModelBinding | undefined;
      if (!prepared && typeof input.model_profile === 'string') {
        const profile = lookupModelProfile(this.roles.read().modelProfiles ?? [], input.model_profile);
        if (!profile?.enabled) throw new ClassmatesError('INVALID_PROFILE', '模型用途预设不存在或未启用，请重新调用 classmates_list');
        selected = await resolveProfileSelection(this.ctx, profile, signal);
      }
      const resolved = prepared?.role ?? await resolveRoleForSpawn(this.ctx, agent, role, selected);
      await validateModel(this.ctx, resolved);
      signal.throwIfAborted();
      await this.store.prepare(agent.id, input.name, resolved, input.task, input.model_profile);
      assertCurrent();
      if (!resolved.model) throw new ClassmatesError('MODEL_REQUIRED', '无法确定成员的模型');
      if (isModelProtected(this.roles.read().protectedModels, resolved.model)) {
        await requestModelApproval(this.ctx, agent, { model: resolved.model, roleName: role.name, task: input.task,
          toolName: 'classmates_spawn', callId, signal });
        assertCurrent();
      }
      const created = await this.ctx.agentTeams.spawnTeammate(agent, { name: input.name, description: role.description, provider: PROVIDER, context: 'fresh', prompt: [{ type: 'text', text: input.task }], signal });
      return { target: created.member.name, member: created.member, classmate_id: role.id, revision: role.revision, selected: resolved.model, requestObserved: false, reused: false };
    });
    this.pending.set(key, operation);
    try { return await operation; }
    finally { if (this.pending.get(key) === operation) this.pending.delete(key); }
  }

  install(agent: Agent): () => void {
    const membership = this.ctx.agentTeams.tryMembership(agent);
    if (membership?.role !== 'lead') return () => {};
    const caller = (candidate?: Agent): Agent => { if (candidate !== agent) throw new ClassmatesError('LEAD_ONLY', 'Caller identity mismatch'); return candidate; };
    const output = { schema: { type: 'object' as const, additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] };
    const disposers = [
      agent.ctx.tools.register({ name: 'classmates_list', description: 'List enabled specialist roles and enabled model profiles when the user asks for team collaboration. Creates no members.', parameters: { type: 'object', properties: {}, additionalProperties: false }, output, execute: async (_args, exec) => this.list(caller(exec.agent)) }),
      agent.ctx.tools.register({ name: 'classmates_spawn', description: 'Create a fresh Team teammate from an approved role and its listed revision. model_profile selects an enabled model profile and replaces the role model for this teammate. Requires user authorization; continue with official Team message and task tools.', parameters: { type: 'object', properties: { classmate_id: { type: 'string', description: 'Exact role id returned by classmates_list.' }, revision: { type: 'integer', minimum: 1, description: 'Required: current role revision returned by classmates_list.' }, name: { type: 'string', pattern: MEMBER_NAME.source, maxLength: 64, description: 'Unique lowercase letters/digits/hyphens teammate name, for example research-proof. Cannot be lead.' }, task: { type: 'string', minLength: 1, maxLength: 64000, description: 'Initial task for this teammate.' }, model_profile: { type: 'string', description: 'Optional enabled model profile id from classmates_list. Omit to keep the role\'s existing model and effort. Replaces the role model for this teammate.' } }, required: ['classmate_id', 'revision', 'name', 'task'], additionalProperties: false }, output, execute: async (args, exec) => this.spawn(caller(exec.agent), args as SpawnInput, exec.signal, exec.callId) }),
      agent.ctx.systemPrompt.section({ name: 'classmates:discovery', order: 610, text: 'classmates_list discovers configured specialist roles and enabled model profiles. For ordinary delegation, use the matching role-specific subagent tool. When shared Team messages or tasks are needed, use classmates_spawn and then official Team tools. Pass model_profile when the task should use one listed profile; omit it to keep the role\'s existing model behavior. Follow existing collaboration permissions. You may work alone when no role fits.', interpolate: false }),
    ];
    return () => disposers.forEach(dispose => dispose());
  }
}

