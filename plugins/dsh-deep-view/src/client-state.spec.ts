import { describe, expect, it } from 'vitest'
import { createViewStateStore } from './client-state.ts'

const pending = (id: string) => ({ id, sessionId: 's', callId: id, title: id, view: { type: 'confirm' as const, id: 'confirm' } })

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
})
