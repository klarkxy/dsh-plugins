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
import { pageItems, projectConversation, surfaceNote, UNTRUSTED_BACKGROUND, type ConversationItem, type ConversationView, type ModelSurfaceRow } from './conversation.ts'
import type { ResolvedConfig } from './contracts.ts'
import { corpusStamp, decodeCursor, encodeCursor, prefixDigest, type CursorKey, type ListCursor, type ReadCursor, type SearchCursor } from './cursor.ts'

export interface ReadRequest {
  readonly sessionId: string
  readonly cursor?: string
  readonly includeToolDetail?: boolean
  readonly includeReasoning?: boolean
  /** Explicit model-visible surface. The default is the human append transcript. */
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
    const caller = callerFromExecution(exec)
    const filters = sessionFilters(request)
    const limit = request.limit ?? config.searchLimit
    assertLimit(limit, config.searchLimit)
    const rankSameCwd = caller.cwd !== undefined && request.cwd === undefined
    const filterKey = JSON.stringify({ text, filters, cwd: caller.cwd ?? null, limit, rankSameCwd })
    let phase: SearchCursor['phase'] = rankSameCwd ? 'same' : 'rest'
    let hostCursor = ''
    if (request.cursor !== undefined) {
      const cursor = decodeCursor(request.cursor, 'search', cursors) as SearchCursor
      if (cursor.filter !== filterKey) invalid()
      if (!rankSameCwd && cursor.phase === 'same') invalid()
      phase = cursor.phase
      hostCursor = cursor.hostCursor
    }
    const collected: SessionSearchHit[] = []
    let pending: { phase: SearchCursor['phase']; hostCursor: string } | undefined
    while (collected.length < limit) {
      const pulled = await pullSearchPhase(query, text, phaseFilters(filters, phase, rankSameCwd ? caller.cwd : undefined), limit - collected.length, hostCursor, phase === 'rest' && rankSameCwd, caller.cwd, signal)
      collected.push(...pulled.items)
      if (collected.length >= limit) {
        if (pulled.nextHostCursor !== undefined) pending = { phase, hostCursor: pulled.nextHostCursor }
        else if (phase === 'same') pending = { phase: 'rest', hostCursor: '' }
        break
      }
      if (phase === 'same') {
        phase = 'rest'
        hostCursor = ''
        continue
      }
      break
    }
    const titles = await titlesFor(query, collected.map(hit => hit.header.id), signal)
    const next = pending === undefined
      ? undefined
      : encodeCursor({ kind: 'search', filter: filterKey, phase: pending.phase, hostCursor: pending.hostCursor }, cursors)
    return {
      status: 'ok',
      trust: UNTRUSTED_BACKGROUND,
      items: collected.map(hit => ({
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
      })),
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
): Promise<ToolOutcome> {
  const signal = exec.signal
  let observation: Awaited<ReturnType<QueryHost['observeSession']>> | undefined
  try {
    signal?.throwIfAborted()
    const sessionId = brandSessionId(requiredId(request.sessionId))
    const includeToolDetail = request.includeToolDetail === true
    const includeReasoning = request.includeReasoning === true
    const view: ConversationView = request.modelSurface === true ? 'surface' : 'transcript'
    const filterKey = JSON.stringify({ includeToolDetail, includeReasoning, view })
    observation = await query.observeSession(sessionId, { signal, projectionMode: 'none' })
    try {
      signal?.throwIfAborted()
      const inheritedEventCount = observation.inheritedEventCount
      const createdAt = observation.header.createdAt
      const face = branchView(observation)
      let cut: number = observation.cursor
      let index = 0
      let offset = 0
      if (request.cursor !== undefined) {
        const cursor = decodeCursor(request.cursor, 'read', cursors) as ReadCursor
        if (cursor.sessionId !== sessionId || cursor.filter !== filterKey) invalid()
        if (cursor.inheritedEventCount !== inheritedEventCount || cursor.createdAt !== createdAt) stale()
        if (observation.cursor < cursor.cut) stale()
        if (cursor.branchRevision !== face.revision) stale()
        const livePrefix = observation.events.filter(event => event.seq <= cursor.cut)
        if (prefixDigest(livePrefix) !== cursor.prefix) stale()
        cut = cursor.cut
        index = cursor.index
        offset = cursor.offset
      }
      const transcriptEvents = face.transcript(cut)
      const modelRows = face.modelRows(cut, view === 'surface')
      let projected: ReturnType<typeof projectConversation>
      try {
        projected = projectConversation(
          transcriptEvents,
          inheritedEventCount,
          includeToolDetail,
          includeReasoning,
          view,
          modelRows,
          modelRows !== undefined || !face.branched,
        )
      } catch (error) {
        throw new SessionQueryError(
          `session event history is invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
          'SESSION_QUERY_INVALID_SURFACE',
          { cause: error },
        )
      }
      let paged: { items: ConversationItem[]; nextIndex?: number; nextOffset?: number }
      try {
        paged = pageItems(projected.items, index, offset, config.pageChars)
      } catch (error) {
        if (error instanceof RangeError) invalid()
        throw error
      }
      const next = paged.nextIndex === undefined
        ? undefined
        : encodeCursor({
          kind: 'read',
          sessionId,
          cut,
          prefix: prefixDigest(observation.events.filter(event => event.seq <= cut)),
          branchRevision: face.revision,
          inheritedEventCount,
          createdAt,
          filter: filterKey,
          index: paged.nextIndex,
          offset: paged.nextOffset ?? 0,
        }, cursors)
      const note = surfaceNote(projected)
      const titles = await query.readTitleSnapshots([sessionId], signal)
      signal?.throwIfAborted()
      const titleRow = titles[0]
      if (titleRow?.status === 'rejected') throw titleRow.reason
      return {
        status: 'ok',
        trust: UNTRUSTED_BACKGROUND,
        sessionId,
        source: observation.source,
        view,
        cwd: observation.header.cwd ?? null,
        title: titleRow?.status === 'fulfilled' ? titleRow.value.title?.title ?? null : null,
        inheritedEventCount,
        surfaceDiffers: projected.surfaceDiffers,
        surfaceCount: projected.surfaceCount,
        transcriptCount: projected.transcriptCount,
        ...note === undefined ? {} : { surfaceNote: note },
        items: paged.items,
        ...next === undefined ? {} : { nextCursor: next },
      }
    } finally {
      observation[Symbol.dispose]()
      observation = undefined
    }
  } catch (error) {
    observation?.[Symbol.dispose]()
    return failure(error, signal)
  }
}

export async function withObservationLease<T>(
  query: QueryHost,
  sessionId: SessionId,
  signal: AbortSignal | undefined,
  read: (events: readonly SessionEvent[]) => T,
): Promise<T> {
  signal?.throwIfAborted()
  const observation = await query.observeSession(sessionId, { signal, projectionMode: 'none' })
  try {
    signal?.throwIfAborted()
    return read(observation.events)
  } finally {
    observation[Symbol.dispose]()
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

async function pullSearchPhase(
  query: QueryHost,
  text: string,
  filters: readonly SessionResultFilter[],
  limit: number,
  hostCursor: string,
  skipCallerCwd: boolean,
  callerCwd: string | undefined,
  signal: AbortSignal | undefined,
): Promise<{ items: SessionSearchHit[]; nextHostCursor?: string }> {
  const hits: SessionSearchHit[] = []
  let cursor = hostCursor
  let hops = 0
  while (hits.length < limit) {
    if (hops++ > 10_000) {
      throw new SessionQueryError('session search continuation did not advance', 'SESSION_QUERY_INVALID_CURSOR')
    }
    signal?.throwIfAborted()
    const remaining = limit - hits.length
    const page = await query.searchSessions({
      query: text,
      sessionFilters: filters,
      limit: remaining,
      ...cursor === '' ? {} : { cursor: SessionSearchCursor(cursor) },
    }, { signal })
    if (page.items.length > remaining) {
      throw new SessionQueryError('session search page exceeded the requested limit', 'SESSION_QUERY_INVALID_LIMIT')
    }
    const next = page.nextCursor === undefined ? undefined : String(page.nextCursor)
    if (next !== undefined && next === cursor) {
      throw new SessionQueryError('session search continuation did not advance', 'SESSION_QUERY_INVALID_CURSOR')
    }
    for (const hit of page.items) {
      if (skipCallerCwd && hit.header.cwd === callerCwd) continue
      hits.push(hit)
    }
    if (next === undefined) return { items: hits }
    if (hits.length >= limit) return { items: hits, nextHostCursor: next }
    cursor = next
  }
  return { items: hits }
}

function assertLimit(limit: number, ceiling: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > ceiling) {
    throw new SessionQueryError('session query result limit was rejected', 'SESSION_QUERY_INVALID_LIMIT')
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

function invalid(): never {
  throw new SessionQueryError('session query continuation is invalid', 'SESSION_QUERY_INVALID_CURSOR')
}
