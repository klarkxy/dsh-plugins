import { AsyncLocalStorage } from 'node:async_hooks';
import { isAbsolute } from 'node:path';
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts';
import { parseConfig } from './config.js';
import { hardRisk } from './policy.js';
import { assessApproval, bindingOf, escalationReason } from './approval-review.js';
import { createGate } from './gate.js';
import { resolveReviewRoute, sameRoute } from './model-route.js';
export { Config } from './config.js';

export const name = 'dsh-safe-auto';
export const inject = ['tools', 'sandboxPolicy'];

const REVIEW_TOOLS = new Set(['write', 'edit', 'pwsh', 'bash']);
const ESCALATION = new Set(['workspace-write', 'danger-full-access']);
/** Freshness window for one reviewed grant; not process lifetime, revocation or rollback. */
const APPROVAL_TTL_MS = 30000;

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
  const inactiveConfig = parseConfig({ ...config, enabled: false });
  // UI activation owns review, independently of the native preset identity.
  // Never register official Auto: its fixed FullAccess bundle is not our policy.
  const configFor = exec => control?.config(exec.agent?.session) ?? (controlEpoch ? inactiveConfig : config);
  const controlBinding = exec => JSON.stringify({ epoch: controlEpoch, state: control?.state(exec.agent?.session) });
  if (!config.enabled) return;
  if (typeof ctx.tools?.guard !== 'function' || typeof ctx.sandboxPolicy?.resolve !== 'function') throw new Error('DSH Safe Auto requires tools.guard and sandboxPolicy.resolve');
  const decisions = new Map();
  const execution = new AsyncLocalStorage();
  const lifetime = new AbortController();
  let llm;
  // Optional dependency: losing the model service must NOT unload the safety guards.
  if (typeof ctx.inject === 'function') ctx.inject(['llm'], scope => {
    const active = scope.llm;
    llm = active;
    scope.effect(() => () => { if (llm === active) llm = undefined; });
  });
  const gate = createGate(config, { getLlm: () => llm, audit: row => ctx.logger.info('safe-auto %s', JSON.stringify(row)) });
  ctx.effect(() => () => { lifetime.abort(); gate.dispose(); decisions.clear(); execution.disable(); });

  const reviewable = exec => REVIEW_TOOLS.has(exec.name) && ESCALATION.has(exec.arguments?.sandbox_permissions);

  function callOf(exec, includeAuthority = false) {
    const session = exec.agent?.session;
    const sandbox = ctx.sandboxPolicy.resolve({ session });
    const info = includeAuthority ? authority(session) : {};
    const call = { tool: exec.name, args: exec.arguments, callId: String(exec.callId), session, agent: exec.agent,
      cwd: session?.header?.cwd, sandbox, signal: exec.signal,
      subagent: isSubagentSession(session),
      nested: exec.parent !== undefined, ...info };
    if (reviewable(exec)) {
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

  function sameReviewer(exec, decision) {
    if (!decision.reviewRoute) return true;
    try {
      return sameRoute(decision.reviewRoute, resolveReviewRoute(configFor(exec), callOf(exec))) && decision.reviewLlm === llm;
    } catch { return false; }
  }

  ctx.tools.guard(exec => {
    const config = configFor(exec);
    const pending = decisions.get(exec.token);
    if (pending?.controlBinding !== undefined && pending.controlBinding !== controlBinding(exec)) return 'safe-auto: SETTINGS_CHANGED';
    if (!config.enabled) return undefined;
    if (exec.signal.aborted || lifetime.signal.aborted) return 'safe-auto: CANCELLED';
    try {
      const hard = hardRisk(callOf(exec));
      return hard ? `safe-auto: ${hard.code}` : undefined;
    } catch { return 'safe-auto: POLICY_UNAVAILABLE'; }
  });

  ctx.on('tools/pre-execute', async (exec, next) => {
    const config = configFor(exec);
    if (!config.enabled) return next();
    if (exec.signal.aborted || lifetime.signal.aborted) return { kind: 'cancel' };
    const hard = hardRisk(callOf(exec));
    if (hard) return { kind: 'deny', reason: `safe-auto: ${hard.code}` };
    // Native policy remains authoritative; this plugin never manufactures asks.
    return next();
  }, { prepend: true });

  // Bind the approval to the active execution, never a process-wide visible callId cache.
  ctx.on('tools/execute', async (exec, next) => {
    const config = configFor(exec);
    if (!config.enabled || !reviewable(exec)) return next();
    const call = callOf(exec, true);
    const saved = { kind: 'approval', binding: bindingOf(call, assessApproval(call, config)), signal: exec.signal, controlBinding: controlBinding(exec) };
    if (decisions.size >= 1024) return next();
    decisions.set(exec.token, saved);
    const store = { exec, saved, active: true, claimed: false };
    try { return await execution.run(store, next); }
    finally { store.active = false; }
  }, { prepend: true });

  ctx.on('tools/result', (exec, result) => {
    decisions.delete(exec.token);
    ctx.logger.info('safe-auto %s', JSON.stringify({ phase: 'result', tool: exec.name,
      callId: String(exec.callId), isError: result?.isError }));
  });

  ctx.on('approval/request', async (req, next) => {
    const store = execution.getStore();
    const config = configFor(store?.exec ?? { agent: req.agent });
    if (!config.enabled) return next();
    if (store?.saved.controlBinding !== undefined && store.saved.controlBinding !== controlBinding(store.exec)) return 'rejected';
    if (req.signal?.aborted || lifetime.signal.aborted) return 'cancelled';
    // The waterfall is not a human-only channel. An active session owns its asks:
    // missing evidence must reject, never delegate to another automatic answerer.
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
        return current.enabled && bindingOf(call, assessApproval(call, current)) === saved.binding && (!reviewed || sameReviewer(exec, reviewed));
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
    try { decision = await gate.decide({ ...callOf(exec, true), signal }, config); }
    catch { decision = { kind: 'ask', code: 'REVIEW_UNAVAILABLE' }; }
    if (decision.kind === 'allow') reviewed = decision;
    if (!bound()) return finish('rejected', 'binding', decision);
    if (performance.now() - started > APPROVAL_TTL_MS) decision = { kind: 'ask', code: 'APPROVAL_LEASE_EXPIRED' };
    if (decision.kind === 'allow') return finish('allowed-once', 'reviewer', decision);
    if (decision.kind === 'deny') return finish('rejected', 'reviewer', decision);
    if (decision.kind === 'cancel') return finish('cancelled', 'reviewer', decision);
    // Uncertainty, unavailable review, budget exhaustion and expired leases
    // fail closed. No verified human-only DSH contract is available here.
    return finish('rejected', 'policy', decision);
  }, { prepend: true });
}
