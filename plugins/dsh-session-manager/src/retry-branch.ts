/**
 * Browser-safe retry helpers shared by the host service. Everything here is
 * pure over already-observed Session events: the fork-based commit reads the
 * same prompt, surface, and job facts the preview reported.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/**
 * Content digest of one prompt. Not a hash: the token only has to change when
 * the client edited between preview and commit, so the JSON of the durable
 * content is the honest cheapest representation.
 */
export function inputRevisionOf(event: SessionEvent<'user/message'>): string {
  return JSON.stringify(event.data.content)
}

/**
 * An edit of a turn's first input must not inherit its empty turn/step shell.
 * Find the last balanced, drained prefix before that shell, including inbox
 * splices: cutting just before turn/start can resurrect the original queued
 * prompt. A later input in the same turn keeps the real work before it.
 */
export function editForkBoundary(events: readonly SessionEvent[], promptSeq: number): number | undefined {
  const pending = { 'next-turn': 0, 'next-step': 0 }
  let open = false
  let hasContent = false
  let balanced: number | undefined
  let previous: number | undefined
  for (const event of events) {
    if (event.seq >= promptSeq) break
    const type: string = event.type
    if (type === 'agent/inbox/spliced') {
      const splice = event.data as { target: keyof typeof pending; start: number; removedCount?: number; inserted: readonly unknown[] }
      const count = pending[splice.target]
      const removed = splice.removedCount ?? 0
      if (count === undefined || !Array.isArray(splice.inserted)
        || !Number.isSafeInteger(splice.start) || splice.start < 0 || splice.start > count
        || !Number.isSafeInteger(removed) || removed < 0 || splice.start + removed > count) return undefined
      pending[splice.target] += splice.inserted.length - removed
    }
    if (type === 'turn/start') { open = true; hasContent = false }
    else if (type === 'turn/end') { open = false; hasContent = false }
    else if (type === 'user/message' || type === 'assistant/message' || type === 'tool/call'
      || type === 'tool/result' || type === 'command/run' || type === 'job/registered') hasContent = true
    previous = event.seq
    if (!open && pending['next-turn'] === 0 && pending['next-step'] === 0) balanced = event.seq
  }
  if (open && !hasContent) return balanced
  return pending['next-turn'] === 0 && pending['next-step'] === 0 ? previous : undefined
}

/**
 * Whether an already-observed prompt is still on the active surface: its seq
 * must not appear in any later event's `sourceEventSeqs`.
 */
export function isOnActiveSurface(events: readonly SessionEvent[], promptSeq: number): boolean {
  for (const event of events) {
    if (event.seq <= promptSeq) continue
    const seqs = (event as unknown as { sourceEventSeqs?: readonly number[] }).sourceEventSeqs
    if (Array.isArray(seqs) && seqs.includes(promptSeq)) return false
  }
  return true
}

/**
 * Later model-side work the user must explicitly keep (`allowModified`).
 * `command/run` and `job/*` are not in the stock SessionEventMap but a restored
 * log from a newer host can carry them, so the scan compares plain strings.
 */
const MODIFIED_EVIDENCE = new Set(['tool/call', 'tool/result', 'command/run', 'job/registered'])

export function modificationEvidence(events: readonly SessionEvent[], promptSeq: number): string[] {
  const seen = new Set<string>()
  for (const event of events) {
    const type: string = event.type
    if (event.seq > promptSeq && MODIFIED_EVIDENCE.has(type)) seen.add(type)
  }
  return [...seen]
}

/**
 * A live job started and not yet settled blocks retry like a running turn.
 * Job events are absent from the stock event union; the scan reads `jobId`
 * defensively so a log restored from a newer host still reports live work.
 */
export function hasLiveJobs(events: readonly SessionEvent[]): boolean {
  const live = new Set<string>()
  for (const event of events) {
    const type: string = event.type
    if (type !== 'job/registered' && type !== 'job/settled') continue
    const jobId = (event.data as { jobId?: unknown }).jobId
    if (typeof jobId !== 'string') continue
    if (type === 'job/registered') live.add(jobId)
    else live.delete(jobId)
  }
  return live.size > 0
}
