/** Model selection is independent of the main agent's tools, transcript and sampling config. */
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
  value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);

export function validateModelConfig(config) {
  const { endpoint, fastProvider = '', fastModel, deepProvider = '', deepModel } = config;
  for (const value of [fastProvider, fastModel, deepProvider, deepModel]) {
    if (value !== '' && !id(value)) throw new Error('invalid reviewer provider/model identifier');
  }
  for (const key of ['fastReasoningEffort', 'deepReasoningEffort']) {
    const value = config[key] === undefined ? '' : config[key];
    if (value !== '' && !id(value)) throw new Error(`invalid ${key} identifier`);
  }
  if (config.deepReasoningEffort && !deepModel) throw new Error('deepReasoningEffort requires a deep reviewer model');
  if (endpoint) {
    if (config.fastReasoningEffort || config.deepReasoningEffort) throw new Error('HTTP reviewer does not support reasoning effort; use a native DSH route');
    if (fastProvider || deepProvider) throw new Error('HTTP endpoint cannot be combined with native reviewer providers');
    if (!fastModel) throw new Error('endpoint requires fastModel');
  } else {
    if (Boolean(fastProvider) !== Boolean(fastModel)) throw new Error('fastProvider and fastModel must be configured together');
    if (Boolean(deepProvider) !== Boolean(deepModel)) throw new Error('deepProvider and deepModel must be configured together');
  }
}

/** Use the accepted request's route, not a deployment default or another session's model. */
export function conversationRoute(owner = {}) {
  const agent = owner.agent;
  const session = owner.session ?? agent?.session;
  const header = session?.requestHeader?.();
  // A present but malformed header must not silently fall back to potentially unrelated options.
  const selected = header == null ? agent?.options : header.config;
  if (!id(selected?.provider) || !id(selected?.model)) throw new Error('CONVERSATION_MODEL_UNAVAILABLE');
  return Object.freeze({ provider: selected.provider, model: selected.model });
}

/** Snapshot both stages once. No implicit fallback between providers or transports. */
export function resolveReviewRoutes(config, owner) {
  validateModelConfig(config);
  if (config.endpoint) return Object.freeze({
    fast: Object.freeze({ transport: 'http', endpoint: config.endpoint, model: config.fastModel }),
    deep: config.deepModel ? Object.freeze({ transport: 'http', endpoint: config.endpoint, model: config.deepModel }) : null,
  });
  const selected = config.fastProvider ? { provider: config.fastProvider, model: config.fastModel } : conversationRoute(owner);
  return Object.freeze({
    fast: Object.freeze({ transport: 'dsh', ...selected,
      ...(config.fastReasoningEffort ? { reasoningEffort: config.fastReasoningEffort } : {}) }),
    deep: config.deepModel ? Object.freeze({ transport: 'dsh', provider: config.deepProvider, model: config.deepModel,
      ...(config.deepReasoningEffort ? { reasoningEffort: config.deepReasoningEffort } : {}) }) : null,
  });
}

export const sameRoutes = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function usageTotal(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  if (Number.isSafeInteger(usage.totalTokens) && usage.totalTokens >= 0) return usage.totalTokens;
  const fields = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0];
  if (!fields.every(value => Number.isSafeInteger(value) && value >= 0)) return undefined;
  const total = fields.reduce((a, b) => a + b, 0);
  return Number.isSafeInteger(total) ? total : undefined;
}

/** Bounded native DSH one-shot. It never constructs an Agent or runs returned tools. */
export async function nativeCompletion(llm, route, system, input, maxTokens, signal) {
  if (typeof llm?.stream !== 'function') throw new Error('NATIVE_REVIEWER_UNAVAILABLE');
  signal.throwIfAborted();
  if (route.reasoningEffort !== undefined && route.reasoningEffort !== '' && !id(route.reasoningEffort)) throw new Error('INVALID_REASONING_EFFORT');
  const options = {
    provider: route.provider, model: route.model,
    ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}),
    system, messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
    tools: [], maxTokens, signal,
  };
  const blocks = new Map();
  let size = 0;
  let finish;
  let usage;
  let chunks = 0;
  for await (const chunk of llm.stream(options)) {
    signal.throwIfAborted();
    if (++chunks > 16384 || !chunk || typeof chunk !== 'object' || finish !== undefined) throw new Error('INVALID_NATIVE_STREAM');
    if (chunk.type === 'finish') {
      if (chunk.reason?.kind !== 'stop') throw new Error('INVALID_COMPLETION');
      finish = chunk.reason.kind;
      continue;
    }
    if (chunk.type === 'usage') { usage = usageTotal(chunk.usage); continue; }
    if (!Number.isSafeInteger(chunk.index) || chunk.index < 0 || chunk.index > 255) throw new Error('INVALID_NATIVE_BLOCK');
    if (chunk.type === 'block-start') {
      if (!['text', 'reasoning'].includes(chunk.blockType)) throw new Error('UNEXPECTED_REVIEWER_TOOL');
      if (blocks.has(chunk.index)) throw new Error('DUPLICATE_NATIVE_BLOCK');
      blocks.set(chunk.index, { type: chunk.blockType, text: '', ended: false, hasDelta: false });
    } else if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      const type = chunk.type === 'text-delta' ? 'text' : 'reasoning';
      if (typeof chunk.text !== 'string') throw new Error('INVALID_NATIVE_DELTA');
      const block = blocks.get(chunk.index) ?? { type, text: '', ended: false, hasDelta: false };
      if (block.type !== type || block.ended) throw new Error('INVALID_NATIVE_BLOCK');
      size += Buffer.byteLength(chunk.text);
      if (size > 32768) throw new Error('REVIEW_RESPONSE_TOO_LARGE');
      block.text += chunk.text;
      block.hasDelta = true;
      blocks.set(chunk.index, block);
    } else if (chunk.type === 'block-end') {
      if (!['text', 'reasoning'].includes(chunk.block?.type) || typeof chunk.block.text !== 'string') throw new Error('UNEXPECTED_REVIEWER_TOOL');
      const prior = blocks.get(chunk.index);
      if (prior && (prior.ended || prior.type !== chunk.block.type || (prior.hasDelta && prior.text !== chunk.block.text))) throw new Error('INCONSISTENT_NATIVE_BLOCK');
      if (!prior?.hasDelta) size += Buffer.byteLength(chunk.block.text);
      blocks.set(chunk.index, { ...chunk.block, ended: true });
    } else {
      throw new Error('UNEXPECTED_REVIEWER_CHUNK');
    }
    if (size > 32768) throw new Error('REVIEW_RESPONSE_TOO_LARGE');
  }
  signal.throwIfAborted();
  if (finish !== 'stop' || [...blocks.values()].some(block => !block.ended)) throw new Error('MISSING_COMPLETION');
  const text = [...blocks.entries()].sort(([a], [b]) => a - b)
    .filter(([, block]) => block.type === 'text').map(([, block]) => block.text).join('');
  if (!text || Buffer.byteLength(text) > 2048) throw new Error('INVALID_COMPLETION');
  return { text, totalTokens: usage };
}
