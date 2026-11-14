/**
 * Host↔UI contract for the secret manager.
 *
 * Browser-safe by construction: type-only imports plus pure constants and
 * helpers, no Host service and never a secret value. The Host half is the sole
 * writer of this file; the Client half imports types, constants and validators
 * from here so both ends reject the same inputs with the same wording.
 *
 * Values never ride out in a DTO. A tool result carries a `secret://<slot>`
 * reference and state flags only. A value crosses exactly one boundary and only
 * inbound: the authenticated `submit`/`save` call the human just approved,
 * after which it is reachable only through the `ctx.credentials` records this
 * plugin owns. No DTO returned by this plugin ever carries a value.
 */
import type { RpcResult as SharedRpcResult } from '@klarkxy/dsh-plugin-kit/contracts'

export type RpcResult<T = unknown> = SharedRpcResult<T>

export const PLUGIN_NAME = '@klarkxy/dsh-secret-manager'
/** Loader row id, credential-record scope and RPC channel id (one identifier, one meaning). */
export const PLUGIN_ID = 'secret-manager'
/** `credentialKey()` scope: every record this plugin owns lives under this segment. */
export const CREDENTIAL_SCOPE = 'secret-manager'
/**
 * Authenticated Host RPC channel. The Host registers it as a `webServer`
 * prefix route, so the wire form carries the leading slash; {@link PLUGIN_ID}
 * is the same channel without the router prefix.
 */
export const RPC_CHANNEL = '/dsh-secret-manager'
export const REF_SCHEME = 'secret'
export const ENV_KEY_PREFIX = 'DSH_SECRET_'
/** Client locale namespace; the plugin id, matching `locale/zh.json` and `locale/en.json`. */
export const LOCALE = PLUGIN_ID

/**
 * Our id grammar: starts and ends with a lowercase letter or digit, hyphens only
 * between, at most 41 characters. A trailing hyphen is refused because such a
 * slot would derive an injected name ending in `_`, which reads like a truncation.
 */
export const SLOT_RE = /^[a-z0-9](?:[a-z0-9-]{0,39}[a-z0-9])?$/
/**
 * Injected variable grammar. `@deepseek-ai/dsh-subprocess` types a
 * `DshEnvironmentKey` as `DSH_${string}`, and the shell-env registry rejects an
 * undeclared key, so the Host derives this name from a valid slot and declares
 * it; nothing else may choose it.
 */
export const ENV_KEY_RE = /^DSH_SECRET_[A-Z0-9_]{1,48}$/

export const MAX_VALUE_LENGTH = 8192
export const MAX_ID_LENGTH = 200
export const MAX_PURPOSE_LENGTH = 200
export const MAX_RESOURCE_LENGTH = 300
export const MAX_ORIGIN_LENGTH = 512
export const MAX_AUTH_HEADER_LENGTH = 128
export const MAX_AUTH_PREFIX_LENGTH = 64
export const MAX_URL_LENGTH = 2048
export const MAX_METHOD_LENGTH = 16
export const MAX_HTTP_HEADERS = 30
export const MAX_HTTP_REQUEST_BYTES = 64 * 1024
export const MAX_HTTP_RESPONSE_BYTES = 256 * 1024
/** A dialog the human never answers stops blocking the agent on its own. */
export const PENDING_TTL_MS = 5 * 60_000
/** Session authorization is bounded: it never outlives this window. */
export const GRANT_TTL_MS = 60 * 60_000
/** A session grant lasts one hour from the moment the human approved it; UIs must say so. */
export const GRANT_TTL_HINT = 'until this session ends or one hour passes'
export const DEFAULT_AUTH_HEADER = 'Authorization'
/**
 * The complete prefix, used verbatim: the header value is
 * `${authPrefix}${value}`. `'Bearer '` carries its own separator, so the Host
 * never appends a hidden space and a raw-value scheme passes an empty prefix.
 */
export const DEFAULT_AUTH_PREFIX = 'Bearer '

/**
 * Headers an authentication value may never ride in: transport control and
 * envelope framing belong to fetch, and silently overriding them would make the
 * scope the human approved untrue.
 */
export const FORBIDDEN_AUTH_HEADERS: readonly string[] = [
  'host', 'content-length', 'connection', 'transfer-encoding', 'te', 'trailer',
  'upgrade', 'keep-alive', 'expect', 'via', 'proxy-connection',
  'proxy-authorization', 'cookie', 'set-cookie',
]
export const REDACTION_MARKER = '[redacted]'

/** Endpoint names under {@link RPC_CHANNEL}. */
export const RPC = {
  pending: 'pending',
  submit: 'submit',
  cancel: 'cancel',
  list: 'list',
  save: 'save',
  delete: 'delete',
  revoke: 'revoke',
} as const

/** A slot is the addressing unit; the reference is what the model sees. */
export type SecretRef = `secret://${string}`

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isSlot(value: unknown): value is string {
  return typeof value === 'string' && SLOT_RE.test(value)
}

/** Shared boolean narrow, so the dialog and the Host read a flag identically. */
export function isYes(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function isBoundedId(value: unknown): value is string {
  return isBoundedString(value, MAX_ID_LENGTH)
}

/** The injected variable for a slot; callers pass an already validated slot. */
export function envKeyOf(slot: string): string {
  return `${ENV_KEY_PREFIX}${slot.replace(/-/g, '_').toUpperCase()}`
}

export function secretRefOf(slot: string): SecretRef {
  return `secret://${slot}`
}

export function parseSecretRef(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith(`${REF_SCHEME}://`)) return undefined
  const slot = value.slice(REF_SCHEME.length + 3)
  return isSlot(slot) ? slot : undefined
}

/**
 * A canonical absolute origin: `https://host[:port]` with no path, query,
 * fragment, userinfo or trailing slash. Parsing first and comparing
 * `parsed.origin === value` is what makes canonicalisation exact: WHATWG drops
 * a default port, lower-cases the host and strips every suffix, so each of
 * those differences fails the comparison instead of being silently accepted.
 */
export function isCanonicalOrigin(value: unknown): value is string {
  if (!isBoundedString(value, MAX_ORIGIN_LENGTH)) return false
  if (/[\u0000-\u001f\u007f]/.test(value)) return false
  let parsed: URL
  try { parsed = new URL(value) } catch { return false }
  if (parsed.protocol !== 'https:') return false
  if (parsed.origin !== value) return false
  return parsed.username === '' && parsed.password === ''
}

/** RFC 7230 header field name, minus the transport-control heads above. */
export function isAuthHeaderName(value: unknown): value is string {
  if (!isBoundedString(value, MAX_AUTH_HEADER_LENGTH)) return false
  if (!/^[A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]*$/.test(value)) return false
  return !FORBIDDEN_AUTH_HEADERS.includes(value.toLowerCase())
}

/** A prefix may be empty (raw value header) but never a line break or control character. */
export function isAuthPrefix(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_AUTH_PREFIX_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value)
}

/** The origin of one absolute https URL, or undefined when the URL is unusable. */
export function originOfUrl(value: unknown): string | undefined {
  if (!isBoundedString(value, MAX_URL_LENGTH)) return undefined
  let parsed: URL
  try { parsed = new URL(value) } catch { return undefined }
  if (parsed.username || parsed.password) return undefined
  const origin = parsed.origin
  return isCanonicalOrigin(origin) ? origin : undefined
}

/** What one session was allowed to do with one slot. */
export type SecretScope =
  /** Inject into that session's own model shell calls. */
  | { kind: 'env' }
  /** Attach the value to this exact origin as an authentication header. */
  | { kind: 'http'; origin: string; authHeader: string; authPrefix: string }

/** The HTTP shape a pending dialog is asking the human to approve. */
export type HttpScopeRequest = {
  origin: string
  authHeader: string
  authPrefix: string
}

/**
 * One open question to the human, addressed by the tool call that raised it.
 * `sessionId` is recorded by the Host when the tool starts; a later RPC body
 * can only confirm or cancel it, never redirect it to another session.
 */
export type PendingSecretRequest = {
  id: string
  sessionId: string
  callId: string
  kind: 'store' | 'http'
  slot: string
  envKey: string
  ref: string
  /** User-facing reason, bounded and already stripped of control characters. */
  purpose: string
  /** Optional short user-facing target description, e.g. the host being called. */
  resource?: string
  /** The tool asked for shell injection; the human decides in the dialog. */
  requestEnv: boolean
  /** Present only when the tool asked for an HTTP scope. */
  httpOrigin?: string
  authHeader: string
  authPrefix: string
  /** Presence only: never a tail, a length or a timestamp. */
  configured: boolean
  /** Host clock, epoch ms. */
  expiresAt: number
}

/** The RPC view of an open pending request: identical minus Host-only fields. */
export type PendingView = PendingSecretRequest

/**
 * One stored slot's public facts. Never the value.
 *
 * The two `*Sessions` fields are counts only; a management list must not hand
 * out session ids. `envGranted`/`httpGranted` answer the per-session question
 * for the `sessionId` the caller asked about, and are false when it asked about
 * none.
 */
export type SecretEntry = {
  ref: string
  slot: string
  envKey: string
  configured: true
  envGrantedSessions: number
  httpGrantedSessions: number
  envGranted: boolean
  httpGranted: boolean
}

export type SecretToolStatus =
  | 'stored'
  | 'ready'
  | 'cancelled'
  | 'timeout'
  | 'invalid'
  | 'unavailable'
  | 'not-found'

/** `request_secret`'s model-facing output. Presentation metadata mirrors it. */
export type SecretToolResult = {
  owner: typeof PLUGIN_ID
  status: SecretToolStatus
  ref?: string
  slot?: string
  envKey?: string
  configured: boolean
  envGranted: boolean
  httpGranted: boolean
  httpOrigin?: string
  summary: string
}

/** `secret_status`'s model-facing output. */
export type SecretStatusResult = {
  owner: typeof PLUGIN_ID
  entries: { ref: string; slot: string; envKey: string; configured: true }[]
  summary: string
}

export type SecretHttpStatus = 'ok' | 'cancelled' | 'timeout' | 'invalid' | 'unavailable' | 'not-found' | 'denied' | 'error'

/**
 * `secret_http`'s model-facing output: the response body, never the credential
 * and never a mirror of the request configuration. Response headers are
 * omitted on purpose — an echo of an authentication header is a leak.
 */
export type SecretHttpResult = {
  owner: typeof PLUGIN_ID
  status: SecretHttpStatus
  httpStatus?: number
  contentType?: string
  body?: string
  truncated?: boolean
  summary: string
}

/* RPC payloads and outcomes. Bounds are enforced Host-side; the Client validates first. */

export type PendingPayload = { sessionId: string; callId: string }

/**
 * Answering a dialog needs the unpredictable pending id as well as the call
 * identity: an old page, a reloaded session or a replayed call can then only
 * fail as `stale` instead of answering a newer question.
 */
export type SubmitPayload = {
  id: string
  sessionId: string
  callId: string
  /** Absent or empty means "reuse the record already stored for this slot". */
  value?: string
  grantEnv: boolean
  grantHttp: boolean
}

export type SubmitOutcome = {
  status: 'stored' | 'ready'
  ref: string
  slot: string
  envKey: string
  configured: true
  envGranted: boolean
  httpGranted: boolean
  httpOrigin?: string
}

export type CancelPayload = { id: string; sessionId: string; callId: string }

export type SavePayload = { slot: string; value: string }

export type SaveOutcome = { ref: string; slot: string; envKey: string; configured: true }

export type DeletePayload = { slot: string }

export type RevokePayload = { slot: string; sessionId?: string }

export type RevokeOutcome = { revoked: number }

/** `sessionId` is optional: a management page usually asks for no session at all. */
export type ListPayload = { sessionId?: string }

export type ListOutcome = { entries: SecretEntry[] }

/** The one rule both ends apply to a pasted value. */
export function valueProblem(value: unknown): string | undefined {
  if (typeof value !== 'string') return 'value: expected text'
  if (value.length === 0) return 'value: required'
  // Shape problems come before the length rule so a caller sees the actual fault.
  if (/[\u0000\r\n]/.test(value)) return 'value: no control characters or line breaks'
  if (value.trim() !== value) return 'value: no leading or trailing whitespace'
  if (value.length > MAX_VALUE_LENGTH) return `value: at most ${MAX_VALUE_LENGTH} characters`
  return undefined
}
