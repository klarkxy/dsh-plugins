import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-settings';
import type { ClassmateDefinition, ClassmatesState, ModelBinding, ModelChoice, ModelProfile, NormalizedRole, RoleChange, RoleModelSelection } from './contracts.js';
import { fixedModelBinding, MEMBER_NAME, normalizeRole, SETTINGS_NS } from './contracts.js';
import { isModelProtected, validateModelRoute, validateProtectedModels } from './model-protection.js';
import {
  applyModelProfileChanges,
  validateEnabledProfileModel,
  validateModelProfile,
  validateModelProfileChanges,
  validateModelProfiles,
} from './model-profiles.js';

export class ClassmatesError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ClassmatesError'; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function routeField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= 250 ? value : undefined;
}

/** Validate any accepted model shape and return the legacy-tolerant representation. */
function validateRoleModel(role: Record<string, unknown>): ClassmateDefinition['model'] | RoleModelSelection {
  const model = role.model;
  if (model === null || model === undefined) return null;
  if (!isRecord(model)) throw new ClassmatesError('INVALID_MODEL', '模型绑定无效');
  if (model.kind !== undefined) {
    if (model.kind === 'inherit') return { kind: 'inherit' };
    if (model.kind === 'profile') {
      if (typeof model.profileId !== 'string' || !MEMBER_NAME.test(model.profileId) || model.profileId.length > 80) {
        throw new ClassmatesError('INVALID_PROFILE', '模型预设标识须为小写英文、数字和连字符');
      }
      return { kind: 'profile', profileId: model.profileId };
    }
    if (model.kind === 'fixed') {
      const provider = routeField(model.provider);
      const id = routeField(model.id);
      if (!provider || !id) throw new ClassmatesError('INVALID_MODEL', '模型路由无效');
      if (model.effort !== undefined && !routeField(model.effort)) throw new ClassmatesError('INVALID_EFFORT', '思考强度无效');
      return {
        kind: 'fixed', provider, id,
        ...model.effort === undefined ? {} : { effort: model.effort as string },
      };
    }
    throw new ClassmatesError('INVALID_MODEL', '模型绑定无效');
  }
  for (const key of ['provider', 'id'] as const) {
    if (!routeField(model[key])) throw new ClassmatesError('INVALID_MODEL', '模型路由无效');
  }
  if (model.reasoningEffort !== undefined && (typeof model.reasoningEffort !== 'string' || !model.reasoningEffort.trim())) throw new ClassmatesError('INVALID_EFFORT', '思考强度无效');
  return {
    provider: model.provider as string, id: model.id as string,
    ...model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort as string },
  };
}

export function validateRole(value: unknown): NormalizedRole {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ClassmatesError('INVALID_ROLE', '角色格式无效');
  const role = value as ClassmateDefinition;
  if (role.schemaVersion !== 1) throw new ClassmatesError('SCHEMA_VERSION', '不支持此角色格式版本');
  if (typeof role.id !== 'string' || !MEMBER_NAME.test(role.id) || role.id.length > 80) throw new ClassmatesError('INVALID_ID', '角色标识须为小写英文、数字和连字符');
  if (!Number.isSafeInteger(role.revision) || role.revision < 0) throw new ClassmatesError('INVALID_REVISION', '角色版本无效');
  for (const [key, limit] of [['name', 100], ['description', 200], ['instructions', 32000]] as const) {
    if (typeof role[key] !== 'string' || !role[key].trim() || role[key].length > limit) throw new ClassmatesError('INVALID_FIELD', `${key} 必须填写，且不超过 ${limit} 字符`);
  }
  if (typeof role.enabled !== 'boolean') throw new ClassmatesError('INVALID_ROLE', '启用状态无效');
  if (role.reasoningEffort !== undefined && (typeof role.reasoningEffort !== 'string' || !role.reasoningEffort.trim() || role.reasoningEffort.length > 250)) throw new ClassmatesError('INVALID_EFFORT', '思考强度无效');
  const model = validateRoleModel(role as unknown as Record<string, unknown>);
  const modelEffort = fixedModelBinding({ ...role, model: model as ClassmateDefinition['model'] } as ClassmateDefinition)?.reasoningEffort;
  if (role.reasoningEffort !== undefined && modelEffort !== undefined && role.reasoningEffort !== modelEffort) throw new ClassmatesError('INVALID_EFFORT', '新旧思考强度配置冲突');
  const recommendedRaw = (role as { recommendedModelProfileId?: unknown }).recommendedModelProfileId;
  let recommendedModelProfileId: string | undefined;
  if (recommendedRaw !== undefined && recommendedRaw !== null && recommendedRaw !== '') {
    if (typeof recommendedRaw !== 'string' || !MEMBER_NAME.test(recommendedRaw) || recommendedRaw.length > 80) {
      throw new ClassmatesError('INVALID_PROFILE', '建议的模型预设标识须为小写英文、数字和连字符');
    }
    recommendedModelProfileId = recommendedRaw;
  }
  return normalizeRole({
    schemaVersion: 1, id: role.id, revision: role.revision, name: role.name,
    description: role.description, instructions: role.instructions, enabled: role.enabled,
    ...(role.reasoningEffort === undefined ? {} : { reasoningEffort: role.reasoningEffort }),
    ...(recommendedModelProfileId === undefined ? {} : { recommendedModelProfileId }),
    model: model as ClassmateDefinition['model'],
  });
}

export function validateRoles(value: unknown): NormalizedRole[] {
  if (!Array.isArray(value) || value.length > 100) throw new ClassmatesError('INVALID_ROLES', '角色列表无效或超过 100 项');
  const roles = value.map(validateRole);
  if (new Set(roles.map(role => role.id)).size !== roles.length) throw new ClassmatesError('DUPLICATE_ID', '角色标识重复');
  return roles;
}

const MODEL_ROUTE_MAX = 250;

function routeText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= MODEL_ROUTE_MAX ? value : undefined;
}

/** Latest own request/header route. Inherited prefix and invalid shapes stay null. */
export function currentModelFromOwnRequestHeaders(events: unknown, inheritedEventCount = 0): ModelBinding | null {
  if (!Array.isArray(events) || !Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0) return null;
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (!isRecord(event) || event.type !== 'request/header') continue;
    if (typeof event.seq !== 'number' || !Number.isSafeInteger(event.seq) || event.seq < inheritedEventCount) continue;
    const data = isRecord(event.data) ? event.data : undefined;
    const header = data && isRecord(data.header) ? data.header : undefined;
    const config = header && isRecord(header.config) ? header.config : undefined;
    if (!config) continue;
    const provider = routeText(config.provider);
    const id = routeText(config.model) ?? routeText(config.id);
    if (!provider || !id) continue;
    if (config.reasoningEffort === undefined) return { provider, id };
    const reasoningEffort = routeText(config.reasoningEffort);
    if (!reasoningEffort) continue;
    return { provider, id, reasoningEffort };
  }
  return null;
}

/** One RoleChange envelope. Rejects unknown ops and extra keys. */
export function validateRoleChange(value: unknown): RoleChange {
  if (!isRecord(value) || typeof value.op !== 'string') throw new ClassmatesError('INVALID_BATCH', '批量操作格式无效');
  if (value.op === 'upsert') {
    if (Object.keys(value).some(key => key !== 'op' && key !== 'role')) throw new ClassmatesError('INVALID_BATCH', '批量操作含未知字段');
    return { op: 'upsert', role: validateRole(value.role) };
  }
  if (value.op === 'remove') {
    if (Object.keys(value).some(key => key !== 'op' && key !== 'id' && key !== 'revision')) throw new ClassmatesError('INVALID_BATCH', '批量操作含未知字段');
    if (typeof value.id !== 'string' || !value.id) throw new ClassmatesError('INVALID_ID', '角色标识须为小写英文、数字和连字符');
    if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0) {
      throw new ClassmatesError('INVALID_REVISION', '角色版本无效');
    }
    return { op: 'remove', id: value.id, revision: value.revision };
  }
  throw new ClassmatesError('INVALID_BATCH', '不支持的批量操作');
}

export function validateRoleChanges(value: unknown): RoleChange[] {
  if (!Array.isArray(value) || value.length > 100) throw new ClassmatesError('INVALID_BATCH', '批量操作无效或超过 100 项');
  const changes = value.map(validateRoleChange);
  const targeted = new Set<string>();
  for (const change of changes) {
    const id = change.op === 'upsert' ? change.role.id : change.id;
    if (targeted.has(id)) throw new ClassmatesError('DUPLICATE_ID', '同一批次不能重复针对同一角色');
    targeted.add(id);
  }
  return changes;
}

export async function validateModel(ctx: Context, role: ClassmateDefinition | NormalizedRole): Promise<void> {
  if (!role.enabled) return;
  // Only a fixed route resolves against the catalog here. A profile reference
  // is validated at dispatch (missing/disabled is a hard error with guidance).
  const binding = fixedModelBinding(role);
  if (binding === null) return;
  if (!ctx.llm.listProviders().some(provider => provider.id === binding.provider)) throw new ClassmatesError('MODEL_UNAVAILABLE', '模型供应商未配置');
  const model = await ctx.llm.resolveModelInfo(binding.provider, binding.id);
  const selectedEffort = role.reasoningEffort ?? binding.reasoningEffort;
  if (selectedEffort !== undefined && !model.reasoning?.efforts.some(effort => effort.id === selectedEffort)) throw new ClassmatesError('INVALID_EFFORT', '所选模型不支持该思考强度');
}

/** Persisted form: normalized role without the read-time migration notice. */
function toStoredRole(role: NormalizedRole): Omit<NormalizedRole, 'migratedRecommendation'> {
  const { migratedRecommendation: _notice, ...stored } = role;
  return stored;
}

export class RoleConfig {
  constructor(private readonly ctx: Context, readonly namespace = SETTINGS_NS) {}

  read() {
    const settings = this.ctx.settings;
    const entry = settings.describe().find(item => item.ns === this.namespace);
    if (!entry) throw new ClassmatesError('SETTINGS_UNAVAILABLE', '队友角色配置尚未加载');
    const value = entry.value as { roles?: unknown; modelProfiles?: unknown; protectedModels?: unknown };
    return {
      roles: validateRoles(value.roles),
      modelProfiles: validateModelProfiles(value.modelProfiles),
      protectedModels: validateProtectedModels(value.protectedModels),
      settingsRevision: entry.revision,
      writable: settings.writable,
    };
  }

  private assertWritable() {
    if (!this.ctx.settings.writable) throw new ClassmatesError('SETTINGS_READONLY', '当前配置为只读，无法保存');
  }

  private assertExpected(expected: number) {
    if (!Number.isSafeInteger(expected) || expected < 0) throw new ClassmatesError('SETTINGS_CONFLICT', '请重新读取配置');
  }

  async catalog(): Promise<{ models: ModelChoice[]; catalogErrors: string[] }> {
    const result: ModelChoice[] = [];
    const catalogErrors: string[] = [];
    const providers = this.ctx.llm.listProviders();
    await Promise.all(providers.map(async provider => {
      const providerId = typeof provider?.id === 'string' ? provider.id.trim() : '';
      const providerName = typeof provider?.name === 'string' ? provider.name.trim() : '';
      const label = providerName || providerId || '未命名供应商';
      if (!providerId) {
        catalogErrors.push(`${label} 的模型目录暂时不可用`);
        return;
      }
      try {
        const models = await this.ctx.llm.listModels(providerId);
        for (const model of models) {
          const modelId = typeof model?.id === 'string' ? model.id.trim() : '';
          const modelName = typeof model?.name === 'string' ? model.name.trim() : '';
          if (!modelId || !modelName) {
            catalogErrors.push(`${label} 的一项模型缺少公开标识或名称`);
            continue;
          }
          try {
            const info = await this.ctx.llm.resolveModelInfo(providerId, modelId);
            result.push({
              provider: providerId,
              ...providerName ? { providerName } : {},
              availability: 'unverified',
              id: modelId,
              name: modelName,
              ...typeof info.description === 'string' && info.description ? { description: info.description } : {},
              ...typeof info.context?.contextWindow === 'number' ? { contextWindow: info.context.contextWindow } : {},
              efforts: info.reasoning?.efforts.map(effort => ({
                id: effort.id,
                name: effort.name,
                ...typeof effort.description === 'string' && effort.description ? { description: effort.description } : {},
              })) ?? [],
            });
          } catch { catalogErrors.push(`${label} / ${modelName} 暂时不可用`); }
        }
      } catch { catalogErrors.push(`${label} 的模型目录暂时不可用`); }
    }));
    result.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
    return { models: result, catalogErrors };
  }

  async load(): Promise<ClassmatesState> {
    const catalog = await this.catalog();
    return { ...this.read(), ...catalog };
  }

  async save(input: unknown, expected: number): Promise<ClassmatesState> {
    const role = validateRole(input);
    this.assertExpected(expected);
    this.assertWritable();
    await validateModel(this.ctx, role);
    const state = this.read();
    if (state.settingsRevision !== expected) throw new ClassmatesError('SETTINGS_CONFLICT', '配置已被其他页面修改，请刷新后重试；当前输入仍保留');
    const existing = state.roles.find(item => item.id === role.id);
    if (role.revision !== (existing?.revision ?? 0)) throw new ClassmatesError('ROLE_CONFLICT', '角色版本已改变，请重新读取');
    const next = { ...role, revision: (existing?.revision ?? 0) + 1 };
    const roles = existing ? state.roles.map(item => item.id === role.id ? next : item) : [...state.roles, next];
    validateRoles(roles);
    await this.ctx.settings.mutate(this.namespace, [{ op: 'set', path: ['roles'], value: roles.map(toStoredRole) }], expected);
    return this.load();
  }

  async remove(id: string, revision: number, expected: number): Promise<ClassmatesState> {
    this.assertWritable();
    const state = this.read();
    const existing = state.roles.find(item => item.id === id);
    if (!existing || existing.revision !== revision || state.settingsRevision !== expected) throw new ClassmatesError('ROLE_CONFLICT', '角色已改变，请刷新后重试');
    await this.ctx.settings.mutate(this.namespace, [{ op: 'set', path: ['roles'], value: state.roles.filter(item => item.id !== id) }], expected);
    return this.load();
  }

  /** All-or-nothing role edits: every op validates, then one settings CAS mutation. */
  async batch(input: unknown, expected: number): Promise<ClassmatesState> {
    this.assertExpected(expected);
    this.assertWritable();
    const changes = validateRoleChanges(input);
    const state = this.read();
    if (state.settingsRevision !== expected) throw new ClassmatesError('SETTINGS_CONFLICT', '配置已被其他页面修改，请刷新后重试；当前输入仍保留');
    if (changes.length === 0) return this.load();
    let roles = state.roles;
    const upserts: NormalizedRole[] = [];
    for (const change of changes) {
      if (change.op === 'upsert') {
        const existing = roles.find(item => item.id === change.role.id);
        if (change.role.revision !== (existing?.revision ?? 0)) throw new ClassmatesError('ROLE_CONFLICT', '角色版本已改变，请重新读取');
        const next = { ...change.role, revision: (existing?.revision ?? 0) + 1 };
        upserts.push(next);
        roles = existing ? roles.map(item => item.id === next.id ? next : item) : [...roles, next];
      } else {
        const existing = roles.find(item => item.id === change.id);
        if (!existing || existing.revision !== change.revision) throw new ClassmatesError('ROLE_CONFLICT', '角色已改变，请刷新后重试');
        roles = roles.filter(item => item.id !== change.id);
      }
    }
    validateRoles(roles);
    await Promise.all(upserts.map(role => validateModel(this.ctx, role)));
    await this.ctx.settings.mutate(this.namespace, [{ op: 'set', path: ['roles'], value: roles.map(toStoredRole) }], expected);
    return this.load();
  }

  async saveModelProfile(input: unknown, expected: number): Promise<ClassmatesState> {
    return this.batchModelProfiles([{ op: 'upsert', profile: validateModelProfile(input) }], expected);
  }

  async setModelProtection(input: unknown, required: boolean, expected: number): Promise<ClassmatesState> {
    this.assertExpected(expected);
    this.assertWritable();
    const model = validateModelRoute(input);
    if (typeof required !== 'boolean') throw new ClassmatesError('INVALID_PROTECTION', '模型审批开关无效');
    const state = this.read();
    if (state.settingsRevision !== expected) throw new ClassmatesError('SETTINGS_CONFLICT', '配置已被其他页面修改，请刷新后重试；当前输入仍保留');
    if (isModelProtected(state.protectedModels, model) === required) return this.load();
    const protectedModels = required ? [...state.protectedModels, model]
      : state.protectedModels.filter(route => route.provider !== model.provider || route.id !== model.id);
    validateProtectedModels(protectedModels);
    await this.ctx.settings.mutate(this.namespace, [{ op: 'set', path: ['protectedModels'], value: protectedModels }], expected);
    return this.load();
  }

  async removeModelProfile(id: string, revision: number, expected: number): Promise<ClassmatesState> {
    return this.batchModelProfiles([{ op: 'remove', id, revision }], expected);
  }

  /** All-or-nothing model-use preset edits on the same settings CAS as roles. */
  async batchModelProfiles(input: unknown, expected: number): Promise<ClassmatesState> {
    this.assertExpected(expected);
    this.assertWritable();
    const changes = validateModelProfileChanges(input);
    const state = this.read();
    if (state.settingsRevision !== expected) throw new ClassmatesError('SETTINGS_CONFLICT', '配置已被其他页面修改，请刷新后重试；当前输入仍保留');
    if (changes.length === 0) return this.load();
    const modelProfiles = applyModelProfileChanges(state.modelProfiles, changes);
    const upserts: ModelProfile[] = [];
    for (const change of changes) {
      if (change.op === 'upsert') {
        const next = modelProfiles.find(item => item.id === change.profile.id);
        if (next) upserts.push(next);
      }
    }
    await Promise.all(upserts.map(profile => validateEnabledProfileModel(this.ctx, profile)));
    await this.ctx.settings.mutate(this.namespace, [{ op: 'set', path: ['modelProfiles'], value: modelProfiles }], expected);
    return this.load();
  }
}
