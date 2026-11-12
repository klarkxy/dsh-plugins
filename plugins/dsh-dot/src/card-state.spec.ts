import { describe, expect, it } from 'vitest'
import { DotCards, cardAnswerText } from './card-state.ts'
import { DotStore, type DotDomainHandle } from './store.ts'

function domain() {
  const tables = new Map<string, Map<string, unknown>>()
  return { table(name: string) {
    const rows = tables.get(name) ?? new Map<string, unknown>(); tables.set(name, rows)
    return { entries: () => rows.entries(), get: (key: string) => rows.get(key), put: async (key: string, value: unknown) => { rows.set(key, structuredClone(value)) }, delete: async (key: string) => rows.delete(key) }
  }, close: async () => {} } as DotDomainHandle
}
const shown = { title: '选择环境', interactive: true, view: { type: 'options' as const, id: 'env', options: [{ label: '测试' }, { label: '生产' }] } }

describe('dot asynchronous cards', () => {
  it('keeps increasing numbers and old pending cards across restart and segment change', async () => {
    const db = domain()
    const store = new DotStore(db)
    await store.beginSegment({ sessionId: 'one', startedAt: 1, persona: '' })
    const cards = new DotCards(store)
    const first = await cards.present(shown, 'call1')
    expect(first.dotCard?.number).toBe(1)
    await store.beginSegment({ sessionId: 'two', startedAt: 2, persona: '' })
    expect(cards.pending('call1')?.expired).toBe(true)
    const reloaded = new DotStore(db)
    const next = await new DotCards(reloaded).present(shown, 'call2')
    expect(next.dotCard?.number).toBe(2)
    expect(reloaded.cards[0]?.expired).toBe(true)
    expect(reloaded.settings.taskPermission).toBe('workspace-write')
  })

  it('allows expired replies, validates answers, and settles once', async () => {
    const store = new DotStore(undefined)
    await store.beginSegment({ sessionId: 'one', startedAt: 1, persona: '' })
    const cards = new DotCards(store)
    const first = await cards.present(shown, 'call1')
    await store.expireCards()
    let text = ''
    await expect(cards.answer(first.viewId!, 'env', { selected: ['不存在'] }, async () => {})).rejects.toThrow()
    const record = cards.pending('call1')!
    await cards.answer(first.viewId!, 'env', { selected: ['测试'] }, async (card, answer) => { text = cardAnswerText(card, answer, true) })
    expect(text).toContain('[补答已过期卡片 #1「选择环境」]')
    expect(record.number).toBe(1)
    expect(cards.pending('call1')).toBeNull()
    await expect(cards.answer(first.viewId!, 'env', { selected: ['生产'] }, async () => {})).rejects.toThrow('already answered')
  })

  it('keeps a timely answer unexpired and prevents duplicate delivery after a checkpoint error', async () => {
    const store = new DotStore(undefined)
    await store.beginSegment({ sessionId: 'one', startedAt: 1, persona: '' })
    const cards = new DotCards(store)
    const first = await cards.present(shown, 'call1')
    let deliveries = 0
    const save = store.setCardAnswer.bind(store)
    store.setCardAnswer = async (id, answer) => { await save(id, answer); throw new Error('checkpoint unavailable') }
    await cards.answer(first.viewId!, 'env', { selected: ['测试'] }, async () => {
      deliveries++
      await store.expireCards(first.viewId)
    })
    expect(store.cards[0]?.expired).toBe(false)
    await expect(cards.answer(first.viewId!, 'env', { selected: ['测试'] }, async () => { deliveries++ })).rejects.toThrow('already answered')
    expect(deliveries).toBe(1)
  })

  it('does not allocate a number to display cards or lose a pending answer on failed delivery', async () => {
    const store = new DotStore(undefined)
    await store.beginSegment({ sessionId: 'one', startedAt: 1, persona: '' })
    const cards = new DotCards(store)
    await cards.present({ title: '完成', interactive: false, view: { type: 'text', text: '结果' } }, 'display')
    expect(store.cardSequence).toBe(0)
    const first = await cards.present(shown, 'call1')
    await expect(cards.answer(first.viewId!, 'env', { selected: ['测试'] }, async () => { throw new Error('offline') })).rejects.toThrow('offline')
    expect(cards.pending('call1')).not.toBeNull()
  })
})
