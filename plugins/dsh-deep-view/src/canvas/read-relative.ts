// Adapted from @deepseek-ai/dsh-client-ui-sidebar-documentpreview 0.2.2-rc.5
// (MIT License). Copyright (c) 2026 DeepSeek.
// Adapt a relative workspace read without changing its Session or Host path authority.
import type { CanvasFileBytes, ReadCanvasRelative } from './pack.ts'
import { sessionFileAddress, sessionFileOf } from '../file-address.ts'

/** Error branch of a Remote read, folded instead of thrown. */
export type RemoteFailure = { readonly message?: string; readonly details?: Record<string, unknown> }
export type RemoteResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: RemoteFailure }

/**
 * Read one dependency relative to the addressed HTML file through the Host.
 * @param address - root HTML file address.
 * @param relativePath - decoded dependency path, resolved only by the Host.
 * @param signal - cancellation shared by the tab and packing operation.
 * @returns the complete-byte result, including declared failures.
 */
export type ReadCanvasRelated = (address: string, relativePath: string, signal: AbortSignal) => Promise<RemoteResult<CanvasFileBytes>>

/**
 * Bind a package reader to the original HTML file's address.
 * @param readRelated - workspace reader using the Session in the root HTML address.
 * @param address - root HTML file address.
 * @param lifetime - tab lifetime.
 * @param addResource - subscribes to the dependency path reported by the Host.
 * @returns a reader that strips URL query/fragment, decodes one path, and preserves Host failures.
 */
export function createReadCanvasRelative(
  readRelated: ReadCanvasRelated,
  address: string,
  lifetime: AbortSignal,
  addResource: (address: string) => void,
): ReadCanvasRelative {
  return async (reference, signal) => {
    const suffix = reference.search(/[?#]/u)
    const path = decodeURIComponent(suffix === -1 ? reference : reference.slice(0, suffix))
    if (path.length === 0 || /^(?:[a-z][a-z\d+.-]*:|[/\\])/iu.test(path) || path.includes('\0') || path.includes('\\')) {
      throw new Error('HTML dependency must use a relative file path')
    }
    const combined = AbortSignal.any([lifetime, signal])
    combined.throwIfAborted()
    const file = sessionFileOf(address)
    if (!file) throw new Error(`dsh-deep-view: not a session file address "${address}"`)
    const result = await readRelated(address, path, combined)
    combined.throwIfAborted()
    if (!result.ok) {
      const details = result.error.details
      if (details && typeof details.path === 'string') {
        addResource(sessionFileAddress(file.sessionId, details.path))
      }
      throw new Error(result.error.message ?? 'HTML dependency could not be read')
    }
    if (result.value.absolutePath !== undefined) {
      addResource(sessionFileAddress(file.sessionId, result.value.absolutePath))
    }
    return result.value
  }
}
