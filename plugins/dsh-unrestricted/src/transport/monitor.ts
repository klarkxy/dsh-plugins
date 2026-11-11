/**
 * Streaming guard for the request-boundary transport.
 *
 * A refusal is usually visible in the first few hundred characters. The guard
 * holds the opening chunks until it can decide: if the text opens like a
 * refusal it returns `refused` and discards the whole opening, so the caller can
 * make a second request without the user seeing the first refusal. A tool-call
 * delta or a sufficiently long answer commits the stream as a normal reply.
 */

import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { isRefusalText } from '../refusal.ts'

/** Outcome reported when the source stream ends. */
export interface GuardResult {
  /** Whether the opening looked like a refusal and was discarded. */
  refused: boolean
  /** The accumulated assistant text, used for logging. */
  text: string
  /** Whether any text or reasoning chunk was seen. */
  sawOutput: boolean
}

/** How many characters are inspected before the stream is committed. */
export const GUARD_CHARS = 640

/** Bound reasoning held while the opening is still uncommitted. */
export const GUARD_REASONING_CHARS = 8192

/**
 * Wrap one model stream with refusal-aware buffering.
 *
 * @param source - the provider stream from the next waterfall listener.
 * @returns chunks for a normal reply, or a `refused` result if the opening is a refusal.
 */
export async function* guardStream(source: AsyncIterable<StreamChunk>): AsyncGenerator<StreamChunk, GuardResult> {
  const pending: StreamChunk[] = []
  let text = ''
  let sawOutput = false
  let reasoning = 0
  let decided = false

  for await (const chunk of source) {
    if (decided) {
      yield chunk
      continue
    }

    if (chunk.type === 'text-delta') {
      pending.push(chunk)
      text += chunk.text
      sawOutput = true
      if (text.length >= GUARD_CHARS) {
        if (isRefusalText(text)) return { refused: true, text, sawOutput }
        for (const item of pending) yield item
        pending.length = 0
        decided = true
      }
      continue
    }

    if (chunk.type === 'reasoning-delta') {
      pending.push(chunk)
      sawOutput = true
      reasoning += chunk.text.length
      if (text === '' && reasoning >= GUARD_REASONING_CHARS) {
        for (const item of pending) yield item
        pending.length = 0
        decided = true
      }
      continue
    }

    if (chunk.type === 'tool-call-delta') {
      // A tool call means the model is already executing the task, not refusing.
      for (const item of pending) yield item
      pending.length = 0
      decided = true
      yield chunk
      continue
    }

    if (chunk.type === 'finish') {
      if (isRefusalText(text)) return { refused: true, text, sawOutput }
      for (const item of pending) yield item
      pending.length = 0
      decided = true
      yield chunk
      continue
    }

    pending.push(chunk)
  }

  if (!decided) {
    if (isRefusalText(text)) return { refused: true, text, sawOutput }
    for (const item of pending) yield item
    pending.length = 0
  }
  return { refused: false, text, sawOutput }
}
