import {
  DEFAULT_PLUGIN_LOG_LEVEL, buildPluginLogEntry, createChildPluginLogger,
  normalizePluginLogSource, parsePluginLogLevel, pluginLogLevelEnabled,
  sanitizePluginLogText,
  type PluginLogContext, type PluginLogEntry, type PluginLogInput,
  type PluginLogLevel, type PluginLogger,
} from './log-shared.ts'

export * from './log-shared.ts'

export const CLIENT_PLUGIN_LOG_GLOBAL = '__KLARKXY_PLUGIN_LOGS__'
export const CLIENT_PLUGIN_LOG_LIMIT = 500

export interface ClientPluginLoggerOptions {
  minimumLevel?: PluginLogLevel
  now?: () => Date
  bufferLimit?: number
  forwardToHostLogger?: boolean
  loadedContext?: PluginLogContext
}

type BrowserContextLike = {
  effect?: (callback: () => () => void, label?: string) => unknown
  logger?: {
    warn?: (...args: unknown[]) => void
    error?: (...args: unknown[]) => void
  }
}

type GlobalLogCarrier = {
  [CLIENT_PLUGIN_LOG_GLOBAL]?: PluginLogEntry[]
  window?: { localStorage?: { getItem?: (key: string) => string | null } }
  console?: {
    debug?: (...args: unknown[]) => void
    info?: (...args: unknown[]) => void
    warn?: (...args: unknown[]) => void
    error?: (...args: unknown[]) => void
  }
}

function readStorageFlag(key: string): string | undefined {
  try {
    const win = (globalThis as unknown as GlobalLogCarrier).window
    const storage = win?.localStorage
    const value = storage?.getItem?.(key)
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  } catch {
    return undefined
  }
}

function sharedClientBuffer(limit: number): PluginLogEntry[] {
  const carrier = globalThis as unknown as GlobalLogCarrier
  if (!Array.isArray(carrier[CLIENT_PLUGIN_LOG_GLOBAL])) {
    try {
      carrier[CLIENT_PLUGIN_LOG_GLOBAL] = []
    } catch {
      return []
    }
  }
  const list = carrier[CLIENT_PLUGIN_LOG_GLOBAL]!
  const overflow = list.length - limit
  if (overflow > 0) list.splice(0, overflow)
  return list
}

export function readClientPluginLogs(source?: string): PluginLogEntry[] {
  const carrier = globalThis as unknown as GlobalLogCarrier
  const list = Array.isArray(carrier[CLIENT_PLUGIN_LOG_GLOBAL]) ? carrier[CLIENT_PLUGIN_LOG_GLOBAL]! : []
  if (!source) return list.slice()
  const normalized = normalizePluginLogSource(source)
  return list.filter(entry => entry.source === normalized)
}

export function clearClientPluginLogs(): void {
  const carrier = globalThis as unknown as GlobalLogCarrier
  if (Array.isArray(carrier[CLIENT_PLUGIN_LOG_GLOBAL])) {
    carrier[CLIENT_PLUGIN_LOG_GLOBAL]!.length = 0
  }
}

export function createClientPluginLogger(
  source: string,
  ctx?: unknown,
  options: ClientPluginLoggerOptions = {},
): PluginLogger {
  const normalized = normalizePluginLogSource(source)
  const now = options.now ?? (() => new Date())
  const limit = Math.max(10, options.bufferLimit ?? CLIENT_PLUGIN_LOG_LIMIT)
  const browserCtx = ctx && typeof ctx === 'object' ? ctx as BrowserContextLike : undefined

  const resolveMinimum = (): PluginLogLevel => {
    if (options.minimumLevel) return options.minimumLevel
    return parsePluginLogLevel(readStorageFlag('dsh-plugin-log-level'), normalized, DEFAULT_PLUGIN_LOG_LEVEL)
  }

  const logger: PluginLogger = {
    source: normalized,
    file: null,
    lastWriteError: null,
    debug: (event, message, context) => logger.write({ level: 'debug', event, message, ...(context ? { context } : {}) }),
    info: (event, message, context) => logger.write({ level: 'info', event, message, ...(context ? { context } : {}) }),
    warn: (event, message, error, context) => logger.write({
      level: 'warn', event, message,
      ...(error !== undefined ? { error } : {}),
      ...(context ? { context } : {}),
    }),
    error: (event, message, error, context) => logger.write({
      level: 'error', event, message,
      ...(error !== undefined ? { error } : {}),
      ...(context ? { context } : {}),
    }),
    fault: (event, message, error, context) => logger.write({
      level: 'fault', event, message,
      ...(error !== undefined ? { error } : {}),
      ...(context ? { context } : {}),
    }),
    child: context => createChildPluginLogger(logger, context),
    write(input: PluginLogInput): boolean {
      try {
        if (!pluginLogLevelEnabled(input.level, resolveMinimum())) return false
        const entry = buildPluginLogEntry(input, {
          at: now(),
          source: normalized,
          surface: 'client',
        })
        const buffer = sharedClientBuffer(limit)
        buffer.push(entry)
        const overflow = buffer.length - limit
        if (overflow > 0) buffer.splice(0, overflow)

        if (options.forwardToHostLogger !== false && browserCtx?.logger) {
          const summary = sanitizePluginLogText(`${normalized} [${entry.event}]: ${entry.message}`, 500)
          if (entry.level === 'warn' && typeof browserCtx.logger.warn === 'function') {
            browserCtx.logger.warn(summary)
          } else if ((entry.level === 'error' || entry.level === 'fault') && typeof browserCtx.logger.error === 'function') {
            browserCtx.logger.error(summary)
          }
        }
        if (readStorageFlag('dsh-plugin-log-console') === '1') {
          const con = (globalThis as unknown as GlobalLogCarrier).console
          const fn = entry.level === 'debug' ? con?.debug
            : entry.level === 'info' ? con?.info
              : entry.level === 'warn' ? con?.warn
                : con?.error
          fn?.call(con, `[${normalized}] ${entry.event}: ${entry.message}`, entry)
        }
        return true
      } catch {
        return false
      }
    },
  }
  return logger
}

export function installClientPluginLogger(
  ctx: unknown,
  source: string,
  options: ClientPluginLoggerOptions = {},
): PluginLogger {
  const logger = createClientPluginLogger(source, ctx, options)
  logger.info('client.loaded', 'Client plugin initialized.', options.loadedContext)
  const browserCtx = ctx && typeof ctx === 'object' ? ctx as BrowserContextLike : undefined
  if (typeof browserCtx?.effect === 'function') {
    try {
      browserCtx.effect(() => () => {
        logger.debug('client.disposed', 'Client plugin disposed.')
      }, `${logger.source}.client-logger`)
    } catch {
      // Non-Cordis mock context.
    }
  }
  return logger
}

export async function clientLogStep<T>(
  logger: PluginLogger,
  step: string,
  context: PluginLogContext | undefined,
  action: () => Promise<T>,
  completedLevel: PluginLogLevel = 'debug',
): Promise<T> {
  const started = Date.now()
  const base = { ...context, step }
  logger.debug('step.started', 'Client step started.', base)
  try {
    const result = await action()
    logger.write({
      level: completedLevel,
      event: 'step.completed',
      message: 'Client step completed.',
      context: { ...base, durationMs: Date.now() - started },
    })
    return result
  } catch (error) {
    logger.error('step.failed', 'Client step failed.', error, {
      ...base,
      durationMs: Date.now() - started,
    })
    throw error
  }
}
