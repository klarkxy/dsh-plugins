import { assessApproval } from './approval-review.js';
import { review } from './reviewer.js';
import { resolveReviewRoute, sameRoute } from './model-route.js';

/** Per-instance, per-session budgets. Model changes never reset the ledger. */
export function createGate(config, { audit = () => {}, getLlm = () => undefined } = {}) {
  const sessions = new WeakMap();
  const abort = new AbortController();
  function state(session, task) {
    let s = sessions.get(session);
    if (!s) {
      s = { task, reviews: 0, consecutive: 0, reportedTokens: 0 };
      sessions.set(session, s);
    }
    // A new direct user message resets the per-task budget and the denial streak.
    if (s.task !== task) {
      s.task = task; s.reviews = 0; s.consecutive = 0;
    }
    return s;
  }
  return {
    dispose() { abort.abort(); },
    async decide(call, currentConfig = config) {
      // One ledger survives reviewer preference changes; settings edits do not refill budgets.
      const config = currentConfig;
      const start = Date.now();
      let result = assessApproval(call, config);
      let s;
      if (result.kind === 'review') {
        if (!call.session || call.subagent) result = { kind: 'ask', code: 'NO_DIRECT_USER_AUTHORITY' };
        else {
          s = state(call.session, call.task);
          if (s.consecutive >= config.consecutiveDenials) {
            result = { kind: 'ask', code: 'CIRCUIT_OPEN' };
          } else {
            const oldTask = s.task;
            try {
              const signal = AbortSignal.any([call.signal, abort.signal]);
              const route = resolveReviewRoute(config, call);
              const llm = getLlm();
              const verdict = await review(config, result.action, call.intent, s, signal, { route, llm });
              const details = { risk: verdict.risk, authorization: verdict.authorization, bounded: verdict.bounded, reason: verdict.reason };
              if (signal.aborted || s.task !== oldTask) result = { kind: 'deny', code: 'STALE_REVIEW' };
              else if (verdict.decision === 'deny') result = { kind: 'deny', code: 'MODEL_NOT_ALLOWED', ...details };
              else if (!sameRoute(route, resolveReviewRoute(config, call)) || llm !== getLlm()) {
                result = { kind: 'ask', code: 'REVIEW_MODEL_CHANGED' };
              } else result = { kind: verdict.decision, code: verdict.decision === 'allow' ? 'MODEL_ALLOWED' : 'MODEL_NOT_ALLOWED', ...details,
                ...(verdict.decision === 'allow' ? { reviewRoute: route, reviewLlm: llm } : {}),
              };
            } catch { result = { kind: 'ask', code: 'REVIEW_UNAVAILABLE' }; }
            if (result.kind === 'allow') s.consecutive = 0;
            else s.consecutive++;
          }
        }
      }
      if (call.signal.aborted || abort.signal.aborted) result = { kind: 'cancel', code: 'CANCELLED' };
      // Audit failures cannot accidentally grant permission. Do not include arguments, intent or errors.
      try { audit({ phase: 'assessment', tool: call.tool, callId: call.callId, decision: result.kind, code: result.code,
        durationMs: Date.now() - start,
        // Rationale is kept in the result, not logs: a model can echo raw commands or secrets.
        ...(result.risk ? { risk: result.risk, authorization: result.authorization, bounded: result.bounded,
          reason: '[reviewer rationale withheld from audit]' } : {}),
        ...(s ? { reviews: s.reviews, reportedTokens: s.reportedTokens } : {}),
      }); } catch { result = { kind: 'deny', code: 'AUDIT_UNAVAILABLE' }; }
      return result;
    },
  };
}
