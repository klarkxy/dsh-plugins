// Development-only deterministic adapter. No network or credentials.
import { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
export const name = 'classmates-enhancement-mock';
export const inject = ['llm'];
export const requests = [];
const queuedTools = [];
export function queueToolCall(name, args, trigger) { queuedTools.push({ name, args, trigger }); }
let reviewVisible = true;
export function setReviewVisible(value) { reviewVisible = value; }
const models = [
  { id: 'lead-model', name: '主控模型' },
  { id: 'design-model', name: '界面模型' },
  { id: 'review-model', name: '审查模型' },
];
export function response(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}
class Adapter extends LlmAdapter {
  async listModels(provider) { return models.filter(model => reviewVisible || model.id !== 'review-model').map(model => ({ ...model, provider })); }
  async resolveModel(provider, id) {
    const model = models.find(item => item.id === id);
    if (!model) throw new Error('Unknown local fixture model');
    return { ...model, provider, reasoning: { efforts: [{ id: ReasoningEffortId('low'), name: '低' }, { id: ReasoningEffortId('high'), name: '高' }] } };
  }
  async *stream(options) {
    if (options.signal?.aborted) throw options.signal.reason;
    requests.push({ model: options.model, provider: options.provider, tools: options.tools?.map(tool => tool.name) ?? [] });
    const queuedIndex = queuedTools.findIndex(plan => !plan.trigger || JSON.stringify(options.messages).includes(plan.trigger));
    if (options.model === 'lead-model' && queuedIndex !== -1) {
      const [next] = queuedTools.splice(queuedIndex, 1);
      const block = { type: 'tool-call', id: crypto.randomUUID(), name: next.name, arguments: JSON.stringify(next.args) };
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments };
      yield { type: 'block-end', index: 0, block };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    yield* response('本地验收回复：运行时与界面已连通。此回复来自固定测试模型，不代表真实模型推理结果。');
  }
}
export function apply(ctx) { ctx.llm.registerAdapter(['fixture'], new Adapter()); }
