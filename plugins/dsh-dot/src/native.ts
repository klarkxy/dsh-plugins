/**
 * The original session's own card answers through the rest of the waterfall
 * and lives as long as the request's signal. When dot settles a request first,
 * that card must close, but the request itself is still answered (by dot), so
 * aborting the caller's signal is wrong. Give the downstream answerers their
 * own signal instead: it follows the caller's signal and can also be aborted
 * alone once dot has answered.
 */
export interface NativeLease {
  /** Close the downstream answerers' card; the caller's request is unaffected. */
  readonly close: () => void
  /** Drop the link to the caller's signal. */
  readonly release: () => void
}

export function detachNative(request: { signal?: AbortSignal }): NativeLease | undefined {
  const parent = request.signal
  if (parent?.aborted) return undefined
  const own = new AbortController()
  const follow = () => own.abort(parent?.reason)
  parent?.addEventListener('abort', follow, { once: true })
  const release = () => parent?.removeEventListener('abort', follow)
  try {
    // Downstream listeners receive this same object; the host keeps its own
    // reference to the caller's signal for its cancellation handling.
    Object.defineProperty(request, 'signal', { value: own.signal, configurable: true, enumerable: true, writable: true })
  } catch {
    release()
    return undefined
  }
  return {
    close: () => { release(); if (!own.signal.aborted) own.abort(new Error('answered through dot')) },
    release,
  }
}
