import { describe, expect, it } from 'vitest'
import { catalogFailures, checkedModelCatalog, knownModelFromChoices, MODEL_CATALOG_INJECT, modelCatalogFailures, modelMenuEffortOptions, parseModelMenuChoices, readModelCatalog } from './catalog.ts'

const CATALOG = {
  groups: [
    {
      id: 'deepseek', name: 'DeepSeek',
      models: [
        { id: 'deepseek-chat', name: 'Chat', reasoning: { efforts: [{ id: 'off', name: '关闭' }, { id: 'high', name: '高' }] } },
        { id: 'deepseek-reasoner', name: 'Reasoner' },
      ],
    },
    { id: 'openai', models: [{ id: 'gpt-5' }] },
  ],
}

describe('checked host catalog', () => {
  it('preserves provider failures and host metadata in bare and wrapped results', async () => {
    const catalog = { ...CATALOG, default: { provider: 'deepseek', model: 'deepseek-chat' }, routableProviders: ['deepseek'], failures: [{ id: 'broken', name: 'Broken', message: 'Credentials expired' }] }
    expect(checkedModelCatalog(catalog)).toBe(catalog)
    expect(await readModelCatalog({ remote: { session: { modelCatalog: async () => ({ ok: true, value: catalog }) } } })).toBe(catalog)
    expect(modelCatalogFailures(catalog)).toBe(catalog.failures)
    expect(catalogFailures(catalog)).toEqual(['Broken: Credentials expired'])
    expect(catalogFailures(null)).toEqual([])
    expect(modelCatalogFailures(undefined)).toEqual([])
    expect(MODEL_CATALOG_INJECT).toEqual(['remote', 'remote.session'])
  })

  it.each([null, {}, { groups: {} }, { groups: [null] }, { groups: [{ id: 'p' }] },
    { groups: [{ id: 'p', models: [null] }] }, { groups: [{ id: '', models: [] }] },
    { groups: [{ id: 'p', models: [{ id: 'm', reasoning: {} }] }] },
    { groups: [], failures: [{}] }, { ok: true, value: null }, { ok: true, value: {} },
  ])('rejects malformed catalogs rather than reporting an empty menu: %j', value => {
    expect(() => checkedModelCatalog(value)).toThrow('Invalid model catalog')
    expect(modelCatalogFailures(value)).toEqual([])
    expect(catalogFailures(value)).toEqual([])
  })

  it('rejects dependency absence, sync throws, async failures and error envelopes', async () => {
    for (const client of [{}, { remote: {} }, { remote: { session: {} } }]) {
      await expect(readModelCatalog(client)).rejects.toThrow('inject both remote and remote.session')
    }
    await expect(readModelCatalog({ remote: { session: { modelCatalog() { throw new Error('sync') } } } })).rejects.toThrow('sync')
    await expect(readModelCatalog({ remote: { session: { modelCatalog: async () => { throw new Error('offline') } } } })).rejects.toThrow('offline')
    await expect(readModelCatalog({ remote: { session: { modelCatalog: async () => ({ ok: false, error: { message: 'denied' } }) } } })).rejects.toThrow('denied')
    expect(() => checkedModelCatalog({ ok: false, error: 'failed' })).toThrow('failed')
    expect(checkedModelCatalog({ groups: [] })).toEqual({ groups: [] })
  })
})

describe('host catalog parsing', () => {
  it('flattens the session catalog into provider / model choices', () => {
    expect(parseModelMenuChoices(CATALOG)).toEqual([
      { provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek / Chat', efforts: [{ id: 'off', name: '关闭' }, { id: 'high', name: '高' }] },
      { provider: 'deepseek', model: 'deepseek-reasoner', label: 'DeepSeek / Reasoner', efforts: [] },
      { provider: 'openai', model: 'gpt-5', label: 'openai / gpt-5', efforts: [] },
    ])
  })

  it('unwraps the host remote result envelope around the catalog', () => {
    const wrapped = { ok: true, value: CATALOG }
    expect(parseModelMenuChoices(wrapped)).toEqual(parseModelMenuChoices(CATALOG))
    expect(parseModelMenuChoices({ ok: false, error: { code: 'X', message: 'no' } })).toEqual([])
  })

  it('keeps a saved route selectable when the catalog does not list it', () => {
    const choices = parseModelMenuChoices(CATALOG, { provider: 'legacy', model: 'legacy-1' })
    expect(choices.at(-1)).toEqual({ provider: 'legacy', model: 'legacy-1', label: 'legacy / legacy-1', efforts: [] })
  })

  it('lists effort options and keeps the saved effort selectable', () => {
    const [chat] = parseModelMenuChoices(CATALOG)
    expect(modelMenuEffortOptions(chat)).toEqual([{ id: 'off', name: '关闭' }, { id: 'high', name: '高' }])
    expect(modelMenuEffortOptions(chat, 'max')).toEqual([
      { id: 'off', name: '关闭' }, { id: 'high', name: '高' }, { id: 'max', name: 'max' },
    ])
    expect(modelMenuEffortOptions(undefined, 'low')).toEqual([{ id: 'low', name: 'low' }])
  })

  it('builds a known-model predicate from choices', () => {
    const known = knownModelFromChoices(parseModelMenuChoices(CATALOG))
    expect(known({ provider: 'deepseek', model: 'deepseek-chat' })).toBe(true)
    expect(known({ provider: 'deepseek', model: 'ghost' })).toBe(false)
  })
})
