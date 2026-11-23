// Adapted from @deepseek-ai/dsh-client-ui-sidebar-documentpreview 0.2.2-rc.5
// (MIT License). Copyright (c) 2026 DeepSeek.
// Finite HTML-declared classic scripts and stylesheets; no module, CSS
// dependency or runtime fetch traversal.
import type { HtmlAsset, HtmlBundle } from './bootstrap.ts'
import { decodeText } from './bytes.ts'
import { scanCanvasSource } from './html-source.ts'

/** Complete bytes for one document dependency read under the source file's authority. */
export interface CanvasFileBytes {
  readonly data: Uint8Array<ArrayBuffer>
  /** Absolute target path, reported back so the preview can watch the dependency. */
  readonly absolutePath?: string
}

/**
 * A read bound to the original document's session and directory, using ordinary file operations.
 * @param reference - HTML-decoded relative URL, including any query or fragment; the reader resolves its file path.
 * @param signal - cancellation of this packing operation.
 * @returns complete file bytes; permission and read failures reject.
 */
export type ReadCanvasRelative = (reference: string, signal: AbortSignal) => Promise<CanvasFileBytes>

const MAX_ASSET_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_ASSETS = 64

/**
 * Collect static dependencies without executing or mounting document elements in the parent page.
 * A base element leaves URL resolution to the browser. Only direct .js classic scripts and .css
 * links are packed; local CSS url/import, modules and dynamically constructed URLs are unsupported.
 * @param data - complete UTF-8 HTML bytes.
 * @param readRelative - original-document-scoped read, never exposed to the iframe.
 * @param signal - stops reads and prevents publication after cancellation.
 * @returns complete HTML and its finite static asset set; decoding, limits and read failures reject.
 */
export async function packCanvasHtml(
  data: Uint8Array<ArrayBuffer>,
  readRelative: ReadCanvasRelative,
  signal: AbortSignal,
): Promise<HtmlBundle> {
  signal.throwIfAborted()
  let total = data.byteLength
  if (total > MAX_TOTAL_BYTES) throw new Error('HTML package exceeds its total byte limit')
  const source = scanCanvasSource(decodeText(data))
  const assets: HtmlAsset[] = []
  if (source.hasBaseHref) return { data, assets }

  for (const candidate of source.assets) {
    if (assets.length >= MAX_ASSETS) throw new Error('HTML package exceeds its asset count limit')
    signal.throwIfAborted()
    const asset = await readRelative(candidate.reference, signal)
    signal.throwIfAborted()
    const size = asset.data.byteLength
    if (size > MAX_ASSET_BYTES) throw new Error('HTML asset exceeds its byte limit')
    total += size
    if (total > MAX_TOTAL_BYTES) throw new Error('HTML package exceeds its total byte limit')
    decodeText(asset.data)
    assets.push({ kind: candidate.kind, reference: candidate.reference, ranges: candidate.ranges, data: asset.data })
  }
  return { data, assets }
}
