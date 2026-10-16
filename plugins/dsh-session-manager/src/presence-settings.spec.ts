import { describe, expect, it, vi } from 'vitest'
import { PresenceSettingsStore } from './presence-settings.ts'
import type { PresenceSettings } from './storage.ts'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture(initial?: PresenceSettings) {
  let durable = initial
  const gate = deferred()
  const close = vi.fn(async () => {})
  const put = vi.fn(async (_key: string, row: PresenceSettings) => {
    if (put.mock.calls.length === 1) await gate.promise
    durable = row
  })
  const store = new PresenceSettingsStore({ table: () => ({ entries: () => [][Symbol.iterator](), get: () => durable, put: put as never }), close })
  return { store, put, gate, close, durable: () => durable }
}

describe('presence settings write ownership', () => {
  it('merges deferred concurrent routes and suggestions against the latest row with increasing revisions', async () => {
    const f = fixture()
    const first = f.store.write({ provider: 'p', model: 'recap', reasoningEffort: 'high' })
    const second = f.store.rememberSuggestion('a', 5, 'first')
    const third = f.store.writeGhost({ provider: 'p', model: 'ghost' })
    const fourth = f.store.rememberSuggestion('b', 7, null)
    const fifth = f.store.rememberSuggestion('a', 9, 'latest')
    await Promise.resolve()
    expect(f.put).toHaveBeenCalledTimes(1)
    expect(f.store.read().revision).toBe(0)
    f.gate.resolve()
    await Promise.all([first, second, third, fourth, fifth])
    expect(f.put.mock.calls.map(([, row]) => row.revision)).toEqual([1, 2, 3, 4, 5])
    expect(f.store.read()).toEqual(f.durable())
    expect(f.durable()).toEqual({
      revision: 5,
      model: { provider: 'p', model: 'recap', reasoningEffort: 'high' },
      ghostModel: { provider: 'p', model: 'ghost' },
      suggestions: { a: { seq: 9, text: 'latest' }, b: { seq: 7, text: null } },
    })
  })

  it('performs CAS and cancellation at execution time and keeps the queue usable after failure', async () => {
    const f = fixture()
    const first = f.store.write(null, { expectedRevision: 0 })
    const stale = f.store.writeGhost(null, { expectedRevision: 0 })
    const staleCheck = expect(stale).rejects.toThrow(/changed/)
    const cancelled = new AbortController()
    const skipped = f.store.rememberSuggestion('cancelled', 1, null, cancelled.signal)
    const skipCheck = expect(skipped).rejects.toMatchObject({ name: 'AbortError' })
    cancelled.abort()
    f.gate.resolve()
    await first
    await Promise.all([staleCheck, skipCheck])
    expect(f.put).toHaveBeenCalledTimes(1)
    expect(await f.store.writeGhost(null, { expectedRevision: 1 })).toBe(2)

    const failed = fixture()
    const write = failed.store.write({ provider: 'p', model: 'lost' })
    const check = expect(write).rejects.toThrow('disk failed')
    failed.gate.reject(new Error('disk failed'))
    await check
    expect(failed.store.read().revision).toBe(0)
    expect(failed.durable()).toBeUndefined()
    expect(await failed.store.writeGhost({ provider: 'p', model: 'saved' })).toBe(1)
    expect(failed.store.read()).toMatchObject({ revision: 1, model: null, ghostModel: { model: 'saved' } })
  })

  it('rejects queued/new work on close, drains an admitted put and closes exactly once', async () => {
    const f = fixture()
    const abort = new AbortController()
    const first = f.store.write({ provider: 'p', model: 'committed' }, { signal: abort.signal })
    const queued = f.store.writeGhost(null)
    const queuedCheck = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    const closing = f.store.close()
    expect(f.store.close()).toBe(closing)
    abort.abort()
    await expect(f.store.write(null)).rejects.toThrow(/unloaded/)
    expect(f.close).not.toHaveBeenCalled()
    f.gate.resolve()
    expect(await first).toBe(1)
    await queuedCheck
    await closing
    expect(f.close).toHaveBeenCalledTimes(1)
    expect(f.put).toHaveBeenCalledTimes(1)
    expect(f.durable()).toMatchObject({ revision: 1, model: { model: 'committed' } })
  })

  it('evicts against the queue-time suggestions without dropping concurrent additions', async () => {
    const suggestions = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`s${i}`, { seq: i, text: null }]))
    const f = fixture({ revision: 8, model: null, ghostModel: null, suggestions })
    const first = f.store.rememberSuggestion('a', 201, 'a')
    const second = f.store.rememberSuggestion('b', 202, 'b')
    f.gate.resolve()
    await Promise.all([first, second])
    expect(Object.keys(f.store.read().suggestions)).toHaveLength(200)
    expect(f.store.suggestion('s0')).toBeUndefined()
    expect(f.store.suggestion('s1')).toBeUndefined()
    expect(f.store.suggestion('a')?.text).toBe('a')
    expect(f.store.suggestion('b')?.text).toBe('b')
  })
})
