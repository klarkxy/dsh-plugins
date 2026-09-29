import { describe, expect, it } from 'vitest'
import {
  modelMenuChoiceKey, modelMenuEffortOptions, modelMenuOverride, normalizeModelMenuRoute,
  parseModelMenuChoiceKey, parseModelMenuChoices,
  type ModelMenuRoute,
} from './model-menu.ts'

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

const bound: ModelMenuRoute = { provider: '', model: '' }

describe('plugin-page model menu', () => {
  it('flattens the session catalog into provider / model choices', () => {
    expect(parseModelMenuChoices(CATALOG)).toEqual([
      { provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek / Chat', efforts: [{ id: 'off', name: '关闭' }, { id: 'high', name: '高' }] },
      { provider: 'deepseek', model: 'deepseek-reasoner', label: 'DeepSeek / Reasoner', efforts: [] },
      { provider: 'openai', model: 'gpt-5', label: 'openai / gpt-5', efforts: [] },
    ])
  })

  it('keeps a saved route selectable when the catalog does not list it', () => {
    const choices = parseModelMenuChoices(CATALOG, { provider: 'legacy', model: 'legacy-1' })
    expect(choices.at(-1)).toEqual({ provider: 'legacy', model: 'legacy-1', label: 'legacy / legacy-1', efforts: [] })
  })

  it('round-trips the internal choice key without losing either part', () => {
    const key = modelMenuChoiceKey('deepseek', 'deepseek-chat')
    expect(key).toContain('deepseek')
    expect(key).toContain('deepseek-chat')
    expect(parseModelMenuChoiceKey(key)).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(parseModelMenuChoiceKey('')).toBeUndefined()
    expect(parseModelMenuChoiceKey('nokey')).toBeUndefined()
  })

  it('returns no route for an empty saved selection so the host default applies', () => {
    expect(modelMenuOverride(bound)).toBeUndefined()
    expect(modelMenuOverride(undefined)).toBeUndefined()
    expect(modelMenuOverride({ provider: 'deepseek', model: '' })).toBeUndefined()
    expect(modelMenuOverride({ provider: '', model: 'deepseek-chat' })).toBeUndefined()
  })

  it('builds a model route with and without reasoning effort', () => {
    expect(modelMenuOverride({ provider: 'deepseek', model: 'deepseek-chat' }))
      .toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(modelMenuOverride({ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }))
      .toEqual({ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' })
  })

  it('normalizes untrusted stored routes and keeps a valid effort', () => {
    expect(normalizeModelMenuRoute(undefined)).toEqual(bound)
    expect(normalizeModelMenuRoute({ provider: 'p', model: 'm' })).toEqual({ provider: 'p', model: 'm' })
    expect(normalizeModelMenuRoute({ provider: 'p', model: 'm', reasoningEffort: 'high' }))
      .toEqual({ provider: 'p', model: 'm', reasoningEffort: 'high' })
    expect(normalizeModelMenuRoute({ provider: '', model: 'm' })).toEqual(bound)
    expect(normalizeModelMenuRoute({ provider: 'p', model: '' })).toEqual(bound)
    expect(normalizeModelMenuRoute({ provider: `p${'x'.repeat(260)}`, model: 'm' })).toEqual(bound)
    expect(normalizeModelMenuRoute({ provider: 'p', model: 'm', reasoningEffort: 'x'.repeat(90) }))
      .toEqual({ provider: 'p', model: 'm' })
    expect(normalizeModelMenuRoute('nope')).toEqual(bound)
  })

  it('lists advertised efforts and keeps an unlisted saved effort selectable', () => {
    const choices = parseModelMenuChoices(CATALOG)
    const chat = choices.find(item => item.model === 'deepseek-chat')
    expect(modelMenuEffortOptions(chat)).toEqual([{ id: 'off', name: '关闭' }, { id: 'high', name: '高' }])
    expect(modelMenuEffortOptions(chat, 'medium')).toEqual([
      { id: 'off', name: '关闭' }, { id: 'high', name: '高' }, { id: 'medium', name: 'medium' },
    ])
    expect(modelMenuEffortOptions(undefined)).toEqual([])
  })
})
