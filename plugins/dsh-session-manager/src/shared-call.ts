import { createHash } from 'node:crypto'

/**
 * Server-side merge for identical auxiliary generations. Concurrent requests
 * carrying the same material fingerprint share one model call instead of
 * paying twice.
 *
 * Cancellation stays per waiter: a caller leaving early only detaches itself
 * and never cancels the work other callers await. When the last waiter
 * detaches the entry is dropped and the shared signal aborted, so a slow or
 * signal-ignoring model call can never be handed to a later caller, and the
 * model stops spending on a result nobody is waiting for.
 */
export interface SharedCallRunner {
  run<T>(key: string, signal: AbortSignal, work: (shared: AbortSignal) => Promise<T>): Promise<T>
}

export function createSharedCalls(): SharedCallRunner {
  interface Inflight {
    readonly promise: Promise<unknown>
    waiters: number
    readonly controller: AbortController
  }
  const inflight = new Map<string, Inflight>()
  return {
    async run<T>(key: string, signal: AbortSignal, work: (shared: AbortSignal) => Promise<T>): Promise<T> {
      signal.throwIfAborted()
      let entry = inflight.get(key)
      if (entry === undefined) {
        const controller = new AbortController()
        entry = {
          controller,
          waiters: 0,
          // Deferred through a microtask so a synchronous throw still settles
          // the shared promise instead of escaping run() as a mixed channel.
          promise: Promise.resolve().then(() => work(controller.signal)),
        }
        inflight.set(key, entry)
        const cleanup = () => { if (inflight.get(key) === entry) inflight.delete(key) }
        void entry.promise.then(cleanup, cleanup)
      }
      entry.waiters += 1
      let abort: (() => void) | undefined
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(Object.assign(new Error('调用已取消。'), { name: 'AbortError' }))
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
      })
      try {
        return await Promise.race([entry.promise as Promise<T>, cancelled])
      } finally {
        if (abort !== undefined) signal.removeEventListener('abort', abort)
        entry.waiters -= 1
        if (entry.waiters === 0) {
          // Retract immediately: the entry must not be joinable after it has
          // been aborted, even while the model call is still draining.
          if (inflight.get(key) === entry) inflight.delete(key)
          entry.controller.abort()
        }
      }
    },
  }
}

/** Short content fingerprint for cache and merge keys; 24 hex chars are plenty. */
export function hashAuxiliaryMaterial(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 24)
}
