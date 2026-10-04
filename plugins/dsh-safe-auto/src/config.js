import { validateModelConfig } from './model-route.js';

const defaults = Object.freeze({
  enabled: true,
  provider: '', model: '', reasoningEffort: '', reviewerPrompt: '',
  timeoutMs: 30000, maxInputBytes: 8192, outputTokens: 256,
  maxReviewsPerTask: 20, consecutiveDenials: 3,
});
const limits = {
  timeoutMs: [100, 120000], maxInputBytes: [512, 32768], outputTokens: [64, 2048],
  maxReviewsPerTask: [1, 100], consecutiveDenials: [1, 20],
};

/** Immutable, load-time policy. Unknown keys fail rather than silently disabling a control. */
export function parseConfig(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config must be an object');
  for (const key of Object.keys(raw)) if (!Object.hasOwn(defaults, key)) throw new Error(`unknown config field: ${key}`);
  const c = { ...defaults, ...raw };
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
// This schema intentionally has no volatile form metadata; edits require a plugin reload.
export const Config = Object.freeze({ '~standard': Object.freeze({
  version: 1, vendor: 'dsh-safe-auto',
  validate(value) {
    try { return { value: parseConfig(value) }; }
    catch (error) { return { issues: [{ message: error instanceof Error ? error.message : 'invalid configuration' }] }; }
  },
}) });
