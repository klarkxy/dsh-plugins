import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-llm';
import { ClassmatesError } from './config.js';
import { MEMBER_NAME, type ModelBinding, type ModelProfile, type ModelProfileChange } from './contracts.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, code: string, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ClassmatesError(code, message);
  return value;
}

function profileModel(value: unknown): ModelBinding {
  if (!isRecord(value)) throw new ClassmatesError('INVALID_MODEL', '模型绑定无效');
  const provider = requiredText(value.provider, 'INVALID_MODEL', '模型路由无效');
  const id = requiredText(value.id, 'INVALID_MODEL', '模型路由无效');
  if (provider.length > 250 || id.length > 250) throw new ClassmatesError('INVALID_MODEL', '模型路由无效');
  if (value.reasoningEffort !== undefined && (typeof value.reasoningEffort !== 'string' || !value.reasoningEffort.trim())) {
    throw new ClassmatesError('INVALID_EFFORT', '思考强度无效');
  }
  return {
    provider,
    id,
    ...value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort },
  };
}

export function validateModelProfile(value: unknown): ModelProfile {
  if (!isRecord(value)) throw new ClassmatesError('INVALID_PROFILE', '模型用途预设格式无效');
  if (typeof value.id !== 'string' || !MEMBER_NAME.test(value.id) || value.id.length > 80) {
    throw new ClassmatesError('INVALID_ID', '预设标识须为小写英文、数字和连字符');
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    throw new ClassmatesError('INVALID_REVISION', '预设版本无效');
  }
  for (const [key, limit] of [['name', 100], ['description', 200]] as const) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > limit) {
      throw new ClassmatesError('INVALID_FIELD', `${key} 必须填写，且不超过 ${limit} 字符`);
    }
  }
  if (typeof value.enabled !== 'boolean') throw new ClassmatesError('INVALID_PROFILE', '启用状态无效');
  return {
    id: value.id,
    revision: value.revision as number,
    name: value.name as string,
    description: value.description as string,
    enabled: value.enabled,
    model: profileModel(value.model),
  };
}

export function validateModelProfiles(value: unknown): ModelProfile[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new ClassmatesError('INVALID_PROFILES', '模型用途预设列表无效或超过 100 项');
  const profiles = value.map(validateModelProfile);
  if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) {
    throw new ClassmatesError('DUPLICATE_ID', '模型用途预设标识重复');
  }
  return profiles;
}

export function validateModelProfileChange(value: unknown): ModelProfileChange {
  if (!isRecord(value) || typeof value.op !== 'string') throw new ClassmatesError('INVALID_BATCH', '批量操作格式无效');
  if (value.op === 'upsert') {
    if (Object.keys(value).some(key => key !== 'op' && key !== 'profile')) throw new ClassmatesError('INVALID_BATCH', '批量操作含未知字段');
    return { op: 'upsert', profile: validateModelProfile(value.profile) };
  }
  if (value.op === 'remove') {
    if (Object.keys(value).some(key => key !== 'op' && key !== 'id' && key !== 'revision')) {
      throw new ClassmatesError('INVALID_BATCH', '批量操作含未知字段');
    }
    if (typeof value.id !== 'string' || !value.id) throw new ClassmatesError('INVALID_ID', '预设标识须为小写英文、数字和连字符');
    if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0) {
      throw new ClassmatesError('INVALID_REVISION', '预设版本无效');
    }
    return { op: 'remove', id: value.id, revision: value.revision };
  }
  throw new ClassmatesError('INVALID_BATCH', '不支持的批量操作');
}

export function validateModelProfileChanges(value: unknown): ModelProfileChange[] {
  if (!Array.isArray(value) || value.length > 100) throw new ClassmatesError('INVALID_BATCH', '批量操作无效或超过 100 项');
  const changes = value.map(validateModelProfileChange);
  const targeted = new Set<string>();
  for (const change of changes) {
    const id = change.op === 'upsert' ? change.profile.id : change.id;
    if (targeted.has(id)) throw new ClassmatesError('DUPLICATE_ID', '同一批次不能重复针对同一预设');
    targeted.add(id);
  }
  return changes;
}

/** Enabled presets must resolve in the native catalog. Omitted effort is the model's default. */
export async function validateEnabledProfileModel(ctx: Context, profile: ModelProfile): Promise<void> {
  if (!profile.enabled) return;
  if (!ctx.llm.listProviders().some(provider => provider.id === profile.model.provider)) {
    throw new ClassmatesError('MODEL_UNAVAILABLE', '模型供应商未配置');
  }
  const model = await ctx.llm.resolveModelInfo(profile.model.provider, profile.model.id);
  const selectedEffort = profile.model.reasoningEffort;
  if (selectedEffort !== undefined && !model.reasoning?.efforts.some(effort => effort.id === selectedEffort)) {
    throw new ClassmatesError('INVALID_EFFORT', '所选模型不支持该思考强度');
  }
}

export function applyModelProfileChanges(current: ModelProfile[], changes: ModelProfileChange[]): ModelProfile[] {
  let profiles = current;
  for (const change of changes) {
    if (change.op === 'upsert') {
      const existing = profiles.find(item => item.id === change.profile.id);
      if (change.profile.revision !== (existing?.revision ?? 0)) {
        throw new ClassmatesError('PROFILE_CONFLICT', '模型用途预设版本已改变，请重新读取');
      }
      const next = { ...change.profile, revision: (existing?.revision ?? 0) + 1 };
      profiles = existing ? profiles.map(item => item.id === next.id ? next : item) : [...profiles, next];
    } else {
      const existing = profiles.find(item => item.id === change.id);
      if (!existing || existing.revision !== change.revision) {
        throw new ClassmatesError('PROFILE_CONFLICT', '模型用途预设已改变，请刷新后重试');
      }
      profiles = profiles.filter(item => item.id !== change.id);
    }
  }
  return validateModelProfiles(profiles);
}

/** Exact stored binding. Missing effort stays omitted so callers use the model default. */
export function profileModelBinding(profile: ModelProfile): ModelBinding {
  const { provider, id, reasoningEffort } = profile.model;
  return reasoningEffort === undefined ? { provider, id } : { provider, id, reasoningEffort };
}

export function lookupModelProfile(profiles: readonly ModelProfile[], id: string): ModelProfile | undefined {
  return profiles.find(profile => profile.id === id);
}
