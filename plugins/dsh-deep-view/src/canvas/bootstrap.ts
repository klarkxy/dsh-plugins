// Adapted from @deepseek-ai/dsh-client-ui-sidebar-documentpreview 0.2.2-rc.5
// (MIT License). Copyright (c) 2026 DeepSeek.
// A fixed bootstrap runs inside the opaque iframe; no Host callbacks enter its
// document. Deep View inserts the error-reporting script into the author HTML
// as text (no DOMParser round-trip) so textarea/pre leading newlines survive,
// and rewrites packed asset attributes at their exact parse5 source ranges
// through random markers — the iframe then substitutes each marker verbatim.
import { decodeText, encodeText } from './bytes.ts'
import { captureInsertion, type SourceRange } from './html-source.ts'

/** One statically declared local script or stylesheet, already read under the source file's authority. */
export interface HtmlAsset {
  readonly kind: 'script' | 'stylesheet'
  /** Original HTML attribute, not a Host absolute path. */
  readonly reference: string
  /** Every `name="value"` occurrence of this asset's URL attribute in the decoded source. */
  readonly ranges: readonly SourceRange[]
  readonly data: Uint8Array<ArrayBuffer>
}

/** Complete bytes for one document; dependencies are finite and never requested by iframe messages. */
export interface HtmlBundle {
  readonly data: Uint8Array<ArrayBuffer>
  readonly assets: readonly HtmlAsset[]
}

/** One packed asset after source marking: the iframe swaps each marker for its fresh object URL. */
export interface PreparedAsset {
  readonly kind: 'script' | 'stylesheet'
  /** Random token replacing every URL attribute occurrence; unique within the source. */
  readonly marker: string
  readonly text: string
}

/** The author document with capture inserted and asset attributes marked, plus each asset's marker. */
export interface PreparedCanvasSource {
  readonly html: string
  readonly assets: readonly PreparedAsset[]
}

/**
 * Insert `capture` as the first child of the author `<head>` without parsing
 * the document into the parent DOM. A DOMParser round-trip would drop the
 * first LF after `<textarea>` / `<pre>` / `<listing>`, and serializing would
 * not put it back; the parse5 insertion point keeps the source untouched
 * elsewhere, head attributes as written and comments never mistaken for tags.
 * @param html - original author HTML.
 * @param capture - complete `<script>` element text.
 * @returns the same source with capture inserted.
 */
export function insertCaptureScript(html: string, capture: string): string {
  const insertion = captureInsertion(html)
  const text = insertion.wrapHead ? `<head>${capture}</head>` : capture
  return html.slice(0, insertion.offset) + text + html.slice(insertion.offset)
}

/** A fresh marker absent from the source and every marker already issued. */
function freshMarker(source: string, taken: ReadonlySet<string>): string {
  for (;;) {
    const marker = `dvui-asset-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
    if (!taken.has(marker) && !source.includes(marker)) return marker
  }
}

/**
 * Mark every packed URL attribute with its asset's random marker, then insert
 * the capture script. Attribute ranges come from the same decoded source, so
 * quoting style, spacing and entity-encoded values in the author HTML never
 * matter: only the element's own attribute text is replaced, and every
 * occurrence of a deduplicated reference is marked. The insertion point is
 * located on the marked source (offsets shifted by the replacements).
 * @param bundle - complete HTML bytes and the assets packed from it.
 * @param capture - `<script>` element text inserted at the start of the author head.
 * @returns the prepared source and per-asset markers; invalid UTF-8 throws.
 */
export function prepareCanvasSource(bundle: HtmlBundle, capture: string): PreparedCanvasSource {
  const source = decodeText(bundle.data)
  const taken = new Set<string>()
  const assets = bundle.assets.map(asset => {
    const marker = freshMarker(source, taken)
    taken.add(marker)
    return { kind: asset.kind, marker, text: decodeText(asset.data) }
  })
  const spans: { start: number; end: number; name: string; marker: string }[] = []
  bundle.assets.forEach((asset, index) => {
    const name = asset.kind === 'script' ? 'src' : 'href'
    for (const range of asset.ranges) spans.push({ start: range.start, end: range.end, name, marker: assets[index]!.marker })
  })
  // Descending order keeps the earlier offsets valid while splicing.
  spans.sort((a, b) => b.start - a.start)
  let html = source
  for (const span of spans) html = `${html.slice(0, span.start)}${span.name}="${span.marker}"${html.slice(span.end)}`
  return { html: insertCaptureScript(html, capture), assets }
}

/**
 * Build the outer iframe document. Its resource URLs are created inside the sandbox,
 * because that opaque origin cannot load resource URLs created by the parent.
 * The prepared source already carries capture and markers, so the in-iframe
 * code is one exact token substitution per asset — no source string matching.
 * `document.write` is deferred so Chromium starts a fresh parser instead of
 * ignoring a later `<head>` while still inside the bootstrap head.
 * @param bundle - complete HTML bytes and optional static dependencies.
 * @param capture - `<script>` element text inserted at the start of the author head.
 * @returns bootstrap HTML; invalid UTF-8 throws before navigation.
 */
export function createHtmlDocument(bundle: HtmlBundle, capture: string): string {
  const prepared = prepareCanvasSource(bundle, capture)
  const payload = encodeText(JSON.stringify({ html: prepared.html, assets: prepared.assets }))
  return [
    '<!doctype html><meta charset="utf-8"><script>(()=>{',
    'const bytes=data=>Uint8Array.from(atob(data),character=>character.charCodeAt(0));',
    "const text=data=>new TextDecoder('utf-8',{fatal:true}).decode(bytes(data));",
    'const bundle=JSON.parse(text("', payload, '"));',
    'let html=bundle.html;',
    'for(const asset of bundle.assets){',
    "const url=URL.createObjectURL(new Blob([asset.text],{type:asset.kind==='script'?'application/javascript':'text/css'}));",
    'html=html.split(asset.marker).join(url);',
    '}',
    'const write=()=>{document.open();document.write(html);document.close();};',
    'setTimeout(write,0);',
    '})()</script>',
  ].join('')
}
