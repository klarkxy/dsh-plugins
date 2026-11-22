/** Deep View canvas preview identity, shared by metadata and the keyed slot. */
export const CANVAS_RENDERER_ID = '@klarkxy/dsh-deep-view/canvas'

/** Subset of the host's DocumentPreviewDefinition the canvas declares. */
export type CanvasPreviewDefinition = {
  readonly id: string
  readonly extensions: readonly string[]
  readonly priority: 'builtin' | 'extension'
  readonly title: () => string
  readonly loading: 'bytes-complete'
  readonly wrap: false
}

/**
 * Describe the canvas renderer's file types and loading mode.
 * `priority: 'extension'` wins over the builtin HTML renderer, which stays
 * selectable in the renderer dropdown.
 * @param title - locale-owned implementation name.
 */
export function canvasPreviewDefinition(title: () => string): CanvasPreviewDefinition {
  return { id: CANVAS_RENDERER_ID, extensions: ['html', 'htm'], priority: 'extension', title, loading: 'bytes-complete', wrap: false }
}
