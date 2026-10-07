import type { ModelChoice, ModelProfile, NormalizedRole } from '../contracts.js';
import { profileReferenceStatus } from './role-model.js';

export type RoleHealth = 'enabled' | 'disabled' | 'unconfigured' | 'invalid';

export function findModel(models: ModelChoice[], binding: { provider: string; id: string }): ModelChoice | undefined {
  return models.find(model => model.provider === binding.provider && model.id === binding.id);
}

type ProfileRef = readonly Pick<ModelProfile, 'id' | 'enabled'>[];

/**
 * Catalog health of one normalized role. A fixed route must exist in the
 * catalog with a supported effort; a strong preset reference must resolve to
 * an enabled preset when the preset list is known (missing/disabled is a hard
 * dispatch error, so the role reads as invalid rather than quietly healthy).
 */
export function roleHealth(role: NormalizedRole, models: ModelChoice[], profiles?: ProfileRef): RoleHealth {
  const model = role.model;
  if (model.kind === 'fixed') {
    const choice = findModel(models, model);
    if (!choice) return 'invalid';
    if (model.effort !== undefined && !choice.efforts.some(option => option.id === model.effort)) return 'invalid';
  } else if (model.kind === 'profile') {
    if (profiles !== undefined && profileReferenceStatus(model.profileId, profiles) !== 'ok') return 'invalid';
  } else if (role.reasoningEffort !== undefined) {
    // Inherit keeps an optional effort override against any catalog model.
    const efforts = models.flatMap(choice => choice.efforts);
    if (!efforts.some(option => option.id === role.reasoningEffort)) return 'invalid';
  }
  return role.enabled ? 'enabled' : 'disabled';
}

export function enabledValidRoles(roles: NormalizedRole[], models: ModelChoice[], profiles?: ProfileRef): NormalizedRole[] {
  return roles.filter(role => roleHealth(role, models, profiles) === 'enabled');
}

/** Public provider label only — never an endpoint, key, or other secret. */
export function formatProviderLabel(model: ModelChoice): string {
  const named = model.providerName?.trim();
  return named || model.provider;
}

export function formatModelOption(model: ModelChoice): string {
  return `${formatProviderLabel(model)} · ${model.name}`;
}

export function catalogConnectivityUnknown(model: ModelChoice | undefined): boolean {
  return model === undefined || model.availability === 'unverified' || model.availability === undefined;
}

/** Copy for the model summary; the default is the Chinese text used in task drafts. */
export interface ModelSummaryCopy {
  follow: string;
  /** Whole-line label of a strong preset reference (the preset owns model and effort). */
  profile(preset: string): string;
  summary(model: string, effort: string): string;
}

const ZH_MODEL_SUMMARY: ModelSummaryCopy = {
  follow: '跟随当前聊天',
  profile: preset => `模型预设：${preset}`,
  summary: (model, effort) => `模型：${model} · 思考强度：${effort}`,
};

export function formatRoleModelSummary(
  role: NormalizedRole,
  models: ModelChoice[],
  copy: ModelSummaryCopy = ZH_MODEL_SUMMARY,
  profiles?: readonly Pick<ModelProfile, 'id' | 'name'>[],
): string {
  const model = role.model;
  if (model.kind === 'profile') {
    const name = profiles?.find(item => item.id === model.profileId)?.name;
    return copy.profile(name ? `${name}（${model.profileId}）` : model.profileId);
  }
  if (model.kind === 'fixed') {
    const choice = findModel(models, model);
    const modelLabel = `${choice ? formatProviderLabel(choice) : model.provider} · ${choice?.name ?? model.id}`;
    // A fixed route without an explicit effort follows the dispatching chat's.
    const effortLabel = model.effort
      ? choice?.efforts.find(entry => entry.id === model.effort)?.name ?? model.effort
      : copy.follow;
    return copy.summary(modelLabel, effortLabel);
  }
  const effort = role.reasoningEffort;
  const effortLabel = effort
    ? models.flatMap(choice => choice.efforts).find(entry => entry.id === effort)?.name ?? effort
    : copy.follow;
  return copy.summary(copy.follow, effortLabel);
}

export function buildTaskDraft(
  roles: NormalizedRole[],
  models: ModelChoice[],
  profiles?: readonly Pick<ModelProfile, 'id' | 'name'>[],
): string {
  const lines = ['可用角色：'];
  for (const role of roles) {
    const duty = role.description.trim();
    lines.push(`- ${role.name.trim()}：${duty}。${formatRoleModelSummary(role, models, ZH_MODEL_SUMMARY, profiles)}。`);
  }
  lines.push('');
  lines.push('以上模型来自当前模型列表，连接尚未验证。');
  lines.push('描述要派发的任务。不必每件事都派发；主控可以独自完成。');
  return lines.join('\n');
}
