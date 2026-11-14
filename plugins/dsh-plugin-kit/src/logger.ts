import { AsyncLocalStorage } from 'node:async_hooks'
import {
  appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync,
  readSync, readdirSync, realpathSync, renameSync, unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PLUGIN_LOG_LEVEL, buildPluginLogEntry, createChildPluginLogger,
  mergePluginLogContext, normalizePluginLogSource, parsePluginLogLevel,
  pluginLogLevelEnabled, sanitizePluginLogText,
  type PluginLogContext, type PluginLogEntry, type PluginLogInput,
  type PluginLogLevel, type PluginLogger,
} from './log-shared.ts'

export * from './log-shared.ts'

export const PLUGIN_LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const PLUGIN_LOG_MAX_FILE_BYTES = 100 * 1024 * 1024
export const PLUGIN_LOG_MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
export const PLUGIN_LOG_RECENT_LIMIT = 200

const PROFILE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const ARCHIVE_RE = /^[a-z][a-z0-9-]{0,63}\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.\d+\.\d+\.jsonl$/

const correlationStorage = new AsyncLocalStorage<PluginLogContext>()
const processFileLoggers = new Map<string, RotatingPluginLogger>()
let operationSequence = 0

export interface RotatingPluginLoggerOptions {
  directory?: string
  home?: string
  profile?: string
  minimumLevel?: PluginLogLevel
  env?: NodeJS.ProcessEnv
  now?: () => Date
  pid?: number
  maxFileBytes?: number
  maxArchiveBytes?: number
  maxAgeMs?: number
  recentLimit?: number
  forwardHostWarnError?: boolean
}

export interface InstallPluginLoggerOptions extends RotatingPluginLoggerOptions {
  loadedContext?: PluginLogContext
}

type HostContextLike = {
  baseUrl?: unknown
  get?: (name: string, ...rest: unknown[]) => unknown
  effect?: (callback: () => () => void | Promise<void>, label?: string) => unknown
  logger?: {
    warn?: (...args: unknown[]) => void
    error?: (...args: unknown[]) => void
  }
}

export function safeProfileName(profile: string | undefined | null): string {
  const trimmed = String(profile ?? '').trim()
  if (PROFILE_RE.test(trimmed)) return trimmed.toLowerCase()
  const cleaned = trimmed.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return cleaned && PROFILE_RE.test(cleaned) ? cleaned : 'default'
}

export function pluginLogDirectory(home: string, profile = 'default'): string {
  return join(resolve(home), 'logs', 'plugins', safeProfileName(profile))
}

export function resolveHostLogTarget(
  ctx: unknown,
  options: Pick<RotatingPluginLoggerOptions, 'directory' | 'home' | 'profile' | 'env'> = {},
): { directory: string | null; anchor: string | null; profile?: string } {
  const env = options.env ?? process.env
  if (options.directory?.trim()) {
    const dir = resolve(options.directory.trim())
    return { directory: dir, anchor: dir, ...(options.profile ? { profile: safeProfileName(options.profile) } : {}) }
  }
  if (options.home?.trim()) {
    const home = resolve(options.home.trim())
    const profile = safeProfileName(options.profile)
    return { directory: pluginLogDirectory(home, profile), anchor: home, profile }
  }
  if (env.DSH_PLUGIN_LOG_DIR?.trim()) {
    const dir = resolve(env.DSH_PLUGIN_LOG_DIR.trim())
    return { directory: dir, anchor: dir, ...(options.profile ? { profile: safeProfileName(options.profile) } : {}) }
  }
  const host = ctx && typeof ctx === 'object' ? ctx as HostContextLike : undefined
  let profileCtx: { home?: unknown; name?: unknown; dir?: unknown } | undefined
  try {
    profileCtx = host?.get?.('profileContext', false) as typeof profileCtx
  } catch {
    try { profileCtx = host?.get?.('profileContext') as typeof profileCtx } catch { profileCtx = undefined }
  }
  if (
    typeof profileCtx?.home === 'string' && profileCtx.home.trim()
    && typeof profileCtx.dir === 'string' && profileCtx.dir.trim()
  ) {
    const home = resolve(profileCtx.home.trim())
    const dir = resolve(profileCtx.dir.trim())
    if (isInside(home, dir)) {
      const profile = safeProfileName(typeof profileCtx.name === 'string' ? profileCtx.name : basename(dir))
      return { directory: pluginLogDirectory(home, profile), anchor: home, profile }
    }
  }
  const inUnitTest = Boolean(env.VITEST || env.NODE_TEST_CONTEXT)
  if (!inUnitTest && typeof host?.baseUrl === 'string' && host.baseUrl.trim()) {
    const basePath = pathFromBaseUrl(host.baseUrl)
    const configuredHome = resolve((env.DSH_HOME?.trim() || join(homedir(), '.dsh')).trim())
    const profilesRoot = join(configuredHome, 'profiles')
    if (basePath && isInside(profilesRoot, basePath) && !samePath(profilesRoot, basePath)) {
      const rel = basePath.slice(profilesRoot.length).replace(/^[/\\]+/, '')
      const firstSegment = rel.split(/[/\\]/)[0]
      if (firstSegment) {
        const profile = safeProfileName(firstSegment)
        return { directory: pluginLogDirectory(configuredHome, profile), anchor: configuredHome, profile }
      }
    }
  }
  return { directory: null, anchor: null, ...(options.profile ? { profile: safeProfileName(options.profile) } : {}) }
}

/**
 * Synchronous, append-only rotating JSONL logger modeled on DSH Spaces
 * diagnostics: 7-day or 100 MiB active rotation, 7-day / 100 MiB archive
 * retention, secret and path redaction, and non-throwing write resilience.
 */
export class RotatingPluginLogger implements PluginLogger {
  readonly source: string
  readonly file: string | null
  private lastError: string | null = null
  private size = 0
  private openedAt = 0
  private initialized = false
  private writing = false
  private sequence = 0
  private loggedWriteFailure = false
  private readonly recent: PluginLogEntry[] = []
  private readonly directory: string | null
  private readonly anchor: string | null
  private readonly profile: string | undefined
  private readonly minimum: PluginLogLevel
  private readonly now: () => Date
  private readonly pid: number
  private readonly maxFileBytes: number
  private readonly maxArchiveBytes: number
  private readonly maxAgeMs: number
  private readonly recentLimit: number

  constructor(source: string, options: RotatingPluginLoggerOptions & { anchor?: string | null } = {}) {
    this.source = normalizePluginLogSource(source)
    const env = options.env ?? process.env
    const resolved = options.directory !== undefined || options.home !== undefined
      ? resolveHostLogTarget(undefined, options)
      : { directory: null, anchor: options.anchor ?? null, profile: options.profile }
    this.directory = resolved.directory
    this.anchor = options.anchor ?? resolved.anchor
    this.profile = options.profile ?? resolved.profile
    this.file = this.directory ? join(this.directory, `${this.source}.jsonl`) : null
    this.minimum = options.minimumLevel ?? parsePluginLogLevel(env.DSH_PLUGIN_LOG_LEVEL, this.source, DEFAULT_PLUGIN_LOG_LEVEL)
    this.now = options.now ?? (() => new Date())
    this.pid = options.pid ?? process.pid
    this.maxFileBytes = options.maxFileBytes ?? PLUGIN_LOG_MAX_FILE_BYTES
    this.maxArchiveBytes = options.maxArchiveBytes ?? PLUGIN_LOG_MAX_ARCHIVE_BYTES
    this.maxAgeMs = options.maxAgeMs ?? PLUGIN_LOG_MAX_AGE_MS
    this.recentLimit = Math.max(1, options.recentLimit ?? PLUGIN_LOG_RECENT_LIMIT)
  }

  get lastWriteError(): string | null {
    return this.lastError
  }

  recentEntries(limit = this.recentLimit): PluginLogEntry[] {
    return this.recent.slice(-Math.max(0, limit))
  }

  debug(event: string, message: string, context?: PluginLogContext): boolean {
    return this.write({ level: 'debug', event, message, ...(context ? { context } : {}) })
  }

  info(event: string, message: string, context?: PluginLogContext): boolean {
    return this.write({ level: 'info', event, message, ...(context ? { context } : {}) })
  }

  warn(event: string, message: string, error?: unknown, context?: PluginLogContext): boolean {
    return this.write({
      level: 'warn', event, message,
      ...(error !== undefined ? { error } : {}),
      ...(context ? { context } : {}),
    })
  }

  error(event: string, message: string, error?: unknown, context?: PluginLogContext): boolean {
    return this.write({
      level: 'error', event, message,
      ...(error !== undefined ? { error } : {}),
      ...(context ? { context } : {}),
    })
  }

  fault(event: string, message: string, error?: unknown, context?: PluginLogContext): boolean {
    return this.write({
      level: 'fault', event, message,
      ...(error !== undefined ? { error } : {}),
      ...(context ? { context } : {}),
    })
  }

  child(context: PluginLogContext): PluginLogger {
    return createChildPluginLogger(this, context)
  }

  write(input: PluginLogInput): boolean {
    if (!pluginLogLevelEnabled(input.level, this.minimum) || this.writing) return false
    const at = this.now()
    let entry: PluginLogEntry
    let line: string
    try {
      entry = buildPluginLogEntry(input, {
        at,
        source: this.source,
        surface: 'host',
        profile: this.profile,
        pid: this.pid,
        correlation: correlationStorage.getStore(),
      })
      line = `${JSON.stringify(entry)}\n`
    } catch {
      return false
    }
    this.pushRecent(entry)
    if (!this.directory || !this.file) return true
    this.writing = true
    try {
      this.openManagedDirectory()
      this.prepare(at)
      // Other plugin bundles/processes may rotate or replace this path after
      // initialization. Recheck the target and size before every append.
      const active = this.regularFile(this.file)
      this.size = active?.size ?? 0
      if (!active) this.openedAt = at.getTime()
      if (
        this.size > 0
        && (this.size + Buffer.byteLength(line) > this.maxFileBytes || at.getTime() - this.openedAt >= this.maxAgeMs)
      ) {
        this.rotate(at)
      }
      appendFileSync(this.file, line, { encoding: 'utf8', mode: 0o600 })
      this.size += Buffer.byteLength(line)
      this.prune(at)
      this.lastError = null
      this.loggedWriteFailure = false
      return true
    } catch (error) {
      const detail = sanitizePluginLogText(error instanceof Error ? error.message : String(error), 500)
      this.lastError = `The plugin diagnostic log could not be written: ${detail}`
      this.initialized = false
      if (!this.loggedWriteFailure) {
        this.loggedWriteFailure = true
        try {
          process.stderr.write(`DSH Plugin (${this.source}): ${this.lastError}. The original operation continues unchanged.\n`)
        } catch {
          // Broken stderr must never affect caller behavior.
        }
      }
      return false
    } finally {
      this.writing = false
    }
  }

  private pushRecent(entry: PluginLogEntry): void {
    this.recent.push(entry)
    const overflow = this.recent.length - this.recentLimit
    if (overflow > 0) this.recent.splice(0, overflow)
  }

  private prepare(at: Date): void {
    if (this.initialized || !this.file) return
    this.openManagedDirectory()
    const stat = this.regularFile(this.file)
    this.size = stat?.size ?? 0
    const stamps = stat ? [stat.birthtimeMs, stat.mtimeMs].filter(value => value > 0) : []
    this.openedAt = stamps.length ? Math.min(...stamps) : at.getTime()
    this.initialized = true
  }

  private rotate(at: Date): void {
    if (!this.directory || !this.file) return
    const stamp = at.toISOString().replace(/:/g, '-')
    const name = `${this.source}.${stamp}.${this.pid}.${this.sequence++}.jsonl`
    if (!ARCHIVE_RE.test(name)) throw new Error('Diagnostic log archive name is invalid.')
    const archive = join(this.directory, name)
    if (lexists(archive)) throw new Error('Diagnostic log archive already exists.')
    try {
      renameSync(this.file, archive)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        this.size = 0
        this.openedAt = at.getTime()
        return
      }
      throw error
    }
    this.size = 0
    this.openedAt = at.getTime()
  }

  private rotateStaleActive(at: Date): void {
    if (!this.file) return
    const stat = this.regularFile(this.file)
    if (!stat || stat.size === 0) return
    if (at.getTime() - stat.mtimeMs < this.maxAgeMs) return
    this.rotate(at)
  }

  private prune(at: Date): void {
    if (!this.directory) return
    this.rotateStaleActive(at)
    const archives: Array<{ name: string; size: number; mtime: number }> = []
    let total = 0
    for (const name of readdirSync(this.directory)) {
      if (!ARCHIVE_RE.test(name) || !name.startsWith(`${this.source}.`)) continue
      const file = join(this.directory, name)
      const stat = lstatSync(file)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Diagnostic log archive is not a regular file.')
      if (at.getTime() - stat.mtimeMs >= this.maxAgeMs) {
        try { unlinkSync(file) } catch { /* concurrent prune */ }
        continue
      }
      archives.push({ name, size: stat.size, mtime: stat.mtimeMs })
      total += stat.size
    }
    archives.sort((left, right) => left.mtime - right.mtime || left.name.localeCompare(right.name))
    while (total > this.maxArchiveBytes && archives.length) {
      const oldest = archives.shift()!
      try { unlinkSync(join(this.directory, oldest.name)) } catch { /* concurrent prune */ }
      total -= oldest.size
    }
  }

  private openManagedDirectory(): void {
    if (!this.directory) return
    if (this.anchor) {
      const anchorStat = existsSync(this.anchor) ? lstatSync(this.anchor) : undefined
      if (anchorStat?.isSymbolicLink()) throw new Error('Diagnostic log anchor cannot be a symbolic link.')
    }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const stat = lstatSync(this.directory)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Diagnostic log directory is not a real directory.')
    }
    const realDir = realpathSync(this.directory)
    if (this.anchor) {
      const realAnchor = realpathSync(this.anchor)
      if (!isInside(realAnchor, realDir)) {
        throw new Error('Diagnostic log directory escaped its managed root.')
      }
    }
  }

  private regularFile(file: string): { size: number; birthtimeMs: number; mtimeMs: number } | undefined {
    try {
      const stat = lstatSync(file)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Diagnostic log is not a regular file.')
      const expected = join(realpathSync(dirname(file)), basename(file))
      if (!samePath(realpathSync(file), expected)) throw new Error('Diagnostic log path could not be verified.')
      return stat
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
}

export function createPluginLogger(
  ctxOrSource: unknown,
  maybeSource?: string | RotatingPluginLoggerOptions,
  maybeOptions?: RotatingPluginLoggerOptions,
): PluginLogger {
  const hasCtx = typeof ctxOrSource !== 'string'
  const ctx = hasCtx ? ctxOrSource : undefined
  const source = hasCtx ? String(maybeSource ?? 'dsh-plugin') : ctxOrSource
  const options = (hasCtx ? maybeOptions : maybeSource as RotatingPluginLoggerOptions | undefined) ?? {}
  const normalized = normalizePluginLogSource(source)
  const target = resolveHostLogTarget(ctx, options)

  let backing: RotatingPluginLogger
  const canShare = Boolean(
    target.directory
    && options.minimumLevel === undefined
    && options.now === undefined
    && options.pid === undefined
    && options.maxFileBytes === undefined
    && options.maxArchiveBytes === undefined
    && options.maxAgeMs === undefined,
  )
  if (canShare && target.directory) {
    const key = resolve(target.directory, `${normalized}.jsonl`)
    let shared = processFileLoggers.get(key)
    if (!shared) {
      shared = new RotatingPluginLogger(normalized, {
        ...options,
        directory: target.directory,
        anchor: target.anchor,
        profile: target.profile,
      })
      processFileLoggers.set(key, shared)
    }
    backing = shared
  } else {
    backing = new RotatingPluginLogger(normalized, {
      ...options,
      ...(target.directory ? { directory: target.directory, anchor: target.anchor } : {}),
      ...(target.profile ? { profile: target.profile } : {}),
    })
  }

  if (options.forwardHostWarnError === false || !ctx || typeof ctx !== 'object') {
    return backing
  }
  return wrapWithHostForwarding(backing, ctx as HostContextLike)
}

export function installPluginLogger(
  ctx: unknown,
  source: string,
  options: InstallPluginLoggerOptions = {},
): PluginLogger {
  const logger = createPluginLogger(ctx, source, options)
  logger.info('plugin.loaded', 'Host plugin initialized.', options.loadedContext)
  const host = ctx && typeof ctx === 'object' ? ctx as HostContextLike : undefined
  if (typeof host?.effect === 'function') {
    try {
      host.effect(() => () => {
        logger.debug('plugin.disposed', 'Host plugin disposed.')
      }, `${logger.source}.logger`)
    } catch {
      // Non-Cordis or mock effect implementation.
    }
  }
  return logger
}

function wrapWithHostForwarding(backing: PluginLogger, host: HostContextLike): PluginLogger {
  const forward = (input: PluginLogInput) => {
    if (input.level !== 'warn' && input.level !== 'error' && input.level !== 'fault') return
    try {
      const hostLogger = host.logger
      if (!hostLogger) return
      const detail = input.error instanceof Error
        ? `${input.message} (${input.error.message})`
        : input.error !== undefined
          ? `${input.message} (${String(input.error)})`
          : input.message
      const text = sanitizePluginLogText(`${backing.source} [${input.event}]: ${detail}`, 1_000)
      if (input.level === 'warn') {
        if (typeof hostLogger.warn === 'function') hostLogger.warn(text)
      } else if (typeof hostLogger.error === 'function') {
        hostLogger.error(text)
      } else if (typeof hostLogger.warn === 'function') {
        hostLogger.warn(text)
      }
    } catch {
      // Host logger forwarding is best-effort.
    }
  }
  const wrapped: PluginLogger = {
    get source() { return backing.source },
    get file() { return backing.file },
    get lastWriteError() { return backing.lastWriteError },
    debug: (event, message, context) => backing.debug(event, message, context),
    info: (event, message, context) => backing.info(event, message, context),
    warn: (event, message, error, context) => {
      const wrote = backing.warn(event, message, error, context)
      forward({ level: 'warn', event, message, error, context })
      return wrote
    },
    error: (event, message, error, context) => {
      const wrote = backing.error(event, message, error, context)
      forward({ level: 'error', event, message, error, context })
      return wrote
    },
    fault: (event, message, error, context) => {
      const wrote = backing.fault(event, message, error, context)
      forward({ level: 'fault', event, message, error, context })
      return wrote
    },
    write: input => {
      const wrote = backing.write(input)
      forward(input)
      return wrote
    },
    child: context => createChildPluginLogger(wrapped, context),
  }
  return wrapped
}

export function nextPluginOperationId(prefix = 'op'): string {
  return `${normalizePluginLogSource(prefix)}-${process.pid}-${++operationSequence}`
}

export function currentPluginLogContext(): PluginLogContext | undefined {
  return correlationStorage.getStore()
}

export function withPluginLogContext<T>(context: PluginLogContext, action: () => T): T {
  const merged = mergePluginLogContext(correlationStorage.getStore(), context) ?? {}
  return correlationStorage.run(merged, action)
}

export async function pluginLogStep<T>(
  logger: PluginLogger,
  step: string,
  context: PluginLogContext | undefined,
  action: () => Promise<T>,
  completedLevel: PluginLogLevel = 'debug',
): Promise<T> {
  const started = Date.now()
  const base = { ...context, step }
  logger.debug('step.started', 'Operation step started.', base)
  try {
    const result = await action()
    logger.write({
      level: completedLevel,
      event: 'step.completed',
      message: 'Operation step completed.',
      context: { ...base, durationMs: Date.now() - started },
    })
    return result
  } catch (error) {
    logger.error('step.failed', 'Operation step failed.', error, {
      ...base,
      durationMs: Date.now() - started,
    })
    throw error
  }
}

export function pluginLogSyncStep<T>(
  logger: PluginLogger,
  step: string,
  context: PluginLogContext | undefined,
  action: () => T,
  completedLevel: PluginLogLevel = 'debug',
): T {
  const started = Date.now()
  const base = { ...context, step }
  logger.debug('step.started', 'Operation step started.', base)
  try {
    const result = action()
    logger.write({
      level: completedLevel,
      event: 'step.completed',
      message: 'Operation step completed.',
      context: { ...base, durationMs: Date.now() - started },
    })
    return result
  } catch (error) {
    logger.error('step.failed', 'Operation step failed.', error, {
      ...base,
      durationMs: Date.now() - started,
    })
    throw error
  }
}

export function readPluginLogTail(file: string, maxBytes = 256 * 1024): string {
  const stat = lstatSync(file)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Diagnostic log is not a regular file.')
  if (stat.size <= 0 || maxBytes <= 0) return ''
  const length = Math.min(stat.size, maxBytes)
  const descriptor = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const read = readSync(descriptor, buffer, 0, buffer.length, stat.size - length)
    let text = buffer.subarray(0, read).toString('utf8')
    if (stat.size > length) {
      const newline = text.indexOf('\n')
      text = newline === -1 ? '' : text.slice(newline + 1)
    }
    return text
  } finally {
    closeSync(descriptor)
  }
}

function lexists(file: string): boolean {
  try {
    lstatSync(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function pathFromBaseUrl(baseUrl: string): string | null {
  try {
    return baseUrl.includes('://') ? resolve(fileURLToPath(baseUrl)) : resolve(baseUrl)
  } catch {
    return null
  }
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isInside(root: string, target: string): boolean {
  const rootResolved = resolve(root)
  const targetResolved = resolve(target)
  if (samePath(rootResolved, targetResolved)) return true
  const prefix = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep
  return process.platform === 'win32'
    ? targetResolved.toLowerCase().startsWith(prefix.toLowerCase())
    : targetResolved.startsWith(prefix)
}
