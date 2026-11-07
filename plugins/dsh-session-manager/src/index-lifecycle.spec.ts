import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PresenceDomainHandle } from './presence-settings.ts'
import type { PresenceModelStore } from './config-editor.ts'
import type { PresenceModelHost } from './welcome-back.ts'

const rpc = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock('./tools.ts', () => ({ registerSessionTools: () => () => {} }))
vi.mock('./rpc.ts', () => ({ registerSessionManagerRpc: (...args: unknown[]) => { rpc.capture(...args); return () => {} } }))
import { apply } from './index.ts'

const roots: Array<{ ctx: Context; disposers: Array<() => unknown> }> = []
afterEach(async () => {
  for (const fixture of roots.splice(0)) {
    for (const dispose of fixture.disposers.splice(0).reverse()) await dispose()
    await fixture.ctx.fiber.dispose()
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

function domain() {
  const get = vi.fn(() => ({ revision: 0, model: null }))
  const put = vi.fn(async () => {})
  const close = vi.fn(async () => {})
  return { table: () => ({ get, put, entries: () => [['current', get()]][Symbol.iterator]() }), close, put, get }
}

function fixture(failRegistration = false) {
  let mount!: (scope: unknown) => void
  let auxMount!: (scope: unknown) => void
  const disposers: Array<() => unknown> = []
  const ctx = Object.assign(new Context(), {
    effect: (fn: () => unknown) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
    on: (name: string) => { if (failRegistration && name === 'model-settings/collect') throw new Error('registration failed'); return () => {} },
    inject(services: string[], callback: (scope: unknown) => void) {
      // Two injects declare storageDomain: the shared auxiliary owner
      // (storageDomain+webServer+connection) and the plugin settings store.
      if (services.includes('storageDomain') && services.includes('webServer')) auxMount = callback
      else if (services.includes('storageDomain')) mount = callback
      else callback({ effect: (fn: () => unknown) => fn() })
    },
  })
  roots.push({ ctx, disposers })
  apply(ctx as never)
  const args = rpc.capture.mock.calls.at(-1)!
  const models = args[3] as () => PresenceModelHost
  const store = args[4] as () => PresenceModelStore | undefined
  return {
    models, store,
    mount(open: Promise<PresenceDomainHandle>) {
      let dispose!: () => Promise<void>
      mount({
        storageDomain: { open: () => open },
        effect(fn: () => () => Promise<void>) { dispose = fn() },
      })
      return () => dispose()
    },
    /**
     * Mounts the shared auxiliary inject: the inner ctx's root carries the
     * service rendezvous retainAuxiliaryModel uses, and opening the shared
     * domain can be driven to fail. The open is lazy so a rejection is always
     * created with its consumer already attached.
     */
    mountAux(open: () => Promise<unknown>) {
      const services = new Map<string, unknown>([
        ['storageDomain', { open }],
        ['webServer', {}],
        ['connection', {}],
      ])
      const root = {
        get: (name: string) => services.get(name),
        provide: (name: string, value: unknown) => { services.set(name, value); return () => services.delete(name) },
        inject(_deps: readonly string[], callback: (scope: unknown) => void) {
          callback({
            storageDomain: services.get('storageDomain'),
            effect: (fn: () => unknown) => fn(),
          })
          return { dispose: async () => {}, then: (resolve: (value: unknown) => void) => resolve(undefined) }
        },
      }
      auxMount({ root, effect: (fn: () => unknown) => fn() })
    },
  }
}

const tick = async () => { for (let i = 0; i < 15; ++i) await Promise.resolve() }

describe('presence domain mount lifecycle', () => {
  it('awaits a pending open on unload, closes its late handle and never publishes it', async () => {
    const f = fixture()
    const open = deferred<PresenceDomainHandle>()
    const dispose = f.mount(open.promise)
    let cleaned = false
    const cleanup = dispose().then(() => { cleaned = true })
    await tick()
    expect(cleaned).toBe(false)
    const late = domain()
    open.resolve(late)
    await cleanup
    expect(late.close).toHaveBeenCalledTimes(1)
    expect(f.store()).toBeUndefined()
  })

  it('prevents an old open or old cleanup from overwriting a newer mount', async () => {
    const f = fixture()
    const slow = deferred<PresenceDomainHandle>()
    const disposeOld = f.mount(slow.promise)
    const newer = domain()
    const disposeNew = f.mount(Promise.resolve(newer))
    await tick()
    const current = f.store()
    expect(current).toBeDefined()
    const late = domain()
    slow.resolve(late)
    await tick()
    expect(f.store()).toBe(current)
    expect(late.close).toHaveBeenCalledTimes(1)
    await disposeOld()
    expect(f.store()).toBe(current)
    await disposeNew()
    expect(f.store()).toBeUndefined()
    expect(newer.close).toHaveBeenCalledTimes(1)
  })

  it.each(['constructor', 'registration'])('closes the handle after %s failure', async failure => {
    const f = fixture(failure === 'registration')
    const opened = domain()
    if (failure === 'constructor') {
      opened.table = () => ({
        get: () => { throw new Error('bad handle') },
        put: opened.put,
        entries: () => [['current', {}]][Symbol.iterator](),
      })
    }
    const dispose = f.mount(Promise.resolve(opened))
    await tick()
    expect(f.store()).toBeUndefined()
    expect(opened.close).toHaveBeenCalledTimes(1)
    await dispose()
    expect(opened.close).toHaveBeenCalledTimes(1)
  })

  it('captures the original store and owner cancellation for an in-flight suggestion', async () => {
    const f = fixture()
    const old = domain()
    const disposeOld = f.mount(Promise.resolve(old))
    await tick()
    const captured = f.models()
    const next = domain()
    const disposeNew = f.mount(Promise.resolve(next))
    await tick()
    await disposeOld()
    expect(captured.signal.aborted).toBe(true)
    await expect(captured.rememberSuggestion!('s', 5, 'old', 'k', captured.signal)).rejects.toThrow(/unloaded/)
    expect(next.put).not.toHaveBeenCalled()
    expect(f.store()).toBeDefined()
    await disposeNew()
  })

  it('marks a failed shared auxiliary mount instead of silently falling back', async () => {
    const f = fixture()
    // The rejection is created inside open(): it is awaited by the mount path
    // in the same turn, so nothing is transiently unhandled.
    f.mountAux(() => Promise.reject(new Error('auxiliary domain corrupt')))
    // The init failure surfaces through captured model state: features without
    // an explicit route degrade rather than billing the conversation model.
    await vi.waitFor(() => expect(f.models().auxBroken).toBe(true))
  })
})
