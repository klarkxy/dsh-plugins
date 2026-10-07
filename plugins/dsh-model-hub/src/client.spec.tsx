import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { apply, HubPage, type HubEntry } from './client.tsx'

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
    setField: async () => entries,
    modelCatalog: async () => CATALOG,
    ...overrides,
  }
}

describe('hub settings page', () => {
  it('renders every detected field with the standard editor, marker metadata first', () => {
    const html = renderToStaticMarkup(createElement(HubPage, { api: api(), initialEntries: entries, initialCatalog: CATALOG }))
    expect(html).toContain('@klarkxy/dsh-safe-auto')
    expect(html).toContain('审核模型')
    expect(html).toContain('review · contract marker · reviewer')
    // The current route shows on the trigger with its effort caption.
    expect(html).toContain('Provider / Reasoner')
    expect(html).toContain('Medium')
    // A shape-detected field without a value starts in follow mode.
    expect(html).toContain('summary.model')
    expect(html).toContain('shape match')
    expect(html).toContain('Follow host default')
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
    expect(html).toContain('pool.[]')
    expect(html).toContain('No collection item to edit')
    expect(html).not.toContain('class="dsh-model-menu-triggerLabel"')
  })

  it('registers the bundle config seat with the package key', async () => {
    const waiting: Array<() => void> = []
    const registered: Array<{ options: { key?: string }; component: unknown }> = []
    apply({
      slots: { inject: (_name: string, fn: () => void) => waiting.push(fn), register: (options: { key?: string }, component: unknown) => registered.push({ options, component }) },
      connection: { rpc: { call: async () => ({ ok: true, value: [] }) } },
      remote: { session: { modelCatalog: async () => CATALOG } },
      locale: 'en',
    })
    expect(waiting.length).toBe(1)
    waiting.forEach(fn => fn())
    expect(registered.length).toBe(1)
    expect(registered[0]!.options.key).toBe('@klarkxy/dsh-model-hub')
  })
})
