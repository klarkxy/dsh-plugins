import { randomUUID } from 'node:crypto';

/** Runtime-local single-use requests. Only the authenticated UI route answers
 * them; no automatic approval waterfall or model tool is consulted. The client
 * and other same-process plugins remain trusted, not a physical-human proof.
 */
export function createHumanApprovals({ now = () => performance.now(), wallNow = Date.now } = {}) {
  const pending = new Map();
  let closed = false;
  function current(row) {
    if (row.signal.aborted) return { kind: 'cancel', code: 'HUMAN_APPROVAL_CANCELLED' };
    if (now() >= row.deadline) return { kind: 'deny', code: 'HUMAN_APPROVAL_EXPIRED' };
    try { if (!row.valid()) return { kind: 'deny', code: 'GRANT_INVALIDATED' }; }
    catch { return { kind: 'deny', code: 'GRANT_INVALIDATED' }; }
    return undefined;
  }
  function settle(row, decision) {
    if (pending.get(row.id) !== row) return false;
    pending.delete(row.id);
    clearInterval(row.timer);
    row.signal.removeEventListener('abort', row.onAbort);
    row.resolve(decision);
    return true;
  }
  return {
    request({ session, action, review, signal, timeoutMs, valid }) {
      if (closed || pending.size >= 32) return Promise.resolve({ kind: 'deny', code: 'HUMAN_APPROVAL_UNAVAILABLE' });
      return new Promise(resolve => {
        const id = randomUUID(), deadline = now() + timeoutMs;
        const row = { id, session, signal, valid, resolve, deadline,
          view: { id, action: structuredClone(action), review: structuredClone(review), expiresAt: wallNow() + timeoutMs } };
        row.onAbort = () => settle(row, { kind: 'cancel', code: 'HUMAN_APPROVAL_CANCELLED' });
        pending.set(id, row);
        row.timer = setInterval(() => { const invalid = current(row); if (invalid) settle(row, invalid); }, Math.min(250, timeoutMs));
        signal.addEventListener('abort', row.onAbort, { once: true });
        const invalid = current(row); if (invalid) settle(row, invalid);
      });
    },
    list(session) {
      const requests = [];
      for (const row of pending.values()) {
        const invalid = current(row);
        if (invalid) { settle(row, invalid); continue; }
        if (row.session === session) requests.push({ ...structuredClone(row.view), remainingMs: Math.max(0, row.deadline - now()) });
      }
      return { requests };
    },
    answer(session, id, outcome) {
      if (typeof id !== 'string' || !['allow', 'deny'].includes(outcome)) throw new Error('Invalid approval response');
      const row = pending.get(id);
      if (!row || row.session !== session) throw new Error('Approval expired or is no longer pending');
      const invalid = current(row);
      if (invalid) { settle(row, invalid); throw new Error('Approval expired or invalidated'); }
      // Claim synchronously before any asynchronous verification. A second tab
      // or response never grants this request a second time.
      settle(row, { kind: outcome, code: outcome === 'allow' ? 'HUMAN_ALLOWED' : 'HUMAN_REJECTED', deadline: row.deadline });
      return { accepted: true };
    },
    invalidate() { for (const row of pending.values()) { const invalid = current(row); if (invalid) settle(row, invalid); } },
    cancelAll() { for (const row of pending.values()) settle(row, { kind: 'cancel', code: 'HUMAN_APPROVAL_CANCELLED' }); },
    dispose() { closed = true; this.cancelAll(); },
    beforeDeadline(decision) { return typeof decision.deadline === 'number' && now() < decision.deadline; },
  };
}
