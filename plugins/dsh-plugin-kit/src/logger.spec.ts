import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearClientPluginLogs, clientLogStep, createClientPluginLogger,
  installClientPluginLogger, readClientPluginLogs,
} from './client-logger.ts'
import {
  RotatingPluginLogger, createPluginLogger, installPluginLogger,
  parsePluginLogLevel, pluginLogDirectory, pluginLogStep,
  readPluginLogTail, resolveHostLogTarget, withPluginLogContext,
  type PluginLogEntry,
} from './logger.ts'

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-log-'))
  tempDirs.push(dir)
  return dir
}

function readEntries(file: string): PluginLogEntry[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as PluginLogEntry)
}

afterEach(() => {
  clearClientPluginLogs()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

describe('parsePluginLogLevel', () => {
  it('supports global level and per-source overrides', () => {
    expect(parsePluginLogLevel(undefined, 'dsh-zhihu')).toBe('info')
    expect(parsePluginLogLevel('debug', 'dsh-zhihu')).toBe('debug')
    expect(parsePluginLogLevel('dsh-zhihu=debug,dsh-dot:warn,error', '@klarkxy/dsh-zhihu')).toBe('debug')
    expect(parsePluginLogLevel('dsh-zhihu=debug,dsh-dot:warn,error', 'dsh-dot')).toBe('warn')
    expect(parsePluginLogLevel('dsh-zhihu=debug,dsh-dot:warn,error', 'dsh-font')).toBe('error')
  })
})

describe('RotatingPluginLogger', () => {
  it('records all 5 levels when minimumLevel is debug and filters below minimum', () => {
    const dir = makeTempDir()
    const logger = new RotatingPluginLogger('@klarkxy/dsh-demo', {
      directory: dir,
      minimumLevel: 'debug',
      pid: 4242,
      now: () => new Date('2026-11-12T10:00:00.000Z'),
    })
    expect(logger.debug('demo.debug', 'Debug detail', { count: 1 })).toBe(true)
    expect(logger.info('demo.info', 'Info event')).toBe(true)
    expect(logger.warn('demo.warn', 'Warn event', new Error('minor issue'))).toBe(true)
    expect(logger.error('demo.error', 'Error event', Object.assign(new Error('failed'), { code: 'E_FAIL' }))).toBe(true)
    expect(logger.fault('demo.fault', 'Fault event', new Error('corrupt journal'))).toBe(true)

    const entries = readEntries(logger.file!)
    expect(entries.map(item => item.level)).toEqual(['debug', 'info', 'warn', 'error', 'fault'])
    expect(entries[0]).toMatchObject({
      version: 1,
      source: 'dsh-demo',
      surface: 'host',
      pid: 4242,
      event: 'demo.debug',
      context: { count: 1 },
    })
    expect(entries[3]?.error?.code).toBe('E_FAIL')

    const warnOnly = new RotatingPluginLogger('dsh-warn-only', { directory: dir, minimumLevel: 'warn' })
    expect(warnOnly.debug('skip.debug', 'ignored')).toBe(false)
    expect(warnOnly.info('skip.info', 'ignored')).toBe(false)
    expect(warnOnly.warn('keep.warn', 'recorded')).toBe(true)
    expect(readEntries(warnOnly.file!)).toHaveLength(1)
  })

  it('redacts secrets, tokens, headers, chat payloads, private keys, and local paths', () => {
    const dir = makeTempDir()
    const logger = new RotatingPluginLogger('dsh-redact', { directory: dir, minimumLevel: 'debug' })

    logger.warn(
      'auth.failed',
      'Request to https://user:pass123@example.com/api?token=abc123&ok=1 with Bearer eyJhbGciOiJIUzI1NiJ9.secret and sk-1234567890abcdef failed at C:\\Users\\alice\\secret.json',
      new Error('Authorization: Bearer topsecrettoken12345\napiKey=my-secret-value'),
      {
        apiKey: 'should-redact',
        z_c0: 'cookie-secret',
        provider: 'openai',
        filePath: '/Users/alice/.dsh/config.json',
      },
    )
    logger.info('chat.leak', '{"role":"user","content":"private user prompt"}')
    logger.info('key.leak', '-----BEGIN PRIVATE KEY-----MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC')

    const entries = readEntries(logger.file!)
    const serialized = JSON.stringify(entries)
    expect(serialized).not.toContain('pass123')
    expect(serialized).not.toContain('abc123')
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(serialized).not.toContain('sk-1234567890abcdef')
    expect(serialized).not.toContain('topsecrettoken12345')
    expect(serialized).not.toContain('my-secret-value')
    expect(serialized).not.toContain('should-redact')
    expect(serialized).not.toContain('cookie-secret')
    expect(serialized).not.toContain('C:\\\\Users\\\\alice')
    expect(serialized).not.toContain('/Users/alice')
    expect(serialized).not.toContain('private user prompt')
    expect(serialized).not.toContain('BEGIN PRIVATE KEY')

    expect(entries[0]?.context).toEqual({
      apiKey: '[redacted]',
      z_c0: '[redacted]',
      provider: 'openai',
      filePath: '[path]',
    })
    expect(entries[1]?.message).toBe('[omitted chat payload]')
    expect(entries[2]?.message).toBe('[omitted credential material]')
  })

  it('rotates by file size, rotates stale active logs by age, and prunes old or excess archives', () => {
    const dir = makeTempDir()
    let clock = new Date('2026-11-01T00:00:00.000Z')
    const logger = new RotatingPluginLogger('dsh-rotate', {
      directory: dir,
      now: () => clock,
      pid: 99,
      maxFileBytes: 450,
      maxArchiveBytes: 700,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    })

    for (let index = 0; index < 8; index++) {
      clock = new Date(clock.getTime() + 1_000)
      logger.info('batch.write', `entry-${index}-${'x'.repeat(80)}`, { index })
    }

    const filesAfterSize = readdirSync(dir).filter(name => name.startsWith('dsh-rotate.'))
    const archivesAfterSize = filesAfterSize.filter(name => name !== 'dsh-rotate.jsonl')
    expect(archivesAfterSize.length).toBeGreaterThanOrEqual(1)
    const totalArchiveSize = archivesAfterSize.reduce(
      (sum, name) => sum + readFileSync(join(dir, name)).byteLength,
      0,
    )
    expect(totalArchiveSize).toBeLessThanOrEqual(700)

    // Age out existing active + archive files beyond 7 days and trigger a fresh write.
    const oldDate = new Date('2026-10-20T00:00:00.000Z')
    for (const name of readdirSync(dir)) {
      utimesSync(join(dir, name), oldDate, oldDate)
    }
    clock = new Date('2026-11-10T00:00:00.000Z')
    const freshLogger = new RotatingPluginLogger('dsh-rotate', {
      directory: dir,
      now: () => clock,
      pid: 99,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    })
    freshLogger.info('after.age', 'fresh entry')
    freshLogger.info('after.age.second', 'second fresh entry')
    const remaining = readdirSync(dir)
    expect(remaining).toContain('dsh-rotate.jsonl')
    const tail = readPluginLogTail(freshLogger.file!, 260)
    expect(tail).toContain('after.age.second')
  })

  it('never throws when disk writes fail and records lastWriteError', () => {
    const dir = makeTempDir()
    const blockedPath = join(dir, 'not-a-directory')
    writeFileSync(blockedPath, 'file blocking mkdir')
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const logger = new RotatingPluginLogger('dsh-broken', {
      directory: join(blockedPath, 'nested'),
    })
    expect(() => logger.error('disk.test', 'Still safe')).not.toThrow()
    expect(logger.lastWriteError).toBeTruthy()
    expect(logger.recentEntries()).toHaveLength(1)
    expect(stderrSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects symbolic link log files without throwing to callers', () => {
    const dir = makeTempDir()
    const outside = join(dir, 'outside.txt')
    writeFileSync(outside, '')
    const logDir = join(dir, 'logs')
    mkdirSync(logDir)
    let symlinkSupported = true
    try {
      symlinkSync(outside, join(logDir, 'dsh-symlink.jsonl'))
    } catch {
      symlinkSupported = false
    }
    if (!symlinkSupported) return

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const logger = new RotatingPluginLogger('dsh-symlink', { directory: logDir })
    expect(logger.info('symlink.blocked', 'Must not write to outside target')).toBe(false)
    expect(readFileSync(outside, 'utf8')).toBe('')
    expect(logger.lastWriteError).toBeTruthy()
  })
})

describe('host resolution, correlation, and steps', () => {
  it('keeps unit-test mock contexts memory-only while resolving confirmed profileContext to home/logs/plugins/<profile>', async () => {
    expect(resolveHostLogTarget({})).toEqual({ directory: null, anchor: null })
    expect(resolveHostLogTarget({
      get: () => ({ dir: '/tmp/isolated-test' }),
    })).toEqual({ directory: null, anchor: null })

    const home = makeTempDir()
    const profileDir = join(home, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    const warnSpy = vi.fn()
    const infoSpy = vi.fn()
    const disposers: Array<() => void> = []
    const hostCtx = {
      get: (name: string) => name === 'profileContext' ? { home, dir: profileDir, name: 'web' } : undefined,
      effect: (fn: () => () => void) => { disposers.push(fn()) },
      logger: { warn: warnSpy, info: infoSpy },
    }

    const logger = installPluginLogger(hostCtx, '@klarkxy/dsh-sample', { minimumLevel: 'debug' })
    expect(logger.file).toBe(join(pluginLogDirectory(home, 'web'), 'dsh-sample.jsonl'))
    expect(infoSpy).not.toHaveBeenCalled()

    await withPluginLogContext({ operationId: 'op-123', sessionId: 'sess-9' }, async () => {
      await pluginLogStep(logger, 'sync.items', { count: 3 }, async () => 'done', 'info')
      logger.warn('rate.limited', 'Retrying with fallback')
    })
    for (const dispose of disposers) dispose()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const entries = readEntries(logger.file!)
    const completed = entries.find(item => item.event === 'step.completed')
    expect(completed?.context).toMatchObject({
      operationId: 'op-123',
      sessionId: 'sess-9',
      step: 'sync.items',
      count: 3,
    })
    expect(typeof completed?.context?.durationMs).toBe('number')
    expect(entries.at(-1)?.event).toBe('plugin.disposed')

    const child = createPluginLogger(hostCtx, 'dsh-sample').child({ feature: 'sub' })
    child.info('sub.ready', 'Child context merged')
    const updated = readEntries(logger.file!)
    expect(updated.at(-1)?.context).toMatchObject({ feature: 'sub' })
  })
})

describe('client-logger', () => {
  it('stores bounded sanitized entries on globalThis and forwards warn/error to host logger', async () => {
    const warn = vi.fn()
    const error = vi.fn()
    const disposers: Array<() => void> = []
    const ctx = {
      logger: { warn, error },
      effect: (fn: () => () => void) => { disposers.push(fn()) },
    }
    const logger = installClientPluginLogger(ctx, '@klarkxy/dsh-ui-test', {
      minimumLevel: 'debug',
      bufferLimit: 12,
    })
    await clientLogStep(logger, 'panel.open', { tab: 'main' }, async () => 42, 'info')
    logger.warn('ui.slow', 'Slow response for Bearer secret12345678')
    for (let i = 0; i < 15; i++) logger.debug('ui.tick', `tick-${i}`)
    for (const dispose of disposers) dispose()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).not.toContain('secret12345678')
    expect(error).not.toHaveBeenCalled()

    const logs = readClientPluginLogs('dsh-ui-test')
    expect(logs.length).toBeLessThanOrEqual(12)
    expect(logs.at(-1)?.event).toBe('client.disposed')

    const sub = createClientPluginLogger('dsh-other', undefined, { minimumLevel: 'info' })
    sub.info('other.ok', 'Recorded')
    expect(readClientPluginLogs('dsh-other')).toHaveLength(1)
  })
})
