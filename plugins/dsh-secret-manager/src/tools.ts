/**
 * The model-facing tools. None of them accepts a value as an argument and none
 * of them returns one: a secret reaches the Host only through the dialog the
 * human approved, and the model only ever learns a `secret://<slot>` reference
 * plus state flags.
 *
 * Each call that needs a human decision parks on the pending registry until the
 * Client answers, the request expires, or the caller's signal aborts. The
 * dialog is not a polling loop: the answer arrives as an RPC and settles this
 * await.
 */
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import {
  DEFAULT_AUTH_HEADER,
  DEFAULT_AUTH_PREFIX,
  MAX_METHOD_LENGTH,
  MAX_PURPOSE_LENGTH,
  MAX_RESOURCE_LENGTH,
  MAX_URL_LENGTH,
  PLUGIN_ID,
  envKeyOf,
  isAuthHeaderName,
  isAuthPrefix,
  isBoundedId,
  isRecord,
  isSlot,
  originOfUrl,
  parseSecretRef,
  secretRefOf,
  type PendingSecretRequest,
  type SecretHttpResult,
  type SecretStatusResult,
  type SecretToolResult,
  type SubmitOutcome,
} from './contracts.ts'
import { performHttpRequest, type HttpOutcome, type HttpScope } from './http.ts'
import type { PendingAnswer } from './pending.ts'
import type { SecretRuntime } from './index.ts'

export interface ToolRunContext {
  callId: string
  agent?: { id: string; session: unknown }
  signal: AbortSignal
}

const okText = (text: string) => [{ type: 'text' as const, text }]

const requestSecretParameters: ObjectJsonSchema = {
  type: 'object',
  properties: {
    slot: {
      type: 'string',
      description: 'Stable lowercase-hyphenated name for the credential: starts and ends with a letter or digit, at most 41 characters, e.g. "db-prod". Becomes the secret:// reference and the DSH_SECRET_* variable.',
    },
    purpose: {
      type: 'string',
      description: 'One short sentence shown to the human explaining what this credential is for and why this call needs it.',
    },
    resource: {
      type: 'string',
      description: 'Optional short user-facing target, e.g. the service host the credential is used against.',
    },
    request_env: {
      type: 'boolean',
      description: 'Whether this call also wants the value injected into your own shell calls in this session. The human decides in the dialog; default false.',
    },
    http_origin: {
      type: 'string',
      description: 'Optional HTTPS origin, such as "https://api.example.com", that this call wants to call with the credential. The human approves it in the dialog.',
    },
    auth_header: {
      type: 'string',
      description: 'Header name for that HTTP scope; default Authorization. Transport control headers are refused.',
    },
    auth_prefix: {
      type: 'string',
      description: 'Complete value prefix for that header, used verbatim; default "Bearer " (with the trailing space). Pass an empty string for a raw value.',
    },
  },
  required: ['slot', 'purpose'],
  additionalProperties: false,
}

const secretStatusParameters: ObjectJsonSchema = {
  type: 'object',
  properties: {
    slot: { type: 'string', description: 'Only report this slot.' },
  },
  additionalProperties: false,
}

const secretHttpParameters: ObjectJsonSchema = {
  type: 'object',
  properties: {
    ref: { type: 'string', description: 'Reference to the stored credential, e.g. "secret://db-prod".' },
    url: { type: 'string', description: 'Absolute HTTPS URL to call.' },
    method: { type: 'string', description: 'HTTP method; default GET. GET/HEAD take no body.' },
    // The DSL admits only a boolean `additionalProperties`, so the header map is
    // declared open here and every entry is checked as text at runtime.
    headers: { type: 'object', additionalProperties: true, description: 'Request headers as a flat object of string values, never the credential itself.' },
    body: { type: 'string', description: 'Request body text.' },
  },
  required: ['ref', 'url'],
  additionalProperties: false,
}

const secretResultSchema: ObjectJsonSchema = {
  type: 'object',
  properties: {
    owner: { type: 'string', const: PLUGIN_ID },
    status: { type: 'string' },
    ref: { type: 'string' },
    slot: { type: 'string' },
    envKey: { type: 'string' },
    configured: { type: 'boolean' },
    envGranted: { type: 'boolean' },
    httpGranted: { type: 'boolean' },
    httpOrigin: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['owner', 'status', 'configured', 'envGranted', 'httpGranted', 'summary'],
  additionalProperties: false,
}

const statusResultSchema: ObjectJsonSchema = {
  type: 'object',
  properties: {
    owner: { type: 'string', const: PLUGIN_ID },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'string' }, slot: { type: 'string' },
          envKey: { type: 'string' }, configured: { type: 'boolean' },
        },
        required: ['ref', 'slot', 'envKey', 'configured'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
  },
  required: ['owner', 'entries', 'summary'],
  additionalProperties: false,
}

const httpResultSchema: ObjectJsonSchema = {
  type: 'object',
  properties: {
    owner: { type: 'string', const: PLUGIN_ID },
    status: { type: 'string' },
    httpStatus: { type: 'number' },
    contentType: { type: 'string' },
    body: { type: 'string' },
    truncated: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['owner', 'status', 'summary'],
  additionalProperties: false,
}

function summaryOf(outcome: SubmitOutcome): string {
  const grants = [
    outcome.envGranted ? 'shell injection in this session' : undefined,
    outcome.httpGranted ? `HTTP calls to ${outcome.httpOrigin ?? 'the approved origin'}` : undefined,
  ].filter(Boolean)
  const state = grants.length > 0 ? `Authorized for ${grants.join(' and ')}.` : 'No new authorization was granted.'
  return `Credential ${outcome.ref} is stored. ${state}`
}

function invalid(summary: string): SecretToolResult {
  return { owner: PLUGIN_ID, status: 'invalid', configured: false, envGranted: false, httpGranted: false, summary }
}

/** Compose the model-facing result of one answered dialog. */
function resultOf(slot: string, answer: PendingAnswer, configured: boolean): SecretToolResult {
  if (answer.kind === 'cancelled') {
    return {
      owner: PLUGIN_ID, status: 'cancelled', slot, ref: secretRefOf(slot), envKey: envKeyOf(slot),
      configured, envGranted: false, httpGranted: false,
      summary: `The human cancelled the request for ${secretRefOf(slot)}. Do not retry immediately; continue without the credential or ask them in your reply.`,
    }
  }
  if (answer.kind === 'timeout') {
    return {
      owner: PLUGIN_ID, status: 'timeout', slot, ref: secretRefOf(slot), envKey: envKeyOf(slot),
      configured, envGranted: false, httpGranted: false,
      summary: `The request for ${secretRefOf(slot)} expired unanswered. Continue without the credential.`,
    }
  }
  const outcome = answer.outcome
  return {
    owner: PLUGIN_ID, status: outcome.status, slot, ref: outcome.ref, envKey: outcome.envKey,
    configured: outcome.configured, envGranted: outcome.envGranted, httpGranted: outcome.httpGranted,
    ...(outcome.httpOrigin ? { httpOrigin: outcome.httpOrigin } : {}),
    summary: summaryOf(outcome),
  }
}

/** Stop waiting when the caller's signal aborts. */
function waitForAnswer(runtime: SecretRuntime, request: PendingSecretRequest, answer: Promise<PendingAnswer>, signal: AbortSignal): Promise<PendingAnswer> {
  return new Promise<PendingAnswer>((resolve) => {
    let settled = false
    const finish = (value: PendingAnswer) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const onAbort = () => {
      runtime.pending.abandon(request.id)
      finish({ kind: 'cancelled' })
    }
    if (signal.aborted) {
      runtime.pending.abandon(request.id)
      finish({ kind: 'cancelled' })
      return
    }
    signal.addEventListener('abort', onAbort)
    void answer.then(finish)
  })
}

function reasonOf(runtime: SecretRuntime, exec: ToolRunContext): string | undefined {
  if (!exec.agent || !isBoundedId(exec.agent.id)) return 'No live session is driving this call.'
  if (runtime.isSubagent(exec.agent.session)) {
    return 'A delegated child thread cannot obtain credentials; the human must approve it in a top-level session.'
  }
  return undefined
}

function httpScopeFrom(input: Record<string, unknown>): { scope: HttpScope } | { error: string } {
  const origin = input.http_origin === undefined ? undefined : input.http_origin
  if (origin === undefined) return { error: 'http_origin is required' }
  if (typeof origin !== 'string' || originOfUrl(`${origin}/`) !== origin) {
    return { error: 'http_origin: expected an HTTPS origin such as https://api.example.com' }
  }
  const authHeader = input.auth_header === undefined ? DEFAULT_AUTH_HEADER : input.auth_header
  if (!isAuthHeaderName(authHeader)) return { error: 'auth_header: expected a header name that is not a transport control header' }
  const authPrefix = input.auth_prefix === undefined ? DEFAULT_AUTH_PREFIX : input.auth_prefix
  if (!isAuthPrefix(authPrefix)) return { error: 'auth_prefix: expected text without control characters' }
  return { scope: { origin, authHeader, authPrefix } }
}

export function createRequestSecretTool(runtime: SecretRuntime) {
  return {
    name: 'request_secret',
    description: [
      'Ask the human for a credential through a dedicated dialog. The value never enters this conversation: you receive only a secret:// reference and state flags.',
      'Use it when a task needs a credential you do not have. Ask for the narrowest authorization: omit request_env unless you yourself must run a shell command that reads it, and pass http_origin only when a call must carry it.',
      'The dialog is answered outside this turn; this tool waits for the answer. Never ask the human to paste a credential into chat.',
    ].join(' '),
    parameters: requestSecretParameters,
    output: {
      schema: secretResultSchema,
      render: (_args: unknown, value: SecretToolResult) => okText(String(value?.summary ?? '')),
      presentationMeta: (value: unknown) => {
        if (!isRecord(value) || value.owner !== PLUGIN_ID) return null
        return {
          owner: PLUGIN_ID,
          status: String(value.status ?? 'invalid'),
          slot: typeof value.slot === 'string' ? value.slot : null,
          ref: typeof value.ref === 'string' ? value.ref : null,
          envKey: typeof value.envKey === 'string' ? value.envKey : null,
          summary: typeof value.summary === 'string' ? value.summary : '',
          configured: value.configured === true,
          envGranted: value.envGranted === true,
          httpGranted: value.httpGranted === true,
          httpOrigin: typeof value.httpOrigin === 'string' ? value.httpOrigin : null,
        }
      },
    },
    isConcurrencySafe: () => false,
    async execute(args: unknown, exec: ToolRunContext): Promise<SecretToolResult> {
      const input = isRecord(args) ? args : {}
      const refused = reasonOf(runtime, exec)
      if (refused) {
        return { owner: PLUGIN_ID, status: 'unavailable', configured: false, envGranted: false, httpGranted: false, summary: refused }
      }
      if (!isSlot(input.slot)) return invalid('slot: lowercase letters, digits and inner hyphens, starting and ending with a letter or digit, at most 41 characters')
      if (typeof input.purpose !== 'string' || input.purpose.length === 0 || input.purpose.length > MAX_PURPOSE_LENGTH) {
        return invalid(`purpose: required, at most ${MAX_PURPOSE_LENGTH} characters`)
      }
      const resource = input.resource
      if (resource !== undefined && (typeof resource !== 'string' || resource.length === 0 || resource.length > MAX_RESOURCE_LENGTH)) {
        return invalid(`resource: at most ${MAX_RESOURCE_LENGTH} characters`)
      }
      if (input.request_env !== undefined && typeof input.request_env !== 'boolean') return invalid('request_env: expected true or false')

      let http: HttpScope | undefined
      const wantsHttp = input.http_origin !== undefined || input.auth_header !== undefined || input.auth_prefix !== undefined
      if (wantsHttp) {
        const scope = httpScopeFrom(input)
        if ('error' in scope) return invalid(scope.error)
        http = scope.scope
      }

      const slot = input.slot
      const stored = await runtime.store.prime(slot).catch(() => undefined)
      const configured = stored !== undefined
      const pending = runtime.pending.create({
        sessionId: exec.agent!.id,
        callId: exec.callId,
        kind: wantsHttp ? 'http' : 'store',
        slot,
        envKey: envKeyOf(slot),
        ref: secretRefOf(slot),
        purpose: sanitizeText(input.purpose),
        ...(typeof resource === 'string' ? { resource: sanitizeText(resource) } : {}),
        requestEnv: input.request_env === true,
        ...(http ? { httpOrigin: http.origin, authHeader: http.authHeader, authPrefix: http.authPrefix }
          : { authHeader: DEFAULT_AUTH_HEADER, authPrefix: DEFAULT_AUTH_PREFIX }),
        configured,
      })
      runtime.noteDialog?.(exec.agent!.id, exec.callId)
      const answer = await waitForAnswer(runtime, pending.request, pending.answer, exec.signal)
      return resultOf(slot, answer, configured || answer.kind === 'submitted')
    },
  }
}

export function createSecretStatusTool(runtime: SecretRuntime) {
  return {
    name: 'secret_status',
    description: 'Report which credential references are configured, without revealing any value. Use it to avoid asking the human for something already stored.',
    parameters: secretStatusParameters,
    output: {
      schema: statusResultSchema,
      render: (_args: unknown, value: SecretStatusResult) => okText(String(value?.summary ?? '')),
    },
    isConcurrencySafe: () => true,
    async execute(args: unknown): Promise<SecretStatusResult> {
      const input = isRecord(args) ? args : {}
      if (input.slot !== undefined && !isSlot(input.slot)) {
        return { owner: PLUGIN_ID, entries: [], summary: 'slot: lowercase letters, digits and inner hyphens, starting and ending with a letter or digit' }
      }
      // Always enumerate the records this plugin owns and filter them: a status
      // question is answered by presence, never by echoing back the slot the
      // caller named. `slots()` returns addresses only, so no value is read.
      const stored = await runtime.store.slots()
      const slots = input.slot === undefined ? stored : stored.filter(slot => slot === input.slot)
      const entries = slots.map(slot => ({
        ref: secretRefOf(slot), slot, envKey: envKeyOf(slot), configured: true as const,
      }))
      const summary = entries.length > 0
        ? `Stored credentials: ${entries.map(entry => entry.ref).join(', ')}.`
        : input.slot === undefined
          ? 'No credentials are stored yet; call request_secret when one is needed.'
          : `${secretRefOf(input.slot)} is not stored; call request_secret with slot "${input.slot}" when it is needed.`
      return { owner: PLUGIN_ID, entries, summary }
    },
  }
}

export function createSecretHttpTool(runtime: SecretRuntime) {
  return {
    name: 'secret_http',
    description: [
      'Call an HTTPS endpoint with a stored credential attached as an authentication header. The credential never appears in the request arguments or the result.',
      'This tool never prompts: the session must first be authorized through request_secret with http_origin for the exact origin. Without that approval it is refused and tells you which request_secret call is missing.',
      'Redirects are refused, so call the final URL directly. An oversized or unreadable response is refused without returning a partial body.',
    ].join(' '),
    parameters: secretHttpParameters,
    output: {
      schema: httpResultSchema,
      render: (_args: unknown, value: SecretHttpResult) => okText(
        value?.body !== undefined ? `${value.summary}\n\n${value.body}` : String(value?.summary ?? ''),
      ),
    },
    isConcurrencySafe: () => false,
    async execute(args: unknown, exec: ToolRunContext): Promise<SecretHttpResult> {
      const input = isRecord(args) ? args : {}
      const refused = reasonOf(runtime, exec)
      if (refused) return { owner: PLUGIN_ID, status: 'unavailable', summary: refused }

      const slot = parseSecretRef(input.ref)
      if (!slot) return { owner: PLUGIN_ID, status: 'invalid', summary: 'ref: expected secret://<slot>' }
      if (typeof input.url !== 'string' || input.url.length === 0 || input.url.length > MAX_URL_LENGTH) {
        return { owner: PLUGIN_ID, status: 'invalid', summary: 'url: expected an absolute HTTPS URL' }
      }
      const origin = originOfUrl(input.url)
      if (origin === undefined) return { owner: PLUGIN_ID, status: 'invalid', summary: 'url: only absolute HTTPS URLs without credentials are accepted' }
      const method = input.method === undefined ? 'GET' : input.method
      if (typeof method !== 'string' || method.length === 0 || method.length > MAX_METHOD_LENGTH) {
        return { owner: PLUGIN_ID, status: 'invalid', summary: 'method: expected an HTTP method name' }
      }
      let requestHeaders: Record<string, string> | undefined
      if (input.headers !== undefined) {
        requestHeaders = stringRecord(input.headers)
        if (requestHeaders === undefined) {
          return { owner: PLUGIN_ID, status: 'invalid', summary: 'headers: expected a flat object whose values are all text' }
        }
      }
      if (input.body !== undefined && typeof input.body !== 'string') {
        return { owner: PLUGIN_ID, status: 'invalid', summary: 'body: expected text' }
      }

      const sessionId = exec.agent!.id
      // No implicit dialog here: the session must already hold an HTTP approval
      // for this exact origin, granted through request_secret. Asking for it
      // here would open a second, unanswered question surface.
      const granted = runtime.grants.httpScope(slot, sessionId, origin)
      const stored = await runtime.store.prime(slot).catch(() => undefined)
      if (!granted || !stored) {
        const missing = stored ? 'this session has no HTTP authorization for the origin' : `${secretRefOf(slot)} is not stored`
        return {
          owner: PLUGIN_ID,
          status: 'denied',
          summary: `Refused: ${missing}. Call request_secret with slot "${slot}"${stored ? '' : ' and the value'}, http_origin "${origin}", then retry.`,
        }
      }
      // Revalidate in the same tick as the send: the value may have been replaced
      // or the session's authorization revoked while it was loading or while the
      // dialog was open, and neither may be silently bypassed by a stale read.
      const liveGrant = runtime.grants.httpScope(slot, sessionId, origin)
      const liveStored = runtime.store.cached(slot)
      if (!liveGrant || !liveStored) {
        return { owner: PLUGIN_ID, status: 'denied', summary: 'The authorization or the stored value is no longer live; ask again.' }
      }
      runtime.redactor.record(exec.callId, [liveStored.secret])
      const outcome: HttpOutcome = await performHttpRequest(
        {
          url: input.url,
          method: method.toUpperCase(),
          ...(requestHeaders === undefined ? {} : { headers: requestHeaders }),
          ...(typeof input.body === 'string' ? { body: input.body } : {}),
        },
        liveGrant,
        liveStored.secret,
        { fetch: runtime.fetch, signal: exec.signal },
      )

      if (outcome.kind === 'cancelled') return { owner: PLUGIN_ID, status: 'cancelled', summary: 'The request was cancelled.' }
      if (outcome.kind === 'error') {
        return { owner: PLUGIN_ID, status: 'error', summary: `The request failed (${outcome.reason}). No credential was echoed.` }
      }
      if (outcome.kind === 'denied') {
        return { owner: PLUGIN_ID, status: 'denied', summary: `The request was refused by policy (${outcome.reason}).` }
      }
      return {
        owner: PLUGIN_ID,
        status: 'ok',
        httpStatus: outcome.status,
        ...(outcome.contentType ? { contentType: outcome.contentType } : {}),
        body: outcome.body,
        truncated: outcome.truncated,
        summary: `HTTP ${outcome.status} from ${origin}${outcome.truncated ? ' (body truncated)' : ''}.`,
      }
    },
  }
}

/** Strip control characters so a dialog cannot be made to render a fake prompt. */
function sanitizeText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
}

/** A flat object whose values are all text, or undefined when any is not. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [name, item] of Object.entries(value)) {
    if (typeof item !== 'string') return undefined
    out[name] = item
  }
  return out
}
