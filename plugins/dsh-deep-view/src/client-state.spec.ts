import { describe, expect, it } from 'vitest'
import { createViewStateStore } from './client-state.ts'

const pending = (id: string) => ({ id, sessionId: 's', callId: id, title: id, view: { type: 'confirm' as const, id: 'confirm' }, interactive: true, revision: 1 })

describe('pending card identity', () => {
  it('keeps only the latest host-valid pending card per session', () => {
    const store = createViewStateStore()
    store.setPending(pending('one'))
    store.setPending(pending('two'))
    expect(store.pending('s')).toEqual([pending('two')])
    store.clearPending('s', 'two')
    expect(store.pending('s')).toEqual([])
  })
  it('scopes pending to the owning session', () => {
    const store = createViewStateStore()
    store.setPending({ ...pending('one'), sessionId: 'other' })
    expect(store.pending('s')).toEqual([])
    expect(store.pending('other')).toHaveLength(1)
  })
  it('keeps values across surfaces and sessions without mutating snapshots', () => {
    const store = createViewStateStore()
    store.setSnapshot({ ...pending('v'), title: 'One', revision: 1, originCallId: 'one' })
    store.setValues('s', 'v', { amount: 3 })
    store.setSnapshot({ ...pending('v'), title: 'Two', revision: 2, originCallId: 'two' })
    expect(store.latest('s', 'v')).toMatchObject({ title: 'Two', revision: 2, originCallId: 'one' })
    expect(store.values('s', 'v')).toEqual({ amount: 3 })
    store.setValues('other', 'v', { amount: 9 })
    expect(store.values('s', 'v')).toEqual({ amount: 3 })
    expect(store.latest('other', 'v')).toBeUndefined()
  })
})
