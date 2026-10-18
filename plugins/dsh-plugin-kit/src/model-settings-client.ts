import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { modelSettingsChangesIdentity, type ModelSettingsChangesIdentity } from './contracts.ts'

export type ModelSettingsChangeFrame = { kind: 'ready' } | { kind: 'changed'; ns: string; revision: number }

/** This stream carries invalidations only; ready is never a settings snapshot. */
export function parseModelSettingsChangeFrame(value: unknown): ModelSettingsChangeFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid model settings change frame')
  const frame = value as Record<string, unknown>
  if (frame.kind === 'ready' && Object.keys(frame).length === 1) return { kind: 'ready' }
  if (frame.kind === 'changed' && Object.keys(frame).length === 3 && typeof frame.ns === 'string' && frame.ns.length > 0
    && typeof frame.revision === 'number' && Number.isSafeInteger(frame.revision) && frame.revision >= 0) {
    return { kind: 'changed', ns: frame.ns, revision: frame.revision }
  }
  throw new Error('Invalid model settings change frame')
}

/** One owner's contribution. Each package mounts only its own endpoint. */
export function modelSettingsChangesRemote(packageName: string, identity: ModelSettingsChangesIdentity = modelSettingsChangesIdentity(packageName)): TypertRemoteContribution {
  return {
    package: packageName,
    descriptors: [{
      id: `${identity.namespace}/watch`,
      service: identity.service,
      namespace: identity.namespace,
      method: 'watch',
      mode: 'stream' as const,
      invocation: { kind: 'direct' as const },
      parameters: [],
      cancellation: { parameter: 'signal' as const },
      result: { mode: 'strict' as const, typeSymbol: 'ModelSettings.ChangeFrame', create: () => ({ parse: parseModelSettingsChangeFrame }) },
    }],
  }
}

interface RemoteMountScope {
  remote: { $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>> }
  effect(callback: () => () => void | Promise<void>): unknown
}
interface RemoteMountContext {
  inject(dependencies: string[], callback: (scope: unknown) => void): unknown
}

/** Mount from a synchronous apply. Disposal waits for an in-flight mount and
 * then withdraws it, so the contribution cannot outlive the plugin. */
export function mountModelSettingsChanges(ctx: RemoteMountContext, packageName: string): void {
  const contribution = modelSettingsChangesRemote(packageName)
  ctx.inject(['remote'], injected => {
    const scope = injected as RemoteMountScope
    const mounting = scope.remote.$mount(contribution)
    void mounting.catch(() => {})
    scope.effect(() => async () => {
      const unmount = await mounting.catch(() => undefined)
      await unmount?.()
    })
  })
}

interface StreamItem {
  generation: number
  value: unknown
  signal: AbortSignal
  accept(): void
}
interface ChangeStream extends AsyncIterable<StreamItem> { dispose(): Promise<void> }
type OpenChangeStream = (options: {
  name: string
  open(signal: AbortSignal): AsyncIterable<unknown>
  ended(accepted: boolean): Error
}) => ChangeStream
export interface ModelSettingsSubscriberScope {
  remote: { $stream: OpenChangeStream } & Record<string, { watch?(signal: AbortSignal): AsyncIterable<unknown> } | OpenChangeStream | undefined>
  effect(callback: () => () => void | Promise<void>): unknown
}
export interface ModelSettingsSubscriberContext {
  inject(dependencies: string[], callback: (scope: unknown) => void): unknown
}
export interface ModelSettingsSubscriber {
  subscribe(onChange: () => void, onError?: (message: string) => void): () => void
}

/** Native RemoteStream owns carrier reconnects; no timers or browser transport.
 * A factory shares one logical stream while at least one subscriber remains. */
export function createModelSettingsSubscriber(
  ctx: ModelSettingsSubscriberContext,
  packageName: string,
  identity: ModelSettingsChangesIdentity = modelSettingsChangesIdentity(packageName),
  accept: (ns: string) => boolean = ns => ns === packageName,
): ModelSettingsSubscriber {
  const endpoint = identity
  const listeners = new Set<{ change: () => void; error?: (message: string) => void }>()
  let injection: { dispose(): void | Promise<void> } | undefined
  let current: { stream: ChangeStream; active: boolean } | undefined
  let lifecycle = 0
  let failureMessage: string | undefined
  const report = (message: string) => {
    failureMessage = message
    for (const listener of [...listeners]) {
      try { listener.error?.(message) } catch { /* Isolate page callbacks. */ }
    }
  }
  const invalidate = () => {
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue
      try { listener.change() } catch (error) {
        try { listener.error?.(error instanceof Error ? error.message : String(error)) } catch { /* Isolate callbacks. */ }
      }
    }
  }
  const start = () => {
    const life = ++lifecycle
    injection = ctx.inject(['remote', `remote.${endpoint.namespace}`], injected => {
      if (life !== lifecycle || !listeners.size) return
      const scope = injected as ModelSettingsSubscriberScope
      const service = scope.remote[endpoint.namespace]
      if (!service || !('watch' in service) || !service.watch) { report('Model settings sync service unavailable'); return }
      const watch = service.watch
      const stream = scope.remote.$stream({
        name: 'Model settings sync',
        open: signal => watch(signal),
        ended: accepted => new Error(`Model settings sync stream ended ${accepted ? 'after' : 'before'} ready; refresh or reopen the page`),
      })
      const session = { stream, active: true }
      current = session
      scope.effect(() => () => {
        session.active = false
        if (current === session) {
          current = undefined
          if (life === lifecycle && listeners.size) report('Model settings sync service unavailable')
        }
        return stream.dispose()
      })
      void (async () => {
        let generation: number | undefined
        let ready = false
        try {
          for await (const item of stream) {
            if (!session.active || life !== lifecycle || !listeners.size) break
            if (item.signal.aborted) continue
            if (generation !== item.generation) { generation = item.generation; ready = false }
            const frame = parseModelSettingsChangeFrame(item.value)
            if (frame.kind === 'ready') {
              ready = true
              failureMessage = undefined
              // Accept the validated invalidation baseline, not fetched data.
              // Every current listener queues its own latest settings read.
              item.accept()
              invalidate()
            } else {
              if (!ready) throw new Error('Model settings sync change arrived before ready')
              if (accept(frame.ns)) invalidate()
            }
          }
        } catch (error) {
          if (session.active && life === lifecycle) report(error instanceof Error ? error.message : String(error))
        } finally {
          if (current === session) current = undefined
          session.active = false
          await stream.dispose().catch(() => {})
        }
      })()
    }) as { dispose(): void | Promise<void> }
    queueMicrotask(() => {
      if (life === lifecycle && listeners.size && !current) report('Model settings sync service unavailable')
    })
  }
  return Object.freeze({ subscribe(onChange: () => void, onError?: (message: string) => void) {
    const listener = { change: onChange, error: onError }
    listeners.add(listener)
    if (!injection) start()
    else if (failureMessage) queueMicrotask(() => {
      if (listeners.has(listener) && failureMessage) {
        try { listener.error?.(failureMessage) } catch { /* Isolate callbacks. */ }
      }
    })
    return () => {
      if (!listeners.delete(listener) || listeners.size) return
      lifecycle++
      if (current) { current.active = false; void current.stream.dispose().catch(() => {}) }
      current = undefined
      failureMessage = undefined
      const previous = injection
      injection = undefined
      try { void Promise.resolve(previous?.dispose()).catch(() => {}) } catch { /* Already unloaded. */ }
    }
  } })
}
