import { AsyncLocalStorage } from 'node:async_hooks';
import { parseConfig } from './config.js';
import { assess } from './policy.js';
import { createGate } from './gate.js';
import { assessEscalation, bindingOf, escalationReason, isNativeEscalation } from './escalation.js';
export { Config } from './config.js';

export const name = 'dsh-safe-auto';
export const inject = ['tools', 'sandboxPolicy'];

/** Do not turn assistant/tool/subagent text into user authority, even when it resembles an approval. */
export function authority(session) {
  const events = session?.snapshotEvents?.();
  if (!Array.isArray(events)) return {};
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.type !== 'user/message' || e.data?.source?.kind !== 'user') continue;
    const blocks = e.data.content;
    if (!Array.isArray(blocks) || blocks.some(b => b?.type !== 'text' || typeof b.text !== 'string')) return { task: e.seq ?? i };
    return { task: e.seq ?? i, intent: blocks.map(b => b.text).join('\n') };
  }
  return {};
}

/** Public DSH seams only. Standing sandbox policy is NEVER written or temporarily switched. */
export function apply(ctx, raw = {}) {
  const config = parseConfig(raw);
  if (config.mode === 'off') return;
  if (typeof ctx.tools?.guard !== 'function' || typeof ctx.sandboxPolicy?.resolve !== 'function') throw new Error('DSH Safe Auto requires tools.guard and sandboxPolicy.resolve');
  const decisions = new Map();
  const execution = new AsyncLocalStorage();
  const lifetime = new AbortController();
  const gate = createGate(config, { audit: row => ctx.logger.info('safe-auto %s', JSON.stringify(row)) });
  ctx.effect(() => () => { lifetime.abort(); gate.dispose(); decisions.clear(); execution.disable(); });

  function callOf(exec, includeAuthority = false) {
    const session = exec.agent?.session;
    const sandbox = ctx.sandboxPolicy.resolve({ session });
    const info = includeAuthority ? authority(session) : {};
    const call = { tool: exec.name, args: exec.arguments, callId: String(exec.callId), session,
      cwd: session?.header?.cwd, sandbox, signal: exec.signal,
      subagent: Boolean(session?.header?.parentSession) || session?.header?.origin === 'subagent',
      nested: exec.parent !== undefined, ...info };
    if (isNativeEscalation(call)) {
      // These are optional capability reads, not model assertions about its environment.
      const fs = ctx.get?.('fs');
      const shell = ctx.get?.('shell');
      const paths = [call.cwd, ...(call.tool === 'bash' ? [] : [call.args.file_path])];
      call.localExecution = paths.every(p => typeof p === 'string' && fs?.processPathFromHostPath?.(p) === p);
      call.jobsAvailable = typeof ctx.get !== 'function' || ctx.get('jobs') !== undefined;
      call.shellConfined = ['read-only', 'workspace-write', 'danger-full-access'].includes(shell?.sandboxMode);
    }
    return call;
  }

  function currentEscalation(exec, saved) {
    const call = callOf(exec, true);
    const assessment = assessEscalation(call, config);
    return { call, assessment, unchanged: bindingOf(call, assessment) === saved.binding };
  }

  ctx.tools.guard(exec => {
    if (config.mode === 'shadow') return undefined;
    if (exec.signal.aborted || lifetime.signal.aborted) return 'safe-auto: CANCELLED';
    try {
      const hard = assess(callOf(exec), config);
      if (hard.kind === 'deny') return `safe-auto: ${hard.code}`;
      const saved = decisions.get(exec.token);
      // A prepended short-circuiting plugin must not bypass our policy entirely.
      if (!saved) return 'safe-auto: PREFLIGHT_NOT_RUN';
      if (saved.kind === 'escalation') {
        const current = currentEscalation(exec, saved);
        if (current.assessment.kind === 'deny') return `safe-auto: ${current.assessment.code}`;
        if (!current.unchanged) return 'safe-auto: ESCALATION_CHANGED';
        return undefined; // Only admits the native tool to ASK; not permission to execute outside the sandbox.
      }
      if (saved.kind === 'allow' && hard.kind === 'ask') return 'safe-auto: POLICY_CHANGED';
      if (saved.kind === 'deny' || saved.kind === 'cancel') return `safe-auto: ${saved.code}`;
    } catch { return 'safe-auto: POLICY_UNAVAILABLE'; }
    return undefined;
  });

  ctx.on('tools/pre-execute', async (exec, next) => {
    let decision;
    try {
      if (decisions.size >= 1024) decision = { kind: 'deny', code: 'TOO_MANY_PENDING_CALLS' };
      else {
        const call = callOf(exec);
        if (isNativeEscalation(call)) {
          Object.assign(call, authority(call.session));
          const assessed = assessEscalation(call, config);
          decision = assessed.kind === 'deny' ? assessed : {
            kind: 'escalation', code: assessed.code, binding: bindingOf(call, assessed), signal: exec.signal,
          };
        } else {
          if (assess(call, config).kind === 'review') Object.assign(call, authority(call.session));
          decision = await gate.decide(call);
          const latest = assess(callOf(exec), config);
          if (latest.kind === 'deny' || (decision.kind === 'allow' && latest.kind === 'ask')) decision = latest;
          if (call.intent !== undefined) {
            const current = authority(call.session);
            if (current.task !== call.task || current.intent !== call.intent) decision = { kind: 'ask', code: 'AUTHORITY_CHANGED' };
          }
        }
      }
    } catch { decision = { kind: 'ask', code: 'POLICY_UNAVAILABLE' }; }
    if (exec.signal.aborted || lifetime.signal.aborted) decision = { kind: 'cancel', code: 'CANCELLED' };
    if (config.mode === 'unattended' && decision.kind === 'ask') decision = { ...decision, kind: 'deny' };
    if (config.mode === 'shadow') return next();
    if (decisions.size < 1024) decisions.set(exec.token, decision);
    if (decision.kind === 'deny') return { kind: 'deny', reason: `safe-auto: ${decision.code}` };
    if (decision.kind === 'cancel') return { kind: 'cancel' };
    const downstream = await next();
    if (downstream.kind !== 'allow' || decision.kind === 'allow' || decision.kind === 'escalation') return downstream;
    return { kind: 'ask', reason: `safe-auto: ${decision.code}` };
  }, { prepend: true });

  // ApprovalRequest deliberately has no execution token/arguments. Bind it through the active
  // async dispatch, never a global callId cache or the assistant's claimed approval reason.
  ctx.on('tools/execute', async (exec, next) => {
    if (config.mode === 'shadow') return next();
    const saved = decisions.get(exec.token);
    if (saved?.kind !== 'escalation') return next();
    const store = { exec, saved, active: true, claimed: false };
    try { return await execution.run(store, next); }
    finally { store.active = false; }
  }, { prepend: true });

  ctx.on('tools/result', (exec, result) => {
    decisions.delete(exec.token);
    ctx.logger.info('safe-auto %s', JSON.stringify({ phase: 'result', tool: exec.name,
      callId: String(exec.callId), isError: result?.isError, mode: config.mode }));
  });

  ctx.on('approval/request', async (req, next) => {
    if (config.mode === 'shadow') return next();
    const store = execution.getStore();
    if (!store) return config.mode === 'unattended' ? (req.signal?.aborted ? 'cancelled' : 'rejected') : next();
    const { exec, saved } = store;
    if (!store.active || store.claimed) return 'rejected';
    // Other policy questions are not our sandbox request. Never auto-answer them.
    if (typeof req.reason !== 'string' || !req.reason.startsWith('escalate sandbox to ')) {
      return config.mode === 'unattended' ? 'rejected' : next();
    }
    if (req.agent !== exec.agent || req.toolName !== exec.name || req.callId !== exec.callId ||
        req.signal !== exec.signal || req.reason !== escalationReason(callOf(exec))) return 'rejected';
    store.claimed = true; // Reserve the single decision slot BEFORE the first await.
    const signal = AbortSignal.any([saved.signal, exec.signal, req.signal, lifetime.signal]);
    const started = performance.now();
    const requestReason = req.reason;
    function stillBound() {
      if (signal.aborted || !store.active || decisions.get(exec.token) !== saved) return false;
      if (req.agent !== exec.agent || req.toolName !== exec.name || req.callId !== exec.callId ||
          req.signal !== exec.signal || req.reason !== requestReason) return false;
      try { return currentEscalation(exec, saved).unchanged; }
      catch { return false; }
    }
    function finish(outcome, source, code) {
      if (signal.aborted) outcome = 'cancelled';
      else if (!stillBound()) outcome = 'rejected';
      try {
        ctx.logger.info('safe-auto %s', JSON.stringify({ phase: 'escalation', tool: exec.name,
          callId: String(exec.callId), decision: outcome, source, code,
          from: 'workspace-write', to: 'danger-full-access', scope: 'this-call-only',
          binding: saved.binding, durationMs: Math.round(performance.now() - started) }));
      } catch { return 'rejected'; }
      return outcome;
    }
    if (!stillBound()) return finish('rejected', 'binding', 'ESCALATION_CHANGED');
    let decision;
    try { decision = await gate.decide({ ...callOf(exec, true), signal }, 'escalation'); }
    catch { decision = { kind: 'ask', code: 'REVIEW_UNAVAILABLE' }; }
    if (!stillBound()) return finish('rejected', 'binding', 'ESCALATION_CHANGED');
    if (performance.now() - started > config.escalationApprovalTtlMs) decision = { kind: 'ask', code: 'ESCALATION_LEASE_EXPIRED' };
    if (decision.kind === 'allow') return finish('allowed-once', 'reviewer', decision.code);
    if (decision.kind === 'cancel') return finish('cancelled', 'reviewer', decision.code);
    if (decision.kind === 'deny' || config.mode === 'unattended') return finish('rejected', 'policy', decision.code);
    // Only uncertainty falls back to native approval. Explicit model denials are not retried.
    try {
      const human = await next();
      return finish(['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(human) ? human : 'unavailable', 'native', decision.code);
    } catch { return finish('unavailable', 'native', 'APPROVAL_UNAVAILABLE'); }
  }, { prepend: true });
}
