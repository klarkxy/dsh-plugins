import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createModelSettingsSubscriber, modelSettingsChangesRemote, parseModelSettingsChangeFrame,
  type ModelSettingsSubscriberContext, type ModelSettingsSubscriberScope } from './model-settings-client.ts'
import { notifyModelSettingsChanged } from './model-settings.ts'

// Gateway's public client entry is a browser ModuleLoader wrapper. Exercise
// its shipped native source modules in Node with the same class identity.
const require = createRequire(import.meta.url)
const gateway = dirname(require.resolve('@deepseek-ai/dsh-api-gateway/package.json'))
const nativeModule = (name: string) => pathToFileURL(join(gateway, 'lib/types/client', name)).href
const { RemoteStream } = await import(/* @vite-ignore */ nativeModule('remote-stream.js'))
const { RemoteStreamCarrierError } = await import(/* @vite-ignore */ nativeModule('stream-client.js'))
const { apply: installNativeGateway } = await import(/* @vite-ignore */ nativeModule('index.js'))

function channel(signal: AbortSignal) {
  const queue: unknown[] = []
  let failure: unknown, closed = false, wake: (() => void) | undefined
  const stop = () => { closed = true; wake?.() }
  signal.addEventListener('abort', stop, { once: true })
  return {
    push(value: unknown) { queue.push(value); wake?.() },
    fail(error: unknown) { failure = error; wake?.() },
    end() { closed = true; wake?.() },
    async *[Symbol.asyncIterator]() {
      try {
        while (!closed && !signal.aborted) {
          if (failure) throw failure
          if (queue.length) { yield queue.shift(); continue }
          await new Promise<void>(resolve => { wake = resolve })
          wake = undefined
        }
      } finally { signal.removeEventListener('abort', stop) }
    },
  }
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve() }
function harness(namespace = 'owner') {
  const generations: ReturnType<typeof channel>[] = []
  const cleanups: (() => void | Promise<void>)[] = []
  let scopeCallback: ((scope: ModelSettingsSubscriberScope) => void) | undefined
  const nativeStreams: InstanceType<typeof RemoteStream>[] = []
  const scope: ModelSettingsSubscriberScope = {
    remote: {
      modelSettingsChanges: { watch(signal) { const stream = channel(signal); generations.push(stream); return stream } },
      $stream(options) {
        const stream = new RemoteStream({ generation: { getSnapshot: () => 1, subscribe: () => () => {} } }, options)
        nativeStreams.push(stream)
        return stream
      },
    },
    effect(callback) { cleanups.push(callback()) },
  }
  const disposeScope = async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() }
  const inject = vi.fn((_dependencies: string[], callback: (scope: ModelSettingsSubscriberScope) => void) => {
    scopeCallback = callback
    callback(scope)
    return { dispose: disposeScope }
  })
  const subscriber = createModelSettingsSubscriber({ inject }, namespace)
  return { subscriber, inject, generations, nativeStreams, unload: disposeScope, remount: () => scopeCallback!(scope) }
}

describe('model settings native stream subscriber', () => {
  it('shares one stream, validates ready before accept, and filters namespaces', async () => {
    const h = harness(), first = vi.fn(), second = vi.fn()
    const off1 = h.subscriber.subscribe(first), off2 = h.subscriber.subscribe(second)
    await settle()
    expect(h.inject).toHaveBeenCalledTimes(1)
    expect(h.generations).toHaveLength(1)
    h.generations[0]!.push({ kind: 'ready' })
    await settle()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    h.generations[0]!.push({ kind: 'changed', ns: 'other', revision: 4 })
    h.generations[0]!.push({ kind: 'changed', ns: 'owner', revision: 5 })
    await settle()
    expect(first).toHaveBeenCalledTimes(2)
    off1()
    expect(h.nativeStreams[0]!.signal.aborted).toBe(false)
    off2()
    await settle()
    expect(h.nativeStreams[0]!.signal.aborted).toBe(true)
  })

  it('uses authentic native carrier recovery and invalidates all listeners on the replacement ready', async () => {
    const h = harness('*'), change = vi.fn(), error = vi.fn()
    const off = h.subscriber.subscribe(change, error)
    h.generations[0]!.push({ kind: 'ready' })
    await settle()
    h.generations[0]!.fail(new RemoteStreamCarrierError('socket lost'))
    await settle()
    expect(h.generations).toHaveLength(2)
    h.generations[1]!.push({ kind: 'ready' })
    h.generations[1]!.push({ kind: 'changed', ns: 'other', revision: 9 })
    await settle()
    expect(change).toHaveBeenCalledTimes(3)
    expect(error).not.toHaveBeenCalled()
    off()
  })

  it('reports terminal end, invalid frames and missing service; remount has a fresh lifetime', async () => {
    const h = harness(), change = vi.fn(), error = vi.fn()
    const off = h.subscriber.subscribe(change, error)
    h.generations[0]!.push({ kind: 'ready' })
    await settle()
    h.generations[0]!.end()
    await settle()
    expect(error.mock.calls[0]![0]).toContain('ended after ready')
    expect(h.generations).toHaveLength(1)
    off()
    const next = h.subscriber.subscribe(change, error)
    h.generations[1]!.push({ kind: 'changed', ns: 'owner', revision: 1 })
    await settle()
    expect(error.mock.calls.at(-1)![0]).toContain('before ready')
    next()
    const missing = createModelSettingsSubscriber({ inject: () => ({ dispose() {} }) } as ModelSettingsSubscriberContext, 'owner')
    const stop = missing.subscribe(change, error)
    await settle()
    expect(error.mock.calls.at(-1)![0]).toContain('unavailable')
    stop()
  })

  it('closes streams on service unload and follows a dynamic service replacement', async () => {
    const h = harness(), change = vi.fn(), error = vi.fn()
    const off = h.subscriber.subscribe(change, error)
    h.generations[0]!.push({ kind: 'ready' })
    await settle()
    await h.unload()
    expect(h.nativeStreams[0]!.signal.aborted).toBe(true)
    expect(error).toHaveBeenCalledWith('Model settings sync service unavailable')
    h.remount()
    h.generations[1]!.push({ kind: 'ready' })
    await settle()
    expect(change).toHaveBeenCalledTimes(2)
    off()
  })

  it('uses a strict no-argument cancellation-aware stream descriptor', () => {
    const descriptor = modelSettingsChangesRemote.descriptors[0]!
    expect(descriptor.mode).toBe('stream')
    expect(descriptor.parameters).toEqual([])
    expect(descriptor.cancellation).toEqual({ parameter: 'signal' })
    expect(parseModelSettingsChangeFrame({ kind: 'changed', ns: 'owner', revision: 0 })).toEqual({ kind: 'changed', ns: 'owner', revision: 0 })
    for (const value of [{ kind: 'ready', revision: 1 }, { kind: 'changed', ns: '', revision: 1 }, { kind: 'changed', ns: 'x', revision: -1 }]) {
      expect(() => descriptor.result.create().parse(value)).toThrow('Invalid')
    }
  })

  it('follows actual Cordis child fibers across native descriptor mount, unload and remount', async () => {
    const root = new Context()
    try {
    const generations: ReturnType<typeof channel>[] = []
    const generation = { getSnapshot: () => ({ host: { home: 'test' } }), subscribe: () => () => {} }
    root.provide('connection', {
      generation, registerGenerationSource: () => () => {}, start: () => ({ stop() {} }),
      rpc: { open(_channel: string, _endpoint: string, _payload: unknown, signal: AbortSignal) {
        const physical = channel(signal)
        generations.push(physical)
        return physical
      } },
    })
    root.provide('typert', { remotes: { register: () => () => {} } })
    const gatewayFiber = root.plugin({ inject: ['connection', 'typert'], apply: installNativeGateway })
    await gatewayFiber
    let status = '', changes = 0
    let ownerScope!: Context
    let off!: () => void
    const owner = root.plugin({ inject: ['remote', 'typert'], apply(ctx) { ownerScope = ctx } })
    await owner
    const consumer = root.plugin({ apply(ctx) {
      // The page need not inject the remote container itself. The helper's
      // optional child must declare both the container and its namespace.
      // This assignment proves the public structural Context accepts native
      // Cordis without application-specific casts at each caller.
      const subscriber = createModelSettingsSubscriber(ctx, 'owner')
      off = subscriber.subscribe(() => { status = ''; changes++ }, message => { status = message })
      ctx.effect(() => off)
    } })
    await consumer
    await settle()
    expect(status).toContain('unavailable')
    const remote = ownerScope.get('remote')
    const unmount = await remote.$mount(modelSettingsChangesRemote)
    await settle()
    expect(generations).toHaveLength(1)
    generations[0]!.push({ kind: 'ready' })
    await settle()
    expect(status).toBe('')
    expect(changes).toBe(1)
    await unmount()
    await settle()
    expect(status).toContain('unavailable')
    const remounted = await remote.$mount(modelSettingsChangesRemote)
    await settle()
    expect(generations).toHaveLength(2)
    generations[1]!.push({ kind: 'ready' })
    await settle()
    expect(status).toBe('')
    expect(changes).toBe(2)
    await consumer.dispose()
    generations[1]!.push({ kind: 'changed', ns: 'owner', revision: 8 })
    await settle()
    expect(changes).toBe(2)
    await remounted()
    } finally { await root.fiber.dispose() }
  })

  it('never fails an already committed save because a notification observer fails', async () => {
    expect(() => notifyModelSettingsChanged({ parallel() { throw new Error('observer failed') } }, 'owner', 4)).not.toThrow()
    notifyModelSettingsChanged({ parallel: () => Promise.reject(new Error('async observer failed')) }, 'owner', 5)
    await settle()
    const ctx = new Context()
    try {
      const observed = vi.fn()
      ctx.on('model-settings/changed' as never, async (change: unknown) => {
        observed(change)
        await Promise.resolve()
        throw new Error('real Cordis async observer failed')
      })
      expect(() => notifyModelSettingsChanged(ctx, 'owner', 6)).not.toThrow()
      await settle()
      expect(observed).toHaveBeenCalledWith({ ns: 'owner', revision: 6 })
    } finally { await ctx.fiber.dispose() }
  })
})
