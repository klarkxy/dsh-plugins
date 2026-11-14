/**
 * Output redaction: a defense-in-depth layer, never a guarantee.
 *
 * The Host remembers which values one tool execution was given, per call, and
 * replaces those exact strings in what that call finally exposes. The snapshot
 * is what matters: a revocation between two shell calls removes the value from
 * later executions, while the execution already running keeps redacting its own
 * output. Recording is therefore tied to the execution that resolved the value,
 * not to the current grants.
 *
 * Every value this plugin accepts is masked, with no minimum length: a stored
 * value that could not be masked would be a value this layer provably fails to
 * protect. The only refusals at insertion are an empty value, transport-hostile
 * characters and an upper bound, so "stored" and "maskable" are the same set.
 *
 * `guardDecision` is the whole policy. It runs on the final `PostToolDecision`,
 * so a later listener's block or replacement wins first; this layer never
 * overrides a policy decision. What it cannot rewrite — the canonical `meta`, the
 * result's own `additionalContexts` (the executor merges those itself), and an
 * error's canonical value — becomes a fixed safe block rather than a partial
 * pass-through.
 *
 * What no decision can cover is stated in the plugin README: anything a shell
 * process writes to its live stream, to a spill file, to a persistent shell's
 * screen, or into a provider's own log has already left before a tool result
 * exists.
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { REDACTION_MARKER } from './contracts.ts'

/** Fixed text for a result that could not be made safe. Carries no request data. */
export const SAFE_BLOCK_TEXT = 'Tool output withheld: it contained a stored credential. Re-run the call without printing the value.'

function eligible(values: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) seen.add(value)
  }
  // Longest first: masking a value that contains another cannot leave the
  // shorter one's remainder readable.
  return [...seen].sort((left, right) => right.length - left.length)
}

/** Replace every occurrence of each value in one text. */
export function maskValues(text: string, values: readonly string[]): string {
  if (typeof text !== 'string' || text.length === 0) return text
  let masked = text
  for (const value of eligible(values)) {
    if (!masked.includes(value)) continue
    masked = masked.split(value).join(REDACTION_MARKER)
  }
  return masked
}

/** Whether a value would be masked at all; the Host stores nothing that would not. */
export function isMaskable(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** True when any string inside this JSON-ish value holds one of the secrets. */
export function containsValue(value: unknown, values: readonly string[]): boolean {
  if (values.length === 0) return false
  if (typeof value === 'string') return values.some(secret => value.includes(secret))
  if (Array.isArray(value)) return value.some(item => containsValue(item, values))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .some(([key, item]) => containsValue(key, values) || containsValue(item, values))
  }
  return false
}

/** Mask every string inside this JSON-ish value, preserving its shape. */
export function sanitizeValue<T>(value: T, values: readonly string[]): T {
  if (typeof value === 'string') return maskValues(value, values) as unknown as T
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, values)) as unknown as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = sanitizeValue(item, values)
    return out as unknown as T
  }
  return value
}

/** Mask text blocks; any block still holding a secret afterwards is a leak. */
export function sanitizeBlocks(blocks: readonly ContentBlock[], values: readonly string[]): ContentBlock[] {
  return blocks.map((block) => {
    if (block.type === 'text') {
      const text = maskValues(block.text, values)
      return text === block.text ? block : { ...block, text }
    }
    return sanitizeValue(block, values)
  })
}

function safeBlock(): PostToolDecision {
  return { kind: 'block', feedback: [{ type: 'text', text: SAFE_BLOCK_TEXT }] }
}

/**
 * The committed decision handed to the pipeline.
 *
 * `next()` already ran every later listener, so a `block` or a replacement here
 * is their decision and only the strings inside it are masked. The executor
 * appends the result's own `additionalContexts` to whatever this returns, which
 * is why this function never repeats them — it can only sanitize its own.
 */
export function guardDecision(
  decision: PostToolDecision,
  result: Readonly<ToolExecutionResult>,
  values: readonly string[],
): PostToolDecision {
  if (values.length === 0) return decision

  // Surfaces no decision can rewrite: a successful result's `meta` has no field
  // here, the result's own contexts are merged by the executor, and a failure's
  // canonical text — content, value and the structured `error` (message plus
  // `info.reason`) — cannot be replaced by a decision. Only a success's value can.
  const errorLeak = result.isError && (
    containsValue(result.content, values)
    || containsValue(result.value, values)
    || containsValue(result.error, values)
  )
  if (errorLeak || containsValue(result.meta, values) || containsValue(result.additionalContexts, values)) {
    return safeBlock()
  }

  if (decision.kind === 'block') {
    const feedback = sanitizeBlocks(decision.feedback, values)
    if (containsValue(feedback, values)) return safeBlock()
    const contexts = decision.additionalContexts
    if (contexts === undefined) return { kind: 'block', feedback }
    const safeContexts = sanitizeValue(contexts, values)
    if (containsValue(safeContexts, values)) return safeBlock()
    return { kind: 'block', feedback, additionalContexts: safeContexts as UserMessage[] }
  }

  const ownContexts = decision.additionalContexts
  const contextsOf = (): UserMessage[] | undefined => {
    if (ownContexts === undefined) return undefined
    const safe = sanitizeValue(ownContexts, values)
    return containsValue(safe, values) ? undefined : safe
  }

  if (decision.value !== undefined) {
    if (!containsValue(decision.value, values)) {
      const contexts = contextsOf()
      return contexts === undefined ? decision : { kind: 'accept', value: decision.value, additionalContexts: contexts }
    }
    const sanitized = sanitizeValue(decision.value, values)
    if (containsValue(sanitized, values)) return safeBlock()
    const contexts = contextsOf()
    return { kind: 'accept', value: sanitized, ...(contexts === undefined ? {} : { additionalContexts: contexts }) }
  }

  // A content projection keeps the canonical value; if that value leaks, the
  // value must be replaced instead (the pipeline re-renders content from it).
  if (containsValue(result.value, values)) {
    const sanitized = sanitizeValue(result.value, values)
    if (containsValue(sanitized, values)) return safeBlock()
    const contexts = contextsOf()
    return { kind: 'accept', value: sanitized, ...(contexts === undefined ? {} : { additionalContexts: contexts }) }
  }

  const source = decision.content ?? result.content
  const contentLeak = containsValue(source, values)
  const contexts = contextsOf()
  if (!contentLeak && contexts === undefined) return decision
  const content = sanitizeBlocks(source, values)
  if (containsValue(content, values)) return safeBlock()
  return { kind: 'accept', content, ...(contexts === undefined ? {} : { additionalContexts: contexts }) }
}

export class Redactor {
  private readonly perCall = new Map<string, string[]>()

  /** Attach the values one execution resolved, for that call's own result. */
  record(callId: string, values: readonly string[]): void {
    const filtered = eligible(values)
    if (filtered.length === 0) return
    const current = this.perCall.get(callId) ?? []
    this.perCall.set(callId, [...new Set([...current, ...filtered])])
  }

  /** Consume one execution's snapshot; a later result never inherits it. */
  take(callId: string): string[] {
    const values = this.perCall.get(callId)
    if (values === undefined) return []
    this.perCall.delete(callId)
    return values
  }

  /** Mask text with values reported for this call, if any are still pending. */
  redact(text: string, values: readonly string[]): string {
    return maskValues(text, values)
  }

  clear(): void {
    this.perCall.clear()
  }
}

/**
 * The `tools/post-execute` listener body. Exported so the Host wiring stays a
 * one-liner and the policy can be tested with real decision shapes.
 */
export function createRedactionListener(redactor: Redactor) {
  return async (
    exec: { callId: string },
    result: Readonly<ToolExecutionResult>,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    const decision = await next()
    const values = redactor.take(String(exec.callId))
    if (values.length === 0) return decision
    return guardDecision(decision, result, values)
  }
}
