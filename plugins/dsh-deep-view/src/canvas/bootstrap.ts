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
  /** Normalized workspace-relative reference mapped back from runtime `blob:` URLs. */
  readonly reference: string
  /** URI-encoded `sourceURL` form when non-ASCII or spaces appear, so V8 stack frames map back cleanly. */
  readonly encodedRef?: string
  /** Random token replacing every URL attribute occurrence; unique within the source. */
  readonly marker: string
  readonly text: string
}

/** The author document with capture inserted and asset attributes marked, plus each asset's marker. */
export interface PreparedCanvasSource {
  readonly html: string
  readonly assets: readonly PreparedAsset[]
}

export interface CreateHtmlDocumentOptions {
  /** Workspace-relative path of the root HTML document for mapping inline script stack frames. */
  readonly rootPath?: string
  /** Prepend `<!doctype html>` when omitted by the author so standards mode sizing stays active. */
  readonly ensureDoctype?: boolean
  /** Inject a strict self-contained CSP `<meta>` for inline chat-stream cards. */
  readonly inlineCsp?: boolean
}

const INLINE_SELF_CONTAINED_CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' blob:; style-src \'unsafe-inline\' blob:; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src \'none\'; object-src \'none\'; frame-src \'none\'; base-uri \'none\'">'

/** Normalize an author relative asset reference (decoding one percent-encoding layer) for display and `sourceURL`. */
export function cleanCanvasSourceUrl(reference: string): string {
  const suffix = reference.search(/[?#]/u)
  const raw = (suffix === -1 ? reference : reference.slice(0, suffix))
    .replace(/[\r\n]+/gu, '')
    .trim()
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  const normalized = decoded.replace(/^(?:\.\/)+/u, '').trim()
  return normalized || raw || reference.replace(/[\r\n]+/gu, '')
}

function hasSourceUrlDirective(code: string): boolean {
  return /(?:^|\r?\n)\s*\/\/[#@]\s*source(?:Mapping)?URL=/u.test(code)
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
 * occurrence of a deduplicated reference is marked. Packed classic scripts
 * without an existing sourceURL directive receive a trailing `//# sourceURL=`
 * comment so stack traces name the workspace relative file rather than a `blob:` UUID.
 */
export function prepareCanvasSource(
  bundle: HtmlBundle,
  capture: string,
  options?: Pick<CreateHtmlDocumentOptions, 'ensureDoctype' | 'inlineCsp'>,
): PreparedCanvasSource {
  const source = decodeText(bundle.data)
  const taken = new Set<string>()
  const assets: PreparedAsset[] = bundle.assets.map(asset => {
    const marker = freshMarker(source, taken)
    taken.add(marker)
    const reference = cleanCanvasSourceUrl(asset.reference)
    const encodedRef = encodeURI(reference)
    const decoded = decodeText(asset.data)
    const text = asset.kind === 'script' && !hasSourceUrlDirective(decoded)
      ? `${decoded}\n//# sourceURL=${encodedRef}`
      : decoded
    return {
      kind: asset.kind,
      reference,
      ...(encodedRef !== reference ? { encodedRef } : {}),
      marker,
      text,
    }
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
  const headInjection = options?.inlineCsp ? `${INLINE_SELF_CONTAINED_CSP}${capture}` : capture
  let withCapture = insertCaptureScript(html, headInjection)
  if (options?.ensureDoctype && !/^(?:\uFEFF)?\s*(?:<!--[\s\S]*?-->\s*)*<!doctype\b/iu.test(withCapture)) {
    withCapture = `<!doctype html>${withCapture}`
  }
  return { html: withCapture, assets }
}

/**
 * Build the outer iframe document. Its resource URLs are created inside the sandbox,
 * because that opaque origin cannot load resource URLs created by the parent.
 * Packed `Blob` URLs are revoked once the written document finishes loading,
 * while `window.__dvuiAssets` stays populated so later runtime stack traces still
 * map `blob:` and encoded `sourceURL` filenames back to workspace relative paths.
 */
export function createHtmlDocument(
  bundle: HtmlBundle,
  capture: string,
  options?: CreateHtmlDocumentOptions,
): string {
  const prepared = prepareCanvasSource(bundle, capture, options)
  const payload = encodeText(JSON.stringify({
    html: prepared.html,
    assets: prepared.assets,
    ...(options?.rootPath !== undefined && options.rootPath !== '' ? { rootPath: options.rootPath } : {}),
  }))
  return [
    '<!doctype html><meta charset="utf-8"><script>(()=>{',
    'const bytes=data=>Uint8Array.from(atob(data),character=>character.charCodeAt(0));',
    "const text=data=>new TextDecoder('utf-8',{fatal:true}).decode(bytes(data));",
    'const bundle=JSON.parse(text("', payload, '"));',
    'let html=bundle.html;',
    'const assetMap={};',
    'const blobUrls=[];',
    'if(bundle.rootPath&&typeof location==="object"&&location.href)assetMap[location.href]=bundle.rootPath;',
    'for(const asset of bundle.assets){',
    "const url=URL.createObjectURL(new Blob([asset.text],{type:asset.kind==='script'?'application/javascript':'text/css'}));",
    'blobUrls.push(url);',
    'if(asset.reference){',
    'assetMap[url]=asset.reference;',
    'if(asset.encodedRef)assetMap[asset.encodedRef]=asset.reference;',
    '}',
    'html=html.split(asset.marker).join(url);',
    '}',
    'window.__dvuiAssets=assetMap;',
    'const revoke=()=>{for(const u of blobUrls){try{URL.revokeObjectURL(u)}catch{}}};',
    'const write=()=>{',
    'document.open();',
    'document.write(html);',
    'document.close();',
    'if(document.readyState==="complete")setTimeout(revoke,0);',
    'else addEventListener("load",()=>setTimeout(revoke,0),{once:true});',
    '};',
    'setTimeout(write,0);',
    '})()</script>',
  ].join('')
}
