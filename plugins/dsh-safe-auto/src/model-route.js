/** Model selection is independent of the main agent's tools, transcript and sampling config. */
// Reasoning models stream their thinking before the verdict; only the text
// blocks carry the answer.
const MAX_STREAM_BYTES = 512 * 1024;
const MAX_TEXT_BYTES = 16 * 1024;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
  value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);

export function validateModelConfig(config) {
  const { provider = '', model = '', reasoningEffort = '' } = config;
  for (const value of [provider, model, reasoningEffort]) {
    if (value !== '' && !id(value)) throw new Error('invalid reviewer provider/model identifier');
  }
  if (Boolean(provider) !== Boolean(model)) throw new Error('provider and model must be configured together');
  if (reasoningEffort && !model) throw new Error('reasoningEffort requires a reviewer model');
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

/**
 * The global auxiliary default, when one is configured.
 *
 * It is a complete route or nothing. A default that is present but malformed
 * is a broken setting, not an absent one: it throws instead of quietly
 * sending the review to another model. Only `null`/`undefined` means "no
 * default", and only that case falls back to the accepted conversation route.
 */
export function auxiliaryRoute(auxiliary) {
  if (auxiliary === undefined || auxiliary === null) return undefined;
  if (typeof auxiliary !== 'object' || Array.isArray(auxiliary)) throw new Error('INVALID_AUXILIARY_MODEL');
  const provider = auxiliary.provider;
  const model = auxiliary.model;
  const effort = auxiliary.reasoningEffort ?? '';
  if (!id(provider) || !id(model)) throw new Error('INVALID_AUXILIARY_MODEL');
  if (effort !== '' && !id(effort)) throw new Error('INVALID_AUXILIARY_MODEL');
  return Object.freeze(effort ? { provider, model, reasoningEffort: effort } : { provider, model });
}

/**
 * Route for one review, resolved once and frozen:
 * an explicit reviewer model wins, then the global auxiliary default, then the
 * accepted conversation route. There is no other fallback — a session without
 * an accepted route cannot be reviewed, and no deployment default is used.
 */
export function resolveReviewRoute(config, owner, auxiliary) {
  validateModelConfig(config);
  if (config.provider) {
    return Object.freeze({ provider: config.provider, model: config.model,
      ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}) });
  }
  const aux = auxiliaryRoute(auxiliary);
  if (aux) {
    // The reviewer's own effort wins; otherwise the default's effort carries.
    return Object.freeze({ ...aux,
      ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}) });
  }
  return conversationRoute(owner);
}

function usageTotal(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  if (Number.isSafeInteger(usage.totalTokens) && usage.totalTokens >= 0) return usage.totalTokens;
  const fields = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0];
  if (!fields.every(value => Number.isSafeInteger(value) && value >= 0)) return undefined;
  const total = fields.reduce((a, b) => a + b, 0);
  return Number.isSafeInteger(total) ? total : undefined;
}

/**
 * The full native usage breakdown. Cache counters stay separate from the
 * prompt and completion counters, so a review record shows what the model
 * actually cached instead of one opaque total. Reasoning tokens are reported
 * as their own field and never counted into the total: the provider already
 * includes them in the completion count.
 */
function usageBreakdown(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const out = {};
  for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    const value = usage[field];
    if (Number.isSafeInteger(value) && value >= 0) out[field] = value;
  }
  const total = usageTotal(usage);
  if (total !== undefined) out.totalTokens = total;
  return Object.keys(out).length === 0 ? undefined : Object.freeze(out);
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
    if (chunk.type === 'usage') { usage = chunk.usage; continue; }
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
      if (size > MAX_STREAM_BYTES) throw new Error('REVIEW_RESPONSE_TOO_LARGE');
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
    if (size > MAX_STREAM_BYTES) throw new Error('REVIEW_RESPONSE_TOO_LARGE');
  }
  signal.throwIfAborted();
  if (finish !== 'stop' || [...blocks.values()].some(block => !block.ended)) throw new Error('MISSING_COMPLETION');
  const text = [...blocks.entries()].sort(([a], [b]) => a - b)
    .filter(([, block]) => block.type === 'text').map(([, block]) => block.text).join('');
  if (!text || Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new Error('INVALID_COMPLETION');
  const breakdown = usageBreakdown(usage);
  return { text, totalTokens: breakdown?.totalTokens, usage: breakdown };
}
