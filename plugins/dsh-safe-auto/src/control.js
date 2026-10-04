import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts';
import { parseConfig } from './config.js';

export const CHANNEL = '/dsh-safe-auto';
export const REVIEW_FIELDS = ['provider', 'model', 'reasoningEffort', 'reviewerPrompt'];
export const SETTINGS_FIELDS = REVIEW_FIELDS;
const modes = new Set(['read-only', 'workspace-write', 'danger-full-access']);

/** UI writes only reviewer preferences. The enable switch and budgets remain operator-owned profile config. */
export function createControl(base, { table, presets, sandboxPolicy, sessions, platform = process.platform }) {
  let settings = table.get('reviewer') ?? { revision: 0, values: {} };
  let tail = Promise.resolve();
  const selections = new WeakMap();
  let generation = 0;
  const effective = () => parseConfig({ ...base, ...settings.values });
  function active(session) {
    const selected = session && selections.get(session);
    if (!selected || selected.enabled === false) return false;
    const events = session.snapshotEvents();
    const changed = events.slice(selected.fromSeq).some(e => ['permission/preset', 'sandbox/mode', 'approval/policy'].includes(e.type));
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
        escalationScope: 'this-call-only', timeoutMs: c.timeoutMs, maxInputBytes: c.maxInputBytes,
        outputTokens: c.outputTokens, maxReviewsPerTask: c.maxReviewsPerTask, consecutiveDenials: c.consecutiveDenials } };
  }
  function settingsView() {
    const c = effective();
    return { revision: settings.revision, values: Object.fromEntries(REVIEW_FIELDS.map(k => [k, c[k] ?? ''])), ...policyView() };
  }
  function sessionView(session) {
    const catalog = presets.catalog();
    const policy = policyView();
    const available = policy.available;
    const enabled = active(session);
    const current = enabled ? 'safe-auto' : presets.current(session);
    return { revision: `${session.seq}:${selections.get(session)?.generation ?? 0}`, current, safeAuto: enabled, ...policy,
      options: [...catalog.options.filter(o => o.value !== 'safe-auto'), ...(available ? [{ value: 'safe-auto', name: 'Safe Auto', description: 'Workspace Write with bounded per-call review' }] : [])] };
  }
  function getSession(id) {
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Invalid session');
    const session = sessions.get(id);
    if (!session) throw new Error('Session is not active; open it and retry');
    if (isSubagentSession(session)) throw new Error('Child sessions cannot select Safe Auto');
    return session;
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
      return settingsView();
    }
    if (endpoint === 'session.list') return { sessions: sessions.list()
      .filter(s => !isSubagentSession(s) && sessions.get(s.id) === s)
      .map(s => ({ sessionId: s.id, header: Object.fromEntries(['id', 'createdAt', 'cwd', 'isSeeded', 'agentPreset']
        .filter(k => s.header?.[k] !== undefined).map(k => [k, s.header[k]])), ...sessionView(s) })) };
    if (!['session.get', 'session.select', 'session.disable'].includes(endpoint)) throw new Error('Unknown endpoint');
    const session = getSession(payload.sessionId);
    if (endpoint === 'session.get') return sessionView(session);
    if (payload.expectedRevision !== sessionView(session).revision) throw new Error('Session changed; refresh the list and retry');
    if (endpoint === 'session.disable') {
      selections.set(session, { enabled: false, generation: ++generation });
      return sessionView(session);
    }
    if (payload.value === 'safe-auto') {
      if (!base.enabled) throw new Error('Safe Auto is disabled in the profile');
      const option = workspaceOption();
      if (!option) throw new Error('Workspace Write with native approval is unavailable');
      presets.set(session, option.value);
      selections.set(session, { fromSeq: session.snapshotEvents().length, generation: ++generation });
    } else {
      const option = presets.catalog().options.find(o => o.value === payload.value);
      if (!option || !modes.has(presets.resolve(option.value).sandbox)) throw new Error('Unknown permission preset');
      // Disable first: a failed native switch must never leave automatic approval enabled.
      selections.set(session, { enabled: false, generation: ++generation });
      presets.set(session, option.value);
    }
    return sessionView(session);
  }
  return { state, config, settingsView,
    call(endpoint, payload, signal) {
      const work = tail.then(() => dispatch(endpoint, payload, signal));
      tail = work.catch(() => {});
      return work;
    },
  };
}
