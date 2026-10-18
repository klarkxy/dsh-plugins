import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { createModelSettingsChanges, watchModelSettingsChanges } from './changes.ts'

function events() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  return {
    on(name: string, callback: (...args: any[]) => void) {
      const set = listeners.get(name) ?? new Set()
      listeners.set(name, set)
      set.add(callback)
      return () => { set.delete(callback) }
    },
    emit(name: string, ...args: unknown[]) { for (const listener of listeners.get(name) ?? []) listener(...args) },
    count() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0) },
  }
}
describe('host model settings invalidation service', () => {
  it('attaches before ready, retains changes during reads, coalesces and cleans up', async () => {
    const bus = events(), abort = new AbortController()
    const iterator = watchModelSettingsChanges(bus, abort.signal)
    expect((await iterator.next()).value).toEqual({ kind: 'ready' })
    expect(bus.count()).toBe(2)
    bus.emit('model-settings/changed', { ns: 'owner', revision: 1 })
    bus.emit('model-settings/changed', { ns: 'owner', revision: 2 })
    bus.emit('settings/document-updated', 'native', 3)
    expect((await iterator.next()).value).toEqual({ kind: 'changed', ns: 'owner', revision: 2 })
    expect((await iterator.next()).value).toEqual({ kind: 'changed', ns: 'native', revision: 3 })
    const waiting = iterator.next()
    abort.abort(new Error('request closed'))
    await expect(waiting).rejects.toThrow('request closed')
    expect(bus.count()).toBe(0)
  })

  it('bounds a slow consumer queue and invalidates everything on overflow', async () => {
    const bus = events(), abort = new AbortController()
    const iterator = watchModelSettingsChanges(bus, abort.signal)
    await iterator.next()
    for (let i = 0; i < 300; i++) bus.emit('settings/document-updated', `owner-${i}`, i)
    expect((await iterator.next()).value).toEqual({ kind: 'ready' })
    bus.emit('model-settings/changed', { ns: 'owner', revision: 301 })
    expect((await iterator.next()).value).toEqual({ kind: 'changed', ns: 'owner', revision: 301 })
    await iterator.return()
    expect(bus.count()).toBe(0)
  })

  it('releases event listeners when cancelled while paused at ready', async () => {
    const bus = events(), abort = new AbortController()
    const iterator = watchModelSettingsChanges(bus, abort.signal)
    await iterator.next()
    abort.abort(new Error('paused cancellation'))
    expect(bus.count()).toBe(0)
    await expect(iterator.next()).rejects.toThrow('paused cancellation')
  })

  it('owns every request through actual Cordis disposal and refuses post-unload work', async () => {
    const ctx = new Context()
    const service = createModelSettingsChanges(ctx, modelSettingsChangesIdentity('@klarkxy/dsh-model-hub'))
    const first = service.watch(new AbortController().signal)[Symbol.asyncIterator]()
    await first.next()
    const waiting = first.next()
    const failure = expect(waiting).rejects.toThrow('owner unloaded')
    await ctx.fiber.dispose()
    await failure
    const after = service.watch(new AbortController().signal)[Symbol.asyncIterator]()
    await expect(after.next()).rejects.toThrow('owner unloaded')
  })

  it('drops another owner before the frame reaches a feature plugin stream', async () => {
    const bus = events(), abort = new AbortController()
    const iterator = watchModelSettingsChanges(bus, abort.signal, '@klarkxy/dsh-git-commit')
    await iterator.next()
    bus.emit('model-settings/changed', { ns: '@klarkxy/dsh-current-title', revision: 4 })
    bus.emit('settings/document-updated', '@klarkxy/dsh-git-commit', 5)
    expect((await iterator.next()).value).toEqual({ kind: 'changed', ns: '@klarkxy/dsh-git-commit', revision: 5 })
    await iterator.return()
  })

  it('removes the first listener if attaching the second fails', async () => {
    const off = vi.fn()
    const iterator = watchModelSettingsChanges({ on: vi.fn().mockReturnValueOnce(off).mockImplementationOnce(() => { throw new Error('attach failed') }) }, new AbortController().signal)
    await expect(iterator.next()).rejects.toThrow('attach failed')
    expect(off).toHaveBeenCalledTimes(1)
  })
})
