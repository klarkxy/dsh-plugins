import { parseConfig } from './config.js';
import { assess } from './policy.js';
import { createGate } from './gate.js';
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

/** Thin adapter over public DSH seams; never sets sandbox policy or grants approval outcomes. */
export function apply(ctx, raw = {}) {
  const config = parseConfig(raw);
  if (config.mode === 'off') return;
  if (typeof ctx.tools?.guard !== 'function' || typeof ctx.sandboxPolicy?.resolve !== 'function') throw new Error('DSH Safe Auto requires tools.guard and sandboxPolicy.resolve');
  const decisions = new Map();
  const gate = createGate(config, { audit: row => ctx.logger.info('safe-auto %s', JSON.stringify(row)) });
  ctx.effect(() => () => { gate.dispose(); decisions.clear(); });

  function callOf(exec, includeAuthority = false) {
    const session = exec.agent?.session;
    const sandbox = ctx.sandboxPolicy.resolve({ session });
    const info = includeAuthority ? authority(session) : {};
    return { tool: exec.name, args: exec.arguments, callId: String(exec.callId), session,
      cwd: session?.header?.cwd, sandbox, signal: exec.signal,
      subagent: Boolean(session?.header?.parentSession) || session?.header?.origin === 'subagent', ...info };
  }

  ctx.tools.guard(exec => {
    if (config.mode === 'shadow') return undefined;
    if (exec.signal.aborted) return 'safe-auto: CANCELLED';
    try {
      const hard = assess(callOf(exec), config);
      if (hard.kind === 'deny') return `safe-auto: ${hard.code}`;
      const saved = decisions.get(exec.token);
      // A prepended short-circuiting plugin must not bypass our policy entirely.
      if (!saved) return 'safe-auto: PREFLIGHT_NOT_RUN';
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
        if (assess(call, config).kind === 'review') Object.assign(call, authority(call.session));
        decision = await gate.decide(call);
        // Recheck path/sandbox after model latency; static checks still do not eliminate OS-level TOCTOU.
        const latest = assess(callOf(exec), config);
        if (latest.kind === 'deny' || (decision.kind === 'allow' && latest.kind === 'ask')) decision = latest;
        if (call.intent !== undefined) {
          const current = authority(call.session);
          if (current.task !== call.task || current.intent !== call.intent) decision = { kind: 'ask', code: 'AUTHORITY_CHANGED' };
        }
      }
    } catch { decision = { kind: 'ask', code: 'POLICY_UNAVAILABLE' }; }
    if (exec.signal.aborted) decision = { kind: 'cancel', code: 'CANCELLED' };
    if (config.mode === 'unattended' && decision.kind === 'ask') decision = { ...decision, kind: 'deny' };
    if (config.mode === 'shadow') return next();
    if (decisions.size < 1024) decisions.set(exec.token, decision);
    if (decision.kind === 'deny') return { kind: 'deny', reason: `safe-auto: ${decision.code}` };
    if (decision.kind === 'cancel') return { kind: 'cancel' };
    // Compose with the existing policy instead of overriding a downstream deny or human prompt.
    const downstream = await next();
    if (downstream.kind !== 'allow' || decision.kind === 'allow') return downstream;
    return { kind: 'ask', reason: `safe-auto: ${decision.code}` };
  }, { prepend: true });

  ctx.on('tools/result', (exec, result) => {
    decisions.delete(exec.token);
    // A model assessment is not an execution outcome; record the authoritative result separately.
    ctx.logger.info('safe-auto %s', JSON.stringify({ phase: 'result', tool: exec.name,
      callId: String(exec.callId), isError: result?.isError, mode: config.mode }));
  });
  ctx.on('approval/request', (req, next) => {
    // This is intentionally NOT a universal approval answerer. Even LLM-allowed actions do not
    // authorize another plugin's ask or sandbox escalation. Native human approval stays authoritative.
    if (config.mode === 'unattended') return Promise.resolve(req.signal?.aborted ? 'cancelled' : 'rejected');
    return next();
  }, { prepend: true });
}
