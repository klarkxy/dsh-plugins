import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Capability } from './contracts.ts'
import { appServerArgs, CodexRuntime, safeConfig } from './runtime.ts'
import { JsonRpcProcess, MAX_FRAME_BYTES, type Notice, type RpcProcess } from './process.ts'

const signal = () => new AbortController().signal
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBPkAAAAASUVORK5CYII=', 'base64')
const tempDirs: string[] = []
const runtimes: CodexRuntime[] = []
async function temp() { const root = await mkdtemp(join(tmpdir(), 'dsh-chatgpt-test-')); tempDirs.push(root); return root }
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose())); await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); vi.useRealTimers() })

class FakeRpc implements RpcProcess {
  calls: { method: string; params: any }[] = []
  listeners = new Set<(notice: Notice) => void>()
  closed = false
  accountType = 'chatgpt'
  userAgent = 'Codex Desktop/0.162.0-alpha.17.2 (Windows 10; x86_64) dumb (dsh-chatgpt; 0.1.0-alpha.1)'
  sandbox = { type: 'readOnly', networkAccess: false }
  approval = 'never'
  servers: Record<string, unknown> = {}
  onTurn: (params: any) => void = () => { this.item({ type: 'agentMessage', id: 'answer', text: 'A useful answer.' }); this.complete() }
  onLogin?: () => void
  constructor(public home: string) {}
  emit(method: string, params: Record<string, unknown>) { for (const listener of this.listeners) listener({ method, params }) }
  item(item: any, turnId = 'turn-1', threadId = 'thread-1') { this.emit('item/completed', { threadId, turnId, item }) }
  complete(status = 'completed', turnId = 'turn-1', threadId = 'thread-1', error: unknown = null) { this.emit('turn/completed', { threadId, turn: { id: turnId, status, error } }) }
  async request(method: string, params: any, abort: AbortSignal): Promise<any> {
    abort.throwIfAborted(); this.calls.push({ method, params })
    if (method === 'initialize') return { userAgent: this.userAgent, codexHome: this.home }
    if (method === 'account/read') return { account: { type: this.accountType, email: 'user@example.test', planType: 'plus' } }
    if (method === 'model/list') return { data: [{ id: 'current-default', displayName: 'Default', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }] }
    if (method === 'config/read') return { config: { mcp_servers: this.servers } }
    if (method === 'thread/start') return { thread: { id: 'thread-1' }, sandbox: this.sandbox, approvalPolicy: this.approval }
    if (method === 'turn/start') { this.onTurn(params); return { turn: { id: 'turn-1', status: 'inProgress' } } }
    if (method === 'account/login/start') { this.onLogin?.(); return params.type === 'chatgpt' ? { type: params.type, loginId: 'own-login', authUrl: 'https://auth.openai.com/start' } : { type: params.type, loginId: 'own-login', verificationUrl: 'https://auth.openai.com/device', userCode: 'ABC-123' } }
    return {}
  }
  notify(method: string, params: any) { this.calls.push({ method, params }) }
  subscribe(handler: (notice: Notice) => void) { this.listeners.add(handler); return () => { this.listeners.delete(handler) } }
  async close() { this.closed = true }
}
async function setup(prepare?: (rpc: FakeRpc) => void, overrides = {}) {
  const root = await temp(), home = await temp(), processes: FakeRpc[] = []
  const runtime = new CodexRuntime(() => ({ ...DEFAULT_SETTINGS, ...overrides }), {
    discover: async () => ({ command: 'codex.exe', path: 'codex.exe', args: [] }),
    createProcess: () => { const rpc = new FakeRpc(home); prepare?.(rpc); processes.push(rpc); return rpc },
  })
  runtimes.push(runtime); return { root, home, runtime, processes }
}

describe('isolated capability runtime', () => {
  it('uses catalog default and both empty environments; captures events before turn/start responds', async () => {
    const { runtime, root, processes } = await setup()
    expect((await runtime.run({ mode: 'ask', prompt: 'hello' }, root, signal())).answer).toBe('A useful answer.')
    const rpc = processes[0], thread = rpc.calls.find(call => call.method === 'thread/start')!.params, turn = rpc.calls.find(call => call.method === 'turn/start')!.params
    expect(thread).toMatchObject({ model: 'current-default', modelProvider: 'openai', ephemeral: true, environments: [], sandbox: 'read-only', approvalPolicy: 'never' })
    expect(turn).toMatchObject({ environments: [], approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false } })
    expect(thread.config).toMatchObject({ 'features.shell_tool': false, 'features.stable_environment_tools': false, 'features.code_mode': { enabled: false, direct_only_tool_namespaces: ['web', 'image_gen'] }, 'features.multi_agent': false, 'features.apps': false, 'features.plugins': false, mcp_servers: {}, web_search: 'disabled' })
    expect(rpc.closed).toBe(true)
    expect(await readdir(root)).toEqual([])
  })
  it.each(['ask', 'vision', 'search', 'image', 'edit'] as Capability[])('enables only requested native tool gates for %s', mode => {
    expect(safeConfig(mode)['features.image_generation']).toBe(mode === 'image' || mode === 'edit')
    expect(safeConfig(mode).web_search).toBe(mode === 'search' ? 'live' : 'disabled')
    expect(appServerArgs(mode)).not.toContain('--ignore-user-config')
    expect(appServerArgs(mode)).toContain('features.code_mode={"enabled"=false,"direct_only_tool_namespaces"=["web","image_gen"]}')
    expect(appServerArgs(mode)).toContain('features.code_mode_host={"enabled"=false,"disable_in_process_fallback"=false}')
    expect(safeConfig(mode)['features.standalone_web_search']).toBe(mode === 'search')
  })
  it('requires managed ChatGPT auth and refuses an API-key account', async () => {
    const { runtime, root, processes } = await setup(rpc => { rpc.accountType = 'apiKey' })
    await expect(runtime.run({ mode: 'ask', prompt: 'hello' }, root, signal())).rejects.toMatchObject({ code: 'login-required' })
    expect(processes[0].calls.some(call => call.method === 'thread/start')).toBe(false)
  })
  it.each(['Codex Desktop/0.161.0', 'an unrelated process'])('fails unsupported safety protocol %s', async userAgent => {
    const { runtime, root, processes } = await setup(rpc => { rpc.userAgent = userAgent })
    await expect(runtime.run({ mode: 'ask', prompt: 'hello' }, root, signal())).rejects.toMatchObject({ code: 'unsupported-runtime' })
    expect(processes[0].closed).toBe(true)
  })
  it('requires sandbox and approval response, stopping before turn/start on unsafe settings', async () => {
    const { runtime, root, processes } = await setup(rpc => { rpc.approval = 'on-request' })
    await expect(runtime.run({ mode: 'ask', prompt: 'hello' }, root, signal())).rejects.toMatchObject({ code: 'unsupported-runtime' })
    expect(processes[0].calls.some(call => call.method === 'turn/start')).toBe(false)
  })
  it('explicitly disables each inherited MCP server through thread overrides', async () => {
    const { runtime, root, processes } = await setup(rpc => { rpc.servers = { inherited: { command: 'do not launch', env: { SECRET: 'not retained' } }, 'name.with.dots': { url: 'https://example.test/mcp' } } })
    await runtime.run({ mode: 'ask', prompt: 'hello' }, root, signal())
    expect(processes[0].calls.find(call => call.method === 'thread/start')!.params.config.mcp_servers).toEqual({ inherited: { command: 'do not launch', enabled: false }, 'name.with.dots': { url: 'https://example.test/mcp', enabled: false } })
    expect(processes[0].calls.findIndex(call => call.method === 'config/read')).toBeLessThan(processes[0].calls.findIndex(call => call.method === 'thread/start'))
  })
  it('requires native webSearch and returns attributed HTTPS sources', async () => {
    const { runtime, root } = await setup(rpc => { rpc.onTurn = () => {
      rpc.item({ type: 'webSearch', id: 'web', results: [{ url: 'https://example.test/source', title: 'Source' }, { url: 'javascript:alert(1)' }] })
      rpc.item({ type: 'agentMessage', id: 'answer', text: 'The latest result.' }); rpc.complete()
    } })
    const result = await runtime.run({ mode: 'search', prompt: 'find source' }, root, signal())
    expect(result.searchCount).toBe(1); expect(result.sources).toEqual([{ url: 'https://example.test/source', title: 'Source' }])
  })
  it('does not count a model citation as native search evidence', async () => {
    const { runtime, root } = await setup(rpc => { rpc.onTurn = () => { rpc.item({ type: 'agentMessage', id: 'answer', text: '[Link](https://example.test)' }); rpc.complete() } })
    await expect(runtime.run({ mode: 'search', prompt: 'search' }, root, signal())).rejects.toMatchObject({ code: 'tool-unavailable' })
  })
  it('ignores other threads and turns and needs successful terminal status', async () => {
    const { runtime, root } = await setup(rpc => { rpc.onTurn = () => {
      rpc.item({ type: 'agentMessage', id: 'wrong', text: 'secret' }, 'other-turn')
      rpc.complete('completed', 'turn-1', 'other-thread')
      rpc.item({ type: 'agentMessage', id: 'right', text: 'partial' }); rpc.complete('failed', 'turn-1', 'thread-1', { message: 'a raw token must never escape' })
    } })
    await expect(runtime.run({ mode: 'ask', prompt: 'hello' }, root, signal())).rejects.toMatchObject({ code: 'turn-failed', message: 'ChatGPT 未成功完成本次调用。' })
  })
  it('copies only the exact native savedPath and infers MIME from media magic', async () => {
    const { runtime, root, home } = await setup(rpc => { rpc.onTurn = () => {
      rpc.item({ type: 'imageGeneration', id: 'image', status: 'completed', failure: null, savedPath: join(home, 'generated_images', 'native.wrong') }); rpc.complete()
    } })
    await mkdir(join(home, 'generated_images')); await writeFile(join(home, 'generated_images', 'native.wrong'), png); await writeFile(join(home, 'generated_images', 'unrelated.png'), png)
    const result = await runtime.run({ mode: 'image', prompt: 'draw' }, root, signal())
    expect(result.images).toHaveLength(1); expect(result.images[0]).toMatchObject({ mediaType: 'image/png' })
    expect(result.images[0].path).toMatch(/^\.dsh-chatgpt\/[a-f0-9-]+\/1\.png$/)
    expect(await readFile(join(root, result.images[0].path))).toEqual(png)
  })
  it('rejects model-claimed paths without native image evidence', async () => {
    const { runtime, root } = await setup(rpc => { rpc.onTurn = () => { rpc.item({ type: 'agentMessage', id: 'answer', text: 'saved image at /tmp/a.png' }); rpc.complete() } })
    await expect(runtime.run({ mode: 'image', prompt: 'draw' }, root, signal())).rejects.toMatchObject({ code: 'tool-unavailable' })
  })
  it('requires successful image status and refuses native tool failures', async () => {
    const { runtime, root } = await setup(rpc => { rpc.onTurn = () => { rpc.item({ type: 'imageGeneration', id: 'image', status: 'completed', failure: { type: 'usageLimitExceeded' }, savedPath: join(root, 'image.png') }); rpc.complete() } })
    await expect(runtime.run({ mode: 'image', prompt: 'draw' }, root, signal())).rejects.toMatchObject({ code: 'tool-unavailable' })
  })
  it('rejects empty successful turns and unrelated native tools', async () => {
    const { runtime, root } = await setup(rpc => { rpc.onTurn = () => rpc.complete() })
    await expect(runtime.run({ mode: 'ask', prompt: 'hello' }, root, signal())).rejects.toMatchObject({ code: 'empty-answer' })
    const unsafe = await setup(rpc => { rpc.onTurn = () => { rpc.item({ type: 'commandExecution', id: 'command' }); rpc.complete() } })
    await expect(unsafe.runtime.run({ mode: 'ask', prompt: 'hello' }, unsafe.root, signal())).rejects.toMatchObject({ code: 'unsafe-tool' })
  })
  it('rejects native savedPath outside request and generated_images directories', async () => {
    const outside = await temp(); await writeFile(join(outside, 'stolen.png'), png)
    const { runtime, root } = await setup(rpc => { rpc.onTurn = () => { rpc.item({ type: 'imageGeneration', id: 'image', status: 'completed', savedPath: join(outside, 'stolen.png') }); rpc.complete() } })
    await expect(runtime.run({ mode: 'image', prompt: 'draw' }, root, signal())).rejects.toMatchObject({ code: 'invalid-image' })
    expect(await readdir(join(root, '.dsh-chatgpt'))).toEqual([])
  })
  it('validates inputs and forwards localImage using its canonical staged path', async () => {
    const { runtime, root, processes } = await setup(); await writeFile(join(root, 'input.png'), png)
    await runtime.run({ mode: 'vision', prompt: 'describe', images: ['input.png'] }, root, signal())
    expect(processes[0].calls.find(call => call.method === 'turn/start')!.params.input[1]).toMatchObject({ type: 'localImage', path: join(root, 'input.png') })
    await expect(runtime.run({ mode: 'vision', prompt: 'describe', images: Array(6).fill('input.png') }, root, signal())).rejects.toMatchObject({ code: 'invalid-image' })
    await writeFile(join(root, 'bad.png'), 'not an image')
    await expect(runtime.run({ mode: 'vision', prompt: 'describe', images: ['bad.png'] }, root, signal())).rejects.toMatchObject({ code: 'invalid-image' })
  })
  it('rejects symlinked staged input', async () => {
    const { runtime, root } = await setup(); await writeFile(join(root, 'input.png'), png)
    try { await symlink(join(root, 'input.png'), join(root, 'link.png')) } catch (cause: any) { if (cause.code === 'EPERM') return; throw cause }
    await expect(runtime.run({ mode: 'vision', prompt: 'describe', images: ['link.png'] }, root, signal())).rejects.toMatchObject({ code: 'invalid-image' })
  })
  it('cancellation prevents late publication and closes only its invocation', async () => {
    let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve })
    const { runtime, root, processes } = await setup(rpc => { rpc.onTurn = () => ready() })
    const controller = new AbortController(), result = runtime.run({ mode: 'ask', prompt: 'hello' }, root, controller.signal)
    await started; controller.abort()
    await expect(result).rejects.toMatchObject({ code: 'cancelled' })
    processes[0].item({ type: 'agentMessage', id: 'late', text: 'late' }); processes[0].complete()
    expect(processes[0].closed).toBe(true); expect(await readdir(root)).toEqual([])
  })
  it('timeout and unload stop unfinished turns', async () => {
    const { runtime, root, processes } = await setup(rpc => { rpc.onTurn = () => {} }, { timeoutMs: 50 })
    await expect(runtime.run({ mode: 'ask', prompt: 'hello' }, root, signal())).rejects.toMatchObject({ code: 'timeout' })
    expect(processes[0].closed).toBe(true)
    await runtime.dispose()
    await expect(runtime.status(signal())).rejects.toMatchObject({ code: 'disposed' })
  })
  it('unload cancels an active turn, waits for its process, and leaves no late artifact', async () => {
    let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve })
    const { runtime, root, processes } = await setup(rpc => { rpc.onTurn = () => ready() })
    const pending = runtime.run({ mode: 'ask', prompt: 'hello' }, root, signal())
    void pending.catch(() => {})
    await started; await runtime.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(processes[0].closed).toBe(true); expect(await readdir(root)).toEqual([])
  })
})

describe('managed login lifecycle', () => {
  it('keeps one persistent server and cancels only its own pending id', async () => {
    const { runtime, processes } = await setup()
    const login = await runtime.login('device', signal())
    expect(login).toEqual({ id: 'own-login', kind: 'device', url: 'https://auth.openai.com/device', code: 'ABC-123' })
    await expect(runtime.login('browser', signal())).rejects.toMatchObject({ code: 'login-pending' })
    expect((await runtime.status(signal())).login?.id).toBe(login.id)
    await runtime.cancelLogin(signal()); await runtime.cancelLogin(signal())
    expect(processes).toHaveLength(1)
    expect(processes[0].calls.filter(call => call.method === 'account/login/cancel')).toEqual([{ method: 'account/login/cancel', params: { loginId: 'own-login' } }])
  })
  it('clears its pending login on completion and refreshes account status', async () => {
    const { runtime, processes } = await setup()
    await runtime.login('browser', signal())
    processes[0].emit('account/login/completed', { loginId: 'foreign-login', success: true })
    expect((await runtime.status(signal())).login).toBeDefined()
    processes[0].emit('account/login/completed', { loginId: 'own-login', success: true })
    expect((await runtime.status(signal())).login).toBeUndefined()
    expect((await runtime.status(signal())).signedIn).toBe(true)
  })
  it('never cancels a newer login with a stale expected id', async () => {
    const { runtime, processes } = await setup()
    await runtime.login('browser', signal())
    await expect(runtime.cancelLogin(signal(), 'old-login')).rejects.toMatchObject({ code: 'login-conflict' })
    expect(processes[0].calls.some(call => call.method === 'account/login/cancel')).toBe(false)
    expect((await runtime.status(signal())).login?.id).toBe('own-login')
  })
  it('cleans up an own login started while its caller cancels', async () => {
    const controller = new AbortController()
    const { runtime, processes } = await setup(rpc => { rpc.onLogin = () => controller.abort() })
    await expect(runtime.login('browser', controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(processes[0].calls.at(-1)).toEqual({ method: 'account/login/cancel', params: { loginId: 'own-login' } })
  })
})

describe('bounded JSONL transport', () => {
  function transport() {
    const child = new EventEmitter() as any, frames: any[] = [], launches: any[] = []
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = undefined
    child.stdin = new Writable({ write(chunk, _encoding, callback) { frames.push(JSON.parse(chunk.toString())); callback() } })
    child.kill = () => { queueMicrotask(() => child.emit('close', 0)); return true }
    const spawnFake = ((command: string, args: string[], options: any) => { launches.push({ command, args, options }); return child }) as any
    const rpc = new JsonRpcProcess({ command: 'owned-codex.exe', args: [], path: 'owned-codex.exe' }, ['app-server'], tmpdir(), signal(), spawnFake)
    return { child, frames, rpc, launches }
  }
  it('launches argv without shell and correlates fragmented responses', async () => {
    const { child, rpc, frames, launches } = transport()
    const answer = rpc.request('initialize', {}, signal()), id = frames[0].id
    child.stdout.write('{"id":'); child.stdout.write(`${id},"result":{"ok":true}}\n`)
    expect(await answer).toEqual({ ok: true }); expect(launches[0].options).toMatchObject({ shell: false, windowsHide: true })
    await rpc.close()
  })
  it('denies unknown server requests and fails pending calls without exposing arbitrary payload', async () => {
    const { child, rpc, frames } = transport()
    const pending = rpc.request('turn/start', {}, signal())
    child.stdout.write(JSON.stringify({ id: 99, method: 'item/commandExecution/requestApproval', params: { secret: 'do not expose' } }) + '\n')
    await expect(pending).rejects.toMatchObject({ code: 'unsafe-tool' })
    expect(frames[1]).toEqual({ id: 99, error: { code: -32601, message: 'Client requests are disabled.' } })
    await rpc.close()
  })
  it('bounds even unterminated JSONL frames and fails malformed protocol', async () => {
    const { child, rpc } = transport(), pending = rpc.request('initialize', {}, signal())
    child.stdout.write(Buffer.alloc(MAX_FRAME_BYTES + 1, 120))
    await expect(pending).rejects.toMatchObject({ code: 'protocol-limit' }); await rpc.close()
    const next = transport(), bad = next.rpc.request('initialize', {}, signal())
    next.child.stdout.write('a non-json secret\n')
    await expect(bad).rejects.toMatchObject({ code: 'protocol', message: 'Codex 返回了无效协议消息。' }); await next.rpc.close()
  })
  it('clears the per-request timeout on caller abort without killing the shared server later', async () => {
    vi.useFakeTimers()
    const { child, rpc, frames } = transport(), controller = new AbortController()
    const cancelled = rpc.request('account/read', {}, controller.signal); controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' })
    await vi.advanceTimersByTimeAsync(31_000)
    const next = rpc.request('model/list', {}, signal())
    child.stdout.write(JSON.stringify({ id: frames.at(-1).id, result: { data: [] } }) + '\n')
    expect(await next).toEqual({ data: [] }); await rpc.close()
  })
})
