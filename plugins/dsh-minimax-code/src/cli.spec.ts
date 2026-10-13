import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONNECTORS, MiniMaxCli, cliFailure, managedLauncher, parseCliJson } from './cli.ts'
import { DEFAULT_SETTINGS } from './contracts.ts'
import imageSchema from './fixtures/generate-image.schema.json'
import speechSchema from './fixtures/batch-speech.schema.json'
import videoSchema from './fixtures/video.schema.json'

const roots: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const signal = () => new AbortController().signal
const output = (value: unknown) => ({ stdout: JSON.stringify(value), stderr: '', exitCode: 0 })
function cli(run: ReturnType<typeof vi.fn>) {
  return new MiniMaxCli(DEFAULT_SETTINGS, { discover: vi.fn(async () => ({ command: process.execPath, displayPath: 'managed-tools' })), run })
}

describe('managed MiniMax launcher', () => {
  it('reads an official cmd launcher as data, preserving its broker environment and separate executable arguments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'minimax-cli-spec-')); roots.push(root)
    const entry = join(root, 'tools entry.js'), launcher = join(root, 'mcode-tools-cn.cmd')
    await writeFile(entry, '')
    await writeFile(launcher, ['@echo off', 'setlocal DisableDelayedExpansion', 'set "MCODE_REGION=cn"', 'set "ELECTRON_RUN_AS_NODE=1"', `"${process.execPath}" "${entry}" %*`, 'exit /b %ERRORLEVEL%'].join('\r\n'))
    const result = await managedLauncher(launcher)
    expect(result).toMatchObject({ command: process.execPath, args: [entry], displayPath: launcher, env: { MCODE_REGION: 'cn', ELECTRON_RUN_AS_NODE: '1' } })
    expect(result.command).not.toMatch(/cmd(?:\.exe)?$/i)
  })

  it('interprets the exact official prefix-clearing loops without executing a shell or changing the parent environment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'minimax-cli-spec-')); roots.push(root)
    const entry = join(root, 'tools.js'), launcher = join(root, 'mcode-tools-cn.cmd')
    const prefixes = ['__MAVIS_PARENT_', '__MAVIS_RUNTIME_', 'AGENTARCHON_', 'AGENT_ARCHON_']
    for (const prefix of prefixes) vi.stubEnv(`${prefix}TEST_SENTINEL`, 'parent-value')
    vi.stubEnv('MCODE_TEST_SENTINEL', 'preserved')
    await writeFile(entry, '')
    await writeFile(launcher, [
      '@echo off', 'setlocal DisableDelayedExpansion',
      ...prefixes.map(prefix => `for /f "tokens=1 delims==" %%V in ('set ${prefix} 2^>nul') do set "%%V="`),
      'set "MCODE_REGION=cn"', `"${process.execPath}" "${entry}" %*`, 'exit /b %ERRORLEVEL%',
    ].join('\r\n'))
    const resolved = await managedLauncher(launcher)
    expect(resolved).toMatchObject({ command: process.execPath, args: [entry], env: { MCODE_REGION: 'cn', MCODE_TEST_SENTINEL: 'preserved' } })
    for (const prefix of prefixes) {
      expect(resolved.env).not.toHaveProperty(`${prefix}TEST_SENTINEL`)
      expect(process.env[`${prefix}TEST_SENTINEL`]).toBe('parent-value')
    }
  })

  it.each(['set "PATH=untrusted"', 'set "MCODE_HOME=%TEMP%"', 'set "MCODE_HOME=!TEMP!"', 'echo injected & whoami', 'call another.cmd'])('rejects unsupported launcher instructions: %s', async line => {
    const root = await mkdtemp(join(tmpdir(), 'minimax-cli-spec-')); roots.push(root)
    const path = join(root, 'mcode-tools-cn.cmd')
    await writeFile(path, `@echo off\n${line}\n`)
    await expect(managedLauncher(path)).rejects.toMatchObject({ code: 'unsupported-launcher' })
  })
})

describe('private named connectors', () => {
  it.each([['generate_image', imageSchema, { requests: [{ prompt: 'A tree', output_file: 'item-0.png' }] }], ['batch_speech', speechSchema, { requests: [{ text: 'Hello', output_file: 'item-0.mp3' }] }], ['generate_video', videoSchema, { prompt: 'A tree in wind', model: 'MiniMax-H3', duration: 4, resolution: '2K' }]] as const)('validates the observed %s schema before a single business call', async (capability, schema, args) => {
    const run = vi.fn().mockResolvedValueOnce(output(schema)).mockResolvedValueOnce(output({ code: 0 }))
    await cli(run).call(capability, args, signal())
    expect(run.mock.calls.map(call => call[1])).toEqual([['connector', 'tool', CONNECTORS[capability]], ['connector', 'call', CONNECTORS[capability], '--args-file', '-']])
    expect(JSON.parse(run.mock.calls[1][2].input)).toEqual(args)
  })

  it.each([{ ...imageSchema, tool_name: 'connector__matrix__image_understand' }, { ...imageSchema, input_schema: { type: 'object', properties: {} } }])('refuses a renamed or incompatible connector without a business call', async schema => {
    const run = vi.fn().mockResolvedValue(output(schema))
    await expect(cli(run).call('generate_image', { requests: [{ prompt: 'tree' }] }, signal())).rejects.toMatchObject({ code: 'unsupported-schema' })
    expect(run).toHaveBeenCalledOnce()
  })

  it('refuses parameters rejected by the current vendor schema without a business call', async () => {
    const run = vi.fn().mockResolvedValue(output(videoSchema))
    await expect(cli(run).call('generate_video', { prompt: 'tree', model: 'MiniMax-H3-Max', duration: 4 }, signal())).rejects.toMatchObject({ code: 'bad-request' })
    expect(run).toHaveBeenCalledOnce()
  })

  it.each(['image_understand', 'constructor', '__proto__', 'toString'])('does not resolve an arbitrary or inherited connector name: %s', async capability => {
    const run = vi.fn()
    await expect(cli(run).schema(capability as any, signal())).rejects.toMatchObject({ code: 'unsupported-capability' })
    expect(run).not.toHaveBeenCalled()
    expect(Object.values(CONNECTORS)).not.toEqual(expect.arrayContaining([expect.stringMatching(/music|twitter|image_understand/)]))
  })
})

describe('CLI status and failures', () => {
  it.each([['authenticated', 'shared-broker', true], ['authenticated', 'api-key', false], ['unauthenticated', 'shared-broker', false]])('uses the official auth status shape %s/%s', async (status, auth_mode, authenticated) => {
    const run = vi.fn().mockResolvedValueOnce({ stdout: 'mcode-tools 1.2\n', stderr: '', exitCode: 0 }).mockResolvedValueOnce(output({ status, auth_mode }))
    await expect(cli(run).status(signal())).resolves.toMatchObject({ version: 'mcode-tools 1.2', authenticated })
  })
  it.each([['BROKER_UNAVAILABLE', 'host-required'], ['token expired', 'login-required'], ['insufficient quota', 'quota'], ['unknown failure', 'cli-failed']])('normalizes %s without leaking stderr', (stderr, code) => {
    const privateStderr = `${stderr}; MINIMAX_PRIVATE_STDERR_SENTINEL`
    expect(cliFailure(privateStderr)).toMatchObject({ code })
    expect(cliFailure(privateStderr).message).not.toContain('MINIMAX_PRIVATE_STDERR_SENTINEL')
  })
  it('does not treat JSON-looking stdout from a failed CLI process as success', async () => {
    const run = vi.fn().mockResolvedValue({ ...output(imageSchema), stderr: 'token expired', exitCode: 1 })
    await expect(cli(run).schema('generate_image', signal())).rejects.toMatchObject({ code: 'login-required' })
    expect(run).toHaveBeenCalledOnce()
  })
  it.each(['null', 'true', '1', 'log line\n{}', '{'])('rejects invalid tool JSON: %s', value => {
    expect(() => parseCliJson(value)).toThrow(expect.objectContaining({ code: 'invalid-output' }))
  })
  it('requires the official reference-video duration before passing it to generation', async () => {
    const run = vi.fn().mockResolvedValueOnce(output({ temp_url: 'https://media.example/upload', reference_video: { duration_seconds: 1 } })).mockResolvedValueOnce(output({ temp_url: 'https://media.example/upload', reference_video: { duration_seconds: 8 } }))
    await expect(cli(run).upload('video.mp4', 'video/mp4', signal(), true)).rejects.toMatchObject({ code: 'invalid-media' })
    await expect(cli(run).upload('video.mp4', 'video/mp4', signal(), true)).resolves.toMatchObject({ durationSeconds: 8, mimeType: 'video/mp4' })
  })
})
