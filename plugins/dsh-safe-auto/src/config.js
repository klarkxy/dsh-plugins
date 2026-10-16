import { validateModelConfig } from './model-route.js';

const defaults = Object.freeze({
  enabled: true,
  provider: '', model: '', reasoningEffort: '', reviewerPrompt: '',
  timeoutMs: 90000, outputTokens: 4096, maxTranscriptBytes: 48000,
});
const limits = {
  timeoutMs: [1000, 300000], outputTokens: [256, 16384], maxTranscriptBytes: [4096, 200000],
};
// Fields from the 0.2 reviewer-only design. Profiles written by older releases
// still carry them; they are accepted and ignored so an upgrade does not
// unload the plugin.
const RETIRED = new Set(['maxInputBytes', 'humanApprovalTimeoutMs', 'maxReviewsPerTask', 'consecutiveDenials', 'staticReadonly']);

/** Immutable, load-time policy. Unknown keys fail rather than silently disabling a control. */
export function parseConfig(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config must be an object');
  const c = { ...defaults };
  for (const [key, value] of Object.entries(raw)) {
    if (RETIRED.has(key)) continue;
    if (!Object.hasOwn(defaults, key)) throw new Error(`unknown config field: ${key}`);
    c[key] = value;
  }
  if (typeof c.enabled !== 'boolean') throw new Error('enabled must be a boolean');
  for (const key of ['provider', 'model', 'reasoningEffort', 'reviewerPrompt']) {
    if (typeof c[key] !== 'string' || c[key].length > 4096) throw new Error(`${key} must be a string`);
  }
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (!Number.isSafeInteger(c[key]) || c[key] < min || c[key] > max) throw new Error(`invalid ${key}`);
  }
  validateModelConfig(c);
  return Object.freeze(c);
}

// Cordis accepts StandardSchemaV1. No runtime schema dependency or provider SDK is needed.
export const Config = Object.freeze({ '~standard': Object.freeze({
  version: 1, vendor: 'dsh-safe-auto',
  validate(value) {
    try { return { value: parseConfig(value) }; }
    catch (error) { return { issues: [{ message: error instanceof Error ? error.message : 'invalid configuration' }] }; }
  },
}) });
