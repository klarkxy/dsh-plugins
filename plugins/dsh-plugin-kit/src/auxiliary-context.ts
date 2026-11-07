/**
 * Auxiliary request-context packing for feature model calls.
 *
 * A feature may prepend stable material (session facts, its own durable
 * records) to the live request so provider-side caching reuses one prefix.
 * Three invariants keep this honest and testable:
 *
 * - Material is rebuilt by the caller from current facts on every call;
 *   nothing here stores, accumulates or replays model outputs.
 * - Order is caller-owned: stable material first, live request last.
 * - A context that exceeds its byte budget fails loudly instead of
 *   silently dropping evidence.
 *
 * Pure and browser-safe: no host imports.
 */

/** Thrown when packed context exceeds the caller's byte budget. */
export class AuxiliaryContextTooLargeError extends Error {
  readonly bytes: number
  readonly maxBytes: number
  constructor(bytes: number, maxBytes: number) {
    super(`Auxiliary context is ${bytes} bytes, over the ${maxBytes}-byte budget.`)
    this.name = 'AuxiliaryContextTooLargeError'
    this.bytes = bytes
    this.maxBytes = maxBytes
  }
}

const utf8 = new TextEncoder()

function byteLength(text: string): number {
  return utf8.encode(text).byteLength
}

function normalizeSegments(context: string | readonly string[] | undefined): readonly string[] {
  if (context === undefined) return []
  const list: readonly string[] = typeof context === 'string' ? [context] : context
  return list.filter(segment => typeof segment === 'string' && segment.length > 0)
}

/**
 * Join stable material segments for one request. The packed text must fit
 * `maxBytes` or the call throws — the caller decides what to drop, so
 * evidence is never silently truncated. Empty input packs to ''.
 */
export function packAuxiliaryContext(segments: readonly string[], maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid auxiliary context budget')
  const text = normalizeSegments(segments).join('\n')
  if (byteLength(text) > maxBytes) throw new AuxiliaryContextTooLargeError(byteLength(text), maxBytes)
  return text
}

/** Only word characters, dots, colons and dashes are kept inside the feature attribute. */
function featureAttribute(feature: string): string {
  return feature.replaceAll(/[^\w.:-]/g, '_')
}

/**
 * Assemble the single user message for an auxiliary model call: stable
 * material in one labelled block first, the live request last. With no
 * context the result is byte-identical to `text`, so callers without
 * material keep exactly the previous wire shape.
 */
export function buildAuxiliaryUserText(request: {
  feature?: string
  context?: string | readonly string[]
  text: string
}): string {
  const context = normalizeSegments(request.context)
  if (!context.length) return request.text
  const attribute = request.feature ? ` feature="${featureAttribute(request.feature)}"` : ''
  return `<auxiliary-context${attribute}>\n${context.join('\n')}\n</auxiliary-context>\n<request>\n${request.text}\n</request>`
}
