import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { apply, HubPage, inject, type HubApi, type HubEntry } from './client.tsx'

const CATALOG = {
  groups: [{
    id: 'provider', name: 'Provider',
    models: [
      { id: 'reasoner', name: 'Reasoner', reasoning: { efforts: [{ id: 'medium', name: 'Medium' }] } },
      { id: 'plain', name: 'Plain' },
    ],
  }],
}

const entries: HubEntry[] = [
  { ns: '@klarkxy/dsh-safe-auto', revision: 3, fields: [
    { path: ['reviewer'], via: 'marker', marker: { purpose: 'review', label: '审核模型' }, current: { provider: 'provider', model: 'reasoner', reasoningEffort: 'medium' } },
  ] },
  { ns: 'plain-plugin', revision: 1, fields: [
    { path: ['summary', 'model'], via: 'shape' },
  ] },
]

function api(overrides: Partial<Parameters<typeof HubPage>[0]['api']> = {}) {
  return {
    list: async () => entries,
    setField: async () => ({ committed: true as const, ns: 'owner' }),
    modelCatalog: async () => CATALOG,
    ...overrides,
  }
}

describe('hub settings page', () => {
  it('renders compact plugin groups with meaningful labels and accessible model editors', () => {
    const html = renderToStaticMarkup(createElement(HubPage, { api: api(), initialEntries: entries, initialCatalog: CATALOG }))
    expect(html).toContain('@klarkxy/dsh-safe-auto')
    expect(html).toContain('审核模型')
    expect(html).not.toContain('contract marker')
    expect(html).not.toContain('shape match')
    expect(html).not.toContain('<fieldset')
    expect(html).toContain('Safe auto')
    expect(html).toContain('aria-label="审核模型: Provider / Reasoner"')
    // The current route shows on the trigger with its effort caption.
    expect(html).toContain('Provider / Reasoner')
    expect(html).toContain('Medium')
    // A shape-detected field without a value starts in follow mode.
    expect(html).toContain('Summary / Model')
    expect(html).not.toContain('summary.model')
    expect(html).toContain('Restore plugin default')
    expect(html).toContain('aria-haspopup="menu"')
  })

  it('renders the empty and loading states in zh', () => {
    const empty = renderToStaticMarkup(createElement(HubPage, { api: api(), locale: 'zh-CN', initialEntries: [], initialCatalog: CATALOG }))
    expect(empty).toContain('没有检测到模型字段')
    const loading = renderToStaticMarkup(createElement(HubPage, { api: api(), locale: 'zh-CN' }))
    expect(loading).toContain('正在读取…')
  })

  it('shows collection templates as informational rows without an editor', () => {
    const html = renderToStaticMarkup(createElement(HubPage, { api: api(), initialEntries: [{ ns: 'empty-array', revision: 1,
      fields: [{ path: ['pool', '[]'], via: 'shape', editable: false, arrayItem: true }] }], initialCatalog: CATALOG }))
    expect(html).toContain('Pool / Items')
    expect(html).toContain('No collection item to edit')
    expect(html).not.toContain('class="dsh-model-menu-triggerLabel"')
  })

  it('uses schema labels and descriptions, and hides only the hub self-test fields', () => {
    const html = renderToStaticMarkup(createElement(HubPage, { api: api(), initialCatalog: CATALOG, initialEntries: [
      { ns: '@klarkxy/dsh-model-hub', revision: 1, fields: [{ path: ['selfTestMeta'], via: 'marker', label: 'INTERNAL TEST' }] },
      { ns: 'other-model-hub', title: 'Other plugin', revision: 1, fields: [{ path: ['model'], via: 'shape', label: 'Summary engine', description: 'For short summaries' }] },
      { ns: 'linked', revision: 1, fields: [{ path: ['profile'], via: 'contribution', label: 'Profile model', editable: false, description: 'Linked to reviewer profile' }] },
      { ns: 'broken', title: 'Unavailable plugin', revision: 0, fields: [], error: 'Owner unavailable' },
    ] }))
    expect(html).not.toContain('INTERNAL TEST')
    expect(html).toContain('Other plugin')
    expect(html).toContain('Summary engine')
    expect(html).toContain('For short summaries')
    expect(html).toContain('Linked to reviewer profile')
    expect(html).not.toContain('No collection item to edit')
    expect(html).toContain('Owner unavailable')
  })

  it('renders the fields/cast tabs and hides the native subagent cast namespace from the overview', () => {
    const html = renderToStaticMarkup(createElement(HubPage, { api: api(), initialCatalog: CATALOG, initialEntries: [
      { ns: 'subagent-model-selection-settings', title: 'Subagent selection', revision: 1, fields: [{ path: ['model'], via: 'shape', current: { provider: 'provider', model: 'plain' } }] },
      { ns: 'agent-default-model', title: 'Agent default', revision: 2, fields: [{ path: ['model'], via: 'shape', current: { provider: 'provider', model: 'plain' } }] },
    ] }))
    expect(html).toContain('role="tablist"')
    expect(html).toContain('Fields')
    expect(html).toContain('Subagent Cast')
    expect(html).not.toContain('subagent-model-selection-settings')
    expect(html).not.toContain('Subagent selection')
    expect(html).toContain('agent-default-model')
    expect(html).toContain('Agent default')
  })

  it('registers the bundle config seat with the package key', async () => {
    const waiting: Array<() => void> = []
    const registered: Array<{ options: { key?: string; inject?: () => { api: HubApi } }; component: unknown }> = []
    const cleanup: Array<() => void | Promise<void>> = []
    let mounts = 0, unmounts = 0
    const session = { async modelCatalog() { expect(this).toBe(session); return { ok: true, value: CATALOG } } }
    expect(inject).toEqual(expect.arrayContaining(['remote', 'remote.session']))
    await apply({
      slots: { inject: (_name: string, fn: () => void) => waiting.push(fn), register: (options: { key?: string }, component: unknown) => registered.push({ options, component }) },
      connection: { rpc: { call: async () => ({ ok: true, value: [] }) } },
      remote: { session, $mount: async () => { mounts++; return async () => { unmounts++ } } },
      effect: (callback: () => () => void | Promise<void>) => cleanup.push(callback()),
      inject(deps: string[], callback?: (scope: unknown) => void) {
        if (deps.length === 1 && deps[0] === 'remote') callback?.({ remote: { $mount: async () => { mounts++; return async () => { unmounts++ } } }, effect(run: () => () => void | Promise<void>) { cleanup.push(run()) } })
        return { dispose() {} }
      },
      locale: 'en',
    })
    expect(waiting.length).toBe(1)
    waiting.forEach(fn => fn())
    expect(registered.length).toBe(1)
    expect(registered[0]!.options.key).toBe('@klarkxy/dsh-model-hub')
    expect(await registered[0]!.options.inject!().api.modelCatalog()).toBe(CATALOG)
    expect(mounts).toBe(1)
    for (const dispose of cleanup.reverse()) await dispose()
    expect(unmounts).toBe(1)
  })
})
