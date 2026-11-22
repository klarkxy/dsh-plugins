// Adapted from @deepseek-ai/dsh-client-ui-sidebar-documentpreview 0.2.2-rc.5
// (MIT License). Copyright (c) 2026 DeepSeek.
// A fixed bootstrap runs inside the opaque iframe; no Host callbacks enter its
// document. Deep View inserts the error-reporting script into the author HTML
// as text (no DOMParser round-trip) so textarea/pre leading newlines survive.
import { decodeText, encodeText } from './bytes.ts'

/** One statically declared local script or stylesheet, already read under the source file's authority. */
export interface HtmlAsset {
  readonly kind: 'script' | 'stylesheet'
  /** Original HTML attribute, not a Host absolute path. */
  readonly reference: string
  readonly data: Uint8Array<ArrayBuffer>
}

/** Complete bytes for one document; dependencies are finite and never requested by iframe messages. */
export interface HtmlBundle {
  readonly data: Uint8Array<ArrayBuffer>
  readonly assets: readonly HtmlAsset[]
}

/**
 * Insert `capture` as the first child of the author `<head>` without parsing
 * the document. A DOMParser round-trip would drop the first LF after
 * `<textarea>` / `<pre>` / `<listing>`, and serializing would not put it back.
 * @param html - original author HTML.
 * @param capture - complete `<script>` element text.
 * @returns the same source with capture inserted; head attributes stay as written.
 */
export function insertCaptureScript(html: string, capture: string): string {
  const head = /<head\b[^>]*>/i.exec(html)
  if (head !== null) {
    const index = head.index + head[0].length
    return html.slice(0, index) + capture + html.slice(index)
  }
  const root = /<html\b[^>]*>/i.exec(html)
  if (root !== null) {
    const index = root.index + root[0].length
    return `${html.slice(0, index)}<head>${capture}</head>${html.slice(index)}`
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  if (doctype !== null) return html.slice(0, doctype[0].length) + capture + html.slice(doctype[0].length)
  return capture + html
}

/**
 * Build the outer iframe document. Its resource URLs are created inside the sandbox,
 * because that opaque origin cannot load resource URLs created by the parent.
 * Capture is inserted into the source HTML before the payload is built. Asset
 * URLs are rewritten in the source string. `document.write` is deferred so
 * Chromium starts a fresh parser instead of ignoring a later `<head>` while
 * still inside the bootstrap head.
 * @param bundle - complete HTML bytes and optional static dependencies.
 * @param capture - `<script>` element text inserted at the start of the author head.
 * @returns bootstrap HTML; invalid UTF-8 throws before navigation.
 */
export function createHtmlDocument(bundle: HtmlBundle, capture: string): string {
  const payload = encodeText(JSON.stringify({
    html: insertCaptureScript(decodeText(bundle.data), capture),
    assets: bundle.assets.map(asset => ({ kind: asset.kind, reference: asset.reference, text: decodeText(asset.data) })),
  }))
  return [
    '<!doctype html><meta charset="utf-8"><script>(()=>{',
    'const bytes=data=>Uint8Array.from(atob(data),character=>character.charCodeAt(0));',
    "const text=data=>new TextDecoder('utf-8',{fatal:true}).decode(bytes(data));",
    'const bundle=JSON.parse(text("', payload, '"));',
    'let html=bundle.html;',
    'for(const asset of bundle.assets){',
    "const script=asset.kind==='script';",
    "const url=URL.createObjectURL(new Blob([asset.text],{type:script?'application/javascript':'text/css'}));",
    "const name=script?'src':'href';",
    'const double=name+\'="\'+asset.reference+\'"\';',
    'const single=name+"=\'"+asset.reference+"\'";',
    'if(html.includes(double))html=html.split(double).join(name+\'="\'+url+\'"\');',
    'else if(html.includes(single))html=html.split(single).join(name+"=\'"+url+"\'");',
    'else html=html.split(asset.reference).join(url);',
    '}',
    'const write=()=>{document.open();document.write(html);document.close();};',
    'setTimeout(write,0);',
    '})()</script>',
  ].join('')
}
