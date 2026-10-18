/**
 * Browser half of the 破限模式 / Unrestricted mode preset.
 *
 * Two jobs, both about copy the host renders from a plain string:
 *
 * 1. A preset declaration carries one name and one description, and the host
 *    translates only its own presets, so this half swaps the published Chinese
 *    copy for the active interface language.
 * 2. The account-ban warning inside the description is split into its own span
 *    and painted with the theme's error colour.
 *
 * Both rewrite the text node the renderer owns instead of replacing it, and
 * every element this half inserts is marked, so a re-render or a language
 * change rebuilds the copy instead of stacking copies on top of it.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  PLUGIN_NAME, PRESET_COPY, PRESET_ID, WARNING_ATTRIBUTE, WARNING_MARKS,
} from './contracts.ts'

/** The browser half's own name, beside the Host half's package name. */
export const name = 'dsh-unrestricted-client'

/** The locale service decides which copy is shown. */
export const inject = ['locale'] as const

/** The one rule this half adds; every other card style stays the host's. */
export const WARNING_CSS = `[${WARNING_ATTRIBUTE}]{color:var(--dsw-alias-label-error)}`

/** Display copy this half knows, first entry being what the bundle publishes. */
const COPY = [PRESET_COPY.zh, PRESET_COPY.en] as const

/** One language's copy. */
type Copy = (typeof COPY)[number]

/** Warning sentences across languages: one pattern matches whichever is shown. */
const MARKS: readonly string[] = [WARNING_MARKS.zh, WARNING_MARKS.en]

const NAMES: readonly string[] = COPY.map(entry => entry.name)
const DESCRIPTIONS: readonly string[] = COPY.map(entry => entry.description)

/** The picker row and the settings card of this preset. */
const OWN_ROWS = `button[role="menuitem"],[data-agent-preset-id="${PRESET_ID}"]`

/** A tooltip bubble repeats a description the surface could not show in full. */
const TOOLTIPS = '[role="tooltip"]'

/** The session-header label titles itself with the preset's own description. */
const TITLED = 'span[title]'

/** Literal alternatives, matched anywhere inside one description text node. */
const WARNING_PATTERN = new RegExp(MARKS.map(escapeForRegExp).join('|'), 'g')

/** The client locale service: the active interface language. */
interface LocaleService {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

/** @param literal - text to match verbatim.
 * @returns the same text with regular-expression metacharacters escaped. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** @param locale - the locale service.
 * @returns the copy the active interface language asks for. */
function activeCopy(locale: LocaleService): Copy {
  return locale.getSnapshot().active.toLowerCase().startsWith('zh') ? PRESET_COPY.zh : PRESET_COPY.en
}

/** @param text - text read from a node.
 * @returns whether it is a name, a description or a warning this half rewrites. */
function holdsCopy(text: string): boolean {
  return NAMES.includes(text) || DESCRIPTIONS.includes(text) || MARKS.some(mark => text.includes(mark))
}

/** @param node - a node an observer just saw added.
 * @returns whether a preset card could be inside it. */
function mayHoldCard(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  return holdsCopy((node as Element).textContent ?? '')
}

/** @returns every element currently showing this preset's copy. */
function targets(): Element[] {
  const found: Element[] = []
  for (const element of document.querySelectorAll(OWN_ROWS)) {
    // The selector covers every menu row; only this preset's row carries the copy.
    if (element.getAttribute('role') !== 'menuitem'
      || NAMES.some(entry => (element.textContent ?? '').includes(entry))) {
      found.push(element)
    }
  }
  for (const element of document.querySelectorAll(TITLED)) {
    if (DESCRIPTIONS.includes(element.getAttribute('title') ?? '')) found.push(element)
  }
  for (const element of document.querySelectorAll(TOOLTIPS)) {
    if (holdsCopy(element.textContent ?? '')) found.push(element)
  }
  return found
}

/**
 * Wrap each warning sentence in one description text node, keeping the leading
 * run in the node the renderer created.
 * @param node - a text node containing at least one warning sentence.
 */
function splitWarnings(node: Text): void {
  const text = node.nodeValue ?? ''
  const parent = node.parentNode
  if (parent === null) return
  const marks = [...text.matchAll(WARNING_PATTERN)]
  const first = marks[0]
  /* v8 ignore next -- callers pass a node that matched. */
  if (first === undefined) return
  const pieces: Node[] = []
  for (const [index, mark] of marks.entries()) {
    const end = (mark.index ?? 0) + mark[0].length
    const next = marks[index + 1]
    const warning = document.createElement('span')
    warning.setAttribute(WARNING_ATTRIBUTE, '')
    warning.textContent = mark[0]
    pieces.push(warning)
    const plain = text.slice(end, next === undefined ? text.length : next.index)
    if (plain !== '') pieces.push(document.createTextNode(plain))
  }
  node.nodeValue = text.slice(0, first.index ?? 0)
  node.after(...pieces)
}

/** @param root - one element showing this preset's copy.
 * @param copy - the copy the active language asks for. */
function localize(root: Element, copy: Copy): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.nodeValue ?? ''
    if (NAMES.includes(text) && text !== copy.name) node.nodeValue = copy.name
  }
  for (const element of [root, ...root.querySelectorAll(TITLED)]) {
    const title = element.getAttribute('title') ?? ''
    if (DESCRIPTIONS.includes(title) && title !== copy.description) element.setAttribute('title', copy.description)
  }
}

/** @param root - one element showing this preset's copy.
 * @returns the element hosting the description inside it, if the surface shows one. */
function descriptionHost(root: Element): Element | undefined {
  const marked = root.querySelector(`[${WARNING_ATTRIBUTE}]`)
  if (marked !== null) return marked.parentElement ?? undefined
  const shown = DESCRIPTIONS.find(description => (root.textContent ?? '').includes(description))
  if (shown === undefined) return undefined
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    // A rebuilt copy starts with the same words as the published one; the rest
    // of the text may already be split into this half's spans.
    if ((node.nodeValue ?? '').startsWith(shown.slice(0, 24))) return node.parentElement ?? undefined
  }
  return undefined
}

/** @param host - the element holding the description text.
 * @param copy - the copy the active language asks for. */
function applyCopy(host: Element, copy: Copy): void {
  const base = host.firstChild
  if (base === null || base.nodeType !== Node.TEXT_NODE) return
  // This copy is already in place and already split: nothing to rebuild.
  if ((host.textContent ?? '') === copy.description && host.childNodes.length > 1) return
  // Every sibling after the renderer's node is this half's own. Dropping them
  // covers both reasons to rebuild: another language is shown, or a render wrote
  // the description over the markup. The wanted copy then goes back into the
  // node the renderer owns, with the warning split out of it.
  for (let node = base.nextSibling; node !== null;) {
    const next = node.nextSibling
    node.remove()
    node = next
  }
  ;(base as Text).nodeValue = copy.description
  splitWarnings(base as Text)
}

/** @param root - one element showing this preset's copy.
 * @param copy - the copy the active language asks for. */
function markTarget(root: Element, copy: Copy): void {
  localize(root, copy)
  const host = descriptionHost(root)
  if (host !== undefined) applyCopy(host, copy)
}

/**
 * Mark each target as it appears, and rebuild it when it is rendered again or
 * the interface language changes.
 * @param copyOf - reads the copy the active language asks for.
 * @returns the disposer that stops watching, and a way to scan on demand.
 */
function watchTargets(copyOf: () => Copy): { stop: () => void; rescan: () => void } {
  let frame: number | null = null
  const scan = (): void => {
    frame = null
    const copy = copyOf()
    for (const root of targets()) markTarget(root, copy)
  }
  const rescan = (): void => {
    if (frame !== null) return
    frame = requestAnimationFrame(scan)
  }
  /** @param node - a text node that just changed.
   * @returns whether it sits on a surface this half writes into. */
  const nearCopy = (node: Node): boolean => {
    const element = node.parentElement
    if (element === null) return false
    return element.closest(`${OWN_ROWS},${TOOLTIPS}`) !== null
      || DESCRIPTIONS.includes(element.getAttribute('title') ?? '')
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      // Text elsewhere on the page changes on every streaming chunk; only a
      // node on one of these surfaces can invalidate this half's work.
      if (record.type === 'characterData') {
        if (nearCopy(record.target)) { rescan(); return }
        continue
      }
      for (const node of record.addedNodes) {
        if (mayHoldCard(node)) { rescan(); return }
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  return {
    rescan,
    stop: () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    },
  }
}

/** @param ctx - the client context, which owns the stylesheet, the observer and the locale subscription. */
export function apply(ctx: Context): void {
  const client = ctx as unknown as Context & { locale: LocaleService }
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', PLUGIN_NAME)
    style.textContent = WARNING_CSS
    document.head.append(style)
    const watch = watchTargets(() => activeCopy(client.locale))
    // The card can already be mounted: the plugin loads beside a live picker.
    watch.rescan()
    const stopLocale = client.locale.subscribe(watch.rescan)
    return () => {
      stopLocale()
      watch.stop()
      style.remove()
    }
  }, 'unrestricted.copy')
}
