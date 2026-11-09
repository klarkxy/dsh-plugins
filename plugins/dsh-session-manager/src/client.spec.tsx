import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { CONFIG_READ_ENDPOINT, DELETE_DIALOG_ID, PLUGIN_NAME, SESSION_SETTINGS_ITEMS, USER_ACTIONS_SLOT, type ConfigView } from './contracts.ts'
import { wireSharedSettingsRoot } from './client-test-ctx.ts'
import { apply } from './client.tsx'
import { ComposerSettings, SessionSettingsDetails } from './settings-panel.tsx'
import { createPresenceConfigModel } from './presence-model.ts'

/** Minimal cordis-shaped context: real SlotCore for slots, a map-backed get/provide root. */
function createClientCtx(disposed: string[]) {
  const core = new SlotCore() as any
  core.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'sidebar.workspaces.session.menu.item': { kind: 'list', scope: 'root' },
      'conversation.hero.workspace': { kind: 'single', scope: 'root' },
      'conversation.hero.options': { kind: 'list', scope: 'root' },
      'conversation.chat.user-actions': { kind: 'list', scope: 'root' },
      'conversation.input.overlay': { kind: 'list', scope: 'root' },
      'conversation.chat.node': { kind: 'keyed', scope: 'root' },
      'conversation.chat.turnTail': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  }, () => null)
  const specs: Array<Record<string, unknown>> = []
  const order: string[] = []
  const unloads: Array<() => void> = []
  const slots = {
    entries: core.entries.bind(core),
    entriesOfSlot: core.entriesOfSlot.bind(core),
    spec: core.specDynamic.bind(core),
    specDynamic: core.specDynamic.bind(core),
    subscribe: core.subscribe.bind(core),
    subscribeDeclaration: core.subscribeDeclaration.bind(core),
    onEntryError: core.onEntryError.bind(core),
    inject(key: string, callback: () => (() => void) | void) {
      let last = 0
      let inner = () => {}
      // Track the declaration epoch: a collapse cleans the inner registration
      // and a re-declaration (the shared page's owner changing) replays the
      // callback against the new declaration.
      const sync = () => {
        const epoch = core.declarationEpoch(key)
        if (epoch === last) return
        inner(); inner = () => {}
        last = epoch
        if (slots.spec(key) !== undefined) inner = callback() ?? (() => {})
      }
      const stopDecl = core.subscribeDeclaration(key, sync)
      sync()
      return () => { disposed.push('inject'); stopDecl(); inner() }
    },
    register(spec: Record<string, unknown>, component: unknown) {
      specs.push(spec)
      const stop = (core.register as (s: Record<string, unknown>, c: unknown) => () => void)(spec, component)
      return () => { stop(); disposed.push(String(spec['id'] ?? spec['key'] ?? 'section')) }
    },
  }
  const ctx = wireSharedSettingsRoot({
    slots,
    locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe: () => () => {} },
    effect(callback: () => () => void) { const stop = callback?.() ?? (() => {}); unloads.push(stop); return stop },
    inject(deps: string[], callback?: (scope: unknown) => void) {
      order.push(deps.length === 1 && deps[0] === 'remote' ? 'mount' : deps.join(','))
      if (deps.length === 1 && deps[0] === 'remote') callback?.({ remote: { $mount: async () => async () => {} }, effect() {} })
      return { dispose() {} }
    },
    on() { return () => {} },
  })
  return { ctx, core, specs, order, unload: () => { for (const stop of unloads) stop() } }
}

describe('session menu registration', () => {
  it('joins the shared settings section, keeps its own rows, and cleans up on unload', () => {
    const disposed: string[] = []
    const { ctx, core, specs, order, unload } = createClientCtx(disposed)
    apply(ctx as never)
    expect(order[0]).toBe('mount')
    expect(order[1]).toBe(`remote,remote.${modelSettingsChangesIdentity(PLUGIN_NAME).namespace}`)
    expect(disposed).toEqual([])
    expect(specs).toContainEqual({
      name: 'sidebar.workspaces.session.menu.item',
      id: DELETE_DIALOG_ID,
      order: 510,
    })
    expect(specs).toContainEqual({ name: 'conversation.chat.node', key: 'user', locale: 'chat', priority: -10 })
    expect(specs.some(spec => String(spec['id'] ?? '').includes('copy'))).toBe(false)
    // Session preferences join the shared page through the kit helper: the
    // helper's root service registers exactly one settings.section entry —
    // with this plugin alone enabled the page still exists — declares one
    // child list, and this plugin's row lands in it. No General-page row.
    const sections = core.entriesOfSlot('settings.section')
    expect(sections).toHaveLength(1)
    const section = sections[0]
    expect(section.options).toMatchObject({ id: 'session-manager', order: 30 })
    expect(section.children).toEqual({
      'dsh.session-settings.item': { kind: 'list', scope: 'root' },
    })
    // The shared auxiliary-model card contributes its own row into the same
    // column (root-owned, order 55); this plugin's rows follow, one per feature.
    const items = core.entriesOfSlot('dsh.session-settings.item')
    expect(items.map(item => item.options.id)).toEqual(['auxiliary-model', ...SESSION_SETTINGS_ITEMS.map(item => item.id)])
    expect(items.slice(1).map(item => item.options.order)).toEqual(SESSION_SETTINGS_ITEMS.map(item => item.order))
    expect(SESSION_SETTINGS_ITEMS.map(item => item.id)).toContain('session-manager.handoff')
    expect(SESSION_SETTINGS_ITEMS.map(item => item.id)).not.toContain('session-manager.models')
    expect(specs.some(spec => spec['name'] === 'settings.general.item')).toBe(false)
    expect(core.entriesOfSlot('settings.general.item')).toEqual([])
    unload()
    // The plugin's own registrations are gone; the helper disposes its row
    // (and the shared page, whose service it owns for this lone participant).
    expect(disposed).toContain(DELETE_DIALOG_ID)
    expect(core.entriesOfSlot('dsh.session-settings.item')).toEqual([])
  })
})

describe('session-manager settings item', () => {
  const values: ConfigView = {
    recapMinutes: 15, compactMinutes: 60, continueText: '', continueMode: 'fixed',
    model: null, ghostModel: null, judgeModel: null, handoffModel: null, autoContinueMode: 'off', autoContinueMax: 3,
    allowSelfFork: false, allowSendMessage: false,
  }

  it('mounts the settings body on first expand and keeps it mounted after collapsing', async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
    const previous = new Map<string, unknown>()
    const assign = (key: string, value: unknown) => {
      previous.set(key, (globalThis as Record<string, unknown>)[key])
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    assign('window', dom.window)
    assign('document', dom.window.document)
    assign('HTMLElement', dom.window.HTMLElement)
    assign('Node', dom.window.Node)
    assign('Element', dom.window.Element)
    assign('HTMLButtonElement', dom.window.HTMLButtonElement)
    assign('HTMLInputElement', dom.window.HTMLInputElement)
    assign('MouseEvent', dom.window.MouseEvent)
    assign('Event', dom.window.Event)
    assign('InputEvent', dom.window.InputEvent)
    assign('IS_REACT_ACT_ENVIRONMENT', true)
    const read = vi.fn(async () => ({ ok: true, value: values }))
    const model = createPresenceConfigModel({ rpc: { call: read } }, () => Promise.resolve())
    const catalog = vi.fn(async () => ({ groups: [] }))
    const root = createRoot(dom.window.document.getElementById('root')!)
    try {
      await act(async () => {
        root.render(
          <SessionSettingsDetails testId="session-manager-composer-settings-item" titleKey="composerGroupTitle" descKey="composerGroupHint" locale="zh">
            <ComposerSettings model={model} locale="zh" modelCatalog={catalog} />
          </SessionSettingsDetails>,
        )
      })
      const details = dom.window.document.querySelector('details')!
      // Collapsed by default: no config read and no catalog request.
      expect(details.open).toBe(false)
      expect(dom.window.document.querySelector('.dsm-item-body')).toBeNull()
      expect(read).not.toHaveBeenCalled()
      expect(catalog).not.toHaveBeenCalled()
      const summary = details.querySelector('summary')!
      expect(summary.textContent).toContain('输入框建议')
      expect(summary.textContent).toContain('输入框为空时显示的下一句建议')
      await act(async () => { details.open = true; details.dispatchEvent(new dom.window.Event('toggle')) })
      expect(read.mock.calls[0]?.[1]).toBe(CONFIG_READ_ENDPOINT)
      expect(dom.window.document.querySelector('.dsm-item-body')).not.toBeNull()
      await act(async () => { details.open = false; details.dispatchEvent(new dom.window.Event('toggle')) })
      // Collapsing keeps the mounted subtree, so an in-progress draft survives.
      expect(dom.window.document.querySelector('.dsm-item-body')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, value] of previous) {
        if (value === undefined) delete (globalThis as Record<string, unknown>)[key]
        else Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
      }
    }
  })
})
