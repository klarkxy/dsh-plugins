import { describe, expect, it } from 'vitest'
import { knownModelFromChoices, modelMenuEffortOptions, parseModelMenuChoices } from './catalog.ts'

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
