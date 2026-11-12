/**
 * dot's trajectory: her session log grouped into turns, steps and the records
 * inside them, the way DSH's trajectory view reads a session. dot's session
 * carries the subagent origin, which the browser's session reader refuses, so
 * the host folds the log and the panel draws it. Pure over raw events.
 */
import { textOf, type RawEvent } from './chat.ts'
import type { TrajectoryView, TrajRecord, TrajStep, TrajTurn, TrajUsage } from './contracts.ts'

/** Longest text kept per record; the panel says when a record was cut. */
export const TEXT_MAX = 4_000
/** Turns sent to the panel, newest last. */
export const TURN_WINDOW = 30

type Rec = Record<string, unknown>
const rec = (value: unknown): Rec | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Rec : undefined
const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined

function clip(text: string, max = TEXT_MAX): { text: string; clipped?: boolean } {
  return text.length > max ? { text: text.slice(0, max), clipped: true } : { text }
}

const INPUT_SOURCES: Record<string, Extract<TrajRecord, { kind: 'input' }>['source']> = {
  user: 'user',
  'agent-message': 'relay',
  'runtime-context': 'context',
  'time-context': 'context',
  'model-selection': 'notice',
}

function usageOf(value: unknown): TrajUsage | undefined {
  const usage = rec(value)
  const input = num(usage?.inputTokens)
  const output = num(usage?.outputTokens)
  if (input === undefined || output === undefined) return undefined
  return { input, output, cacheRead: num(usage?.cacheReadTokens) ?? 0 }
}

/** First streamed token: a chunk with text, or the start time of a recorded run of chunks. */
function firstToken(stream: unknown): number | undefined {
  if (!Array.isArray(stream)) return undefined
  let first: number | undefined
  for (const entry of stream) {
    const row = rec(entry)
    if (!row) continue
    const at = row.type === 'chunk' ? undefined : num(row.time0)
    if (at !== undefined) first = first === undefined ? at : Math.min(first, at)
  }
  return first
}

type MutableStep = { -readonly [K in keyof TrajStep]: TrajStep[K] }
type MutableTurn = { -readonly [K in keyof TrajTurn]: TrajTurn[K] }

export function foldTrajectory(events: Iterable<RawEvent>, window = TURN_WINDOW): Omit<TrajectoryView, 'sessionId'> {
  const turns: MutableTurn[] = []
  let turn: MutableTurn | undefined
  let step: MutableStep | undefined
  const calls = new Map<string, { records: TrajRecord[]; index: number }>()
  let model: string | undefined
  /** Inputs logged before their turn starts (inbox splices land ahead of turn/start). */
  let waiting: TrajRecord[] = []

  const target = (): TrajRecord[] => {
    if (step) return step.records as TrajRecord[]
    if (turn) return turn.records as TrajRecord[]
    return waiting
  }

  for (const event of events) {
    const data = rec(event.data) ?? {}
    const at = num(event.time) ?? 0
    const seq = num(event.seq) ?? 0
    switch (event.type) {
      case 'turn/start': {
        turn = { turn: num(data.turn) ?? turns.length + 1, startedAt: at, records: waiting, steps: [] }
        waiting = []
        step = undefined
        turns.push(turn)
        break
      }
      case 'turn/end': {
        if (!turn) break
        const reason = rec(data.reason)
        turn.endedAt = at
        if (typeof reason?.kind === 'string') turn.end = reason.kind
        const message = rec(reason?.error)?.message
        if (typeof message === 'string') turn.error = clip(message, 600).text
        turn = undefined
        step = undefined
        break
      }
      case 'step/start': {
        if (!turn) break
        step = { step: num(data.step) ?? turn.steps.length + 1, startedAt: at, records: [], ...model ? { model } : {} }
        ;(turn.steps as MutableStep[]).push(step)
        break
      }
      case 'step/end': {
        if (step) step.endedAt = at
        step = undefined
        break
      }
      case 'request/header': {
        const config = rec(rec(data.header)?.config)
        if (typeof config?.model === 'string') {
          model = config.model
          if (step) step.model = model
        }
        break
      }
      case 'user/message': {
        const source = rec(data.source)
        const kind = typeof source?.kind === 'string' ? source.kind : ''
        let mapped = INPUT_SOURCES[kind]
        if (!mapped) break
        if (mapped === 'user' && rec(rec(source)?.deepView)?.answer) mapped = 'answer'
        const text = textOf(data.content).trim()
        if (!text) break
        target().push({ kind: 'input', seq, at, source: mapped, ...clip(text) })
        break
      }
      case 'assistant/message': {
        const content = rec(data.message)?.content
        const records = target()
        if (Array.isArray(content)) {
          for (const block of content) {
            const row = rec(block)
            if ((row?.type === 'reasoning' || row?.type === 'text') && typeof row.text === 'string' && row.text.trim()) {
              records.push({ kind: row.type, seq, at, ...clip(row.text) })
            }
          }
        }
        if (step) {
          const usage = usageOf(data.usage)
          if (usage) step.usage = usage
          const first = firstToken(data.stream)
          if (first !== undefined) step.firstTokenAt = first
        }
        break
      }
      case 'assistant/attempt': {
        // A failed attempt: keep its reason on the step.
        if (!step || !Array.isArray(data.stream)) break
        for (const entry of data.stream) {
          const failure = rec(rec(rec(rec(entry)?.chunk)?.reason)?.failure)
          if (typeof failure?.message === 'string') step.failed = clip(failure.message, 600).text
        }
        break
      }
      case 'tool/call': {
        const callId = typeof data.callId === 'string' ? data.callId : String(seq)
        const raw = typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {})
        const args = clip(raw)
        const records = target()
        calls.set(callId, { records, index: records.length })
        records.push({ kind: 'call', seq, at, callId, name: typeof data.name === 'string' ? data.name : 'tool', args: args.text, ...args.clipped ? { argsClipped: true } : {}, status: 'running' })
        break
      }
      case 'tool/result': {
        const message = rec(data.message)
        const callId = typeof message?.toolCallId === 'string' ? message.toolCallId : undefined
        const found = callId === undefined ? undefined : calls.get(callId)
        const call = found?.records[found.index]
        if (!found || call?.kind !== 'call') break
        const result = clip(textOf(message?.content).trim())
        found.records[found.index] = { ...call, status: message?.isError === true ? 'error' : 'done', result: result.text, ...result.clipped ? { resultClipped: true } : {}, endedAt: at }
        break
      }
      case 'compaction/summary': {
        const text = textOf(data.summary).trim()
        const shadowed = num(data.shadowedTokenCount)
        target().push({ kind: 'compaction', seq, at, ...clip(text || 'compacted'), ...shadowed !== undefined ? { shadowed } : {} })
        break
      }
      default:
        break
    }
  }
  const earlier = Math.max(0, turns.length - window)
  return { turns: earlier ? turns.slice(earlier) : turns, earlier }
}

/** Step duration, time to first token and token totals of a turn, for its header row. */
export function turnTotals(turn: TrajTurn): { steps: number; calls: number; usage?: TrajUsage } {
  let calls = 0
  let usage: TrajUsage | undefined
  for (const step of turn.steps) {
    calls += step.records.filter(record => record.kind === 'call').length
    if (step.usage) usage = { input: (usage?.input ?? 0) + step.usage.input, output: (usage?.output ?? 0) + step.usage.output, cacheRead: (usage?.cacheRead ?? 0) + step.usage.cacheRead }
  }
  return { steps: turn.steps.length, calls, ...usage ? { usage } : {} }
}
