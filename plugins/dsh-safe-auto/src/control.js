import { parseConfig } from './config.js';

export const CHANNEL = '/dsh-safe-auto';
export const REVIEW_FIELDS = ['fastProvider', 'fastModel', 'deepProvider', 'deepModel', 'fastReasoningEffort', 'deepReasoningEffort', 'reviewerPrompt'];
const modes = new Set(['read-only', 'workspace-write', 'danger-full-access']);

/** UI writes only reviewer preferences. Permission envelopes remain operator-owned profile config. */
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
    if (changed || sandboxPolicy.resolve({ session }).mode !== 'workspace-write') {
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
    if (!active(session)) return parseConfig({ ...effective(), mode: 'off' });
    return parseConfig({ ...effective(), mode: 'smart' });
  }
  function settingsView() {
    const c = effective();
    return { revision: settings.revision, values: Object.fromEntries(REVIEW_FIELDS.map(k => [k, c[k] ?? ''])), http: Boolean(c.endpoint), platform };
  }
  function sessionView(session) {
    const catalog = presets.catalog();
    const available = base.mode !== 'off' && catalog.options.some(o => {
      const p = presets.resolve(o.value); return p.sandbox === 'workspace-write' && p.approval === 'ask';
    });
    const enabled = active(session);
    const current = enabled ? 'safe-auto' : presets.current(session);
    return { revision: `${session.seq}:${selections.get(session)?.generation ?? 0}`, current, safeAuto: enabled, available, platform,
      options: [...catalog.options.filter(o => o.value !== 'safe-auto'), ...(available ? [{ value: 'safe-auto', name: 'Safe Auto', description: 'Workspace Write with bounded per-call review' }] : [])] };
  }
  function getSession(id) {
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Invalid session');
    const session = sessions.get(id);
    if (!session) throw new Error('Session is not active; open it and retry');
    if (session.header?.parentSession || session.header?.origin === 'subagent') throw new Error('Child sessions cannot select Safe Auto');
    return session;
  }
  async function dispatch(endpoint, payload, signal) {
    signal?.throwIfAborted();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid request');
    if (endpoint === 'settings.get') return settingsView();
    if (endpoint === 'settings.save') {
      if (payload.expectedRevision !== settings.revision) throw new Error('Settings changed; reload and retry');
      if (base.endpoint) throw new Error('HTTP reviewer settings remain in the profile');
      const values = payload.values;
      if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(k => !REVIEW_FIELDS.includes(k))) throw new Error('Only reviewer settings may be edited here');
      const nextConfig = parseConfig({ ...base, ...settings.values, ...values });
      const next = { revision: settings.revision + 1, values: Object.fromEntries(REVIEW_FIELDS.map(k => [k, nextConfig[k] ?? ''])) };
      await table.put('reviewer', next);
      settings = next;
      return settingsView();
    }
    const session = getSession(payload.sessionId);
    if (endpoint === 'session.get') return sessionView(session);
    if (endpoint !== 'session.select') throw new Error('Unknown endpoint');
    if (payload.expectedRevision !== sessionView(session).revision) throw new Error('Session changed; refresh the menu and retry');
    if (payload.value === 'safe-auto') {
      if (base.mode === 'off') throw new Error('Safe Auto is disabled in the profile');
      const option = presets.catalog().options.find(o => {
        const p = presets.resolve(o.value); return p.sandbox === 'workspace-write' && p.approval === 'ask';
      });
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
