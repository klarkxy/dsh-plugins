// Canvas renderer registration: the preview definition and the keyed document
// body share one implementation id, gated on the host's developer-tools switch.
import { CANVAS_RENDERER_ID, canvasPreviewDefinition, type CanvasPreviewDefinition } from './definition.ts'
import { sessionFileOf } from '../file-address.ts'
import type { CanvasFileBytes } from './pack.ts'
import type { RemoteResult, ReadCanvasRelated } from './read-relative.ts'
import { CanvasBody } from './CanvasBody.tsx'

export { CANVAS_RENDERER_ID, canvasPreviewDefinition }
export type { CanvasFileBytes, RemoteResult, ReadCanvasRelated }

/** Services the canvas preview needs; each member is already guarded by the caller. */
export type CanvasScope = {
  readonly locale: { bind(ns: string): (key: string, params?: Record<string, unknown>) => string }
  readonly documentPreviews: { register(definition: CanvasPreviewDefinition): () => void }
  readonly slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: Record<string, unknown>, render: unknown): () => void
  }
  readonly remote: {
    workspaceFiles?: {
      readBytes(sessionId: string, path: string, options?: { baseFile?: string }, signal?: AbortSignal): Promise<RemoteResult<CanvasFileBytes>>
    }
  }
}

/**
 * Register the canvas preview definition and its keyed document body.
 * @param scope - client services shared with the owning plugin.
 * @param locale - the registration's dictionary namespace.
 * @returns disposer removing both registrations.
 */
export function registerCanvasPreview(scope: CanvasScope, locale: string): () => void {
  const t = scope.locale.bind(locale)
  const disposeDefinition = scope.documentPreviews.register(
    canvasPreviewDefinition(() => t('canvasTitle')),
  )
  // Created once per registration: a fresh function on every inject call would
  // churn CanvasBody's pack effect and rebuild the iframe on each render.
  const readRelated: ReadCanvasRelated = (address: string, relativePath: string, signal: AbortSignal) => {
    const file = sessionFileOf(address)
    if (!file || typeof scope.remote.workspaceFiles?.readBytes !== 'function') {
      return Promise.resolve<RemoteResult<CanvasFileBytes>>({ ok: false, error: { message: `dsh-deep-view: cannot read "${relativePath}" for "${address}"` } })
    }
    return scope.remote.workspaceFiles.readBytes(file.sessionId, relativePath, { baseFile: file.path }, signal)
  }
  const disposeBody = scope.slots.inject('sidebar.right.tab.document', () => scope.slots.register(
    {
      name: 'sidebar.right.tab.document', key: CANVAS_RENDERER_ID, locale,
      inject: () => ({ readRelated }),
    },
    CanvasBody,
  ))
  return () => {
    disposeBody()
    disposeDefinition()
  }
}
