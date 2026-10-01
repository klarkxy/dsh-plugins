import { AsyncLocalStorage } from 'node:async_hooks';
import { isAbsolute } from 'node:path';
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts';
import { parseConfig } from './config.js';
import { assess, hardRisk } from './policy.js';
import { assessApproval } from './approval-review.js';
import { createGate } from './gate.js';
import { assessEscalation, bindingOf, escalationReason, isNativeEscalation } from './escalation.js';
import { resolveReviewRoutes, sameRoutes } from './model-route.js';
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
  let control;
  let controlEpoch = 0;
  ctx.provide?.('safeAutoRuntime', { base: config, attach(next) {
    if (control) throw new Error('Safe Auto controls already attached');
    control = next; controlEpoch++;
    return () => { if (control === next) { control = undefined; controlEpoch++; } };
  } });
  const inactiveConfig = parseConfig({ ...config, mode: 'off' });
  // UI activation owns review, independently of the native preset identity.
  // Never register official Auto: its fixed FullAccess bundle is not our policy.
  const configFor = exec => control?.config(exec.agent?.session) ?? (controlEpoch ? inactiveConfig : config);
  const controlBinding = exec => JSON.stringify({ epoch: controlEpoch, state: control?.state(exec.agent?.session) });
  if (config.mode === 'off') return;
  if (typeof ctx.tools?.guard !== 'function' || typeof ctx.sandboxPolicy?.resolve !== 'function') throw new Error('DSH Safe Auto requires tools.guard and sandboxPolicy.resolve');
  const decisions = new Map();
  const execution = new AsyncLocalStorage();
  const lifetime = new AbortController();
  let llm;
  // Optional dependency: losing a model service must NOT unload the safety guards.
  // HTTP-only profiles and deterministic checks remain usable without a native adapter.
  if (!config.endpoint && typeof ctx.inject === 'function') ctx.inject(['llm'], scope => {
    const active = scope.llm;
    llm = active;
    scope.effect(() => () => { if (llm === active) llm = undefined; });
  });
  const gate = createGate(config, { getLlm: () => llm, audit: row => ctx.logger.info('safe-auto %s', JSON.stringify(row)) });
  ctx.effect(() => () => { lifetime.abort(); gate.dispose(); decisions.clear(); execution.disable(); });

  function callOf(exec, includeAuthority = false) {
    const session = exec.agent?.session;
    const sandbox = ctx.sandboxPolicy.resolve({ session });
    const info = includeAuthority ? authority(session) : {};
    const call = { tool: exec.name, args: exec.arguments, callId: String(exec.callId), session, agent: exec.agent,
      cwd: session?.header?.cwd, sandbox, signal: exec.signal,
      subagent: isSubagentSession(session),
      nested: exec.parent !== undefined, ...info };
    if (isNativeEscalation(call) || (configFor(exec).approvalReview && ['write', 'edit', 'pwsh', 'bash'].includes(call.tool) &&
        ['workspace-write', 'danger-full-access'].includes(call.args?.sandbox_permissions))) {
      // These are optional capability reads, not model assertions about its environment.
      const fs = ctx.get?.('fs');
      const shell = ctx.get?.('shell');
      const paths = [call.cwd, ...(['bash', 'pwsh'].includes(call.tool)
        ? (call.args.workdir === undefined ? [] : [call.args.workdir]) : [call.args.file_path])];
      call.localExecution = paths.every(p => typeof p === 'string' && isAbsolute(p) && fs?.processPathFromHostPath?.(p) === p);
      call.jobsAvailable = typeof ctx.get !== 'function' || ctx.get('jobs') !== undefined;
      call.shellConfined = ['read-only', 'workspace-write', 'danger-full-access'].includes(shell?.sandboxMode);
    }
    return call;
  }

  function currentEscalation(exec, saved) {
    const config = configFor(exec);
    const call = callOf(exec, true);
    const assessment = assessEscalation(call, config);
    return { call, assessment, unchanged: bindingOf(call, assessment) === saved.binding };
  }

  function sameReviewer(exec, decision) {
    const config = configFor(exec);
    if (!decision.reviewRoutes) return true;
    return sameRoutes(decision.reviewRoutes, resolveReviewRoutes(config, callOf(exec))) &&
      (decision.reviewRoutes.fast.transport !== 'dsh' || decision.reviewLlm === llm);
  }

  ctx.tools.guard(exec => {
    const config = configFor(exec);
    const pending = decisions.get(exec.token);
    if (pending?.controlBinding !== undefined && pending.controlBinding !== controlBinding(exec)) return 'safe-auto: SETTINGS_CHANGED';
    if (config.mode === 'shadow' || config.mode === 'off') return undefined;
    if (exec.signal.aborted || lifetime.signal.aborted) return 'safe-auto: CANCELLED';
    try {
      if (config.approvalReview) {
        const hard = hardRisk(callOf(exec));
        return hard ? `safe-auto: ${hard.code}` : undefined;
      }
      const hard = assess(callOf(exec), config);
      if (hard.kind === 'deny') return `safe-auto: ${hard.code}`;
      const saved = decisions.get(exec.token);
      if (!saved) return 'safe-auto: PREFLIGHT_NOT_RUN';
      if (!sameReviewer(exec, saved)) return 'safe-auto: REVIEW_MODEL_CHANGED';
      if (saved.preflightBinding) {
        const current = callOf(exec, true);
        if (bindingOf(current, assess(current, config)) !== saved.preflightBinding) return 'safe-auto: PREFLIGHT_CHANGED';
      }
      if (saved.kind === 'escalation') {
        const current = currentEscalation(exec, saved);
        if (current.assessment.kind === 'deny') return `safe-auto: ${current.assessment.code}`;
        if (!current.unchanged) return 'safe-auto: ESCALATION_CHANGED';
        return undefined;
      }
      if (saved.kind === 'allow' && hard.kind === 'ask') return 'safe-auto: POLICY_CHANGED';
      if (saved.kind === 'deny' || saved.kind === 'cancel') return `safe-auto: ${saved.code}`;
    } catch { return 'safe-auto: POLICY_UNAVAILABLE'; }
    return undefined;
  });

  ctx.on('tools/pre-execute', async (exec, next) => {
    const config = configFor(exec);
    const selectedControl = controlBinding(exec);
    if (config.mode === 'off') return next();
    if (config.approvalReview) {
      if (exec.signal.aborted || lifetime.signal.aborted) return { kind: 'cancel' };
      const hard = hardRisk(callOf(exec));
      if (hard && config.mode !== 'shadow') return { kind: 'deny', reason: `safe-auto: ${hard.code}` };
      // Native policy remains authoritative; this opt-in never manufactures asks.
      return next();
    }
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
          const assessment = assess(call, config);
          if (assessment.kind === 'review') Object.assign(call, authority(call.session));
          // Capture before awaiting: session/policy state can change during review or downstream policy.
          const preflightBinding = assessment.kind === 'review' ? bindingOf(call, assessment) : undefined;
          decision = await gate.decide(call, 'preflight', config);
          if (decision.kind === 'allow' && preflightBinding) decision = { ...decision, preflightBinding };
          const latest = assess(callOf(exec), config);
          if (latest.kind === 'deny' || (decision.kind === 'allow' && latest.kind === 'ask')) decision = latest;
          // An explicit denial or cancellation must never be downgraded into a fresh approval chance.
          if (call.intent !== undefined && decision.kind !== 'deny' && decision.kind !== 'cancel') {
            const current = authority(call.session);
            if (current.task !== call.task || current.intent !== call.intent) decision = { kind: 'ask', code: 'AUTHORITY_CHANGED' };
          }
        }
      }
    } catch { decision = { kind: 'ask', code: 'POLICY_UNAVAILABLE' }; }
    if (exec.signal.aborted || lifetime.signal.aborted) decision = { kind: 'cancel', code: 'CANCELLED' };
    if (config.mode === 'unattended' && decision.kind === 'ask') decision = { ...decision, kind: 'deny' };
    if (config.mode === 'shadow' || config.mode === 'off') return next();
    decision = { ...decision, controlBinding: selectedControl };
    if (decisions.size < 1024) decisions.set(exec.token, decision);
    if (decision.kind === 'deny') return { kind: 'deny', reason: `safe-auto: ${decision.code}` };
    if (decision.kind === 'cancel') return { kind: 'cancel' };
    const downstream = await next();
    if (downstream.kind !== 'allow' || decision.kind === 'allow' || decision.kind === 'escalation') return downstream;
    return { kind: 'ask', reason: `safe-auto: ${decision.code}` };
  }, { prepend: true });

  // Bind the approval to the active execution, never a process-wide visible callId cache.
  ctx.on('tools/execute', async (exec, next) => {
    const config = configFor(exec);
    if (config.mode === 'shadow' || config.mode === 'off') return next();
    let saved = decisions.get(exec.token);
    if (config.approvalReview) {
      if (!['write', 'edit', 'pwsh', 'bash'].includes(exec.name) ||
          !['workspace-write', 'danger-full-access'].includes(exec.arguments?.sandbox_permissions)) return next();
      const call = callOf(exec, true);
      saved = { kind: 'approval', binding: bindingOf(call, assessApproval(call, config)), signal: exec.signal, controlBinding: controlBinding(exec) };
      if (decisions.size >= 1024) return next();
      decisions.set(exec.token, saved);
    } else if (saved?.kind !== 'escalation') return next();
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
    const store = execution.getStore();
    const config = configFor(store?.exec ?? { agent: req.agent });
    if (store?.saved.controlBinding !== undefined && store.saved.controlBinding !== controlBinding(store.exec)) return 'rejected';
    if (config.mode === 'shadow' || config.mode === 'off') return next();
    if (config.approvalReview) {
      // The waterfall is not a human-only channel. Active opt-in owns all asks:
      // missing evidence must reject, never delegate to another automatic answerer.
      if (req.signal?.aborted || lifetime.signal.aborted) return 'cancelled';
      if (!store || store.saved.kind !== 'approval') return 'rejected';
      const { exec, saved } = store;
      const matches = () => req.agent === exec.agent && req.toolName === exec.name && req.callId === exec.callId &&
        req.signal === exec.signal && req.reason === escalationReason(callOf(exec));
      if (!matches()) return 'rejected';
      if (!store.active || store.claimed) return 'rejected';
      store.claimed = true;
      const signal = AbortSignal.any([saved.signal, exec.signal, req.signal, lifetime.signal]);
      const started = performance.now();
      let reviewed;
      const bound = () => {
        if (signal.aborted || !store.active || decisions.get(exec.token) !== saved || saved.controlBinding !== controlBinding(exec) || !matches()) return false;
        try {
          const current = configFor(exec), call = callOf(exec, true);
          return current.approvalReview && current.mode !== 'off' && current.mode !== 'shadow' &&
            bindingOf(call, assessApproval(call, current)) === saved.binding && (!reviewed || sameReviewer(exec, reviewed));
        } catch { return false; }
      };
      const finish = (outcome, source, decision) => {
        if (signal.aborted) outcome = 'cancelled';
        else if (!bound()) outcome = 'rejected';
        try { ctx.logger.info('safe-auto %s', JSON.stringify({ phase: 'approval', tool: exec.name, callId: String(exec.callId),
          decision: outcome, source, code: decision?.code, scope: 'this-call-only', durationMs: Math.round(performance.now() - started) })); }
        catch { return 'rejected'; }
        return outcome;
      };
      if (!bound()) return finish('rejected', 'binding');
      let decision;
      try { decision = await gate.decide({ ...callOf(exec, true), signal }, 'approval', config); }
      catch { decision = { kind: 'ask', code: 'REVIEW_UNAVAILABLE' }; }
      if (decision.kind === 'allow') reviewed = decision;
      if (!bound()) return finish('rejected', 'binding', decision);
      if (performance.now() - started > config.escalationApprovalTtlMs) decision = { kind: 'ask', code: 'APPROVAL_LEASE_EXPIRED' };
      if (decision.kind === 'allow') return finish('allowed-once', 'reviewer', decision);
      if (decision.kind === 'deny') return finish('rejected', 'reviewer', decision);
      if (decision.kind === 'cancel') return finish('cancelled', 'reviewer', decision);
      // Uncertainty, unavailable review, budget exhaustion and expired leases
      // fail closed. No verified human-only DSH contract is available here.
      return finish('rejected', 'policy', decision);
    }
    if (!store) return config.mode === 'unattended' ? (req.signal?.aborted ? 'cancelled' : 'rejected') : next();
    const { exec, saved } = store;
    if (!store.active || store.claimed) return 'rejected';
    if (typeof req.reason !== 'string' || !req.reason.startsWith('escalate sandbox to ')) {
      return config.mode === 'unattended' ? 'rejected' : next();
    }
    if (req.agent !== exec.agent || req.toolName !== exec.name || req.callId !== exec.callId ||
        req.signal !== exec.signal || req.reason !== escalationReason(callOf(exec))) return 'rejected';
    store.claimed = true;
    const signal = AbortSignal.any([saved.signal, exec.signal, req.signal, lifetime.signal]);
    const started = performance.now();
    const requestReason = req.reason;
    let reviewed;
    function stillBound() {
      if (signal.aborted || !store.active || decisions.get(exec.token) !== saved || saved.controlBinding !== controlBinding(exec)) return false;
      if (req.agent !== exec.agent || req.toolName !== exec.name || req.callId !== exec.callId ||
          req.signal !== exec.signal || req.reason !== requestReason) return false;
      try { return currentEscalation(exec, saved).unchanged && (!reviewed || sameReviewer(exec, reviewed)); }
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
    try { decision = await gate.decide({ ...callOf(exec, true), signal }, 'escalation', config); }
    catch { decision = { kind: 'ask', code: 'REVIEW_UNAVAILABLE' }; }
    if (decision.kind === 'allow') reviewed = decision;
    if (!stillBound()) return finish('rejected', 'binding', 'ESCALATION_CHANGED');
    if (performance.now() - started > config.escalationApprovalTtlMs) decision = { kind: 'ask', code: 'ESCALATION_LEASE_EXPIRED' };
    if (decision.kind === 'allow') return finish('allowed-once', 'reviewer', decision.code);
    if (decision.kind === 'cancel') return finish('cancelled', 'reviewer', decision.code);
    if (decision.kind === 'deny' || config.mode === 'unattended') return finish('rejected', 'policy', decision.code);
    try {
      const human = await next();
      return finish(['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(human) ? human : 'unavailable', 'native', decision.code);
    } catch { return finish('unavailable', 'native', 'APPROVAL_UNAVAILABLE'); }
  }, { prepend: true });
}
