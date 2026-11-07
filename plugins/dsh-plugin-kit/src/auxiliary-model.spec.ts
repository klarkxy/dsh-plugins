import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { MODEL_SETTINGS_EVENT, type ModelSettingsProvider } from './model-settings.ts'
import {
  AUXILIARY_MODEL_NS, AUXILIARY_MODEL_SERVICE, getAuxiliaryModel,
} from './contracts.ts'
import { retainAuxiliaryModel } from './auxiliary-model.ts'

interface FakeDomain {
  table(name: string): { get(key: string): unknown; put(key: string, value: unknown): Promise<void> }
  close(): Promise<void>
}

/** In-memory shared store honoring the spec's zod schema on reads. */
function fakeStorage() {
  const rows = new Map<string, unknown>()
  const opens: FakeDomain[] = []
  const storageDomain = {
    open: vi.fn(async (spec: { tables?: Record<string, { valueSchema?: { safeParse(v: unknown): { success: boolean } } }> }): Promise<FakeDomain> => {
      const schema = spec.tables?.settings?.valueSchema
      const domain: FakeDomain = {
        table: () => ({
          get(key) {
            const row = rows.get(key)
            if (row !== undefined && schema && !schema.safeParse(row).success) throw new Error('invalid-record')
            return row
          },
          put: async (key, value) => {
            if (schema && !schema.safeParse(value).success) throw new Error('invalid-record')
            rows.set(key, value)
          },
        }),
        close: vi.fn(async () => {}) as never,
      }
      opens.push(domain)
      return domain
    }),
  }
  return { storageDomain, rows, opens }
}

interface StubHost {
  storageDomain: ReturnType<typeof fakeStorage>['storageDomain']
  webServer: { register(): () => void }
  connection: { requestRejection(): undefined }
  remote: Record<string, unknown>
}

function host(storage = fakeStorage()): StubHost {
  return {
    storageDomain: storage.storageDomain,
    webServer: { register: vi.fn(() => vi.fn()) },
    connection: { requestRejection: vi.fn(() => undefined) },
    remote: {},
  }
}

function app(services: StubHost) {
  const ctx = new Context()
  for (const [name, impl] of Object.entries(services)) ctx.provide(name, impl)
  return ctx
}

/** One plugin fiber retaining the store, like a real plugin's apply(). */
async function participant(appCtx: Context) {
  let release: (() => Promise<void>) | undefined
  const fiber = appCtx.inject(['storageDomain', 'webServer', 'connection'], scope => {
    scope.effect(async () => {
      release = await retainAuxiliaryModel(scope)
      return () => release!()
    })
  })
  await fiber
  await vi.waitFor(() => { if (!release) throw new Error('waiting') })
  return { release: release!, fiber }
}

function sharedState(appCtx: Context) {
  return appCtx.root.get(AUXILIARY_MODEL_SERVICE, false) as { snapshot(): { revision: number; model: unknown }; users: number } | undefined
}

function auxProvider(appCtx: Context): ModelSettingsProvider | undefined {
  let provider: ModelSettingsProvider | undefined
  appCtx.emit(MODEL_SETTINGS_EVENT, (value: ModelSettingsProvider) => { if (value.ns === AUXILIARY_MODEL_NS) provider = value })
  return provider
}

describe('retainAuxiliaryModel', () => {
  it('has no default and returns undefined before any participant', async () => {
    const ctx = app(host())
    expect(getAuxiliaryModel(ctx)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('keeps one shared owner while several participants retain', async () => {
    const ctx = app(host())
    const a = await participant(ctx)
    const b = await participant(ctx)
    expect(sharedState(ctx)?.users).toBe(2)
    const releaseA = a.release
    await releaseA()
    expect(sharedState(ctx)?.users).toBe(1)
    await b.release()
    await vi.waitFor(() => { if (ctx.root.get(AUXILIARY_MODEL_SERVICE, false) !== undefined) throw new Error('still provided') })
    await ctx.fiber.dispose()
  })

  it('retains against real traceable services: every ctx read hands out a fresh proxy', async () => {
    // Regression: Cordis wraps every Service impl in a NEW proxy per property
    // read (getTraceable + symbols.tracker), so a dep-swap check that compares
    // proxy identities always reports a fake swap and the open aborts with
    // 'Auxiliary model store released during open'. Real hosts only provide
    // Service subclasses; the fix compares raw Impl.value in fiber.store.
    const rows = new Map<string, unknown>()
    class StorageDomain extends Service {
      async open() {
        return {
          table: () => ({ get: (key: string) => rows.get(key), put: async (key: string, value: unknown) => { rows.set(key, value) } }),
          async close() {},
        }
      }
    }
    class WebServer extends Service {
      register() { return () => {} }
    }
    class Connection extends Service {
      requestRejection() { return undefined }
    }
    const ctx = new Context()
    new StorageDomain(ctx as never, 'storageDomain')
    new WebServer(ctx as never, 'webServer')
    new Connection(ctx as never, 'connection')
    // The bug's precondition: two reads of the same service are never identical.
    expect((ctx as { storageDomain: unknown }).storageDomain).not.toBe((ctx as { storageDomain: unknown }).storageDomain)
    const release = await retainAuxiliaryModel(ctx)
    const provider = auxProvider(ctx)!
    await provider.write(['model'], { provider: 'p', model: 'm' }, 0, new AbortController().signal)
    expect(getAuxiliaryModel(ctx)).toEqual({ provider: 'p', model: 'm' })
    await release()
    await ctx.fiber.dispose()
  })

  it('reopens cleanly after the last release and preserves the stored default', async () => {
    const storage = fakeStorage()
    const ctx = app(host(storage))
    const first = await participant(ctx)
    const provider = auxProvider(ctx)!
    await provider.write(['model'], { provider: 'p', model: 'm' }, 0, new AbortController().signal)
    await first.release()
    await vi.waitFor(() => { if (storage.storageDomain.open.mock.calls.length < 1) throw new Error('wait') })
    const second = await participant(ctx)
    expect(getAuxiliaryModel(ctx)).toEqual({ provider: 'p', model: 'm' })
    await second.release()
    await ctx.fiber.dispose()
  })

  it('lets a single concurrent revision writer win', async () => {
    const ctx = app(host())
    const p = await participant(ctx)
    const provider = auxProvider(ctx)!
    const route = { provider: 'p', model: 'm' }
    const [a, b] = await Promise.allSettled([
      provider.write(['model'], route, 0, new AbortController().signal),
      provider.write(['model'], route, 0, new AbortController().signal),
    ])
    const ok = [a, b].filter(item => item.status === 'fulfilled')
    expect(ok).toHaveLength(1)
    expect(sharedState(ctx)?.snapshot().revision).toBe(1)
    await p.release()
    await ctx.fiber.dispose()
  })

  it('propagates an init failure to the retainer instead of falling back', async () => {
    const storage = fakeStorage()
    storage.storageDomain.open.mockRejectedValue(new Error('disk gone'))
    const ctx = app(host(storage))
    const errors: unknown[] = []
    const fiber = ctx.inject(['storageDomain', 'webServer', 'connection'], scope => {
      scope.effect(async () => {
        try { await retainAuxiliaryModel(scope) } catch (error) { errors.push(error) }
        return () => {}
      })
    })
    await fiber
    await vi.waitFor(() => { if (!errors.length) throw new Error('waiting') })
    expect(errors[0]).toBeInstanceOf(Error)
    expect((errors[0] as Error).message).toContain('disk gone')
    await ctx.fiber.dispose()
  })

  it('rethrows a sticky snapshot failure to readers', () => {
    const ctx = app(host())
    ctx.root.provide(AUXILIARY_MODEL_SERVICE, { snapshot() { throw new Error('storage corrupted') } })
    expect(() => getAuxiliaryModel(ctx)).toThrow('storage corrupted')
    ctx.fiber.dispose()
  })

  it('rejects a stored blank identifier instead of normalizing to no default', async () => {
    const storage = fakeStorage()
    storage.rows.set('defaults', { revision: 1, model: { provider: '   ', model: 'm' } })
    const ctx = app(host(storage))
    const errors: unknown[] = []
    ctx.inject(['storageDomain', 'webServer', 'connection'], scope => {
      scope.effect(async () => {
        try { await retainAuxiliaryModel(scope) } catch (error) { errors.push(error) }
        return () => {}
      })
    })
    await vi.waitFor(() => { if (!errors.length) throw new Error('waiting') })
    expect((errors[0] as Error).message).toBe('invalid-record')
    await ctx.fiber.dispose()
  })

  it('fails fast when required services are missing, on every retain', async () => {
    const ctx = new Context()
    ctx.provide('storageDomain', fakeStorage().storageDomain)
    await expect(retainAuxiliaryModel(ctx)).rejects.toThrow(/webServer|connection/)
    await expect(retainAuxiliaryModel(ctx)).rejects.toThrow(/webServer|connection/)
    expect(ctx.root.get(AUXILIARY_MODEL_SERVICE, false)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('accepts a blank route as clearing the default and rejects partial routes', async () => {
    const ctx = app(host())
    const p = await participant(ctx)
    const provider = auxProvider(ctx)!
    await expect(provider.write(['model'], { provider: 'p', model: '' }, 0, new AbortController().signal)).rejects.toThrow('Invalid model route')
    await provider.write(['model'], { provider: 'p', model: 'm' }, 0, new AbortController().signal)
    const cleared = await provider.write(['model'], { provider: '', model: '' }, 1, new AbortController().signal) as { model: null; revision: number }
    expect(cleared.revision).toBe(2)
    expect(cleared.model).toBeNull()
    expect(getAuxiliaryModel(ctx)).toBeUndefined()
    await p.release()
    await ctx.fiber.dispose()
  })

  it('fails fast on PENDING providers: no open, no fallback, retries succeed once active', async () => {
    const storage = fakeStorage()
    const ctx = new Context()
    ctx.provide('storageDomain', storage.storageDomain)
    // Provider fiber stays LOADING while gated: its impls exist but are PENDING.
    let releaseGate!: () => void
    const gate = new Promise<void>(resolve => { releaseGate = resolve })
    const providerFiber = ctx.inject([], scope => {
      scope.provide('webServer', { register: () => () => {} })
      scope.provide('connection', { requestRejection: () => undefined })
      return gate
    })
    await expect(retainAuxiliaryModel(ctx)).rejects.toThrow(/requires active|webServer|connection/)
    expect(storage.storageDomain.open).not.toHaveBeenCalled()
    expect(getAuxiliaryModel(ctx)).toBeUndefined()
    // Once the provider activates, a fresh retain succeeds.
    releaseGate()
    await providerFiber
    const release = await retainAuxiliaryModel(ctx)
    expect(storage.storageDomain.open).toHaveBeenCalledTimes(1)
    await release()
    await ctx.fiber.dispose()
  })

  it('goes unavailable while storageDomain remounts and never serves stale data', async () => {
    const ctx = new Context()
    ctx.provide('webServer', { register: () => () => {} })
    ctx.provide('connection', { requestRejection: () => undefined })
    const first = fakeStorage()
    const unprovide = ctx.provide('storageDomain', first.storageDomain)
    const release = await retainAuxiliaryModel(ctx)
    const provider = auxProvider(ctx)!
    await provider.write(['model'], { provider: 'p', model: 'm' }, 0, new AbortController().signal)
    expect(getAuxiliaryModel(ctx)).toEqual({ provider: 'p', model: 'm' })
    // Remount: reads must throw during the gap, not return the old default.
    await unprovide()
    await vi.waitFor(() => { try { getAuxiliaryModel(ctx); throw new Error('still readable') } catch (error) { if ((error as Error).message === 'still readable') throw error } })
    const second = fakeStorage()
    // Seed the NEW store with a different route: reading `p` after remount
    // would prove a stale read; `q` proves re-init actually read the new store.
    second.rows.set('defaults', { revision: 3, model: { provider: 'q', model: 'n' } })
    ctx.provide('storageDomain', second.storageDomain)
    await vi.waitFor(() => {
      try { if (getAuxiliaryModel(ctx)?.provider !== 'q') throw new Error('not ready') }
      catch (error) { if ((error as Error).message === 'not ready') throw error; throw new Error('not ready') }
    })
    expect(second.storageDomain.open).toHaveBeenCalled()
    await release()
    await ctx.fiber.dispose()
  })

  it('handles a deferred late-open race: stale init closes its domain, live scope keeps serving', async () => {
    const ctx = new Context()
    ctx.provide('webServer', { register: () => () => {} })
    ctx.provide('connection', { requestRejection: () => undefined })
    const events: string[] = []
    let releaseOpen!: () => void
    const openGate = new Promise<void>(resolve => { releaseOpen = () => { events.push('open1-resolved'); resolve() } })
    const first = { storageDomain: { open: async () => {
      events.push('open1-start')
      await openGate
      const domain = {
        table: () => ({ get: () => ({ revision: 9, model: { provider: 'OLD', model: 'old' } }), put: async () => {} }),
        close: async () => { events.push('domain1-closed') },
      }
      return domain
    } } }
    const unprovide = ctx.provide('storageDomain', first.storageDomain)
    const retaining = retainAuxiliaryModel(ctx)
    // A superseded-init rejection must not surface as an unhandled rejection
    // while the test is still asserting on the live scope.
    void retaining.catch(() => {})
    await vi.waitFor(() => { if (!ctx.root.get(AUXILIARY_MODEL_SERVICE, false)) throw new Error('no state') })
    await new Promise(resolve => setTimeout(resolve, 20)) // gen1's open() entered
    await unprovide(); events.push('unprovided')
    const second = { storageDomain: { open: async () => {
      events.push('open2-start')
      return {
        table: () => ({ get: () => ({ revision: 1, model: { provider: 'NEW', model: 'new' } }), put: async () => {} }),
        close: async () => { events.push('domain2-closed') },
      }
    } } }
    ctx.provide('storageDomain', second.storageDomain)
    // gen2 completes while gen1's open() is still deferred.
    await vi.waitFor(() => { try { if (getAuxiliaryModel(ctx)?.provider !== 'NEW') throw new Error('not NEW') } catch { throw new Error('not NEW') } })
    // Resolve gen1's deferred open: the superseded init closes its domain and
    // must never overwrite the live scope's data.
    releaseOpen()
    await vi.waitFor(() => { if (!events.includes('domain1-closed')) throw new Error('waiting domain1 close') })
    expect(getAuxiliaryModel(ctx)).toEqual({ provider: 'NEW', model: 'new' })
    expect(events.indexOf('domain1-closed')).toBeGreaterThan(events.indexOf('open1-resolved'))
    // The retainer bound to the superseded init rejects exactly once — event
    // loop is not trapped in a retry spin. A fresh retain then succeeds on
    // the live scope.
    await expect(retaining).rejects.toThrow()
    const again = await retainAuxiliaryModel(ctx)
    expect(getAuxiliaryModel(ctx)).toEqual({ provider: 'NEW', model: 'new' })
    await again()
    await ctx.fiber.dispose()
  })
})
