import { describe, expect, it } from 'vitest'
import { createViewStateStore } from './client-state.ts'

const pending = (id: string) => ({ id, sessionId: 's', callId: id, title: id, view: { type: 'confirm' as const, id: 'confirm' }, interactive: true, revision: 1 })
const settled = (id: string, sessionId = 's', revision = 1) => ({
  id,
  sessionId,
  callId: `call-${id}`,
  originCallId: `call-${id}`,
  title: `View ${id}`,
  view: { type: 'metric' as const, label: 'L', value: revision },
  interactive: false,
  revision,
})

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

describe('settled view LRU eviction', () => {
  it('evicts the least-recently-used settled snapshots and bindings once capacity is exceeded', () => {
    const store = createViewStateStore(undefined, { maxSettledViews: 3 })
    store.setSnapshot(settled('v1'))
    store.setValues('s', 'v1', { x: 1 })
    store.setSnapshot(settled('v2'))
    store.setValues('s', 'v2', { x: 2 })
    store.setSnapshot(settled('v3'))
    store.setValues('s', 'v3', { x: 3 })

    // Touch v1 so v2 becomes the oldest settled entry.
    expect(store.latest('s', 'v1')?.id).toBe('v1')

    store.setSnapshot(settled('v4'))
    store.setValues('s', 'v4', { x: 4 })

    expect(store.latest('s', 'v2')).toBeUndefined()
    expect(store.values('s', 'v2')).toBeUndefined()
    expect(store.latest('s', 'v1')?.id).toBe('v1')
    expect(store.values('s', 'v1')).toEqual({ x: 1 })
    expect(store.latest('s', 'v3')?.id).toBe('v3')
    expect(store.latest('s', 'v4')?.id).toBe('v4')
  })

  it('never evicts entries with active key subscribers or open pending state', () => {
    const store = createViewStateStore(undefined, { maxSettledViews: 2 })
    store.setSnapshot(settled('sub'))
    store.setValues('s', 'sub', { pinned: true })
    const unsubscribe = store.subscribeKey('s:sub', () => {})

    store.setPending(pending('pend'))
    store.setSnapshot({ ...pending('pend'), originCallId: 'pend' })
    store.setValues('s', 'pend', { waiting: true })

    store.setSnapshot(settled('s1'))
    store.setSnapshot(settled('s2'))
    store.setSnapshot(settled('s3'))

    // Both subscribed ('sub') and pending ('pend') survive, while 's1' is evicted.
    expect(store.latest('s', 'sub')?.id).toBe('sub')
    expect(store.values('s', 'sub')).toEqual({ pinned: true })
    expect(store.latest('s', 'pend')?.id).toBe('pend')
    expect(store.values('s', 'pend')).toEqual({ waiting: true })
    expect(store.latest('s', 's1')).toBeUndefined()
    expect(store.latest('s', 's2')?.id).toBe('s2')
    expect(store.latest('s', 's3')?.id).toBe('s3')

    // Releasing the subscriber and clearing pending makes those old entries eligible on later writes.
    unsubscribe()
    store.clearPending('s', 'pend')
    store.setSnapshot(settled('s4'))
    store.setSnapshot(settled('s5'))
    expect(store.latest('s', 'sub')).toBeUndefined()
    expect(store.latest('s', 'pend')).toBeUndefined()
    expect(store.latest('s', 's4')?.id).toBe('s4')
    expect(store.latest('s', 's5')?.id).toBe('s5')
  })
})
