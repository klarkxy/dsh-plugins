import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionId as brandSessionId } from '@deepseek-ai/dsh-session'
import {
  SessionQueryError,
  SessionSearchCursor,
  type SessionQueryEngine,
  type SessionRecord,
  type SessionResultFilter,
  type SessionSearchHit,
} from '@deepseek-ai/dsh-session-query'
import type { CallerExecution } from './caller.ts'
import { callerFromExecution } from './caller.ts'
import { pageItems, surfaceNote, UNTRUSTED_BACKGROUND, type ConversationItem, type ConversationView, type ModelSurfaceRow } from './conversation.ts'
import { DEFAULT_TURN_LIMIT, MAX_TURN_LIMIT, type ResolvedConfig } from './contracts.ts'
import { corpusStamp, decodeCursor, encodeCursor, prefixDigest, type CursorKey, type ListCursor, type ReadCursor, type SnapshotCursor, type SearchCursor } from './cursor.ts'
import { findTitleMatches } from './title-search.ts'
import { pageTurnSummaries, pageTurns, projectTurns } from './turns.ts'
import { projectDetails } from './details.ts'
import { extractHandoff, type HandoffSummarizer } from './handoff.ts'

export interface ReadRequest {
  readonly sessionId: string
  readonly mode?: 'conversation' | 'handoff' | 'details'
  readonly turnId?: string
  readonly seq?: number
  readonly snapshot?: string
  readonly limit?: number
  readonly summarize?: boolean
  readonly cursor?: string
  readonly includeToolDetail?: boolean
  readonly includeReasoning?: boolean
  /** Explicit model-visible surface, only in details mode. */
  readonly modelSurface?: boolean
}

export interface ListRequest {
  readonly sessionId?: string
  readonly cwd?: string
  readonly parentSessionId?: string
  readonly includeRoots?: boolean
  readonly createdFrom?: number
  readonly createdTo?: number
  readonly cursor?: string
  readonly limit?: number
}

export interface SearchRequest {
  readonly query: string
  readonly scope?: 'title' | 'content' | 'both'
  readonly cwd?: string
  readonly parentSessionId?: string
  readonly includeRoots?: boolean
  readonly createdFrom?: number
  readonly createdTo?: number
  readonly cursor?: string
  readonly limit?: number
}

export type ToolOutcome =
  | { readonly status: 'ok'; readonly [key: string]: unknown }
  | { readonly status: 'disabled' | 'failed'; readonly code: string; readonly message: string }

type QueryHost = Pick<SessionQueryEngine,
  'listSessions' | 'filterSessions' | 'observeSession' | 'readTitleSnapshots' | 'searchSessions'>

export async function listSessions(
  query: QueryHost,
  request: ListRequest,
  exec: CallerExecution & { signal?: AbortSignal },
  config: ResolvedConfig,
  cursors: CursorKey,
): Promise<ToolOutcome> {
  try {
    const signal = exec.signal
    signal?.throwIfAborted()
    const caller = callerFromExecution(exec)
    const filters = sessionFilters(request)
    const filterKey = JSON.stringify(filters)
    const ranked = rankSessions(await query.filterSessions(filters, signal), caller.cwd)
    const stamp = corpusStamp(JSON.stringify(ranked.map(record => [
      record.header.id, record.header.createdAt, record.header.cwd ?? null, record.live, record.persisted,
    ])))
    const limit = request.limit ?? config.listLimit
    assertLimit(limit, config.listLimit)
    let offset = 0
    if (request.cursor !== undefined) {
      const cursor = decodeCursor(request.cursor, 'list', cursors) as ListCursor
      if (cursor.filter !== filterKey || cursor.stamp !== stamp) stale()
      offset = cursor.offset
    }
    if (offset > ranked.length) invalid()
    const page = ranked.slice(offset, offset + limit)
    const titles = await titlesFor(query, page.map(record => record.header.id), signal)
    const next = offset + page.length < ranked.length
      ? encodeCursor({ kind: 'list', filter: filterKey, stamp, offset: offset + page.length }, cursors)
      : undefined
    return {
      status: 'ok',
      items: page.map(record => ({
        sessionId: record.header.id,
        title: titles.get(record.header.id) ?? null,
        cwd: record.header.cwd ?? null,
        createdAt: record.header.createdAt,
        parentSession: record.header.parentSession ?? null,
        isSeeded: record.header.isSeeded,
        origin: record.header.origin ?? null,
        delegationDepth: record.header.delegationDepth ?? 0,
        live: record.live,
        persisted: record.persisted,
        sameCwd: caller.cwd !== undefined && record.header.cwd === caller.cwd,
      })),
      ...next === undefined ? {} : { nextCursor: next },
    }
  } catch (error) {
    return failure(error, exec.signal)
  }
}

export async function searchSessions(
  query: QueryHost,
  request: SearchRequest,
  exec: CallerExecution & { signal?: AbortSignal },
  config: ResolvedConfig,
  cursors: CursorKey,
): Promise<ToolOutcome> {
  try {
    const signal = exec.signal
    signal?.throwIfAborted()
    const text = request.query.trim()
    if (text === '') throw new SessionQueryError('session query was rejected', 'SESSION_QUERY_INVALID_QUERY')
    const scope = request.scope ?? 'content'
    if (!['title', 'content', 'both'].includes(scope)) throw new SessionQueryError('session search scope was rejected', 'SESSION_QUERY_INVALID_QUERY')
    const caller = callerFromExecution(exec)
    const filters = sessionFilters(request)
    const limit = request.limit ?? config.searchLimit
    assertLimit(limit, config.searchLimit)
    const rankSameCwd = caller.cwd !== undefined && request.cwd === undefined
    const filterKey = JSON.stringify({ text, scope, filters, cwd: caller.cwd ?? null, limit, rankSameCwd })
    const titleMatches = scope === 'content' ? undefined : await findTitleMatches(query, filters, text, caller.cwd, signal)
    const excluded = new Set(titleMatches?.items.map(item => item.sessionId))
    let phase: SearchCursor['phase'] = titleMatches ? 'title' : rankSameCwd ? 'same' : 'rest'
    let hostCursor = ''
    let hostOffset = 0, hostPageStamp: string | undefined
    let titleOffset = 0
    if (request.cursor !== undefined) {
      const cursor = decodeCursor(request.cursor, 'search', cursors) as SearchCursor
      if (cursor.filter !== filterKey) invalid()
      if (cursor.titleStamp !== titleMatches?.stamp) stale()
      if ((cursor.phase === 'title' && !titleMatches) || (scope === 'title' && cursor.phase !== 'title')) invalid()
      if (!rankSameCwd && cursor.phase === 'same') invalid()
      phase = cursor.phase
      hostCursor = cursor.hostCursor
      hostOffset = cursor.hostOffset ?? 0
      hostPageStamp = cursor.hostPageStamp
      titleOffset = cursor.titleOffset ?? 0
    }
    const titleRows: Record<string, unknown>[] = []
    if (phase === 'title' && titleMatches) {
      if (titleOffset > titleMatches.items.length) invalid()
      titleRows.push(...titleMatches.items.slice(titleOffset, titleOffset + limit))
      titleOffset += titleRows.length
      if (titleOffset < titleMatches.items.length || (scope === 'both' && titleRows.length === limit)) {
        const next: SearchCursor = titleOffset < titleMatches.items.length
          ? { kind: 'search', filter: filterKey, phase: 'title', hostCursor: '', titleOffset, titleStamp: titleMatches.stamp }
          : { kind: 'search', filter: filterKey, phase: rankSameCwd ? 'same' : 'rest', hostCursor: '', titleStamp: titleMatches.stamp }
        return { status: 'ok', trust: UNTRUSTED_BACKGROUND, items: titleRows, nextCursor: encodeCursor(next, cursors) }
      }
      if (scope === 'title') return { status: 'ok', trust: UNTRUSTED_BACKGROUND, items: titleRows }
      phase = rankSameCwd ? 'same' : 'rest'
    }
    const contentLimit = limit - titleRows.length
    const collected: SessionSearchHit[] = []
    let pending: ({ phase: SearchCursor['phase'] } & SearchProgress) | undefined
    while (collected.length < contentLimit) {
      const pulled = await pullSearchPhase(query, text, phaseFilters(filters, phase, rankSameCwd ? caller.cwd : undefined), contentLimit - collected.length, limit,
        { hostCursor, hostOffset, hostPageStamp }, phase === 'rest' && rankSameCwd, caller.cwd, signal, excluded)
      collected.push(...pulled.items)
      if (collected.length >= contentLimit) {
        if (pulled.next !== undefined) pending = { phase, ...pulled.next }
        else if (phase === 'same') pending = { phase: 'rest', hostCursor: '' }
        break
      }
      if (phase === 'same') {
        phase = 'rest'
        hostCursor = ''
        hostOffset = 0; hostPageStamp = undefined
        continue
      }
      break
    }
    const titles = await titlesFor(query, collected.map(hit => hit.header.id), signal)
    const next = pending === undefined
      ? undefined
      : encodeCursor({ kind: 'search', filter: filterKey, ...pending,
        ...titleMatches ? { titleStamp: titleMatches.stamp } : {},
      }, cursors)
    return {
      status: 'ok',
      trust: UNTRUSTED_BACKGROUND,
      items: [...titleRows, ...collected.map(hit => ({
        sessionId: hit.header.id,
        title: titles.get(hit.header.id) ?? null,
        cwd: hit.header.cwd ?? null,
        live: hit.live,
        persisted: hit.persisted,
        sameCwd: caller.cwd !== undefined && hit.header.cwd === caller.cwd,
        seq: hit.bestMatch.seq,
        type: hit.bestMatch.type,
        surface: hit.bestMatch.surface,
        time: hit.bestMatch.time,
        snippet: hit.bestMatch.snippet,
        matchedBy: 'content',
      }))],
      ...next === undefined ? {} : { nextCursor: next },
    }
  } catch (error) {
    return failure(error, exec.signal)
  }
}

export async function readSession(
  query: QueryHost,
  request: ReadRequest,
  exec: { signal?: AbortSignal },
  config: ResolvedConfig,
  cursors: CursorKey,
  summarize?: HandoffSummarizer,
): Promise<ToolOutcome> {
  const signal = exec.signal
  let observation: Awaited<ReturnType<QueryHost['observeSession']>> | undefined
  try {
    signal?.throwIfAborted()
    const sessionId = brandSessionId(requiredId(request.sessionId))
    const mode = request.mode ?? 'conversation'
    if (!['conversation', 'handoff', 'details'].includes(mode)) invalidFilter('mode must be conversation, handoff, or details; omit it or pass null for conversation.')
    if (mode !== 'details') {
      if (request.seq !== undefined) invalidFilter('seq requires mode="details". Keep seq and switch mode to inspect that event, or omit seq / pass null to read conversation turns.')
      if (request.includeToolDetail !== undefined) invalidFilter('include_tool_detail requires mode="details", including false. Omit it or pass null in conversation/handoff mode.')
      if (request.includeReasoning === true) invalidFilter('include_reasoning=true requires mode="details".')
      if (request.modelSurface === true) invalidFilter('model_surface=true requires mode="details".')
    }
    if (mode !== 'handoff' && request.summarize === true) invalidFilter('summarize=true requires mode="handoff".')
    if (request.seq !== undefined && (!Number.isSafeInteger(request.seq) || request.seq < 0)) invalidFilter('seq must be a non-negative safe integer from a returned source reference; omit it or pass null when unused.')
    if (request.turnId !== undefined && request.turnId.trim() === '') invalidFilter('turn_id must be a non-empty returned turn ID; omit it or pass null when unused.')
    const turnLimit = request.limit ?? DEFAULT_TURN_LIMIT
    assertLimit(turnLimit, MAX_TURN_LIMIT)
    const includeToolDetail = request.includeToolDetail !== false
    const includeReasoning = request.includeReasoning === true
    const view: ConversationView = request.modelSurface === true ? 'surface' : 'transcript'
    // Conversation cursors index turns (projection 3); details/handoff cursors
    // index flattened message parts (projection 2). Never reinterpret across versions.
    const filterKey = JSON.stringify({ projection: mode === 'conversation' ? 3 : 2, mode, includeToolDetail, includeReasoning, view,
      turnId: request.turnId ?? null, seq: request.seq ?? null, turnLimit, summarize: request.summarize === true })
    observation = await query.observeSession(sessionId, { signal, projectionMode: 'none' })
    try {
      signal?.throwIfAborted()
      const inheritedEventCount = observation.inheritedEventCount
      const createdAt = observation.header.createdAt
      const face = branchView(observation)
      let cut: number = observation.cursor
      let index = 0
      let offset = 0
      const validateSnapshot = (cursor: ReadCursor | SnapshotCursor) => {
        if (cursor.sessionId !== sessionId) invalid()
        if (cursor.inheritedEventCount !== inheritedEventCount || cursor.createdAt !== createdAt) stale()
        if (observation!.cursor < cursor.cut || cursor.branchRevision !== face.revision) stale()
        if (prefixDigest(observation!.events.filter(event => event.seq <= cursor.cut)) !== cursor.prefix) stale()
      }
      if (request.snapshot !== undefined) {
        const anchor = decodeCursor(request.snapshot, 'snapshot', cursors) as SnapshotCursor
        validateSnapshot(anchor); cut = anchor.cut
      }
      if (request.cursor !== undefined) {
        const cursor = decodeCursor(request.cursor, 'read', cursors) as ReadCursor
        if (cursor.filter !== filterKey) invalid()
        validateSnapshot(cursor)
        if (request.snapshot !== undefined && cursor.cut !== cut) invalid()
        cut = cursor.cut
        index = cursor.index
        offset = cursor.offset
      }
      const transcriptEvents = face.transcript(cut)
      const allTurns = projectTurns(transcriptEvents, sessionId, inheritedEventCount)
      const selectedTurn = request.turnId === undefined ? undefined : allTurns.find(turn => turn.turnId === request.turnId)
      if (request.turnId !== undefined && !selectedTurn) invalidFilter('turn_id was not found in the selected session/snapshot. Use a turn ID and snapshot returned together by read_session.')
      const turns = selectedTurn ? [selectedTurn] : allTurns
      const snapshotBase = { sessionId, cut, prefix: prefixDigest(observation.events.filter(event => event.seq <= cut)),
        branchRevision: face.revision, inheritedEventCount, createdAt }
      const snapshot = encodeCursor({ kind: 'snapshot', ...snapshotBase }, cursors)
      if (mode === 'conversation' && offset !== 0) {
        throw new SessionQueryError('conversation continuation offsets are invalid; restart the read and page by turn with the returned cursor', 'SESSION_QUERY_INVALID_CURSOR')
      }
      let paged: { items?: readonly ConversationItem[]; turns?: ReturnType<typeof pageTurns>['turns'] | ReturnType<typeof pageTurnSummaries>['turns']; nextIndex?: number; nextOffset?: number }
      let projection: ReturnType<typeof projectDetails> | undefined
      try {
        if (mode === 'details') {
          const modelRows = face.modelRows(cut, view === 'surface')
          projection = projectDetails(transcriptEvents, sessionId, inheritedEventCount, includeToolDetail, includeReasoning, view,
            modelRows, modelRows !== undefined || !face.branched)
          let items = projection.items.filter(item => (!selectedTurn || selectedTurn.eventSeqs.includes(item.seq))
            && (request.seq === undefined || item.seq === request.seq))
          if (request.seq !== undefined && items.length === 0) {
            const event = transcriptEvents.find(event => event.seq === request.seq)
            if ((event?.type === 'turn/start' || event?.type === 'turn/end') && (!selectedTurn || selectedTurn.eventSeqs.includes(event.seq))) {
              const owner = allTurns.find(turn => turn.eventSeqs.includes(event.seq))!
              items = [{ seq: event.seq, role: 'system', text: JSON.stringify(event.data), eventType: event.type,
                truncated: false, inherited: event.seq < inheritedEventCount,
                reference: { sessionId, turnId: owner.turnId, seq: event.seq } }]
            } else invalidFilter('seq does not select a readable event in this session/snapshot/turn and projection. Use the matching source reference and snapshot; check turn_id and details options.')
          }
          paged = pageItems(items, index, offset, config.pageChars)
        } else if (mode === 'handoff') {
          // Handoff extraction consumes the lossless projection; keep the byte/message pager here.
          paged = pageTurns(turns, index, offset, config.pageChars, turnLimit)
        } else {
          paged = pageTurnSummaries(turns, index, turnLimit)
        }
      } catch (error) {
        if (error instanceof SessionQueryError) throw error
        throw new SessionQueryError(error instanceof Error ? error.message : 'Invalid session history', 'SESSION_QUERY_INVALID_SURFACE')
      }
      const next = paged.nextIndex === undefined
        ? undefined
        : encodeCursor({
          kind: 'read',
          ...snapshotBase,
          filter: filterKey,
          index: paged.nextIndex,
          offset: paged.nextOffset ?? 0,
        }, cursors)
      const note = projection ? surfaceNote(projection) : undefined
      const titles = await query.readTitleSnapshots([sessionId], signal)
      signal?.throwIfAborted()
      const titleRow = titles[0]
      if (titleRow?.status === 'rejected') throw titleRow.reason
      const conversationTurns = mode === 'conversation' ? paged.turns as ReturnType<typeof pageTurnSummaries>['turns'] : undefined
      const metadata = {
        status: 'ok' as const,
        trust: UNTRUSTED_BACKGROUND,
        sessionId,
        source: observation.source,
        mode, view: mode === 'details' ? view : 'turns',
        ...mode === 'conversation' ? { contentView: 'summary' as const } : {},
        snapshot, capturedThroughSeq: cut,
        cwd: observation.header.cwd ?? null,
        title: titleRow?.status === 'fulfilled' ? titleRow.value.title?.title ?? null : null,
        inheritedEventCount,
        ...projection ? { surfaceDiffers: projection.surfaceDiffers, surfaceCount: projection.surfaceCount, transcriptCount: projection.transcriptCount } : {},
        ...note === undefined ? {} : { surfaceNote: note },
        ...mode === 'details' ? { items: paged.items } : { turns: paged.turns, turnCount: allTurns.length,
          coverage: {
            returnedTurns: paged.turns?.map(turn => turn.turnId),
            ...conversationTurns ? { matchedTurns: turns.length, remainingTurns: turns.length - index - conversationTurns.length } : {},
            partial: paged.turns?.some(turn => turn.partial),
            hasMoreHistory: next !== undefined,
          } },
        ...next === undefined ? {} : { nextCursor: next },
      }
      // A model call consumes the captured source material, not a live observation lease.
      observation[Symbol.dispose](); observation = undefined
      if (mode !== 'handoff') return metadata
      const handoffTurns = paged.turns as ReturnType<typeof pageTurns>['turns']
      let handoff = extractHandoff(handoffTurns ?? [], next !== undefined)
      if (request.summarize === true) {
        if (!signal) throw new SessionQueryError('Handoff summarization needs a host execution signal', 'SESSION_QUERY_INVALID_FILTER')
        handoff = summarize ? await summarize(handoffTurns ?? [], handoff, signal, config.pageChars)
          : { ...handoff, summaryStatus: 'unavailable', error: 'No host model is available; source excerpts are retained.' }
      }
      signal?.throwIfAborted()
      return { ...metadata, handoff }
    } finally {
      observation?.[Symbol.dispose]()
      observation = undefined
    }
  } catch (error) {
    observation?.[Symbol.dispose]()
    return failure(error, signal)
  }
}

function sessionFilters(request: ListRequest | SearchRequest): SessionResultFilter[] {
  const filters: SessionResultFilter[] = []
  if ('sessionId' in request && request.sessionId !== undefined) {
    filters.push({ kind: 'id', values: [brandSessionId(requiredId(request.sessionId))] })
  }
  if (request.cwd !== undefined) {
    if (typeof request.cwd !== 'string' || request.cwd === '') {
      throw new SessionQueryError('session query filters were rejected', 'SESSION_QUERY_INVALID_FILTER')
    }
    filters.push({ kind: 'cwd', values: [request.cwd] })
  }
  const parents: Array<SessionId | null> = []
  if (request.parentSessionId !== undefined) parents.push(brandSessionId(requiredId(request.parentSessionId)))
  if (request.includeRoots === true) parents.push(null)
  if (parents.length > 0) filters.push({ kind: 'parent', values: parents })
  if (request.createdFrom !== undefined || request.createdTo !== undefined) {
    assertTime(request.createdFrom)
    assertTime(request.createdTo)
    filters.push({
      kind: 'created-at',
      ...request.createdFrom === undefined ? {} : { from: request.createdFrom },
      ...request.createdTo === undefined ? {} : { to: request.createdTo },
    })
  }
  return filters
}

async function titlesFor(query: QueryHost, ids: readonly SessionId[], signal: AbortSignal | undefined): Promise<Map<string, string>> {
  const snapshots = await query.readTitleSnapshots(ids, signal)
  signal?.throwIfAborted()
  const titles = new Map<string, string>()
  for (const row of snapshots) {
    if (row.status === 'rejected') {
      if (isAbort(row.reason, signal)) throw row.reason
      continue
    }
    const text = row.value.title?.title
    if (text !== undefined) titles.set(row.sessionId, text)
  }
  return titles
}

function rankSessions(records: readonly SessionRecord[], cwd: string | undefined): SessionRecord[] {
  if (cwd === undefined) return [...records]
  return [...records.filter(record => record.header.cwd === cwd), ...records.filter(record => record.header.cwd !== cwd)]
}

function phaseFilters(filters: readonly SessionResultFilter[], phase: SearchCursor['phase'], cwd: string | undefined): SessionResultFilter[] {
  if (phase !== 'same' || cwd === undefined) return [...filters]
  return [...filters, { kind: 'cwd', values: [cwd] }]
}

type SearchProgress = Pick<SearchCursor, 'hostCursor' | 'hostOffset' | 'hostPageStamp'>

async function pullSearchPhase(
  query: QueryHost,
  text: string,
  filters: readonly SessionResultFilter[],
  resultLimit: number,
  providerLimit: number,
  progress: SearchProgress,
  skipCallerCwd: boolean,
  callerCwd: string | undefined,
  signal: AbortSignal | undefined,
  excluded: ReadonlySet<string>,
): Promise<{ items: SessionSearchHit[]; next?: SearchProgress }> {
  const hits: SessionSearchHit[] = []
  let cursor = progress.hostCursor, offset = progress.hostOffset ?? 0, expectedStamp = progress.hostPageStamp
  let hops = 0
  while (hits.length < resultLimit) {
    if (hops++ > 10_000) {
      throw new SessionQueryError('session search continuation did not advance', 'SESSION_QUERY_INVALID_CURSOR')
    }
    signal?.throwIfAborted()
    const page = await query.searchSessions({
      query: text,
      sessionFilters: filters,
      // Standard SQLite binds its cursor to limit. Keep it stable across title/body pages and skipped hits.
      limit: providerLimit,
      ...cursor === '' ? {} : { cursor: SessionSearchCursor(cursor) },
    }, { signal })
    if (page.items.length > providerLimit) {
      throw new SessionQueryError('session search page exceeded the requested limit', 'SESSION_QUERY_INVALID_LIMIT')
    }
    const next = page.nextCursor === undefined ? undefined : String(page.nextCursor)
    if (next !== undefined && next === cursor) {
      throw new SessionQueryError('session search continuation did not advance', 'SESSION_QUERY_INVALID_CURSOR')
    }
    const stamp = corpusStamp(JSON.stringify(page.items))
    if (expectedStamp !== undefined && expectedStamp !== stamp) stale()
    if (offset > page.items.length) invalid()
    for (; offset < page.items.length; offset++) {
      const hit = page.items[offset]!
      if (excluded.has(hit.header.id)) continue
      if (skipCallerCwd && hit.header.cwd === callerCwd) continue
      hits.push(hit)
      if (hits.length === resultLimit) {
        if (offset + 1 < page.items.length) return { items: hits, next: { hostCursor: cursor, hostOffset: offset + 1, hostPageStamp: stamp } }
        return { items: hits, ...next === undefined ? {} : { next: { hostCursor: next } } }
      }
    }
    if (next === undefined) return { items: hits }
    cursor = next
    offset = 0; expectedStamp = undefined
  }
  return { items: hits }
}

function assertLimit(limit: number, ceiling: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > ceiling) {
    throw new SessionQueryError(`limit must be an integer from 1 to ${ceiling}; omit it or pass null for the default`, 'SESSION_QUERY_INVALID_LIMIT')
  }
}

function assertTime(value: number | undefined): void {
  if (value === undefined) return
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SessionQueryError('session query filters were rejected', 'SESSION_QUERY_INVALID_FILTER')
  }
}

function requiredId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SessionQueryError('session query filters were rejected', 'SESSION_QUERY_INVALID_FILTER')
  }
  return value
}

interface BranchView {
  readonly revision: number
  readonly branched: boolean
  transcript(cut: number): readonly SessionEvent[]
  modelRows(cut: number, required: boolean): readonly ModelSurfaceRow[] | undefined
}

function branchView(observation: { readonly events: readonly SessionEvent[] }): BranchView {
  const events = observation.events
  const lease = observation as {
    readonly branchRevision?: unknown
    readonly activeEvents?: unknown
    readModelSurface?: unknown
  }
  const revision = revisionOf(lease.branchRevision)
  const active = Array.isArray(lease.activeEvents) ? lease.activeEvents as readonly SessionEvent[] : undefined
  const branched = events.some(event => (event as { type: string }).type === 'session/active-branch') || (revision !== undefined && revision > 0)
  if (branched && (revision === undefined || active === undefined)) {
    throw new SessionQueryError('session branch selectors are unavailable', 'SESSION_QUERY_INVALID_SURFACE')
  }
  const selected = branched ? active! : events
  const revisionValue = revision ?? 0
  return {
    revision: revisionValue,
    branched,
    transcript: cut => selected.filter(event => event.seq <= cut),
    modelRows: (cut, required) => readModelRows(lease, cut, required && branched),
  }
}

function revisionOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function readModelRows(
  lease: { readModelSurface?: unknown },
  cut: number,
  required: boolean,
): readonly ModelSurfaceRow[] | undefined {
  const read = lease.readModelSurface
  if (typeof read !== 'function') {
    if (required) throw new SessionQueryError('session model surface is unavailable', 'SESSION_QUERY_INVALID_SURFACE')
    return undefined
  }
  const value: unknown = (read as (this: unknown, asOfSeq?: number) => unknown).call(lease, cut)
  if (!Array.isArray(value)) {
    throw new SessionQueryError('session model surface is unavailable', 'SESSION_QUERY_INVALID_SURFACE')
  }
  return value.map(row => {
    if (typeof row !== 'object' || row === null) {
      throw new SessionQueryError('session model surface is unavailable', 'SESSION_QUERY_INVALID_SURFACE')
    }
    const seq = (row as { seq?: unknown }).seq
    const message = (row as { message?: unknown }).message
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || typeof message !== 'object' || message === null) {
      throw new SessionQueryError('session model surface is unavailable', 'SESSION_QUERY_INVALID_SURFACE')
    }
    return { seq, message }
  })
}

function failure(error: unknown, signal: AbortSignal | undefined): ToolOutcome | never {
  if (isAbort(error, signal)) {
    throw error instanceof Error ? error : new SessionQueryError('session query was cancelled', 'SESSION_QUERY_ABORTED')
  }
  if (error instanceof SessionQueryError) {
    const status = error.code === 'SESSION_QUERY_SEARCH_DISABLED' ? 'disabled' : 'failed'
    return { status, code: error.code, message: error.message }
  }
  const message = error instanceof Error ? error.message : 'session query operation failed'
  return { status: 'failed', code: 'SESSION_QUERY_TOOL_FAILED', message }
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true
  if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED') return true
  return error instanceof Error && error.name === 'AbortError'
}

function stale(): never {
  throw new SessionQueryError('session search continuation is stale', 'SESSION_QUERY_STALE_CURSOR')
}

function invalidFilter(message: string): never {
  throw new SessionQueryError(message, 'SESSION_QUERY_INVALID_FILTER')
}

function invalid(): never {
  throw new SessionQueryError('session query continuation is invalid; reuse the returned cursor with its original session, mode, options and snapshot, or omit cursor / pass null to start a new read', 'SESSION_QUERY_INVALID_CURSOR')
}
