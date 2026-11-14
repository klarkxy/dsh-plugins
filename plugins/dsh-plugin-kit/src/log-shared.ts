export type PluginLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fault'

export const PLUGIN_LOG_LEVELS: readonly PluginLogLevel[] = ['debug', 'info', 'warn', 'error', 'fault']
export const DEFAULT_PLUGIN_LOG_LEVEL: PluginLogLevel = 'info'
export const PLUGIN_LOG_MAX_MESSAGE_CHARS = 16_000
export const PLUGIN_LOG_MAX_CONTEXT_CHARS = 8_000

export type PluginLogScalar = string | number | boolean | null
export type PluginLogContext = Record<string, PluginLogScalar | undefined>

export interface PluginLogInput {
  level: PluginLogLevel
  event: string
  message: string
  context?: PluginLogContext
  error?: unknown
}

export interface PluginLogError {
  name: string
  message: string
  stack?: string
  code?: string
}

export interface PluginLogEntry {
  version: 1
  at: string
  level: PluginLogLevel
  source: string
  surface: 'host' | 'client'
  profile?: string
  event: string
  message: string
  pid?: number
  context?: Record<string, PluginLogScalar>
  error?: PluginLogError
}

export interface PluginLogger {
  readonly source: string
  readonly file: string | null
  readonly lastWriteError: string | null
  debug(event: string, message: string, context?: PluginLogContext): boolean
  info(event: string, message: string, context?: PluginLogContext): boolean
  warn(event: string, message: string, error?: unknown, context?: PluginLogContext): boolean
  error(event: string, message: string, error?: unknown, context?: PluginLogContext): boolean
  fault(event: string, message: string, error?: unknown, context?: PluginLogContext): boolean
  write(input: PluginLogInput): boolean
  child(context: PluginLogContext): PluginLogger
}

const SOURCE_RE = /^[a-z][a-z0-9-]{0,63}$/
const EVENT_RE = /^[a-z][a-z0-9._-]{0,127}$/
const CONTEXT_KEY_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/
const SECRET_KEY_RE = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|bearer|authorization|cookie|set[_-]?cookie|nonce|credential|private[_-]?key|password|secret|app[_-]?secret|client[_-]?secret|z_c0|d_c0)$/i

const CHAT_PAYLOAD_RE =
  /"role"\s*:\s*"(?:system|user|assistant|tool)"|"(?:messages|content|prompt|input_text|input_image|image_url)"\s*:\s*[\[{"']/i
const CREDENTIAL_BODY_RE =
  /-----BEGIN (?:RSA |EC |OPENSSH |PRIVATE )?PRIVATE KEY-----|"type"\s*:\s*"service_account"|credentials\.json|\.dsh[/\\](?:credentials|auth)/i
const AUTH_HEADER_RE = /\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]*/gi
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._\-+=/]{8,}/g
const SECRET_FIELD_RE =
  /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|bearer|authorization|cookie|set-cookie|nonce|credential|private[_-]?key|password|secret|app[_-]?secret|client[_-]?secret|password|z_c0|d_c0)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,&;}]+)/gi
const SECRET_QUERY_RE =
  /([?&](?:token|api[_-]?key|key|secret|password|bootstrap|code|sig|signature|credential|password)=)[^\s&#"']+/gi
const URL_CREDENTIAL_RE = /\b(https?:\/\/)[^\s/:@]+:[^\s/@]+@/gi
const BOOTSTRAP_RE = /\/bootstrap\/[^\s"'?&#]+/gi
const KNOWN_TOKEN_RE = /\b(?:sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,}|tvly-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16})\b/g
const PATH_RE = /(?:[A-Za-z]:\\|\\\\)[^\s"'`<>|]+|(?:\/(?:home|Users|tmp|var|root)\/|~\/)[^\s"'`<>|]+/g

export function isPluginLogLevel(value: unknown): value is PluginLogLevel {
  return typeof value === 'string' && (PLUGIN_LOG_LEVELS as readonly string[]).includes(value)
}

export function pluginLogLevelEnabled(level: PluginLogLevel, minimum: PluginLogLevel): boolean {
  return PLUGIN_LOG_LEVELS.indexOf(level) >= PLUGIN_LOG_LEVELS.indexOf(minimum)
}

export function normalizePluginLogSource(raw: string): string {
  const stripped = String(raw || '').trim().replace(/^@[^/]+\//, '').toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  const prefixed = /^[a-z]/.test(stripped) ? stripped : `p-${stripped}`
  const bounded = prefixed.slice(0, 64).replace(/-+$/g, '')
  return SOURCE_RE.test(bounded) ? bounded : 'dsh-plugin'
}

export function normalizePluginLogEvent(raw: string): string {
  const cleaned = String(raw || '').trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 128)
  return EVENT_RE.test(cleaned) ? cleaned : 'plugin.event'
}

/**
 * Parse a level specification like `debug` or `dsh-zhihu=debug,dsh-dot:warn,info`.
 * Source-specific rules win over a bare fallback level.
 */
export function parsePluginLogLevel(
  spec: string | undefined | null,
  source?: string,
  fallback: PluginLogLevel = DEFAULT_PLUGIN_LOG_LEVEL,
): PluginLogLevel {
  if (!spec || typeof spec !== 'string') return fallback
  const normalizedSource = source ? normalizePluginLogSource(source) : undefined
  let wildcard: PluginLogLevel | undefined
  for (const token of spec.split(',').map(part => part.trim()).filter(Boolean)) {
    const lowered = token.toLowerCase()
    if (isPluginLogLevel(lowered)) {
      wildcard = lowered
      continue
    }
    const match = /^([^=:]+)[=:]([a-z]+)$/i.exec(token)
    if (!match) continue
    const target = match[1]!.trim()
    const candidate = match[2]!.trim().toLowerCase()
    if (!isPluginLogLevel(candidate)) continue
    if (target === '*') {
      wildcard = candidate
      continue
    }
    if (normalizedSource && normalizePluginLogSource(target) === normalizedSource) {
      return candidate
    }
  }
  return wildcard ?? fallback
}

export function sanitizePluginLogText(text: string, maxChars = PLUGIN_LOG_MAX_MESSAGE_CHARS): string {
  if (!text) return ''
  if (CREDENTIAL_BODY_RE.test(text)) return '[omitted credential material]'
  if (CHAT_PAYLOAD_RE.test(text)) return '[omitted chat payload]'
  const redacted = text
    .replace(AUTH_HEADER_RE, '$1: [redacted]')
    .replace(BEARER_RE, 'Bearer [redacted]')
    .replace(SECRET_FIELD_RE, (full, prefix: string) => {
      const value = full.slice(prefix.length)
      if (value.startsWith('"')) return `${prefix}"[redacted]"`
      if (value.startsWith("'")) return `${prefix}'[redacted]'`
      return `${prefix}[redacted]`
    })
    .replace(SECRET_QUERY_RE, '$1[redacted]')
    .replace(URL_CREDENTIAL_RE, '$1[redacted]@')
    .replace(BOOTSTRAP_RE, '/bootstrap/[redacted]')
    .replace(KNOWN_TOKEN_RE, '[redacted]')
    .replace(PATH_RE, '[path]')
  return truncateLogText(redacted, maxChars)
}

export function sanitizePluginLogContext(
  input: PluginLogContext | undefined,
): Record<string, PluginLogScalar> | undefined {
  if (!input) return undefined
  const output: Record<string, PluginLogScalar> = {}
  for (const [key, value] of Object.entries(input).slice(0, 32)) {
    if (value === undefined || !CONTEXT_KEY_RE.test(key)) continue
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    if (SECRET_KEY_RE.test(key)) {
      output[key] = '[redacted]'
      continue
    }
    output[key] = typeof value === 'string' ? sanitizePluginLogText(value, 1_000) : value
  }
  if (!Object.keys(output).length) return undefined
  const encoded = JSON.stringify(output)
  if (encoded.length <= PLUGIN_LOG_MAX_CONTEXT_CHARS) return output
  return { omitted: true, reason: 'Diagnostic context exceeded its size limit.' }
}

export function sanitizePluginLogError(error: unknown): PluginLogError | undefined {
  if (error === undefined) return undefined
  const row = error && typeof error === 'object'
    ? error as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown }
    : {}
  const rawMessage = typeof row.message === 'string' ? row.message : String(error)
  const result: PluginLogError = {
    name: typeof row.name === 'string' && row.name.trim() ? truncateLogText(row.name.trim(), 100) : 'Error',
    message: sanitizePluginLogText(rawMessage) || 'Unknown error',
  }
  if (typeof row.stack === 'string' && row.stack.trim()) {
    result.stack = sanitizePluginLogText(row.stack, 24_000)
  }
  if (typeof row.code === 'string' && /^[A-Za-z0-9_./:-]{1,100}$/.test(row.code)) {
    result.code = row.code
  } else if (typeof row.code === 'number' && Number.isFinite(row.code)) {
    result.code = String(row.code)
  }
  return result
}

export function mergePluginLogContext(
  base: PluginLogContext | undefined,
  extra: PluginLogContext | undefined,
): PluginLogContext | undefined {
  if (!base) return extra
  if (!extra) return base
  return { ...base, ...extra }
}

export function buildPluginLogEntry(
  input: PluginLogInput,
  meta: {
    at: Date
    source: string
    surface: 'host' | 'client'
    profile?: string
    pid?: number
    correlation?: PluginLogContext
  },
): PluginLogEntry {
  const entry: PluginLogEntry = {
    version: 1,
    at: meta.at.toISOString(),
    level: isPluginLogLevel(input.level) ? input.level : 'info',
    source: normalizePluginLogSource(meta.source),
    surface: meta.surface,
    ...(meta.profile ? { profile: meta.profile } : {}),
    event: normalizePluginLogEvent(input.event),
    message: sanitizePluginLogText(input.message || 'No diagnostic message was provided.', PLUGIN_LOG_MAX_MESSAGE_CHARS),
    ...(meta.pid !== undefined ? { pid: meta.pid } : {}),
  }
  const context = sanitizePluginLogContext(mergePluginLogContext(meta.correlation, input.context))
  if (context) entry.context = context
  const error = sanitizePluginLogError(input.error)
  if (error) entry.error = error
  return entry
}

export function createChildPluginLogger(parent: PluginLogger, bound: PluginLogContext): PluginLogger {
  return {
    get source() { return parent.source },
    get file() { return parent.file },
    get lastWriteError() { return parent.lastWriteError },
    debug: (event, message, context) => parent.debug(event, message, mergePluginLogContext(bound, context)),
    info: (event, message, context) => parent.info(event, message, mergePluginLogContext(bound, context)),
    warn: (event, message, error, context) => parent.warn(event, message, error, mergePluginLogContext(bound, context)),
    error: (event, message, error, context) => parent.error(event, message, error, mergePluginLogContext(bound, context)),
    fault: (event, message, error, context) => parent.fault(event, message, error, mergePluginLogContext(bound, context)),
    write: input => parent.write({ ...input, context: mergePluginLogContext(bound, input.context) }),
    child: next => createChildPluginLogger(parent, mergePluginLogContext(bound, next) ?? {}),
  }
}

export function truncateLogText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const marker = '[truncated]\n'
  if (maxChars <= marker.length) return text.slice(0, Math.max(0, maxChars))
  return `${marker}${text.slice(-(maxChars - marker.length))}`
}
