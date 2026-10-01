import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { ClassmatesError } from './config.js';
import type { ModelBinding, ModelRoute } from './contracts.js';

export function validateModelRoute(value: unknown): ModelRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ClassmatesError('INVALID_MODEL', '模型路由无效');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== 'provider' && key !== 'id')) throw new ClassmatesError('INVALID_MODEL', '模型保护仅接受供应商和模型标识');
  for (const key of ['provider', 'id']) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 250) throw new ClassmatesError('INVALID_MODEL', '模型路由无效');
  }
  return { provider: input.provider as string, id: input.id as string };
}

export function validateProtectedModels(value: unknown): ModelRoute[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1000) throw new ClassmatesError('INVALID_PROTECTION', '模型保护列表无效');
  const result: ModelRoute[] = [];
  for (const entry of value) {
    const route = validateModelRoute(entry);
    if (!isModelProtected(result, route)) result.push(route);
  }
  return result;
}

export function isModelProtected(routes: readonly ModelRoute[] | undefined, model: ModelRoute): boolean {
  return routes?.some(route => route.provider === model.provider && route.id === model.id) ?? false;
}

export interface ModelApprovalRequest {
  model: ModelBinding;
  roleName: string;
  task: string;
  toolName: string;
  callId?: ToolRunContext['callId'];
  signal: AbortSignal;
  action?: 'create' | 'unlock';
}

/** Native one-action approval. No grants are persisted or shared between calls. */
export async function requestModelApproval(ctx: Context, agent: Agent, input: ModelApprovalRequest): Promise<void> {
  input.signal.throwIfAborted();
  const approval = ctx.get('approval');
  if (!approval) throw new ClassmatesError('APPROVAL_UNAVAILABLE', '此模型需要审批，但当前宿主没有可用审批服务');
  const route = `${input.model.provider}/${input.model.id}`;
  const effort = input.model.reasoningEffort ?? 'model default';
  const task = input.task.length > 1200 ? input.task.slice(0, 1200) + '…' : input.task;
  const unlock = input.action === 'unlock';
  const displayReason = unlock ? {
    zh: `关闭模型 ${route} 的使用前确认；之后新建使用此模型的 Classmates 子智能体不再请求审批。`,
    en: `Remove approval-before-use for ${route}; new Classmates children on this route no longer request approval.`,
  } : {
    zh: `创建 1 个子智能体。模板：${input.roleName}；模型：${route}；思考强度：${effort}。任务：${task}`,
    en: `Create 1 child. Template: ${input.roleName}; model: ${route}; reasoning effort: ${effort}. Task: ${task}`,
  };
  let outcome;
  try {
    outcome = await approval.request({ agent, toolName: input.toolName,
      ...(input.callId === undefined ? {} : { callId: input.callId }), signal: input.signal,
      reason: 'classmates:model-approval:' + JSON.stringify({ action: unlock ? 'unlock' : 'create', model: input.model, template: input.roleName, task }),
      displayReason });
  } catch {
    input.signal.throwIfAborted();
    throw new ClassmatesError('APPROVAL_UNAVAILABLE', '模型审批未能完成，未执行此操作');
  }
  input.signal.throwIfAborted();
  if (outcome !== 'allowed-once') throw new ClassmatesError('APPROVAL_REQUIRED', outcome === 'rejected'
    ? '模型审批被拒绝，未执行此操作；请由主代理决定下一步'
    : '模型审批已取消或不可用，未执行此操作');
}
