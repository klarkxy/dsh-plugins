import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { PREVIEW_CONTEXT_CHARS, PREVIEW_REQUEST_CHARS, PREVIEW_RESPONSE_CHARS } from './contracts.ts'

export interface SourceReference {
  sessionId: string
  turnId: string
  seq: number
  /** Unicode code-point range in the visible text of this event. */
  start?: number
  end?: number
}
export interface TurnText {
  kind: 'request' | 'context' | 'conclusion' | 'partial-response' | 'notice'
  text: string
  reference: SourceReference
  sourceKind?: string
  truncated?: boolean
  continued?: boolean
}
export interface SessionTurn {
  turnId: string
  number?: number
  state: string
  boundary: 'recorded' | 'legacy'
  startSeq: number
  endSeq: number
  stateReference?: SourceReference
  error?: { message?: string; code?: string }
  inherited: boolean
  toolCalls: number
  eventSeqs: number[]
  parts: TurnText[]
}
export interface TurnPage {
  turnId: string
  number?: number
  state: string
  boundary: SessionTurn['boundary']
  startSeq: number
  endSeq: number
  stateReference?: SourceReference
  error?: SessionTurn['error']
  errorTruncated?: boolean
  inherited: boolean
  toolCalls: number
  requests: TurnText[]
  context: TurnText[]
  conclusion?: TurnText
  partialResponse?: TurnText
  /** Remains present when a long request pushes the full response onto a later page. */
  responseLocator?: SourceReference
  responsePreview?: string
  responseKind?: 'conclusion' | 'partial-response'
  partial: boolean
}

export function visibleEventText(event: SessionEvent): string {
  const data = event.data as Record<string, any>
  const content = event.type === 'user/message' ? data.content : data.message?.content
  return Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('\n') : ''
}

/** Uses only standard persistent events. User-role requests can also be delegated tasks. */
export function projectTurns(events: readonly SessionEvent[], sessionId: string, inheritedEventCount: number): SessionTurn[] {
  const turns: SessionTurn[] = [], numbered = new Map<number, SessionTurn>()
  let current: SessionTurn | undefined
  const assistants = new Map<SessionTurn, SessionEvent>()
  const create = (event: SessionEvent, number?: number, recorded = false) => {
    const turn: SessionTurn = {
      turnId: `${recorded ? 'turn' : 'legacy'}:${event.seq}`, number,
      state: recorded ? 'in-progress' : 'unknown', boundary: recorded ? 'recorded' : 'legacy',
      startSeq: event.seq, endSeq: event.seq, inherited: event.seq < inheritedEventCount,
      toolCalls: 0, eventSeqs: [], parts: [],
    }
    turns.push(turn)
    if (number !== undefined) numbered.set(number, turn)
    current = turn
    return turn
  }
  const ref = (turn: SessionTurn, seq: number): SourceReference => ({ sessionId, turnId: turn.turnId, seq })
  for (const event of events) {
    const data = event.data as Record<string, any>
    const number = Number.isSafeInteger(data.turn) && data.turn >= 0 ? data.turn as number : undefined
    let turn: SessionTurn
    if (event.type === 'turn/start') turn = create(event, number, true)
    else if (number !== undefined) {
      turn = numbered.get(number) ?? (current?.boundary === 'legacy' && current.number === undefined ? current : create(event, number))
      if (turn.number === undefined) { turn.number = number; numbered.set(number, turn) }
    } else if (event.type === 'user/message' && (!current || current.state !== 'in-progress')) turn = create(event)
    else if (current) turn = current
    else if (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/call' || event.type === 'tool/result') turn = create(event)
    else continue
    turn.endSeq = Math.max(turn.endSeq, event.seq)
    turn.eventSeqs.push(event.seq)
    if (event.type === 'turn/end') {
      turn.state = typeof data.reason?.kind === 'string' ? data.reason.kind : 'unknown'
      turn.stateReference = ref(turn, event.seq)
      if (turn.state === 'error') turn.error = { message: data.reason.error?.message, code: data.reason.error?.code }
    } else if (event.type === 'tool/call') turn.toolCalls++
    else if (event.type === 'user/message' && isAppendSurfaceEvent(event)) {
      const sourceKind = typeof data.source?.kind === 'string' ? data.source.kind : undefined
      const text = visibleEventText(event)
      turn.parts.push({ kind: sourceKind && sourceKind !== 'user' ? 'context' : 'request', text,
        reference: ref(turn, event.seq), ...sourceKind ? { sourceKind } : {} })
    } else if (event.type === 'assistant/message' && isAppendSurfaceEvent(event)) assistants.set(turn, event)
  }
  for (const turn of turns) {
    const event = assistants.get(turn)
    if (event) {
      const data = event.data as Record<string, any>, text = visibleEventText(event)
      const calls = data.message?.content?.some((block: { type: string }) => block.type === 'tool-call')
      if (text) turn.parts.push({
        kind: turn.state === 'completed' && !data.interrupted && !calls ? 'conclusion' : 'partial-response',
        text, reference: ref(turn, event.seq),
      })
    }
    turn.parts.sort((a, b) => a.reference.seq - b.reference.seq)
    if (!turn.parts.length) turn.parts.push({ kind: 'notice', text: '', reference: ref(turn, turn.startSeq) })
  }
  return turns.reverse()
}

function frame(turn: SessionTurn): TurnPage {
  const response = turn.parts.find(part => part.kind === 'conclusion' || part.kind === 'partial-response')
  const error = turn.error ? {
    message: turn.error.message === undefined ? undefined : Array.from(turn.error.message).slice(0, 120).join(''),
    code: turn.error.code === undefined ? undefined : Array.from(turn.error.code).slice(0, 64).join(''),
  } : undefined
  return {
    turnId: turn.turnId, ...turn.number === undefined ? {} : { number: turn.number },
    state: turn.state, boundary: turn.boundary, startSeq: turn.startSeq, endSeq: turn.endSeq,
    ...turn.stateReference ? { stateReference: turn.stateReference } : {}, ...error ? { error,
      errorTruncated: error.message !== turn.error?.message || error.code !== turn.error?.code } : {},
    inherited: turn.inherited, toolCalls: turn.toolCalls, requests: [], context: [], partial: false,
    ...response ? { responseLocator: response.reference, responseKind: response.kind as 'conclusion' | 'partial-response',
      responsePreview: Array.from(response.text).slice(0, 100).join('') } : {},
  }
}

function append(target: TurnPage, part: TurnText) {
  if (part.kind === 'request') target.requests.push(part)
  else if (part.kind === 'context') target.context.push(part)
  else if (part.kind === 'conclusion') target.conclusion = part
  else if (part.kind === 'partial-response') target.partialResponse = part
}

/** Whole turns first, then whole messages; only an oversized message is split. */
export function pageTurns(turns: readonly SessionTurn[], index: number, offset: number, budget: number, limit: number) {
  const units = turns.flatMap(turn => turn.parts.map(part => ({ turn, part })))
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(offset) || index < 0 || offset < 0 || index > units.length
    || (index === units.length && offset > 0)) throw new RangeError('turn page position is invalid')
  const output: TurnPage[] = []
  const measure = (rows: TurnPage[], at: number, position: number) => Buffer.byteLength(JSON.stringify({ turns: rows,
    ...at < units.length ? { nextIndex: at, nextOffset: position } : {} }), 'utf8')
  while (index < units.length && output.length < limit) {
    const turn = units[index]!.turn
    let end = index
    while (end < units.length && units[end]!.turn === turn) end++
    const whole = frame(turn)
    for (let at = index; at < end; at++) append(whole, units[at]!.part)
    whole.partial = offset > 0 || (index > 0 && units[index - 1]!.turn === turn)
    if (!offset && measure([...output, whole], end, 0) <= budget) { output.push(whole); index = end; continue }
    // Do not start another partial turn when preceding complete turns already fill this page.
    if (output.length) break
    const partial = frame(turn)
    partial.partial = true
    for (; index < end; index++) {
      const original = units[index]!.part, points = Array.from(original.text)
      if (offset > points.length || (offset === points.length && offset > 0)) throw new RangeError('message position is invalid')
      const slice = (count: number): TurnText => ({ ...original, text: points.slice(offset, offset + count).join(''),
        reference: { ...original.reference, start: offset, end: offset + count },
        truncated: offset + count < points.length, continued: offset > 0 })
      const fits = (count: number) => {
        const candidate = structuredClone(partial)
        append(candidate, slice(count))
        const complete = offset + count === points.length
        return measure([candidate], complete ? index + 1 : index, complete ? 0 : offset + count) <= budget
      }
      let count = points.length - offset
      if (!fits(count)) {
        if (partial.requests.length || partial.context.length || partial.conclusion || partial.partialResponse) break
        let low = 0, high = count
        while (low < high) { const mid = Math.ceil((low + high) / 2); if (fits(mid)) low = mid; else high = mid - 1 }
        count = low
        if (count === 0 && points.length > offset) throw new RangeError('page budget cannot fit one turn message; increase pageChars')
      }
      if (!fits(count)) throw new RangeError('page budget cannot fit one turn header; increase pageChars')
      append(partial, slice(count))
      offset += count
      if (offset < points.length) { output.push(partial); return { turns: output, nextIndex: index, nextOffset: offset } }
      offset = 0
    }
    output.push(partial)
  }
  return { turns: output, ...index < units.length ? { nextIndex: index, nextOffset: offset } : {} }
}

/** One turn preview in a conversation summary page. */
export interface TurnSummary {
  turnId: string
  number?: number
  state: string
  boundary: SessionTurn['boundary']
  startSeq: number
  endSeq: number
  stateReference?: SourceReference
  error?: SessionTurn['error']
  errorTruncated?: boolean
  inherited: boolean
  toolCalls: number
  /** First and latest request, deduplicated, each capped at PREVIEW_REQUEST_CHARS. */
  requests: TurnText[]
  /** Latest context message, capped at PREVIEW_CONTEXT_CHARS. */
  context: TurnText[]
  conclusion?: TurnText
  partialResponse?: TurnText
  responseLocator?: SourceReference
  responsePreview?: string
  responseKind?: 'conclusion' | 'partial-response'
  omittedRequests: number
  omittedContext: number
  /** Set when any represented source content was shortened or omitted. */
  partial: boolean
}

export interface TurnSummaryPage {
  turns: TurnSummary[]
  nextIndex?: number
}

/**
 * Conversation-mode pager: one summary record for every selected turn,
 * advancing by turn index only. Preview caps bound the payload; the selected
 * turn count never shrinks to fit an output-size budget.
 */
export function pageTurnSummaries(turns: readonly SessionTurn[], index: number, limit: number): TurnSummaryPage {
  if (!Number.isSafeInteger(index) || index < 0 || index > turns.length) {
    throw new RangeError('turn page position is invalid')
  }
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('turn limit is invalid')
  const selected = turns.slice(index, index + limit).map(summarizeTurn)
  const next = index + selected.length
  return { turns: selected, ...next < turns.length ? { nextIndex: next } : {} }
}

function summarizeTurn(turn: SessionTurn): TurnSummary {
  const requests = turn.parts.filter(part => part.kind === 'request')
  const contexts = turn.parts.filter(part => part.kind === 'context')
  const response = turn.parts.find(part => part.kind === 'conclusion' || part.kind === 'partial-response')
  const pickedRequests = dedupe([requests[0], requests.at(-1)])
  const pickedContext = contexts.at(-1)
  const excerptedResponse = response === undefined ? undefined : excerpt(response, PREVIEW_RESPONSE_CHARS)
  const summary: TurnSummary = {
    ...frame(turn),
    requests: pickedRequests.map(part => excerpt(part, PREVIEW_REQUEST_CHARS)),
    context: pickedContext === undefined ? [] : [excerpt(pickedContext, PREVIEW_CONTEXT_CHARS)],
    ...excerptedResponse === undefined ? {} : excerptedResponse.kind === 'conclusion'
      ? { conclusion: excerptedResponse }
      : { partialResponse: excerptedResponse },
    omittedRequests: requests.length - pickedRequests.length,
    omittedContext: contexts.length - (pickedContext === undefined ? 0 : 1),
    partial: false,
  }
  const shortened = [...summary.requests, ...summary.context, summary.conclusion, summary.partialResponse]
    .some(part => part?.truncated === true)
  summary.partial = shortened || summary.omittedRequests > 0 || summary.omittedContext > 0
  return summary
}

function dedupe(parts: readonly (TurnText | undefined)[]): TurnText[] {
  const seen = new Set<number>()
  return parts.filter((part): part is TurnText => {
    if (part === undefined || seen.has(part.reference.seq)) return false
    seen.add(part.reference.seq)
    return true
  })
}

/** Verbatim prefix excerpt; `truncated` marks omitted text without altering the kept range. */
function excerpt(part: TurnText, cap: number): TurnText {
  const points = Array.from(part.text)
  if (points.length <= cap) return { ...part, truncated: part.truncated === true }
  return {
    ...part,
    text: points.slice(0, cap).join(''),
    reference: { ...part.reference, start: 0, end: cap },
    truncated: true,
  }
}
