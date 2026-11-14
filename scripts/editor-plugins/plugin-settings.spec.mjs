import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as currentTitle } from '../../plugins/dsh-current-title/src/client.tsx'
import { apply as font } from '../../plugins/dsh-font/src/client.tsx'
import { apply as gitCommit } from '../../plugins/dsh-git-commit/src/client.tsx'
import { apply as modelHub } from '../../plugins/dsh-model-hub/src/client.tsx'
import { apply as safeAuto } from '../../plugins/dsh-safe-auto/src/client.jsx'
import { apply as secretManager } from '../../plugins/dsh-secret-manager/src/client.tsx'
import { apply as sessionManager } from '../../plugins/dsh-session-manager/src/client.tsx'
import { apply as webSearch } from '../../plugins/dsh-web-search-manager/src/client.tsx'
import { apply as zhihu } from '../../plugins/dsh-zhihu/src/client.tsx'
import {
  AUXILIARY_MODEL_SEAT_ID, AUXILIARY_MODEL_SEAT_ORDER, registerAuxiliaryModelSettings,
} from '../../plugins/dsh-plugin-kit/src/auxiliary-model-client.tsx'

// Settings are grouped by ownership (plugins/AGENTS.md): preference items merge
// into the native groups, action-owned configuration stays in its own GUI, and
// complex management pages keep their own settings.section. The session-related
// preferences share one UI group — the Session Management section — whose page
// the shared kit service owns: every participant contributes a row to it, no
// participant owns the page, and none of them falls back to the General page.
const GENERAL_ITEM = 'settings.general.item'
const MODELS_FOOTER = 'settings.models.footer'
const SECTION = 'settings.section'
// Every settings section also contributes a nav icon here: the entry id is the
// section id, and the icon renders from owner props {size, active}.
const ICON_SLOT = 'settings.section.icon'
const HEADER_ACTION = 'conversation.session.header.actions'
const PERMISSION = 'conversation.input.permission'
const ITEM_SLOT = 'dsh.session-settings.item'
const SECTION_ID = 'session-manager'
const PAGE_SERVICE = 'dshSessionSettingsPage'
const settingsSeats = [GENERAL_ITEM, MODELS_FOOTER, SECTION]
// The shared "default auxiliary model" card is root-owned infrastructure (the
// shared-column rule in plugins/AGENTS.md): any participant alone mounts one
// 'auxiliary-model' row in the shared Session Management column from the root
// context — and that root share also retains the shared page, so a lone
// auxiliary plugin still creates the column. A business plugin's own settings
// may still never reach a global seat.
const AUX_ROW = { name: ITEM_SLOT, id: AUXILIARY_MODEL_SEAT_ID, order: AUXILIARY_MODEL_SEAT_ORDER }
const isSharedAuxiliaryEntry = entry => entry.spec.name === AUX_ROW.name && entry.spec.id === AUX_ROW.id && entry.owner === 'root'
// Contribution mounts are compared as multisets of descriptor ids: shared
// infrastructure (the auxiliary card's watch lease) mounts and unmounts
// interleave with a plugin's own change stream, so ordering differs legitimately
// — only exact membership and counts prove symmetric teardown.
const contributionIds = list => list
  .map(contribution => (contribution.descriptors ?? []).map(descriptor => descriptor.id).sort().join('|'))
  .sort()
// Business settings stay off the plugins-page seats and the legacy editor seats.
const forbidden = ['plugins.bundle.config', 'plugins.row.config', 'dsh-editor.settings.models', 'dsh-editor.settings.zhihu']
// Opening or rendering a settings contribution may read (status, settings,
// config, catalog, capabilities) but must never write settings, commit, or
// call a model.
const writeEndpoint = /\b(?:update|save|set|write|commit|sync|disconnect|upload|delete|remove|send|edit|patch|create|prepare|allocate|post|put|file)\b/i
const settle = () => new Promise(resolve => setImmediate(resolve))

// The host's own General row: the theme package's native font-size cell. A
// plugin may shadow what this cell renders; the row itself stays the host's.
const NativeFontSizeRow = () => createElement('div', { 'data-testid': 'native-font-size' })

/**
 * The host half of the DSH client.
 *
 * The slot service is backed by the real SlotCore, so the declarations this
 * test drives behave like the product: a child slot is declared once, an
 * owner's disposal collapses the children it declared (their contributions die
 * with it), and a redeclaration replays every injected callback. A hand-rolled
 * map would lose exactly that cascade, so the real core is the point.
 *
 * The root scope mirrors Cordis's service store: one store for every context,
 * `provide` refuses a second registration of the same name, and the disposer
 * drops the store entry before it awaits — so an emptied page can be rebuilt in
 * the same tick. Root-owned effects outlive the plugin that started them, which
 * is what keeps the shared page alive when the plugin that created it unloads.
 *
 * Every plugin gets its own child scope: its registrations and effects are its
 * own, and unloading it releases exactly those.
 */
function createHost(initialSeats = []) {
  const core = new SlotCore()
  const services = new Map()
  const registered = []
  const injected = []
  const calls = []
  const writes = []
  const mounted = []
  const unmounts = []
  const themeWrites = []
  const rootEffects = []
  const scopes = []

  const locale = {
    getSnapshot: () => ({ active: 'en' }),
    subscribe: () => () => {},
    register: () => () => {},
  }
  // The host installs the locale service at the root; the shared page reads the
  // active label from there.
  services.set('locale', { value: locale, active: true })

  // An injection effect is one disposer or an iterable of disposers, exactly
  // like the runtime's declaration effect: a plugin may install several
  // contributions under one seat wait.
  const disposeEffect = (effect) => {
    if (typeof effect === 'function') { effect(); return }
    if (effect && typeof effect[Symbol.iterator] === 'function') {
      for (const dispose of effect) dispose()
    }
  }

  // Every slot operation hands back an idempotent release. When `owned` is
  // given (a plugin scope's own slots), releases are also tracked so scope
  // disposal unloads exactly the contributions that scope installed — the way
  // Cordis drops a child context's slot work when the plugin unloads, without
  // the plugin having to keep each disposer. The root context's slots get no
  // tracking: root-owned work outlives plugin scopes by design.
  const makeSlots = (owner, owned) => ({
    inject(name, run) {
      injected.push(name)
      let attached = false
      let stop
      const off = core.subscribeDeclaration(name, () => {
        const live = Boolean(core.specDynamic(name))
        if (live && !attached) {
          attached = true
          stop = run()
        } else if (!live && attached) {
          attached = false
          const dispose = stop
          stop = undefined
          disposeEffect(dispose)
        }
      })
      if (core.specDynamic(name)) {
        attached = true
        stop = run()
      }
      let released = false
      const release = () => {
        if (released) return
        released = true
        off()
        if (attached) {
          attached = false
          const dispose = stop
          stop = undefined
          disposeEffect(dispose)
        }
      }
      owned?.push(release)
      return release
    },
    register(spec, render) {
      const entry = { spec, render, owner }
      registered.push(entry)
      const dispose = core.register(spec, render)
      let released = false
      const release = () => {
        if (released) return
        released = true
        const index = registered.indexOf(entry)
        if (index >= 0) registered.splice(index, 1)
        dispose()
      }
      owned?.push(release)
      return release
    },
    entries: key => core.entries(key),
    entriesOfSlot: key => core.entriesOfSlot(key),
    spec: key => core.specDynamic(key),
    subscribe: (key, fn) => core.subscribe(key, fn),
  })

  // ctx.remote resolves on every context including the root, the way the host
  // mixes it in: plugin change streams and the shared card's serialized lease
  // both mount their Typert contributions here, and each mount's own effect
  // performs the matching unmount.
  const remote = {
    credentials: {
      describe: async () => ({ ok: true, value: {} }),
      set: async () => { writes.push('credentials.set'); throw new Error('Unexpected credential write') },
      unset: async () => { writes.push('credentials.unset'); throw new Error('Unexpected credential delete') },
    },
    llm: {}, settings: {}, session: {},
    async $mount(contribution) {
      mounted.push(contribution)
      return async () => { unmounts.push(contribution) }
    },
    async $stream() { throw new Error('remote.$stream is not modelled by the harness') },
  }

  // Like scope injects but bound to the root context: the callback runs with
  // the shared remote and its effect disposers live with the host — root-owned
  // work outlives plugin scopes by design. The returned fiber object lets
  // root-owned refcounted services (the shared card's watch lease) tear their
  // mount down deterministically.
  const rootInject = (deps, callback) => {
    injected.push(deps.join(','))
    const cleanups = []
    callback({
      remote,
      effect(run) {
        const dispose = run()
        if (typeof dispose === 'function') cleanups.push(dispose)
        return dispose
      },
    })
    const dispose = async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() }
    rootEffects.push(dispose)
    return { dispose }
  }

  const root = {
    get(name, strict = true) {
      const impl = services.get(name)
      if (!impl) return undefined
      if (strict && !impl.active) return undefined
      return impl.value
    },
    provide(name, value) {
      if (services.has(name)) throw new Error(`service "${name}" has been registered`)
      const impl = { value, active: true }
      services.set(name, impl)
      // Cordis removes the store entry before the disposer awaits.
      return async () => {
        services.delete(name)
        impl.active = false
        await Promise.resolve()
      }
    },
    effect(run) {
      const dispose = run()
      if (typeof dispose === 'function') rootEffects.push(dispose)
      else if (dispose && typeof dispose.then === 'function') rootEffects.push(() => dispose)
      return () => {}
    },
    inject: rootInject,
    remote,
    slots: makeSlots('root'),
    locale,
  }
  // Cordis's root context returns itself from `ctx.root`; the fake must mirror
  // that so root-owned infrastructure (the shared card) can hand the root
  // context to helpers that re-resolve `.root`.
  root.root = root

  function scope(label = 'plugin') {
    const effects = []
    // This scope's own slot waits and registrations; unloaded with the scope.
    const slotDisposers = []
    const ctx = {
      root,
      get: root.get,
      provide: root.provide,
      effect(run) {
        const dispose = run()
        if (typeof dispose === 'function') effects.push(dispose)
        else if (dispose && typeof dispose.then === 'function') effects.push(() => dispose)
        return () => {}
      },
      slots: makeSlots(label, slotDisposers),
      locale,
      inject(deps, callback) {
        injected.push(deps.join(','))
        const cleanups = []
        callback({
          remote: ctx.remote,
          effect(run) {
            const dispose = run()
            if (typeof dispose === 'function') cleanups.push(dispose)
            return dispose
          },
        })
        const dispose = async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() }
        effects.push(dispose)
        return { dispose }
      },
      on() { return () => {} },
      connection: {
        generation: { subscribe: () => () => {} },
        rpc: {
          call: async (channel, endpoint, payload) => {
            calls.push([channel, endpoint])
            if (writeEndpoint.test(String(endpoint))) writes.push(`${channel}:${String(endpoint)}`)
            return { ok: true, value: { enabled: true } }
          },
        },
      },
      remote,
      sessions: { list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready' }), subscribe: () => () => {} } },
      uiWorkspace: {},
      uiSession: { adapter: { current: { getSnapshot: () => ({}), subscribe: () => () => {} } } },
      theme: {
        // The host theme service carries one font size and one font family per
        // role (text, code, terminal); the defaults match the host's own
        // FONT_SIZE_SPECS.
        getTheme: () => ({ fontSizes: { text: 14, code: 11, terminal: 13 }, fontFamilies: { text: '', code: '', terminal: '' } }),
        setFontSize: (role, px) => { themeWrites.push(`fontSize:${role}:${px}`) },
        setFontFamily: (role, value) => { themeWrites.push(`fontFamily:${role}:${value}`) },
      },
    }
    const handle = {
      ctx,
      label,
      async dispose() {
        for (const dispose of effects.splice(0).reverse()) await dispose()
        // Then drop whatever this scope put on the slot ledger, whether or not
        // the plugin kept the disposer — an unloaded plugin keeps no entries.
        for (const release of slotDisposers.splice(0).reverse()) release()
      },
    }
    scopes.push(handle)
    return handle
  }

  // The host declares the native seats it owns. Every seat gets its own owner
  // entry inside a holder list, so collapsing one seat leaves the others
  // untouched: the product declares settings.section (the settings shell) and
  // settings.general.item (the General section) from different owners, and a
  // plugin must see the two lifetimes independently — declaring both at once
  // would hide a plugin that assumed the second seat was already there.
  const SEAT_HOLDER = 'host.seats'
  const seatEntries = new Map()
  // The host's own rows: the theme package contributes the native font-size
  // cell into the General item list, exactly as the product does.
  const nativeRows = new Map([
    [GENERAL_ITEM, [{ id: 'font-size', order: 11, component: NativeFontSizeRow }]],
  ])
  const installedRows = new Map()

  const installNativeRows = (name) => {
    for (const dispose of installedRows.get(name) ?? []) dispose()
    const rows = []
    for (const row of nativeRows.get(name) ?? []) {
      rows.push(core.register({ name, id: row.id, order: row.order }, row.component))
    }
    installedRows.set(name, rows)
  }

  // Seat shapes as the product declares them. Most plugin-facing seats are
  // root-scope lists; the composer permission control is a session-scope
  // single cell — entries replace the occupant at their priority instead of
  // adding a row, so they carry no id.
  const seatSpecs = new Map([
    [PERMISSION, { kind: 'single', scope: 'session' }],
  ])

  const declareSeat = (name, options = {}) => {
    seatEntries.get(name)?.()
    seatEntries.delete(name)
    seatEntries.set(name, core.register({
      name: SEAT_HOLDER,
      id: `host:${name}`,
      children: { [name]: seatSpecs.get(name) ?? { kind: 'list', scope: 'root' } },
    }, () => null))
    if (options.rows !== false) installNativeRows(name)
  }

  // The holder list hangs off the root slot, the way the settings shell owns
  // the settings page in the product.
  core.register({ name: 'root', id: 'host', children: { [SEAT_HOLDER]: { kind: 'list', scope: 'root' } } }, () => null)

  const host = {
    core, root, services, registered, injected, calls, writes, mounted, unmounts, themeWrites,
    scope,
    declare(name, options) { declareSeat(name, options) },
    undeclare(name) { seatEntries.get(name)?.(); seatEntries.delete(name) },
    installNativeRows,
    async dispose() {
      for (const handle of scopes.splice(0).reverse()) await handle.dispose()
      for (const dispose of rootEffects.splice(0).reverse()) await dispose()
    },
  }
  host.ctx = scope('plugin').ctx
  for (const name of initialSeats) declareSeat(name)
  return host
}

// Each plugin's assigned settings contribution: the seat it must wait for, its
// stable id and order, and the props the host composes for that seat (a
// settings.section owner receives `close`; merged group items receive none).
const plugins = [
  { pkg: '@klarkxy/dsh-font', apply: font, seat: SECTION, id: 'font', order: 5 },
  { pkg: '@klarkxy/dsh-web-search-manager', apply: webSearch, seat: SECTION, id: 'web-search-manager', order: 150 },
  { pkg: '@klarkxy/dsh-zhihu', apply: zhihu, seat: SECTION, id: 'zhihu', order: 160 },
  { pkg: '@klarkxy/dsh-secret-manager', apply: secretManager, seat: SECTION, id: 'secret-manager', order: 170 },
  { pkg: '@klarkxy/dsh-model-hub', apply: modelHub, seat: SECTION, id: 'model-hub', order: 180 },
]
const ownerProps = { [SECTION]: { close: () => {} } }

describe('plugin settings registrations', () => {
  for (const { pkg, apply, seat, id, order } of plugins) {
    it(`${pkg} waits for ${seat}, survives redeclaration, and unloads cleanly`, async () => {
      const h = createHost([...forbidden, 'shell.overlay'])
      apply(h.ctx)
      await settle()
      // Business settings never appear on the plugins-page seats, and a plugin
      // merged into a native group must not keep waiting on another settings
      // seat (the exit from per-plugin settings.section navigation).
      expect(h.injected.filter(name => forbidden.includes(name))).toEqual([])
      expect(h.injected.filter(name => settingsSeats.includes(name) && name !== seat)).toEqual([])
      expect(h.registered.filter(entry => settingsSeats.includes(entry.spec.name))).toEqual([])
      h.declare(seat)
      const entries = () => h.registered.filter(entry => entry.spec.name === seat)
      expect(entries()).toHaveLength(1)
      // Contribution identity: stable id + nav order; only settings.section
      // still displays a label — merged group items render their own heading.
      const spec = entries()[0].spec
      expect(spec).toMatchObject({ name: seat, id })
      expect(spec.order).toBe(order)
      if (seat === SECTION) {
        const label = typeof spec.label === 'function' ? spec.label() : spec.label
        expect(typeof label === 'string' && label.length > 0).toBe(true)
      }
      const noWrites = () => {
        expect(h.writes).toEqual([])
        expect(h.themeWrites).toEqual([])
        expect(h.calls.filter(([, endpoint]) => writeEndpoint.test(String(endpoint)))).toEqual([])
      }
      // Registering or opening the contribution must not write config, write
      // credentials, or run inference.
      noWrites()
      const injectedProps = typeof spec.inject === 'function' ? spec.inject() : undefined
      const html = renderToStaticMarkup(createElement(entries()[0].render, { ...ownerProps[seat], ...injectedProps }))
      expect(html.length).toBeGreaterThan(0)
      if (pkg === '@klarkxy/dsh-zhihu') {
        expect(html).toContain('zhihu-settings-embed')
        expect(html).not.toContain('data-testid="zhihu-open"')
      }
      noWrites()
      // The nav icon lives on its own seat: it appears only while the icon
      // slot is declared, its id is the section id, and it renders from the
      // {size, active} owner props the host composes.
      if (seat === SECTION) {
        h.declare(ICON_SLOT)
        const icons = () => h.registered.filter(entry => entry.spec.name === ICON_SLOT)
        expect(icons().map(entry => entry.spec.id)).toEqual([id])
        const icon = h.core.entriesOfSlot(ICON_SLOT).find(row => row.options.id === id)
        expect(icon).toBeTruthy()
        expect(renderToStaticMarkup(createElement(icon.component, { size: 14, active: true })).length).toBeGreaterThan(0)
        h.undeclare(ICON_SLOT)
        expect(icons()).toEqual([])
      }
      h.undeclare(seat)
      expect(entries()).toEqual([])
      h.declare(seat); h.declare(seat)
      expect(entries()).toHaveLength(1)
      await h.dispose(); await h.dispose(); h.declare(seat)
      expect(h.registered).toEqual([])
      expect(h.unmounts).toEqual(h.mounted)
    })

    it(`${pkg} cancels a pending registration on unload`, async () => {
      const h = createHost()
      apply(h.ctx)
      await settle()
      await h.dispose()
      h.declare(seat)
      expect(h.registered).toEqual([])
    })
  }

  it('@klarkxy/dsh-safe-auto keeps its permission entry on the composer seat and stays off every settings seat', async () => {
    const h = createHost([...forbidden, ...settingsSeats])
    safeAuto(h.ctx)
    await settle()
    // The reviewer configuration moved onto the shared Session Management
    // column (see below): the shared kit page service may wait on
    // settings.section from the root context, but the plugin itself holds no
    // settings seat — only the shared page entry (id session-manager, owned
    // by root) may appear on a settings seat.
    expect(h.injected.filter(name => forbidden.includes(name))).toEqual([])
    // Shared root-owned infrastructure rows are not business settings: the
    // shared column page (session-manager) and the shared auxiliary-model
    // card are the only entries a settings seat may show, and only from the
    // root context. Everything else belongs to the plugin's own GUI.
    expect(h.registered.filter(entry =>
      (settingsSeats.includes(entry.spec.name) || forbidden.includes(entry.spec.name))
      && !(entry.spec.name === SECTION && entry.spec.id === SECTION_ID && entry.owner === 'root')
      && !isSharedAuxiliaryEntry(entry))).toEqual([])
    h.declare(PERMISSION)
    const menus = () => h.registered.filter(entry => entry.spec.name === PERMISSION)
    expect(menus()).toHaveLength(1)
    expect(menus()[0].spec.priority).toBeLessThan(0)
    const props = menus()[0].spec.inject()
    const menu = createElement(menus()[0].render, { sessionId: 'session-1', locked: false, ...props })
    expect(renderToStaticMarkup(menu).length).toBeGreaterThan(0)
    // Opening the control reads the session once it mounts; registering and
    // rendering the menu itself must never write settings or select a preset.
    expect(h.writes).toEqual([])
    expect(h.calls.filter(([, endpoint]) => writeEndpoint.test(String(endpoint)))).toEqual([])
    h.undeclare(PERMISSION)
    expect(menus()).toEqual([])
    await h.dispose(); h.declare(PERMISSION)
    expect(h.registered).toEqual([])
    expect(contributionIds(h.unmounts)).toEqual(contributionIds(h.mounted))
  })

  it('@klarkxy/dsh-git-commit keeps model settings inside the commit action and off every settings seat', async () => {
    const h = createHost([...forbidden, ...settingsSeats])
    gitCommit(h.ctx)
    await settle()
    // Model and fallback live in the commit popover's own GUI: the plugin
    // itself registers nothing on a settings seat. The shared root-owned
    // auxiliary-model card is infrastructure — the shared page install is its
    // only settings-seat wait, exactly once each for the section seat, the
    // shared item slot and the nav-icon seat.
    expect(h.injected.filter(name =>
      (settingsSeats.includes(name) && name !== SECTION) || forbidden.includes(name))).toEqual([])
    expect(h.injected.filter(name => name === SECTION)).toHaveLength(1)
    expect(h.injected.filter(name => name === ITEM_SLOT)).toHaveLength(1)
    expect(h.injected.filter(name => name === ICON_SLOT)).toHaveLength(1)
    expect(h.injected.filter(name => name === MODELS_FOOTER)).toEqual([])
    expect(h.registered.filter(entry =>
      (settingsSeats.includes(entry.spec.name) || forbidden.includes(entry.spec.name))
      && !isSharedAuxiliaryEntry(entry)
      // The shared page entry is the root-owned column itself, not business
      // settings; the aux share retains it exactly like the participants do.
      && !(entry.spec.name === SECTION && entry.spec.id === SECTION_ID && entry.owner === 'root'))).toEqual([])
    // The action contribution waits for its own seat like every other slot.
    h.declare(HEADER_ACTION)
    const actions = () => h.registered.filter(entry => entry.spec.name === HEADER_ACTION)
    expect(actions()).toHaveLength(1)
    expect(actions()[0].spec).toMatchObject({ name: HEADER_ACTION, id: 'git-commit' })
    const props = actions()[0].spec.inject()
    expect(typeof props.call).toBe('function')
    expect(typeof props.subscribeSettings).toBe('function')
    const html = renderToStaticMarkup(createElement(actions()[0].render, {
      sessionId: 'session-1', useSession: selector => selector({ running: false }), t: key => key, ...props,
    }))
    expect(html.length).toBeGreaterThan(0)
    // Registering and first-rendering the action never writes settings or
    // commits on its own; a commit still requires the explicit confirm.
    expect(h.writes).toEqual([])
    expect(h.calls.filter(([, endpoint]) => writeEndpoint.test(String(endpoint)))).toEqual([])
    await h.dispose(); h.declare(HEADER_ACTION)
    expect(h.registered).toEqual([])
    expect(contributionIds(h.unmounts)).toEqual(contributionIds(h.mounted))
  })
})

describe('shared default auxiliary model card', () => {
  const auxRows = h => h.registered.filter(entry => entry.spec.name === ITEM_SLOT && entry.spec.id === AUX_ROW.id)
  // Only the shared card's own change-stream contribution; participants keep
  // their unrelated model-settings mounts.
  const auxMounts = h => h.mounted.filter(contribution => contribution.package === '@klarkxy/dsh-plugin-kit')
  const auxUnmounts = h => h.unmounts.filter(contribution => contribution.package === '@klarkxy/dsh-plugin-kit')

  it('mounts one root-owned card for several participants and releases it with the last', async () => {
    const h = createHost([SECTION])
    const first = h.scope('aux-participant-a')
    const second = h.scope('aux-participant-b')
    first.ctx.effect(() => registerAuxiliaryModelSettings(first.ctx))
    second.ctx.effect(() => registerAuxiliaryModelSettings(second.ctx))
    await settle()
    // One card, owned by the shared root service — never one per participant.
    expect(auxRows(h)).toHaveLength(1)
    expect(auxRows(h)[0].spec).toMatchObject(AUX_ROW)
    expect(auxRows(h)[0].owner).toBe('root')
    // The card's root share also created the shared column itself.
    expect(h.registered.filter(entry => entry.spec.name === SECTION && entry.spec.id === SECTION_ID)).toHaveLength(1)
    // The row renders its own heading without consuming owner props.
    expect(renderToStaticMarkup(createElement(auxRows(h)[0].render)).length).toBeGreaterThan(0)
    // The client-side watch contribution mounts once on the root lease.
    expect(auxMounts(h)).toHaveLength(1)
    // The first participant unloads: the card and its stream survive.
    await first.dispose()
    await settle()
    expect(auxRows(h)).toHaveLength(1)
    expect(auxMounts(h)).toHaveLength(1)
    expect(auxUnmounts(h)).toEqual([])
    // The last participant leaves: the card and the watch mount go with it.
    await second.dispose()
    await settle()
    await settle()
    expect(auxRows(h)).toEqual([])
    expect(h.registered.filter(entry => entry.spec.name === SECTION && entry.spec.id === SECTION_ID)).toEqual([])
    expect(auxUnmounts(h)).toEqual(auxMounts(h))
  })

  it('remounts cleanly after a full teardown instead of duplicating the seat', async () => {
    const h = createHost([SECTION])
    const first = h.scope('aux-participant-a')
    first.ctx.effect(() => registerAuxiliaryModelSettings(first.ctx))
    await settle()
    await first.dispose()
    await settle()
    await settle()
    expect(auxRows(h)).toEqual([])
    const second = h.scope('aux-participant-b')
    second.ctx.effect(() => registerAuxiliaryModelSettings(second.ctx))
    await settle()
    // The lease serialized the unmount before remounting: still one row.
    expect(auxRows(h)).toHaveLength(1)
    expect(auxRows(h)[0].spec).toMatchObject(AUX_ROW)
    expect(auxMounts(h)).toHaveLength(2)
    await h.dispose()
  })

  it('keeps business settings off the seat when no participant mounts it', async () => {
    const h = createHost([...forbidden, ...settingsSeats])
    // A bare host with no participant shows no card: the shared column row
    // belongs to the shared service alone, never to a plugin's own
    // registration, and the legacy footer seat stays empty.
    expect(auxRows(h)).toEqual([])
    expect(h.core.entriesOfSlot(MODELS_FOOTER).filter(entry => entry.options.id === AUX_ROW.id)).toEqual([])
    expect(h.core.entries(ITEM_SLOT)).toEqual([])
    await h.dispose()
  })
})

describe('font settings page and the native font-size cell', () => {
  // The Font plugin owns a settings page of its own, so the General page must
  // not show the same setting twice: while the page exists the plugin shadows
  // the native font-size cell with a same-id entry at a lower priority that
  // renders nothing. The native row is never touched — it stays on the ledger
  // and owns the cell again as soon as the page or the plugin goes away.
  const fontPage = h => h.core.entriesOfSlot(SECTION).filter(entry => entry.options.id === 'font')
  const generalCell = h => h.core.entriesOfSlot(GENERAL_ITEM)

  it('leaves the native font-size row alone until the Font page exists', async () => {
    const h = createHost()
    h.declare(GENERAL_ITEM)
    const plugin = h.scope('@klarkxy/dsh-font')
    font(plugin.ctx)
    await settle()
    // The settings shell has no section list yet: the plugin contributes
    // nothing, so the native row still owns its cell.
    expect(fontPage(h)).toEqual([])
    expect(generalCell(h)).toHaveLength(1)
    expect(generalCell(h)[0].options).toMatchObject({ id: 'font-size', order: 11 })
    expect(generalCell(h)[0].options.priority ?? 0).toBe(0)

    h.declare(SECTION)
    await settle()
    // One nav row, and the native cell is shadowed by the page's own entry.
    expect(fontPage(h)).toHaveLength(1)
    expect(fontPage(h)[0].options).toMatchObject({ order: 5 })
    expect(generalCell(h)).toHaveLength(1)
    expect(generalCell(h)[0].options).toMatchObject({ id: 'font-size', priority: -10 })
    // The native row is untouched on the ledger — only the cell's winner moved.
    expect(h.core.entries(GENERAL_ITEM)).toHaveLength(2)
    // The plugin leaves no General row of its own behind.
    expect(h.core.entries(GENERAL_ITEM).some(entry => entry.options.id === 'font')).toBe(false)
    // The shadow renders nothing in the native row's place.
    expect(generalCell(h)[0].component()).toBeNull()
  })

  it('gives the native font-size row back when the plugin unloads', async () => {
    const h = createHost()
    h.declare(GENERAL_ITEM)
    h.declare(SECTION)
    const plugin = h.scope('@klarkxy/dsh-font')
    font(plugin.ctx)
    await settle()
    expect(generalCell(h)[0].options.priority).toBe(-10)
    await plugin.dispose()
    await settle()
    expect(fontPage(h)).toEqual([])
    expect(generalCell(h)).toHaveLength(1)
    expect(generalCell(h)[0].options).toMatchObject({ id: 'font-size' })
    expect(generalCell(h)[0].options.priority ?? 0).toBe(0)
  })

  it('gives the native font-size row back when the section list collapses', async () => {
    const h = createHost()
    h.declare(GENERAL_ITEM)
    h.declare(SECTION)
    const plugin = h.scope('@klarkxy/dsh-font')
    font(plugin.ctx)
    await settle()
    expect(generalCell(h)[0].options.priority).toBe(-10)
    h.undeclare(SECTION)
    await settle()
    // The page is gone, so the native row owns the cell again.
    expect(fontPage(h)).toEqual([])
    expect(generalCell(h)).toHaveLength(1)
    expect(generalCell(h)[0].options.priority ?? 0).toBe(0)
  })

  it('installs the shadow when the General list appears after the page', async () => {
    const h = createHost()
    h.declare(SECTION)
    const plugin = h.scope('@klarkxy/dsh-font')
    font(plugin.ctx)
    await settle()
    expect(fontPage(h)).toHaveLength(1)
    // No General list yet: the plugin waits for it instead of failing.
    expect(h.core.specDynamic(GENERAL_ITEM)).toBeUndefined()
    expect(h.core.entries(GENERAL_ITEM)).toEqual([])
    h.declare(GENERAL_ITEM)
    await settle()
    expect(generalCell(h)).toHaveLength(1)
    expect(generalCell(h)[0].options.priority).toBe(-10)
  })

  it('keeps the shadow when the native row loads late', async () => {
    const h = createHost()
    h.declare(GENERAL_ITEM, { rows: false })
    const plugin = h.scope('@klarkxy/dsh-font')
    font(plugin.ctx)
    await settle()
    h.declare(SECTION)
    await settle()
    expect(generalCell(h)).toHaveLength(1)
    expect(generalCell(h)[0].options.priority).toBe(-10)
    // The host's own row arrives afterwards: it joins the cell but must not
    // take it back from the shadow.
    h.installNativeRows(GENERAL_ITEM)
    await settle()
    expect(h.core.entries(GENERAL_ITEM)).toHaveLength(2)
    expect(generalCell(h)).toHaveLength(1)
    expect(generalCell(h)[0].options.priority).toBe(-10)
  })

  it('follows a General list that collapses and comes back', async () => {
    const h = createHost()
    h.declare(GENERAL_ITEM)
    h.declare(SECTION)
    const plugin = h.scope('@klarkxy/dsh-font')
    font(plugin.ctx)
    await settle()
    expect(generalCell(h)[0].options.priority).toBe(-10)
    h.undeclare(GENERAL_ITEM)
    await settle()
    // The list is gone with its owner, and the shadow went with it.
    expect(h.core.specDynamic(GENERAL_ITEM)).toBeUndefined()
    expect(h.core.entries(GENERAL_ITEM)).toEqual([])
    // The page is still installed, so the shadow returns with the list.
    expect(fontPage(h)).toHaveLength(1)
    h.declare(GENERAL_ITEM)
    await settle()
    expect(generalCell(h)).toHaveLength(1)
    expect(generalCell(h)[0].options.priority).toBe(-10)
    expect(h.core.entries(GENERAL_ITEM)).toHaveLength(2)
  })
})

describe('shared Session Management settings column', () => {
  // The participants of the shared column. They are equal citizens: each one
  // contributes a row and none of them owns the page. The shared
  // auxiliary-model card is a participant too: it contributes the
  // 'auxiliary-model' row from the root context, and several business
  // participants retain it as well — `aux` marks whoever adds that row.
  const participants = [
    {
      pkg: 'shared-auxiliary-card',
      apply: ctx => ctx.effect(() => registerAuxiliaryModelSettings(ctx)),
      rows: [{ id: AUX_ROW.id, order: AUX_ROW.order, marker: 'data-testid="auxiliary-model-settings"' }],
      aux: true,
    },
    {
      pkg: '@klarkxy/dsh-session-manager',
      apply: sessionManager,
      rows: [
        { id: 'session-manager.composer', order: 60, marker: 'data-testid="session-manager-composer-settings-item"' },
        { id: 'session-manager.auto-continue', order: 62, marker: 'data-testid="session-manager-auto-continue-settings-item"' },
        { id: 'session-manager.return', order: 64, marker: 'data-testid="session-manager-return-settings-item"' },
        { id: 'session-manager.handoff', order: 66, marker: 'data-testid="session-manager-handoff-settings-item"' },
        { id: 'session-manager.agent-actions', order: 68, marker: 'data-testid="session-manager-agent-actions-settings-item"' },
      ],
      aux: true,
    },
    {
      pkg: '@klarkxy/dsh-current-title',
      apply: currentTitle,
      rows: [{ id: 'current-title', order: 70, marker: 'data-testid="current-title-settings-item"' }],
      aux: true,
    },
    {
      pkg: '@klarkxy/dsh-safe-auto',
      apply: safeAuto,
      rows: [{ id: 'safe-auto', order: 80, marker: 'data-testid="safe-auto-settings-item"' }],
      aux: true,
    },
  ]
  const rowOrder = Object.fromEntries(participants.flatMap(entry => entry.rows.map(row => [row.id, row.order])))
  // The rows a subset contributes: its own ids plus the shared card's row
  // whenever any loaded participant retains it, all in nav order.
  const expectedIds = list => [...new Set([
    ...(list.some(entry => entry.aux) ? [AUX_ROW.id] : []),
    ...list.flatMap(entry => entry.rows.map(row => row.id)),
  ])].sort((left, right) => rowOrder[left] - rowOrder[right])

  const pageRows = h => h.core.entries(SECTION)
  const itemRows = h => h.core.entries(ITEM_SLOT)
  const ids = rows => rows.map(row => row.options.id)

  const load = async (h, list) => {
    const handles = list.map(entry => {
      const handle = h.scope(entry.pkg)
      entry.apply(handle.ctx)
      return handle
    })
    await settle()
    return handles
  }

  const renderPage = h => {
    const page = pageRows(h)[0]
    const renderSlot = (key, owner) => h.core.entriesOfSlot(key).map(row => createElement(
      row.component,
      { ...owner, ...(typeof row.inject === 'function' ? row.inject() : {}) },
    ))
    return renderToStaticMarkup(createElement(page.component, { ...ownerProps[SECTION], renderSlot }))
  }

  it('gives every participant the same page, however many are installed', async () => {
    // Every non-empty subset of the four participants, in mask order.
    const subsets = []
    for (let mask = 1; mask < (1 << participants.length); mask += 1) {
      subsets.push(participants.map((_, index) => index).filter(index => mask & (1 << index)))
    }
    for (const subset of subsets) {
      const h = createHost([SECTION])
      const list = subset.map(index => participants[index])
      await load(h, list)
      // One page, owned by the shared service — never one page per plugin.
      expect(pageRows(h)).toHaveLength(1)
      expect(pageRows(h)[0].options).toMatchObject({ id: SECTION_ID, order: 30 })
      const label = pageRows(h)[0].options.label
      expect((typeof label === 'function' ? label() : label)?.length > 0).toBe(true)
      // The page declares the shared item list once; every participant holds
      // exactly one row in it, in nav order.
      expect(h.core.specDynamic(ITEM_SLOT)).toEqual({ kind: 'list', scope: 'root' })
      expect(ids(itemRows(h))).toEqual(expectedIds(list))
      // No participant falls back to the General page.
      expect(ids(h.core.entries(GENERAL_ITEM))).toEqual([])
      // No duplicate navigation row.
      expect(new Set(ids(pageRows(h))).size).toBe(1)
      expect(new Set(ids(itemRows(h))).size).toBe(itemRows(h).length)
      // The shared page's nav icon: several participants may hold a raw entry
      // for the page id, but the rendered cell has exactly one winner.
      const iconRows = h.core.entries(ICON_SLOT).filter(row => row.options.id === SECTION_ID)
      expect(h.core.entriesOfSlot(ICON_SLOT).filter(row => row.options.id === SECTION_ID).length).toBeLessThanOrEqual(1)
      expect(iconRows.every(row => row.options.id === SECTION_ID)).toBe(true)
    }
  })

  it('renders every participant row inside the shared page', async () => {
    const h = createHost([SECTION])
    await load(h, participants)
    const html = renderPage(h)
    for (const entry of participants) for (const row of entry.rows) expect(html).toContain(row.marker)
  })

  it('keeps the page when its first creator unloads and releases it with the last participant', async () => {
    const h = createHost([SECTION, ICON_SLOT])
    const [first, second] = await load(h, [participants[0], participants[1]])
    const iconRows = () => h.core.entries(ICON_SLOT).filter(row => row.options.id === SECTION_ID)
    await first.dispose()
    await settle()
    // The page belongs to the root service, not to the plugin that created it.
    expect(pageRows(h)).toHaveLength(1)
    expect(ids(itemRows(h))).toEqual(expectedIds([participants[1]]))
    // The nav icon survives the plugin that first installed it; whichever raw
    // entries remain, at most one winner can render.
    expect(iconRows().length).toBeGreaterThanOrEqual(1)
    expect(h.core.entriesOfSlot(ICON_SLOT).filter(row => row.options.id === SECTION_ID).length).toBe(1)
    await second.dispose()
    await settle()
    // The last participant leaves: the page, its icon and the shared service
    // go with it.
    expect(pageRows(h)).toEqual([])
    expect(iconRows()).toEqual([])
    expect(h.core.specDynamic(ITEM_SLOT)).toBeUndefined()
    expect(h.root.get(PAGE_SERVICE, false)).toBeUndefined()
  })

  it('rebuilds the page after the last participant left', async () => {
    const h = createHost([SECTION])
    const [only] = await load(h, [participants[0]])
    await only.dispose()
    await settle()
    expect(pageRows(h)).toEqual([])
    // The service store entry is gone synchronously, so the next participant
    // finds an empty slot and builds the page again.
    await load(h, [participants[2]])
    expect(pageRows(h)).toHaveLength(1)
    expect(ids(itemRows(h))).toEqual(expectedIds([participants[2]]))
  })

  it('waits for the host settings page before the column appears', async () => {
    const h = createHost()
    const [only] = await load(h, [participants[0]])
    // The host has not declared its settings section yet: the shared page and
    // the row wait for it instead of appearing somewhere else.
    expect(pageRows(h)).toEqual([])
    expect(ids(itemRows(h))).toEqual([])
    h.declare(SECTION)
    await settle()
    expect(pageRows(h)).toHaveLength(1)
    expect(ids(itemRows(h))).toEqual([participants[0].rows[0].id])
  })

  it('never writes settings, credentials or models while opening the column', async () => {
    const h = createHost([SECTION])
    await load(h, participants)
    renderPage(h)
    expect(h.writes).toEqual([])
    expect(h.themeWrites).toEqual([])
    expect(h.calls.filter(([, endpoint]) => writeEndpoint.test(String(endpoint)))).toEqual([])
  })

  it('meets separately bundled copies of the helper through the root service', async () => {
    const h = createHost([SECTION])
    const first = await import('@klarkxy/dsh-plugin-kit/client-utils')
    // A second copy of the helper, as a separately bundled plugin would load it.
    vi.resetModules()
    const second = await import('@klarkxy/dsh-plugin-kit/client-utils')
    expect(second.registerSessionSettingsItem).not.toBe(first.registerSessionSettingsItem)
    const one = h.scope('copy-a')
    one.ctx.effect(() => first.registerSessionSettingsItem(one.ctx, { id: 'delegation', order: 60 }, () => null))
    const other = h.scope('copy-b')
    other.ctx.effect(() => second.registerSessionSettingsItem(other.ctx, { id: 'session-manager.composer', order: 60 }, () => null))
    await settle()
    // Two copies of the helper, one page: the rendezvous is the root service,
    // not a module singleton or a window global.
    expect(pageRows(h)).toHaveLength(1)
    expect(ids(itemRows(h))).toEqual(['delegation', 'session-manager.composer'])
  })

  it('mounts the page icon on a late seat and releases it with the column', async () => {
    // The icon seat can be declared after the page (or reclaimed): the shared
    // page contributes its own nav icon under the section id, renders it from
    // {size, active} owner props, and never shows two icons for one page.
    const h = createHost([SECTION])
    const handles = await load(h, participants)
    const iconRows = () => h.core.entries(ICON_SLOT).filter(row => row.options.id === SECTION_ID)
    expect(iconRows()).toEqual([])
    h.declare(ICON_SLOT)
    await settle()
    expect(iconRows().length).toBeGreaterThanOrEqual(1)
    const icons = h.core.entriesOfSlot(ICON_SLOT).filter(row => row.options.id === SECTION_ID)
    expect(icons).toHaveLength(1)
    const inactive = renderToStaticMarkup(createElement(icons[0].component, { size: 16, active: false }))
    const active = renderToStaticMarkup(createElement(icons[0].component, { size: 16, active: true }))
    expect(inactive.length).toBeGreaterThan(0)
    expect(active.length).toBeGreaterThan(0)
    h.undeclare(ICON_SLOT)
    await settle()
    expect(iconRows()).toEqual([])
    h.declare(ICON_SLOT)
    await settle()
    expect(h.core.entriesOfSlot(ICON_SLOT).filter(row => row.options.id === SECTION_ID)).toHaveLength(1)
    for (const handle of handles) await handle.dispose()
    await settle()
    expect(iconRows()).toEqual([])
  })
})
