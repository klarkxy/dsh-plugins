import { describe, expect, it } from 'vitest'
import { groupModelMenuChoices, modelMenuEffortLabel, modelMenuShortName } from './menu.ts'
import { parseModelMenuChoices } from './catalog.ts'

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

describe('model menu grouping', () => {
  it('translates standard effort ids without rewriting provider names or unknown ids', () => {
    expect(modelMenuEffortLabel({ id: 'high', name: 'high' }, 'zh-CN')).toBe('高')
    expect(modelMenuEffortLabel({ id: 'high', name: 'high' }, 'en-US')).toBe('High')
    expect(modelMenuEffortLabel({ id: 'high', name: 'Provider custom name' }, 'zh')).toBe('Provider custom name')
    expect(modelMenuEffortLabel({ id: 'custom', name: 'custom' }, 'zh')).toBe('custom')
  })
  it('groups catalog choices by provider with display names and short model labels', () => {
    const choices = parseModelMenuChoices(CATALOG)
    const groups = groupModelMenuChoices(choices, '')
    expect(groups.map(group => [group.provider, group.name, group.items.length])).toEqual([
      ['deepseek', 'DeepSeek', 2],
      ['openai', 'openai', 1],
    ])
    expect(groups[0]!.items.map(modelMenuShortName)).toEqual(['Chat', 'Reasoner'])
    expect(modelMenuShortName(groups[1]!.items[0]!)).toEqual('gpt-5')
  })

  it('filters groups by a case-insensitive query across label, model and provider', () => {
    const choices = parseModelMenuChoices(CATALOG)
    expect(groupModelMenuChoices(choices, '  reasoner ').map(group => group.provider)).toEqual(['deepseek'])
    expect(groupModelMenuChoices(choices, 'OPENAI').map(group => group.provider)).toEqual(['openai'])
    expect(groupModelMenuChoices(choices, 'chat').flatMap(group => group.items.map(item => item.model))).toEqual(['deepseek-chat'])
    expect(groupModelMenuChoices(choices, 'nothing-matches')).toEqual([])
  })

  it('matches a provider display name that differs from its id, case-insensitively', () => {
    // The label intentionally omits the display name, isolating the providerLabel channel.
    const labelled = [{ provider: 'p-id', model: 'm1', label: 'm1', providerLabel: 'Acme Cloud', efforts: [] }]
    expect(groupModelMenuChoices(labelled, 'acme')).toHaveLength(1)
    expect(groupModelMenuChoices(labelled, 'ACME CLOUD')).toHaveLength(1)
    expect(groupModelMenuChoices(labelled, 'p-id')).toHaveLength(1)
    expect(groupModelMenuChoices(labelled, 'unrelated')).toEqual([])
    // The group heading prefers providerLabel over the id.
    expect(groupModelMenuChoices(labelled, '')[0]!.name).toBe('Acme Cloud')
  })
})
