import type { ClassmateDefinition, ModelBinding, ModelChoice } from '../contracts.js';

export type RoleHealth = 'enabled' | 'disabled' | 'unconfigured' | 'invalid';

export function findModel(models: ModelChoice[], binding: ModelBinding): ModelChoice | undefined {
  return models.find(model => model.provider === binding.provider && model.id === binding.id);
}

export function roleHealth(role: ClassmateDefinition, models: ModelChoice[]): RoleHealth {
  const model = role.model ? findModel(models, role.model) : undefined;
  if (role.model && !model) return 'invalid';
  const effort = role.reasoningEffort ?? role.model?.reasoningEffort;
  const efforts = model ? model.efforts : models.flatMap(choice => choice.efforts);
  if (effort && !efforts.some(option => option.id === effort)) {
    return 'invalid';
  }
  return role.enabled ? 'enabled' : 'disabled';
}

export function enabledValidRoles(roles: ClassmateDefinition[], models: ModelChoice[]): ClassmateDefinition[] {
  return roles.filter(role => roleHealth(role, models) === 'enabled');
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
  summary(model: string, effort: string): string;
}

const ZH_MODEL_SUMMARY: ModelSummaryCopy = {
  follow: '跟随当前聊天',
  summary: (model, effort) => `模型：${model} · 思考强度：${effort}`,
};

export function formatRoleModelSummary(
  role: ClassmateDefinition,
  models: ModelChoice[],
  copy: ModelSummaryCopy = ZH_MODEL_SUMMARY,
): string {
  const model = role.model ? findModel(models, role.model) : undefined;
  const modelLabel = role.model
    ? `${model ? formatProviderLabel(model) : role.model.provider} · ${model?.name ?? role.model.id}`
    : copy.follow;
  const selectedEffort = role.reasoningEffort ?? role.model?.reasoningEffort;
  const effortLabel = selectedEffort
    ? (model?.efforts ?? models.flatMap(choice => choice.efforts)).find(entry => entry.id === selectedEffort)?.name ?? selectedEffort
    : copy.follow;
  return copy.summary(modelLabel, effortLabel);
}

export function buildTaskDraft(roles: ClassmateDefinition[], models: ModelChoice[]): string {
  const lines = ['可用角色：'];
  for (const role of roles) {
    const duty = role.description.trim();
    lines.push(`- ${role.name.trim()}：${duty}。${formatRoleModelSummary(role, models)}。`);
  }
  lines.push('');
  lines.push('以上模型来自当前模型列表，连接尚未验证。');
  lines.push('描述要派发的任务。');
  return lines.join('\n');
}
