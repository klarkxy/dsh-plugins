// Adapted from @deepseek-ai/dsh-client-ui-sidebar-documentpreview 0.2.2-rc.5
// (MIT License). Copyright (c) 2026 DeepSeek.
// Author-HTML analysis on a single parse5 pass: packed asset references with
// every URL attribute's source range, plus the capture insertion point. The
// source itself is only spliced, never reserialized, so textarea/pre leading
// newlines survive; locations come from the decoded string bootstrap writes.
import { parse, type DefaultTreeAdapterMap } from 'parse5'

type Document = DefaultTreeAdapterMap['document']
type Element = DefaultTreeAdapterMap['element']

/** One `name="value"` attribute occurrence, UTF-16 offsets into the decoded source. */
export interface SourceRange {
  readonly start: number
  readonly end: number
}

/**
 * A distinct statically declared local script or stylesheet plus every source
 * occurrence of its URL attribute. `reference` is entity-decoded, the same
 * value the DOM `getAttribute` semantics produced before.
 */
export interface SourceAsset {
  readonly kind: 'script' | 'stylesheet'
  /** Original HTML attribute, not a Host absolute path. */
  readonly reference: string
  /** Every `name="value"` occurrence in document order; each one is rewritten. */
  readonly ranges: readonly SourceRange[]
}

/** The parse5 scan of one decoded author document. */
export interface CanvasSource {
  /** A declared `<base href>` leaves URL resolution to the browser; nothing is packed. */
  readonly hasBaseHref: boolean
  /** Distinct (kind, reference) assets in first-occurrence order. */
  readonly assets: readonly SourceAsset[]
}

/** Where the capture element belongs in the decoded source. */
export interface CaptureInsertion {
  /** UTF-16 offset the capture text is spliced in at. */
  readonly offset: number
  /** No explicit `<head>` start tag: the capture needs its own `<head>` wrapper. */
  readonly wrapHead: boolean
}

/** Whether this reference can be read relative to the original document, never the parent application URL. */
function relative(reference: string): boolean {
  return reference.length > 0 && !/^(?:[a-z][a-z\d+.-]*:|[/#?])/iu.test(reference) && !reference.includes('\0')
}

const attribute = (element: Element, name: string): string | undefined =>
  element.attrs.find(attr => attr.name === name)?.value

const attributeRange = (element: Element, name: string): SourceRange | undefined => {
  const location = element.sourceCodeLocation?.attrs?.[name]
  return location === undefined ? undefined : { start: location.startOffset, end: location.endOffset }
}

/**
 * Collect candidate asset references and base-element state from one parse.
 * `<template>` content is a separate parse5 fragment rather than a child node,
 * so the element walk never reaches scripts or links declared inside templates.
 * Only direct .js classic scripts and .css stylesheet links qualify; local CSS
 * url/import, modules and dynamically constructed URLs stay unsupported.
 * @param html - decoded author HTML (the same string `decodeText` produced).
 */
export function scanCanvasSource(html: string): CanvasSource {
  const doc = parse(html, { sourceCodeLocationInfo: true })
  const assets: SourceAsset[] = []
  const byKey = new Map<string, { kind: SourceAsset['kind']; reference: string; ranges: SourceRange[] }>()
  let hasBaseHref = false
  const collect = (element: Element, kind: SourceAsset['kind']): void => {
    const name = kind === 'script' ? 'src' : 'href'
    const reference = attribute(element, name)
    if (reference === undefined) return
    const suffix = reference.search(/[?#]/u)
    const path = suffix === -1 ? reference : reference.slice(0, suffix)
    if (!relative(reference) || !(kind === 'script' ? /\.js$/iu : /\.css$/iu).test(path)) return
    const key = `${kind}:${reference}`
    const entry = byKey.get(key)
    const range = attributeRange(element, name)
    if (entry !== undefined) {
      // A repeated declaration packs once but every occurrence is rewritten.
      if (range !== undefined) entry.ranges.push(range)
      return
    }
    const asset = { kind, reference, ranges: range === undefined ? [] : [range] }
    byKey.set(key, asset)
    assets.push(asset)
  }
  const visit = (node: Document | Element): void => {
    for (const child of node.childNodes) {
      const element = child as Element
      if (element.tagName === undefined) continue
      if (element.tagName === 'base' && attribute(element, 'href') !== undefined) hasBaseHref = true
      if (element.tagName === 'script') {
        const type = attribute(element, 'type')?.trim().toLowerCase() ?? ''
        if (['', 'text/javascript', 'application/javascript'].includes(type)) collect(element, 'script')
      } else if (element.tagName === 'link') {
        const rel = attribute(element, 'rel') ?? ''
        if (rel.toLowerCase().split(/\s+/u).includes('stylesheet')) collect(element, 'stylesheet')
      }
      visit(element)
    }
  }
  visit(doc)
  return { hasBaseHref, assets }
}

/**
 * The capture insertion point, from the same parse semantics the asset scan
 * uses: the real `<head>` start tag end (its `>` may sit inside a quoted
 * attribute), else the explicit `<html>` start tag end wrapped in a new head,
 * else after the doctype node, else the document start. Comments never count:
 * a `<head>` mentioned inside one is not an element.
 * @param html - decoded author HTML.
 */
export function captureInsertion(html: string): CaptureInsertion {
  const doc = parse(html, { sourceCodeLocationInfo: true })
  const root = doc.childNodes.find((child): child is Element => (child as Element).tagName === 'html')
  // parse5 always materializes head; an implicit one has no source location.
  const head = root?.childNodes.find((child): child is Element => (child as Element).tagName === 'head')
  const headTag = head?.sourceCodeLocation?.startTag
  if (headTag !== undefined) return { offset: headTag.endOffset, wrapHead: false }
  const rootTag = root?.sourceCodeLocation?.startTag
  if (rootTag !== undefined) return { offset: rootTag.endOffset, wrapHead: true }
  const doctype = doc.childNodes.find(child => child.nodeName === '#documentType')
  const doctypeEnd = doctype?.sourceCodeLocation?.endOffset
  if (doctypeEnd !== undefined) return { offset: doctypeEnd, wrapHead: false }
  return { offset: 0, wrapHead: false }
}
