import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'

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
