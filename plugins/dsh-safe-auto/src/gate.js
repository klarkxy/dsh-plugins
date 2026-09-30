import { assess } from './policy.js';
import { assessEscalation } from './escalation.js';
import { assessApproval } from './approval-review.js';
import { review } from './reviewer.js';
import { resolveReviewRoutes, sameRoutes } from './model-route.js';

/** Per-instance, per-session budgets. Model changes never reset the session budget. */
export function createGate(config, { fetcher = globalThis.fetch, audit = () => {}, getLlm = () => undefined } = {}) {
  const sessions = new WeakMap();
  const abort = new AbortController();
  function state(session, task) {
    let s = sessions.get(session);
    if (!s) {
      s = { task, fastCalls: 0, deepCalls: 0, units: 0, reportedTokens: 0, consecutive: 0, denials: 0 };
      sessions.set(session, s);
    }
    if (s.task !== task) {
      s.task = task; s.fastCalls = 0; s.deepCalls = 0; s.consecutive = 0;
      // Neither the session budget nor the total-denial fuse is reset by a new user message.
    }
    return s;
  }
  return {
    dispose() { abort.abort(); },
    async decide(call, phase = 'preflight', currentConfig = config) {
      // One ledger survives reviewer preference changes; settings edits do not refill budgets.
      const config = currentConfig;
      const start = Date.now();
      let result = phase === 'approval' ? assessApproval(call, config)
        : phase === 'escalation' ? assessEscalation(call, config) : assess(call, config);
      let s;
      if (result.kind === 'review') {
        if (!call.session || call.subagent) result = { kind: 'ask', code: 'NO_DIRECT_USER_AUTHORITY' };
        else {
          s = state(call.session, call.task);
          if (s.consecutive >= config.consecutiveDenials || s.denials >= config.totalDenials) {
            result = { kind: 'ask', code: 'CIRCUIT_OPEN' };
          } else {
            const oldTask = s.task;
            try {
              const signal = AbortSignal.any([call.signal, abort.signal]);
              const routes = resolveReviewRoutes(config, call);
              const llm = routes.fast.transport === 'dsh' ? getLlm() : undefined;
              const verdict = await review(config, result.action, call.intent, s, signal, fetcher, { routes, llm, structured: phase === 'approval' });
              const kind = typeof verdict === 'string' ? verdict : verdict.decision;
              const details = typeof verdict === 'string' ? {} : {
                risk: verdict.risk, authorization: verdict.authorization, bounded: verdict.bounded, reason: verdict.reason,
              };
              if (signal.aborted || s.task !== oldTask) result = { kind: 'deny', code: 'STALE_REVIEW' };
              else if (kind === 'deny') result = { kind: 'deny', code: 'MODEL_NOT_ALLOWED', ...details };
              else if (!sameRoutes(routes, resolveReviewRoutes(config, call)) || (llm && llm !== getLlm())) {
                result = { kind: 'ask', code: 'REVIEW_MODEL_CHANGED' };
              } else result = { kind, code: kind === 'allow' ? 'MODEL_ALLOWED' : 'MODEL_NOT_ALLOWED', ...details,
                ...(kind === 'allow' ? { reviewRoutes: routes, reviewLlm: llm } : {}),
              };
            } catch { result = { kind: 'ask', code: 'REVIEW_UNAVAILABLE' }; }
            if (result.kind === 'allow') s.consecutive = 0;
            else { s.consecutive++; s.denials++; }
          }
        }
      }
      if (call.signal.aborted || abort.signal.aborted) result = { kind: 'cancel', code: 'CANCELLED' };
      if (config.mode === 'unattended' && result.kind === 'ask') result = { ...result, kind: 'deny' };
      // Audit failures cannot accidentally grant permission. Do not include arguments, intent, endpoint or errors.
      try { audit({ phase: 'assessment', gate: phase, tool: call.tool, callId: call.callId, decision: result.kind, code: result.code,
        mode: config.mode, durationMs: Date.now() - start,
        // Rationale is kept in the result, not logs: a model can echo raw commands or secrets.
        ...(result.risk ? { risk: result.risk, authorization: result.authorization, bounded: result.bounded,
          reason: '[reviewer rationale withheld from audit]' } : {}),
        ...(s ? { reservedUnits: s.units, reportedTokens: s.reportedTokens, fastCalls: s.fastCalls, deepCalls: s.deepCalls } : {}),
      }); } catch { result = { kind: 'deny', code: 'AUDIT_UNAVAILABLE' }; }
      return result;
    },
  };
}
