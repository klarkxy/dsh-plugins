import { isAbsolute } from 'node:path';
import { parseEscalationCandidates } from './escalation.js';

const defaults = Object.freeze({
  mode: 'shadow', workspaceRoots: [], shellCandidates: [], escalationCandidates: [],
  escalationApprovalTtlMs: 30000, escalationMaxTimeoutMs: 30000,
  endpoint: '', fastModel: '', deepModel: '', apiKeyEnv: 'DSH_SAFE_AUTO_API_KEY',
  tokenField: 'max_tokens', timeoutMs: 8000, maxInputBytes: 8192,
  fastOutputTokens: 64, deepOutputTokens: 256,
  fastCallsPerTask: 20, deepCallsPerTask: 3, sessionBudgetUnits: 100000,
  consecutiveDenials: 3, totalDenials: 20,
});
const limits = {
  escalationApprovalTtlMs: [100, 120000], escalationMaxTimeoutMs: [100, 60000],
  timeoutMs: [100, 60000], maxInputBytes: [512, 32768],
  fastOutputTokens: [32, 512], deepOutputTokens: [64, 2048],
  fastCallsPerTask: [1, 100], deepCallsPerTask: [0, 20],
  sessionBudgetUnits: [1024, 10000000], consecutiveDenials: [1, 20], totalDenials: [1, 100],
};

/** Immutable, load-time policy. Unknown keys fail rather than silently disabling a control. */
export function parseConfig(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config must be an object');
  for (const key of Object.keys(raw)) if (!Object.hasOwn(defaults, key)) throw new Error(`unknown config field: ${key}`);
  const c = { ...defaults, ...raw };
  if (!['off', 'shadow', 'smart', 'unattended'].includes(c.mode)) throw new Error('invalid mode');
  for (const key of ['endpoint', 'fastModel', 'deepModel', 'apiKeyEnv', 'tokenField']) {
    if (typeof c[key] !== 'string' || c[key].length > 4096) throw new Error(`${key} must be a string`);
  }
  for (const key of ['workspaceRoots', 'shellCandidates']) {
    if (!Array.isArray(c[key]) || c[key].length > 100 || c[key].some(x => typeof x !== 'string' || !x || x.length > 4096)) {
      throw new Error(`${key} must contain at most 100 nonempty strings`);
    }
    c[key] = Object.freeze([...new Set(c[key])]);
  }
  if (c.workspaceRoots.some(p => !isAbsolute(p))) throw new Error('workspaceRoots must be absolute local paths');
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (!Number.isSafeInteger(c[key]) || c[key] < min || c[key] > max) throw new Error(`invalid ${key}`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.apiKeyEnv)) throw new Error('invalid apiKeyEnv');
  if (!['max_tokens', 'max_completion_tokens'].includes(c.tokenField)) throw new Error('invalid tokenField');
  if (Boolean(c.endpoint) !== Boolean(c.fastModel)) throw new Error('endpoint and fastModel must be configured together');
  if (c.deepModel && !c.fastModel) throw new Error('deepModel requires fastModel');
  if (c.endpoint) {
    const u = new URL(c.endpoint);
    if (u.username || u.password || u.hash || u.search) throw new Error('endpoint must not contain credentials, query or fragment');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new Error('endpoint requires HTTPS or loopback HTTP');
    c.endpoint = u.href;
  }
  c.escalationCandidates = parseEscalationCandidates(c.escalationCandidates, c.workspaceRoots);
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
