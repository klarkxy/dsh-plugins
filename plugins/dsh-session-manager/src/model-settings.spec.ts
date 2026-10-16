import { expect, it, vi } from 'vitest'
import type { ModelSettingsProvider } from '@klarkxy/dsh-plugin-kit/model-settings'
import type { ModelRoute } from '@klarkxy/dsh-model-route'
vi.mock('@klarkxy/dsh-plugin-kit/host-rpc', () => ({ registerHostRpc: () => () => {} }))
import { apply } from './index.ts'

const MODEL_EVENTS = {
  llm: {},
  agents: {},
  sessionProjections: {},
  agentDefaultModel: {},
  connection: {},
  webServer: {},
}

/**
 * Cordis inject() stand-in: each requested service list resolves to a child ctx
 * with the requested services plus effect(), and calls the callback eagerly.
 */
interface FakeCtx {
  parallel: ReturnType<typeof vi.fn>
  disposers: (() => unknown)[]
  storageDomain: { open(spec: unknown): Promise<unknown> }
  tools: { register(): () => void }
  sessionQuery: Record<string, never>
  effect(fn: () => (() => unknown) | void): void
  inject(services: string[], callback: (child: FakeCtx) => unknown): () => void
  on(event: string, callback: (arg: unknown) => void): () => void
  provide(): void
  modelSettingsCollect(emit: (provider: ModelSettingsProvider) => void): void
}

function makeCtx(rowRef: { row: unknown }): FakeCtx {
  const parallel = vi.fn((_event: string, _payload: unknown) => Promise.resolve())
  const disposers: (() => unknown)[] = []
  const inner = (services: Record<string, unknown>) => ({
    ...services,
    // registerSessionManagerRpc requires a profile dir and sessionQuery up front.
    get: (name: string) => name === 'profileContext' ? { dir: 'fixture' } : services[name],
    effect(fn: () => (() => unknown) | void) {
      const dispose = fn()
      if (dispose) disposers.push(dispose)
    },
  })
  const listeners = new Map<string, Set<(arg: unknown) => void>>()
  const ctx: FakeCtx = {
    parallel,
    disposers,
    storageDomain: {
      open: async () => ({
        table: () => ({
          get: () => rowRef.row,
          put: async (_key: string, value: unknown) => { rowRef.row = value },
          entries: () => rowRef.row === undefined ? [][Symbol.iterator]() : [['current', rowRef.row]][Symbol.iterator](),
        }),
        close: async () => {},
      }),
    },
    tools: { register: () => () => {} },
    sessionQuery: {},
    effect(fn: () => (() => unknown) | void) {
      const dispose = fn()
      if (dispose) disposers.push(dispose)
    },
    inject(services: string[], callback: (child: FakeCtx) => unknown) {
      const picked: Record<string, unknown> = {}
      for (const name of services) picked[name] = (ctx as unknown as Record<string, unknown>)[name] ?? MODEL_EVENTS[name as keyof typeof MODEL_EVENTS]
      callback(inner(picked) as unknown as FakeCtx)
      // Cordis ctx.inject() resolves to a Fiber; callers may use .dispose().
      const fiberDisposer = { dispose: () => Promise.resolve() }
      Object.assign(fiberDisposer, { then: (resolve: (value: unknown) => void) => resolve(fiberDisposer) })
      return fiberDisposer as unknown as () => void
    },
    on(event: string, callback: (arg: unknown) => void) {
      let set = listeners.get(event)
      if (!set) { set = new Set(); listeners.set(event, set) }
      set.add(callback)
      return () => { set.delete(callback) }
    },
    provide() {},
    /** Replay 'model-settings/collect' listeners the way the host's parallel() would. */
    modelSettingsCollect(emit: (provider: ModelSettingsProvider) => void) {
      for (const callback of listeners.get('model-settings/collect') ?? []) callback(emit)
    },
  } as const
  return ctx
}

async function collectProvider(ctx: ReturnType<typeof makeCtx>): Promise<ModelSettingsProvider> {
  apply(ctx as never)
  // The provider appears once the storage domain has resolved.
  let owner: ModelSettingsProvider | undefined
  for (let attempt = 0; attempt < 50 && owner === undefined; attempt += 1) {
    await Promise.resolve()
    ctx.modelSettingsCollect((value: ModelSettingsProvider) => { owner = value })
  }
  if (owner === undefined) throw new Error('model settings provider never registered')
  return owner
}

it('serves the stored model route, locks on revision and unloads cleanly', async () => {
  const rowRef: { row: unknown } = { row: { revision: 3, model: { provider: 'p', model: 'old' } } }
  const ctx = makeCtx(rowRef)
  const owner = await collectProvider(ctx)
  const signal = new AbortController().signal
  expect(await owner.read(signal)).toMatchObject({
    revision: 3,
    fields: [{
      path: ['model'],
      label: { zh: '欢迎回来摘要模型', en: 'Welcome-back recap model' },
      current: { provider: 'p', model: 'old' },
      allowFollow: true,
      followLabel: { zh: '当前会话 / 宿主默认模型', en: 'Current conversation / host default' },
    }],
  })
  // A write bumps the revision, stores the route and notifies the hub.
  expect(await owner.write(['model'], { provider: 'q', model: 'new', reasoningEffort: 'high' }, 3, signal)).toBe(4)
  expect(rowRef.row).toMatchObject({ revision: 4, model: { provider: 'q', model: 'new', reasoningEffort: 'high' } })
  expect(ctx.parallel).toHaveBeenCalled()
  expect(ctx.parallel.mock.calls.at(-1)?.[1]).toEqual({ ns: '@klarkxy/dsh-session-manager', revision: 4 })
  // Stale revision and unknown paths fail without touching the row.
  await expect(owner.write(['model'], {} as ModelRoute, 3, signal)).rejects.toThrow(/changed/)
  await expect(owner.write(['prompt'], {} as ModelRoute, 4, signal)).rejects.toThrow(/Unknown/)
  expect(rowRef.row).toMatchObject({ revision: 4, model: { provider: 'q', model: 'new', reasoningEffort: 'high' } })
  // An empty route clears the selection back to follow-default.
  expect(await owner.write(['model'], {} as ModelRoute, 4, signal)).toBe(5)
  expect(rowRef.row).toMatchObject({ revision: 5, model: null })
  expect(await owner.read(signal)).toMatchObject({ revision: 5, fields: [{ current: undefined }] })
  // Unloading tears down the owner instead of answering further writes.
  for (const dispose of ctx.disposers.reverse()) await dispose()
  await expect(owner.write(['model'], { provider: 'q', model: 'late' }, 5, signal)).rejects.toThrow(/unloaded/)
})

it('starts from a clean row and tolerates malformed rows', async () => {
  const rowRef: { row: unknown } = { row: undefined }
  const ctx = makeCtx(rowRef)
  const owner = await collectProvider(ctx)
  const signal = new AbortController().signal
  expect(await owner.read(signal)).toMatchObject({ revision: 0, fields: [{ current: undefined }] })
  rowRef.row = { revision: 'nope', model: 42 }
  const freshCtx = makeCtx(rowRef)
  const fresh = await collectProvider(freshCtx)
  expect(await fresh.read(signal)).toMatchObject({ revision: 0, fields: [{ current: undefined }] })
})

it('degrades silently without the storageDomain service', async () => {
  const rowRef: { row: unknown } = { row: undefined }
  const ctx = makeCtx(rowRef)
  const inject = ctx.inject
  const noDomain = {
    ...ctx,
    inject(services: string[], callback: (child: unknown) => unknown) {
      return services.includes('storageDomain') ? () => {} : inject(services, callback)
    },
  }
  apply(noDomain as never)
  await Promise.resolve()
  let emitted: ModelSettingsProvider | undefined
  ctx.modelSettingsCollect((value: ModelSettingsProvider) => { emitted = value })
  expect(emitted).toBeUndefined()
})

it('checks concurrent Model Hub CAS inside the store queue and reports an admitted write despite later cancellation', async () => {
  const rowRef = { row: { revision: 0, model: null } as unknown }
  const ctx = makeCtx(rowRef)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const put = vi.fn(async (_key: string, value: unknown) => {
    await gate
    rowRef.row = value
  })
  ctx.storageDomain.open = async () => ({
    table: () => ({
      get: () => rowRef.row,
      entries: () => [['current', rowRef.row]][Symbol.iterator](),
      put,
    }),
    close: async () => {},
  })
  const owner = await collectProvider(ctx)
  const firstSignal = new AbortController()
  const first = owner.write(['model'], { provider: 'p', model: 'first' }, 0, firstSignal.signal)
  const stale = owner.write(['model'], { provider: 'p', model: 'stale' }, 0, new AbortController().signal)
  const rejected = expect(stale).rejects.toThrow(/changed/)
  await vi.waitFor(() => expect(put).toHaveBeenCalledOnce())
  firstSignal.abort()
  release()
  expect(await first).toBe(1)
  await rejected
  expect(put).toHaveBeenCalledOnce()
  expect(rowRef.row).toMatchObject({ revision: 1, model: { model: 'first' } })
  expect(ctx.parallel.mock.calls.at(-1)?.[1]).toEqual({ ns: '@klarkxy/dsh-session-manager', revision: 1 })
  for (const dispose of ctx.disposers.reverse()) await dispose()
})
