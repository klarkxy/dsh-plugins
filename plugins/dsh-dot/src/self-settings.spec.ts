import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './contracts.ts'
import { SelfSettings } from './self-settings.ts'
import { DotStore } from './store.ts'

function setup() {
  const store = new DotStore(undefined)
  const state = { agreements: '', writes: [] as string[] }
  const view = async () => ({
    agreements: { text: state.agreements, maxChars: 4000, canUndo: false },
    cognition: { text: '', maxChars: 4000, history: [] as Array<{ text: string; at: number }> },
  })
  const service = {
    store,
    knowledgeView: view,
    setAgreements: async (text: string) => { state.agreements = text; state.writes.push(text); return view() },
    settingsChanged: async () => {},
    serialSettings: async <T>(work: () => Promise<T>) => work(),
  }
  return { store, state, self: new SelfSettings(service as never) }
}

describe('Dorothy self settings', () => {
  it('defaults to unlocked and changes nothing until the human approves', async () => {
    const h = setup()
    expect(await h.self.read()).toContain('scope: all')
    const result = await h.self.propose({ field: 'scope', value: 'tracked', reason: 'only watch my tasks' })
    expect(result).toMatch(/setting-.*Nothing changed yet/)
    expect(h.store.settings.scope).toBe('all')
    const id = h.store.settingProposals[0]!.id
    expect(await h.self.decide(id, true)).toContain('scope is now tracked')
    expect(h.store.settings.scope).toBe('tracked')
    expect(h.store.settingProposals).toEqual([])
  })

  it('honours locks for proposals, existing requests and the agreements field', async () => {
    const h = setup()
    await h.store.setSettings({ ...DEFAULT_SETTINGS, locks: { scope: true, memory: true } })
    await expect(h.self.propose({ field: 'scope', value: 'tracked', reason: 'test' })).rejects.toThrow(/locked by the human/)
    await expect(h.self.propose({ field: 'locks', value: {}, reason: 'unlock' })).rejects.toThrow(/unknown setting/)
    await expect(h.self.propose({ field: 'memory', value: '- note', reason: 'test' })).rejects.toThrow(/locked by the human/)
  })

  it('keeps a stale proposal instead of overwriting a newer human edit', async () => {
    const h = setup()
    await h.self.propose({ field: 'policy', value: 'ask before push', reason: 'safer' })
    await h.store.setSettings({ ...DEFAULT_SETTINGS, policy: 'never push' })
    const id = h.store.settingProposals[0]!.id
    await expect(h.self.decide(id, true)).rejects.toMatchObject({ code: 'dot/proposal-stale' })
    expect(h.store.settings.policy).toBe('never push')
    expect(h.store.settingProposals).toHaveLength(1)
    expect(await h.self.decide(id, false)).toContain('no settings changed')
  })

  it('rewrites the agreements (the old memory field) only after approval', async () => {
    const h = setup()
    await h.self.propose({ field: 'memory', value: '- likes tea', reason: 'remember this' })
    expect(h.state.writes).toEqual([])
    await h.self.decide(h.store.settingProposals[0]!.id, true)
    expect(h.state.writes).toEqual(['- likes tea\n'])
  })

  it('refuses an old proposal after the human locks it, including the agreements field', async () => {
    const h = setup()
    await h.self.propose({ field: 'memory', value: '- old', reason: 'old' })
    await h.store.setSettings({ ...DEFAULT_SETTINGS, locks: { memory: true } })
    const id = h.store.settingProposals[0]!.id
    await expect(h.self.decide(id, true)).rejects.toThrow(/locked by the human/)
    expect(h.state.writes).toEqual([])
    expect(h.store.settingProposals).toHaveLength(1)
  })

  it('normalizes an agreements proposal so approval does not cause a spurious change', async () => {
    const h = setup()
    await h.self.propose({ field: 'memory', value: '- likes tea\r\n', reason: 'remember' })
    expect(h.store.settingProposals[0]!.after).toBe('- likes tea\n')
  })
})
