import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts';
import { parseConfig } from './config.js';

export const CHANNEL = '/dsh-safe-auto';
export const REVIEW_FIELDS = ['provider', 'model', 'reasoningEffort', 'reviewerPrompt'];
export const SETTINGS_FIELDS = REVIEW_FIELDS;
const modes = new Set(['read-only', 'workspace-write', 'danger-full-access']);
/** The only events that can change a session's effective permission state. The optimistic-lock revision tracks these; ordinary turn activity (steps, tool calls, messages) must not invalidate the client's view. */
const PERMISSION_EVENTS = new Set(['permission/preset', 'sandbox/mode', 'approval/policy']);
export const isPermissionEvent = event => PERMISSION_EVENTS.has(event?.type);

/** UI writes only reviewer preferences. The enable switch and budgets remain operator-owned profile config. */
export function createControl(base, { table, recentTable, presets, sandboxPolicy, sessions, platform = process.platform, onChange = () => {}, onSettingsChanged = () => {} }) {
  let settings = table.get('reviewer') ?? { revision: 0, values: {} };
  const recent = recentTable?.get('lastSelection');
  // Invalid or legacy data fails closed. Only a remembered Safe Auto selection
  // opts a future fresh session in; native presets remain the host's own default.
  let inheritSafeAuto = recent?.value === 'safe-auto';
  let tail = Promise.resolve();
  const lifetime = new AbortController();
  const selections = new WeakMap();
  const permissionMarks = new WeakMap();
  let generation = 0;
  const effective = () => parseConfig({ ...base, ...settings.values });
  function active(session) {
    if (lifetime.signal.aborted) return false;
    const selected = session && selections.get(session);
    if (!selected || selected.enabled === false) return false;
    const events = session.snapshotEvents();
    const changed = events.slice(selected.fromSeq).some(e => PERMISSION_EVENTS.has(e.type));
    let native;
    try { native = presets.resolve(presets.current(session)); } catch { native = {}; }
    if (changed || sessions.get(session.id) !== session || isSubagentSession(session) ||
        sandboxPolicy.resolve({ session }).mode !== 'workspace-write' || native.sandbox !== 'workspace-write' || native.approval !== 'ask') {
      selections.set(session, { enabled: false, generation: ++generation }); return false;
    }
    return true;
  }
  function state(session) {
    const enabled = active(session);
    const selected = selections.get(session);
    return { active: enabled, revision: `${settings.revision}:${selected?.generation ?? 0}` };
  }
  function config(session) {
    if (!active(session)) return parseConfig({ ...effective(), enabled: false });
    return effective();
  }
  function workspaceOption() {
    return presets.catalog().options.find(o => {
      if (o.value === 'auto' || o.value === 'safe-auto') return false;
      const p = presets.resolve(o.value); return p.sandbox === 'workspace-write' && p.approval === 'ask';
    });
  }
  function policyView() {
    const c = effective();
    return { available: base.enabled && Boolean(workspaceOption()), platform,
      policyLimits: { readonly: true, sandbox: 'workspace-write', approval: 'ask', rootSessionsOnly: true,
        escalationScope: 'this-call-only', timeoutMs: c.timeoutMs, outputTokens: c.outputTokens,
        maxTranscriptBytes: c.maxTranscriptBytes } };
  }
  function settingsView() {
    const c = effective();
    return { revision: settings.revision, values: Object.fromEntries(REVIEW_FIELDS.map(k => [k, c[k] ?? ''])), ...policyView() };
  }
  /** Optimistic-lock watermark: one past the last permission event. Mid-turn conversation activity leaves it untouched, so switching while a turn runs applies at once. */
  function permissionMark(session) {
    const seq = session.seq;
    let cached = permissionMarks.get(session);
    if (!cached || cached.scanned > seq) cached = { scanned: 0, mark: 0 };
    if (cached.scanned < seq) {
      const fresh = session.snapshotEvents(cached.scanned);
      const base = seq - fresh.length;
      for (let i = 0; i < fresh.length; i++) {
        const at = base + i;
        if (at < cached.scanned) continue;
        if (PERMISSION_EVENTS.has(fresh[i]?.type)) cached.mark = at + 1;
      }
      cached.scanned = seq;
      permissionMarks.set(session, cached);
    }
    return cached.mark;
  }
  function sessionView(session) {
    const catalog = presets.catalog();
    const policy = policyView();
    const available = policy.available;
    const enabled = active(session);
    const current = enabled ? 'safe-auto' : presets.current(session);
    return { revision: `${permissionMark(session)}:${selections.get(session)?.generation ?? 0}`, current, safeAuto: enabled, ...policy,
      options: [...catalog.options.filter(o => o.value !== 'safe-auto'), ...(available ? [{ value: 'safe-auto', name: 'Safe Auto', description: 'Workspace Write; a reviewer model answers approval requests' }] : [])] };
  }
  function getSession(id) {
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Invalid session');
    const session = sessions.get(id);
    if (!session) throw new Error('Session is not active; open it and retry');
    if (isSubagentSession(session)) throw new Error('Child sessions cannot select Safe Auto');
    return session;
  }
  function rememberSelection(value) {
    const enabled = value === 'safe-auto';
    inheritSafeAuto = enabled;
    // This is a best-effort memo: the session's committed native permission
    // remains authoritative even when this small profile write fails.
    try { return Promise.resolve(recentTable?.put('lastSelection', { value: enabled ? 'safe-auto' : 'native' })).catch(() => {}); }
    catch { return Promise.resolve(); }
  }
  function observeSession(session) {
    // Each session.open is a composer navigation, including a return to a
    // previously viewed session. List reads and focus refreshes stay read-only.
    return rememberSelection(sessionView(session).safeAuto ? 'safe-auto' : 'native');
  }
  /**
   * Runs before the factory releases a genuinely new session's first prompt.
   * Forks have their own inherited native permissions and are not "new chats".
   */
  function seedSession(agent, source, signal) {
    if (source !== 'startup' || lifetime.signal.aborted) return Promise.resolve(false);
    const session = agent?.session;
    if (!session || sessions.get(session.id) !== session || isSubagentSession(session)
      || typeof session.header?.parentSession === 'string') return Promise.resolve(false);
    // Share the UI queue: reads that opened an older session and a manual
    // permission switch ahead of creation are applied before inheritance.
    // Deliberately no early `inheritSafeAuto` check: a queued explicit Safe
    // Auto selection may be the operation that enables this inheritance.
    return api.call('session.inherit', { sessionId: session.id }, signal);
  }
  /** Pin the workspace+ask preset on `session` and mark it Safe Auto from the next snapshot position; shared by session.select and api.select. */
  function enableSafeAuto(session) {
    if (!base.enabled) throw new Error('Safe Auto is disabled in the profile');
    const option = workspaceOption();
    if (!option) throw new Error('Workspace Write with native approval is unavailable');
    presets.set(session, option.value);
    selections.set(session, { fromSeq: session.snapshotEvents().length, generation: ++generation });
  }
  async function dispatch(endpoint, payload, signal) {
    signal?.throwIfAborted();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid request');
    if (endpoint === 'settings.get') return settingsView();
    if (endpoint === 'settings.save') {
      if (payload.expectedRevision !== settings.revision) throw new Error('Settings changed; reload and retry');
      const values = payload.values;
      if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(k => !SETTINGS_FIELDS.includes(k))) throw new Error('Only reviewer settings may be edited here');
      const nextConfig = parseConfig({ ...base, ...settings.values, ...values });
      const next = { revision: settings.revision + 1, values: Object.fromEntries(REVIEW_FIELDS.map(k => [k, nextConfig[k] ?? ''])) };
      await table.put('reviewer', next);
      settings = next;
      // Notify committed writes even when the caller was cancelled while saving.
      try { onSettingsChanged(next.revision); } catch {}
      signal?.throwIfAborted();
      onChange();
      return settingsView();
    }
    if (endpoint === 'session.list') return { sessions: sessions.list()
      .filter(s => !isSubagentSession(s) && sessions.get(s.id) === s)
      .map(s => ({ sessionId: s.id, header: Object.fromEntries(['id', 'createdAt', 'cwd', 'isSeeded', 'agentPreset']
        .filter(k => s.header?.[k] !== undefined).map(k => [k, s.header[k]])), ...sessionView(s) })) };
    if (!['session.get', 'session.open', 'session.select', 'session.disable', 'session.inherit'].includes(endpoint)) throw new Error('Unknown endpoint');
    const session = getSession(payload.sessionId);
    if (endpoint === 'session.get') return sessionView(session);
    if (endpoint === 'session.open') { await observeSession(session); return sessionView(session); }
    if (endpoint === 'session.inherit') {
      if (!inheritSafeAuto || !policyView().available || selections.has(session)) return false;
      await dispatch('session.select', { sessionId: session.id, expectedRevision: sessionView(session).revision, value: 'safe-auto' }, signal);
      return true;
    }
    if (payload.expectedRevision !== sessionView(session).revision) throw new Error('Session changed; refresh the list and retry');
    if (endpoint === 'session.disable') {
      selections.set(session, { enabled: false, generation: ++generation });
      await rememberSelection('native');
      onChange();
      return sessionView(session);
    }
    if (payload.value === 'safe-auto') {
      enableSafeAuto(session);
    } else {
      const option = presets.catalog().options.find(o => o.value === payload.value);
      if (!option || !modes.has(presets.resolve(option.value).sandbox)) throw new Error('Unknown permission preset');
      // Disable first: a failed native switch must never leave automatic approval enabled.
      selections.set(session, { enabled: false, generation: ++generation });
      presets.set(session, option.value);
    }
    await rememberSelection(payload.value);
    onChange();
    return sessionView(session);
  }
  const enqueue = (job, signal) => {
    if (lifetime.signal.aborted) return Promise.reject(lifetime.signal.reason);
    const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    const work = tail.then(() => job(combined));
    tail = work.catch(() => {});
    return work;
  };
  const api = { state, config, settingsView, getSession, seedSession, signal: lifetime.signal,
    /** Whether Safe Auto can be enabled on a session right now. */
    available: () => policyView().available,
    /** Sync read of one session's Safe Auto state; false for unknown or invalid ids. */
    sessionActive(sessionId) {
      if (typeof sessionId !== 'string' || !sessionId) return false;
      const session = sessions.get(sessionId);
      return session ? active(session) : false;
    },
    /**
     * Enable Safe Auto on an owned session without memoizing it for future
     * chats: unlike session.select this never touches the lastSelection memo.
     */
    select(sessionId, signal) {
      return enqueue(combined => {
        combined.throwIfAborted();
        const session = getSession(sessionId);
        enableSafeAuto(session);
        onChange();
        return sessionView(session).safeAuto;
      }, signal);
    },
    async dispose() {
      lifetime.abort(new Error('Safe Auto control unloaded'));
      await tail;
    },
    call(endpoint, payload, signal) {
      return enqueue(combined => dispatch(endpoint, payload, combined), signal);
    },
  };
  return api;
}
