import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Capability } from './contracts.ts'
import { GrokRuntime, type GrokRequest } from './runtime.ts'
import { childEnvironment, gateArgs, isolationConfig, isolationHolds, parseInspect, runGrok, tomlString, versionAccepted, type InspectReport } from './process.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const clean = (): InspectReport => ({ version: '1.0.50', plugins: [], skills: [], servers: [], instructions: [], layers: [] })
const signal = () => new AbortController().signal
async function fixture(capability: Capability = 'search') {
  const root = await mkdtemp(join(tmpdir(), 'grok-test-')); roots.push(root)
  const request: GrokRequest = { capability, prompt: 'test', inputs: [], jobId: 'job', jobDirectory: root, workspace: root }
  const run = vi.fn(async (_exe, args, env, _cwd, _signal, onLine) => {
    if (args.includes('--version')) { expect(onLine).toBeUndefined(); return { stdout: 'grok 1.0.50', stderr: '', exitCode: 0 } }
    const id = args[args.indexOf('--session-id') + 1], tool = args[args.indexOf('--tools') + 1]
    await onLine(JSON.stringify({ type: 'tool_call', toolCallId: 'call', toolName: tool, rawInput: {} }))
    await onLine(JSON.stringify({ type: 'text', data: 'INVENTED ASSISTANT ANSWER https://fake.example' }))
    await onLine(JSON.stringify({ type: 'tool_call_update', toolCallId: 'call', status: 'completed', rawOutput: { type: 'WebSearch', content: 'native answer', citations: ['https://real.example', 'invalid'] } }))
    await onLine(JSON.stringify({ type: 'end', stopReason: 'end_turn', sessionId: id }))
    return { stdout: '', stderr: '', exitCode: 0 }
  })
  const inspect = vi.fn(async () => clean()), discover = vi.fn(async () => ({ command: 'chosen.exe', displayPath: 'chosen.exe' }))
  const runtime = new GrokRuntime(() => ({ ...DEFAULT_SETTINGS, executable: 'chosen.exe', allowNativeMediaFiles: true }), { run, inspect, discover })
  return { root, request, run, inspect, discover, runtime }
}
describe('CLI isolation and native protocol', () => {
  it('writes valid single compatibility tables and escaped Windows paths', () => {
    const report = clean(); report.plugins = [{ name: "quote's", scope: 'user', path: "C:\\dir's\\plug" }]
    const config = isolationConfig(report)
    expect(config.match(/\[compat.claude\]/g)).toHaveLength(1)
    expect(tomlString("C:\\dir's")).toBe('"C:\\\\dir\'s"')
    expect(config).toContain('enabled = []')
    expect(() => gateArgs('unknown_native_name')).toThrow()
    expect(versionAccepted([1, 0, 50])).toBe(true); expect(versionAccepted([1, 0, 51])).toBe(false)
  })
  it('strips provider overlays and turns every compatibility surface off', () => {
    const env = childEnvironment('private', 'auth-pointer', { PATH: 'path', GROK_CONFIG: 'user', GROK_MODEL: 'override', XAI_API_KEY: 'unused', OPENAI_API_KEY: 'unused', GROK_HOME: 'global' })
    expect(env).toMatchObject({ GROK_HOME: 'private', GROK_AUTH_PATH: 'auth-pointer', PATH: 'path' })
    expect(env.GROK_CONFIG).toBeUndefined(); expect(env.XAI_API_KEY).toBeUndefined()
    for (const vendor of ['CLAUDE', 'CURSOR', 'CODEX']) for (const surface of ['HOOKS', 'SKILLS', 'MCPS', 'RULES', 'AGENTS']) expect(env[`GROK_${vendor}_${surface}_ENABLED`]).toBe('0')
  })
  it('blocks external skills, MCP, instructions and config siblings but ignores plugin trust as a disabling signal', () => {
    const base = clean(); base.plugins = [{ name: 'trusted-but-disabled', scope: 'user', path: 'user-plugin' }]
    expect(isolationHolds(base, 'private')).toBeUndefined()
    expect(isolationHolds({ ...base, skills: [{ name: 'external', path: 'x', source: 'user', disabled: false }] }, 'private')).toContain('技能')
    expect(isolationHolds({ ...base, servers: [{ name: 'mcp', source: 'user', disabled: false }] }, 'private')).toContain('MCP')
    expect(isolationHolds({ ...base, instructions: [{ path: 'AGENTS.md', status: '' }] }, 'private')).toContain('说明')
    expect(isolationHolds({ ...base, layers: ['private-sibling/config.toml'] }, 'private')).toContain('配置')
    expect(parseInspect({ configWarnings: [{ message: 'parse failed' }] }).warnings).toEqual(['parse failed'])
  })
  it('uses the selected executable for both inspections and only accepts native search content/citations', async () => {
    const f = await fixture(); const result = await f.runtime.run(f.request, signal())
    expect(result).toMatchObject({ answer: 'native answer', sources: [{ url: 'https://real.example' }], state: 'completed' })
    expect(JSON.stringify(result)).not.toContain('INVENTED')
    expect(f.inspect).toHaveBeenCalledTimes(2)
    expect(f.inspect.mock.calls[0][0]).toMatchObject({ command: 'chosen.exe' })
    const args = f.run.mock.calls.at(-1)![1]
    expect(args[args.indexOf('--tools') + 1]).toBe('web_search')
    await f.runtime.dispose()
  })
  it.each([200, 404, 503])('preserves native fetch status %s and untrimmed body', async status => {
    const f = await fixture('fetch'); f.request.nativeInput = { url: 'https://source.test/' }
    f.run.mockImplementation(async (_exe, args, _env, _cwd, _signal, onLine) => {
      if (args.includes('--version')) return { stdout: 'grok 1.0.50', stderr: '', exitCode: 0 }
      const id = args[args.indexOf('--session-id') + 1]
      const prompt = JSON.parse(args[args.indexOf('--prompt-json') + 1])[0].text
      expect(JSON.parse(prompt).arguments).toEqual({ url: 'https://source.test/' })
      await onLine(JSON.stringify({ type: 'tool_call', toolCallId: 'fetch', toolName: 'web_fetch', rawInput: { url: 'https://source.test/' } }))
      await onLine(JSON.stringify({ type: 'tool_call_update', toolCallId: 'fetch', status: 'completed', rawOutput: { type: 'WebFetch', Content: { url: 'https://source.test/final', content: '  native body\n ', status_code: status } } }))
      await onLine(JSON.stringify({ type: 'end', stopReason: 'end_turn', sessionId: id }))
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    expect(await f.runtime.run(f.request, signal())).toMatchObject({ state: 'completed', fetch: { statusCode: status, url: 'https://source.test/final', body: { kind: 'text', content: '  native body\n ' }, truncated: false } })
    await f.runtime.dispose()
  })
  it('keeps capabilities separate when native file access has not been allowed', async () => {
    const f = await fixture(); const runtime = new GrokRuntime(() => DEFAULT_SETTINGS, { discover: f.discover, run: f.run, inspect: f.inspect })
    const status = await runtime.status(signal())
    expect(status.capabilities.filter(c => c.available).map(c => c.id)).toEqual(['search', 'fetch', 'generate_image'])
    await expect(runtime.run({ ...f.request, capability: 'edit_image' }, signal())).rejects.toMatchObject({ code: 'native-media-disabled' })
    await runtime.dispose(); await f.runtime.dispose()
  })
  it('rejects a CLI tool-selection fallback before accepting any result', async () => {
    const f = await fixture()
    f.run.mockImplementation(async (_exe, args, _env, _cwd, _signal, onLine) => {
      if (args.includes('--version')) return { stdout: 'grok 1.0.50', stderr: '', exitCode: 0 }
      await onLine(JSON.stringify({ type: 'available_commands', tools: ['web_search', 'Bash'] }))
      throw new Error('must not continue')
    })
    expect(await f.runtime.run(f.request, signal())).toMatchObject({ state: 'uncertain', error: { code: 'unexpected-tool' } })
    await f.runtime.dispose()
  })
  it('records start before invocation, copies native files before cleanup and preserves partial success after cancellation', async () => {
    const f = await fixture('generate_image'), order: string[] = []
    f.request.onStarted = async () => { order.push('persist-start') }
    f.request.onFile = async file => { order.push('persist-file'); expect(await readFile(file.source)).toHaveLength(8) }
    let privateHome = ''
    f.run.mockImplementation(async (_exe, args, env, _cwd, _signal, onLine) => {
      if (args.includes('--version')) return { stdout: 'grok 1.0.50', stderr: '', exitCode: 0 }
      order.push('invoke'); privateHome = env.GROK_HOME
      const id = args[args.indexOf('--session-id') + 1], folder = join(privateHome, 'sessions', 'cwd', id, 'images'), path = join(folder, '1.png')
      await mkdir(folder, { recursive: true }); await writeFile(path, Buffer.from([137,80,78,71,13,10,26,10])); await writeFile(join(privateHome, 'input-guard.used'), 'verified')
      await onLine(JSON.stringify({ type: 'tool_call', toolCallId: 'm', toolName: 'image_gen', rawInput: {} }))
      await onLine(JSON.stringify({ type: 'tool_call_update', toolCallId: 'm', status: 'completed', rawOutput: { type: 'ImageGen', path, filename: '1.png', session_folder: 'images' } }))
      throw Object.assign(new Error('cancelled'), { code: 'cancelled' })
    })
    const result = await f.runtime.run(f.request, signal())
    expect(order).toEqual(['persist-start', 'invoke', 'persist-file'])
    expect(result.state).toBe('uncertain'); expect(result.files).toHaveLength(1)
    expect(await readFile(result.files[0].source)).toHaveLength(8)
    await expect(readFile(join(privateHome, 'config.toml'))).rejects.toThrow()
    await f.runtime.dispose()
  })
  it('cancels an active process during dispose and never resubmits it', async () => {
    const f = await fixture(); let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve })
    f.run.mockImplementation(async (_exe, args, _env, _cwd, signal) => {
      if (args.includes('--version')) return { stdout: 'grok 1.0.50', stderr: '', exitCode: 0 }
      entered(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); throw Object.assign(new Error(), { code: 'cancelled' })
    })
    const work = f.runtime.run(f.request, signal()); await ready; await f.runtime.dispose()
    expect((await work).state).toBe('uncertain')
    expect(f.run.mock.calls.filter(call => !call[1].includes('--version'))).toHaveLength(1)
  })
})
it.skipIf(process.env.DSH_GROK_LIVE_PREFLIGHT !== '1')('harmless installed CLI version and two-pass isolation preflight', async () => {
  const runtime = new GrokRuntime(() => DEFAULT_SETTINGS, { inspect: async (executable, env, cwd, signal) => {
    const result = await runGrok(executable, ['inspect', '--json'], env, cwd, signal, undefined, 60_000)
    const value = JSON.parse(result.stdout)
    if (value.configWarnings?.length) console.log('GROK_PREFLIGHT_CONFIG_WARNINGS', JSON.stringify(value.configWarnings))
    return parseInspect(value)
  } })
  try { const status = await runtime.status(signal()); console.log('GROK_PREFLIGHT', JSON.stringify(status)); expect(status.available).toBe(true); expect(status.version).toContain('1.0.50') } finally { await runtime.dispose() }
}, 120_000)
