import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'

const MAX_INDEX = 100_000_000
const MAX_TEXT = 8_192
const MAX_DIGEST = 128

/** Secret held by one plugin instance. Continuation tokens are not valid for another instance. */
export interface CursorKey {
  readonly secret: Buffer
}

export function createCursorKey(): CursorKey {
  return { secret: randomBytes(32) }
}

/**
 * Continuation bound to one captured physical prefix and the observation's
 * branch revision. Append-only growth keeps the cut. A changed envelope or a
 * new branch revision does not.
 */
export interface ReadCursor {
  readonly kind: 'read'
  readonly sessionId: string
  readonly cut: number
  readonly prefix: string
  readonly branchRevision: number
  readonly inheritedEventCount: number
  readonly createdAt: number
  readonly filter: string
  readonly index: number
  readonly offset: number
}

/** Continuation bound to one list filter and corpus stamp. */
export interface ListCursor {
  readonly kind: 'list'
  readonly filter: string
  readonly stamp: string
  readonly offset: number
}

/**
 * Continuation bound to one search request.
 * `hostCursor` is required. An empty string starts the named phase; omitting it is invalid.
 */
export interface SearchCursor {
  readonly kind: 'search'
  readonly filter: string
  readonly phase: 'same' | 'rest'
  readonly hostCursor: string
}

export type PageCursor = ReadCursor | ListCursor | SearchCursor

export function encodeCursor(cursor: PageCursor, key: CursorKey): string {
  const payload = JSON.stringify(cursor)
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload, key)}`
}

export function decodeCursor(token: string, kind: PageCursor['kind'], key: CursorKey): PageCursor {
  const split = token.lastIndexOf('.')
  if (split <= 0) invalid()
  const encoded = token.slice(0, split)
  const signature = token.slice(split + 1)
  const payload = decode(encoded)
  if (payload === undefined || !verify(payload, signature, key)) invalid()
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    invalid()
  }
  if (!isCursor(parsed, kind)) invalid()
  return parsed
}

/** SHA-256 of each event's full canonical envelope, including time, surface, and meta. */
export function prefixDigest(events: readonly object[]): string {
  const hash = createHash('sha256')
  for (const event of events) {
    hash.update(stable(event))
    hash.update('\n')
  }
  return hash.digest('base64url')
}

export function corpusStamp(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function sign(payload: string, key: CursorKey): string {
  return createHmac('sha256', key.secret).update(payload).digest('base64url')
}

function verify(payload: string, signature: string, key: CursorKey): boolean {
  const actual = Buffer.from(sign(payload, key))
  const given = Buffer.from(signature)
  return actual.length === given.length && timingSafeEqual(actual, given)
}

function isCursor(value: unknown, kind: PageCursor['kind']): value is PageCursor {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  if (row.kind !== kind) return false
  if (kind === 'read') {
    return text(row.sessionId, 1, 512)
      && bounded(row.cut, -1, Number.MAX_SAFE_INTEGER)
      && text(row.prefix, 1, MAX_DIGEST)
      && bounded(row.branchRevision, 0, Number.MAX_SAFE_INTEGER)
      && bounded(row.inheritedEventCount, 0, Number.MAX_SAFE_INTEGER)
      && bounded(row.createdAt, 0, Number.MAX_SAFE_INTEGER)
      && text(row.filter, 1, MAX_TEXT)
      && bounded(row.index, 0, MAX_INDEX)
      && bounded(row.offset, 0, MAX_INDEX)
  }
  if (kind === 'list') {
    return text(row.filter, 1, MAX_TEXT)
      && text(row.stamp, 1, MAX_DIGEST)
      && bounded(row.offset, 0, MAX_INDEX)
  }
  return text(row.filter, 1, MAX_TEXT)
    && (row.phase === 'same' || row.phase === 'rest')
    && text(row.hostCursor, 0, MAX_TEXT)
}

function text(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}

function decode(value: string): string | undefined {
  try {
    return Buffer.from(value, 'base64url').toString('utf8')
  } catch {
    return undefined
  }
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(item => stable(item)).join(',')}]`
  const row = value as Record<string, unknown>
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${stable(row[key])}`).join(',')}}`
}

function invalid(): never {
  throw new SessionQueryError('session query continuation is invalid', 'SESSION_QUERY_INVALID_CURSOR')
}
