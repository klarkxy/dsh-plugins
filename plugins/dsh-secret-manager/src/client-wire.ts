/**
 * Defensive readers over the frozen Host↔UI contract (`./contracts.ts`).
 * The contract file is the single source of truth for names and bounds; this
 * module only maps untrusted wire input onto those types, tolerating the
 * optional fields (per-session grant flags, resource) the Host still backfills.
 * Every parsed value is metadata — a value never crosses the wire into the UI.
 */
import {
  DEFAULT_AUTH_HEADER,
  DEFAULT_AUTH_PREFIX,
  isAuthHeaderName,
  isAuthPrefix,
  isBoundedId,
  isCanonicalOrigin,
  isRecord,
  isSlot,
  isYes,
  PLUGIN_ID,
  envKeyOf,
  secretRefOf,
  type PendingView,
  type SecretEntry,
  type SecretToolResult,
  type SubmitOutcome,
} from './contracts.ts'

function textOf(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined
}

function countOf(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : 0
}

/** `pending` resolves to the open dialog or nothing (settled, gone, foreign). */
export function readPendingView(value: unknown): PendingView | undefined {
  if (!isRecord(value)) return undefined
  const id = isBoundedId(value.id) ? value.id : undefined
  const sessionId = isBoundedId(value.sessionId) ? value.sessionId : undefined
  const callId = isBoundedId(value.callId) ? value.callId : undefined
  const slot = isSlot(value.slot) ? value.slot : undefined
  const envKey = textOf(value.envKey, 96)
  const ref = textOf(value.ref, 256)
  const purpose = textOf(value.purpose, 200)
  if (!id || !sessionId || !callId || !slot || !envKey || !ref || !purpose) return undefined
  const kind = value.kind
  if (kind !== 'store' && kind !== 'http') return undefined
  if (!isYes(value.requestEnv) || !isYes(value.configured)) return undefined
  if (typeof value.expiresAt !== 'number') return undefined
  const view: PendingView = {
    id, sessionId, callId, kind, slot, envKey, ref, purpose,
    requestEnv: value.requestEnv,
    configured: value.configured,
    authHeader: isAuthHeaderName(value.authHeader) ? value.authHeader : DEFAULT_AUTH_HEADER,
    authPrefix: isAuthPrefix(value.authPrefix) ? value.authPrefix : DEFAULT_AUTH_PREFIX,
    expiresAt: value.expiresAt,
  }
  const resource = textOf(value.resource, 300)
  if (resource) view.resource = resource
  if (isCanonicalOrigin(value.httpOrigin)) view.httpOrigin = value.httpOrigin
  return view
}

/** `submit` resolves to non-secret facts about what was stored and granted. */
export function readSubmitOutcome(value: unknown): SubmitOutcome | undefined {
  if (!isRecord(value)) return undefined
  if (value.status !== 'stored' && value.status !== 'ready') return undefined
  const ref = textOf(value.ref, 256)
  const slot = isSlot(value.slot) ? value.slot : undefined
  const envKey = textOf(value.envKey, 96)
  if (!ref || !slot || !envKey || !isYes(value.envGranted) || !isYes(value.httpGranted)) return undefined
  const outcome: SubmitOutcome = {
    status: value.status, ref, slot, envKey, configured: true,
    envGranted: value.envGranted, httpGranted: value.httpGranted,
  }
  if (isCanonicalOrigin(value.httpOrigin)) outcome.httpOrigin = value.httpOrigin
  return outcome
}

/**
 * One `list` row. The per-session grant flags default to false: the Host only
 * fills them when the call passed a `sessionId`, and "unknown" must never
 * render as "granted".
 */
export function readSecretEntry(value: unknown): SecretEntry | undefined {
  if (!isRecord(value)) return undefined
  const ref = textOf(value.ref, 256)
  const slot = isSlot(value.slot) ? value.slot : undefined
  const envKey = textOf(value.envKey, 96)
  if (!ref || !slot || !envKey) return undefined
  return {
    ref, slot, envKey,
    configured: true,
    envGrantedSessions: countOf(value.envGrantedSessions),
    httpGrantedSessions: countOf(value.httpGrantedSessions),
    envGranted: isYes(value.envGranted) ? value.envGranted : false,
    httpGranted: isYes(value.httpGranted) ? value.httpGranted : false,
  }
}

/** `list` resolves to `{ entries: [...] }`; a foreign row fails the whole page. */
export function readListOutcome(value: unknown): NonNullable<ReturnType<typeof readSecretEntry>>[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.entries)) return undefined
  const entries: NonNullable<ReturnType<typeof readSecretEntry>>[] = []
  for (const row of value.entries) {
    const entry = readSecretEntry(row)
    if (!entry) return undefined
    entries.push(entry)
  }
  return entries
}

/** A persisted `request_secret` tool result mirrors its presentation metadata. */
export function readToolResult(value: unknown): SecretToolResult | undefined {
  if (!isRecord(value) || value.owner !== PLUGIN_ID) return undefined
  if (typeof value.status !== 'string' || !value.status) return undefined
  // Older presentation records carry status and slot without the model-facing
  // summary or derived reference. They are still valid saved tool results.
  const slot = isSlot(value.slot) ? value.slot : undefined
  const summary = textOf(value.summary, 400) ?? ''
  return {
    owner: PLUGIN_ID,
    status: typeof value.status === 'string' ? value.status as SecretToolResult['status'] : 'invalid',
    configured: value.configured === true,
    envGranted: value.envGranted === true,
    httpGranted: value.httpGranted === true,
    summary,
    ...(textOf(value.ref, 256) ? { ref: textOf(value.ref, 256) } : slot ? { ref: secretRefOf(slot) } : {}),
    ...(slot ? { slot } : {}),
    ...(textOf(value.envKey, 96) ? { envKey: textOf(value.envKey, 96) } : slot ? { envKey: envKeyOf(slot) } : {}),
    ...(isCanonicalOrigin(value.httpOrigin) ? { httpOrigin: value.httpOrigin } : {}),
  }
}
