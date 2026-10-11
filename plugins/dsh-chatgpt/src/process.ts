import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, readdir, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, dirname, extname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { ChatGptError } from './contracts.ts'

export type Notice = { method: string; params: Record<string, unknown> }
export interface RpcProcess {
  request(method: string, params: unknown, signal: AbortSignal): Promise<any>
  notify(method: string, params: unknown): void
  subscribe(handler: (notice: Notice) => void): () => void
  close(): Promise<void>
}
export type Executable = { command: string; args: string[]; path: string }
export const MAX_FRAME_BYTES = 32 * 1024 * 1024
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024
const failure = (code: string, message: string) => new ChatGptError(code, message)

async function executable(path: string): Promise<Executable> {
  const canonical = await realpath(path)
  if (!(await stat(canonical)).isFile()) throw failure('unavailable', 'Codex 可执行文件无效。')
  if (/\.(cmd|ps1)$/i.test(canonical)) {
    // npm launchers are never executed through a command shell.
    const script = join(dirname(canonical), 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    await access(script, constants.R_OK)
    return { command: process.execPath, args: [script], path: canonical }
  }
  if (extname(canonical).toLowerCase() === '.js') return { command: process.execPath, args: [canonical], path: canonical }
  await access(canonical, process.platform === 'win32' ? constants.R_OK : constants.X_OK)
  return { command: canonical, args: [], path: canonical }
}

export async function discoverExecutable(setting: string): Promise<Executable> {
  const explicit = setting || process.env.DSH_CHATGPT_CODEX_PATH || process.env.CODEX_CLI_PATH
  if (explicit) {
    try { return await executable(resolve(explicit)) } catch { throw failure('unavailable', '指定的 Codex 可执行文件不可用。') }
  }
  const candidates: string[] = []
  const paths = (process.env.PATH || '').split(delimiter).filter(Boolean)
  if (process.platform === 'win32') {
    // Prefer a native runtime to old npm launchers. Package directory names may change per update.
    const roots = [join(process.env.ProgramFiles || 'C:\\Program Files', 'WindowsApps'), join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'Codex')]
    for (const root of roots) {
      try {
        const entries = root.endsWith('WindowsApps') ? (await readdir(root)).filter(name => /^OpenAI\.Codex_/i.test(name)).sort().reverse().map(name => join(root, name)) : [root]
        for (const base of entries) for (const suffix of ['app/resources/codex.exe', 'resources/codex.exe', 'codex.exe']) candidates.push(join(base, suffix))
      } catch { /* An inaccessible optional installation is not a discovery failure. */ }
    }
    candidates.push(...paths.map(path => join(path, 'codex.exe')))
    candidates.push(...paths.flatMap(path => ['codex.cmd', 'codex.ps1'].map(name => join(path, name))))
  } else candidates.push(...paths.map(path => join(path, 'codex')))
  for (const candidate of candidates) { try { return await executable(candidate) } catch { /* next candidate */ } }
  throw failure('unavailable', '未找到官方 Codex 运行时，请在配置中指定路径。')
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void; clean(): void }
export class JsonRpcProcess implements RpcProcess {
  private child: ChildProcessWithoutNullStreams
  private nextId = 0
  private pending = new Map<number, Pending>()
  private handlers = new Set<(notice: Notice) => void>()
  private buffer = Buffer.alloc(0)
  private outputBytes = 0
  private ended = false
  private terminalError?: Error
  private closing?: Promise<void>
  private exited: Promise<void>
  constructor(exe: Executable, args: string[], cwd: string, signal: AbortSignal, spawnChild: typeof spawn = spawn) {
    signal.throwIfAborted()
    this.child = spawnChild(exe.command, [...exe.args, ...args], { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' }) as ChildProcessWithoutNullStreams
    this.exited = new Promise(resolveExit => this.child.once('close', () => {
      this.ended = true; this.fail(failure('process-exited', 'Codex 进程已结束。')); resolveExit()
    }))
    this.child.on('error', () => this.fail(failure('unavailable', '无法启动 Codex 运行时。')))
    this.child.stdin.on('error', () => this.fail(failure('process-exited', 'Codex 通信已断开。')))
    this.child.stdout.on('error', () => this.fail(failure('process-exited', 'Codex 通信已断开。')))
    this.child.stderr.on('error', () => this.fail(failure('process-exited', 'Codex 通信已断开。')))
    this.child.stdout.on('data', (chunk: Buffer) => this.receive(chunk))
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.outputBytes += chunk.length
      if (this.outputBytes > MAX_OUTPUT_BYTES) this.fail(failure('protocol-limit', 'Codex 输出超过安全上限。'))
    })
    const abort = () => { this.fail(failure('cancelled', '操作已取消。')); void this.close() }
    signal.addEventListener('abort', abort, { once: true })
    void this.exited.then(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  }
  private fail(error: Error) {
    if (this.terminalError) return
    this.terminalError = error
    for (const pending of this.pending.values()) { pending.clean(); pending.reject(error) }
    this.pending.clear()
    for (const handler of this.handlers) { try { handler({ method: '__process_failed', params: { code: error instanceof ChatGptError ? error.code : 'process-exited' } }) } catch { /* observer cannot prevent owned process cleanup */ } }
    if (!this.ended) void this.close()
  }
  private receive(chunk: Buffer) {
    if (this.terminalError) return
    this.outputBytes += chunk.length
    if (this.outputBytes > MAX_OUTPUT_BYTES) return this.fail(failure('protocol-limit', 'Codex 输出超过安全上限。'))
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const end = this.buffer.indexOf(10)
      if (end < 0) break
      if (end > MAX_FRAME_BYTES) return this.fail(failure('protocol-limit', 'Codex 消息超过安全上限。'))
      const line = this.buffer.subarray(0, end).toString('utf8'); this.buffer = this.buffer.subarray(end + 1)
      if (!line.trim()) continue
      let message: any
      try { message = JSON.parse(line) } catch { return this.fail(failure('protocol', 'Codex 返回了无效协议消息。')) }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return this.fail(failure('protocol', 'Codex 返回了无效协议消息。'))
      if (typeof message.method === 'string') {
        if (message.id !== undefined) {
          this.write({ id: message.id, error: { code: -32601, message: 'Client requests are disabled.' } })
          this.fail(failure('unsafe-tool', 'Codex 请求了被禁止的客户端能力。'))
          return
        } else for (const handler of this.handlers) {
          try { handler({ method: message.method, params: message.params && typeof message.params === 'object' ? message.params : {} }) }
          catch { this.fail(failure('protocol', 'Codex 事件处理失败。')); return }
        }
      } else if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id)
        if (!pending) continue
        this.pending.delete(message.id); pending.clean()
        if (message.error) pending.reject(failure('protocol', 'Codex 拒绝了请求；请检查运行时兼容性或登录状态。'))
        else pending.resolve(message.result)
      } else return this.fail(failure('protocol', 'Codex 返回了无效协议消息。'))
    }
    if (this.buffer.length > MAX_FRAME_BYTES) this.fail(failure('protocol-limit', 'Codex 消息超过安全上限。'))
  }
  private write(value: unknown) {
    if (this.terminalError || this.ended) throw this.terminalError || failure('process-exited', 'Codex 进程已结束。')
    this.child.stdin.write(JSON.stringify(value) + '\n')
  }
  request(method: string, params: unknown, signal: AbortSignal): Promise<any> {
    signal.throwIfAborted()
    const id = ++this.nextId
    return new Promise((resolveResult, reject) => {
      const abort = () => { this.pending.delete(id); clean(); reject(failure('cancelled', '操作已取消。')) }
      const timer = setTimeout(() => { this.pending.delete(id); signal.removeEventListener('abort', abort); reject(failure('timeout', 'Codex 协议请求超时。')); void this.close() }, 30_000)
      const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
      signal.addEventListener('abort', abort, { once: true })
      this.pending.set(id, { resolve: resolveResult, reject, clean })
      try { this.write({ id, method, params }) } catch (error) { this.pending.delete(id); clean(); reject(error) }
    })
  }
  notify(method: string, params: unknown) { this.write({ method, params }) }
  subscribe(handler: (notice: Notice) => void) { this.handlers.add(handler); return () => this.handlers.delete(handler) }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closing = (async () => {
      if (this.ended) return
      const pid = this.child.pid
      // Kill only this owned child and its owned process tree, never by image name.
      if (pid && process.platform === 'win32') {
        await new Promise<void>(resolveKill => {
          const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' })
          killer.once('error', () => { this.child.kill(); resolveKill() }); killer.once('close', () => resolveKill())
        })
      } else if (pid) { try { process.kill(-pid, 'SIGTERM') } catch { this.child.kill() } }
      else this.child.kill()
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([this.exited, new Promise<void>(resolveWait => { timer = setTimeout(resolveWait, 2_000) })])
      if (timer) clearTimeout(timer)
      if (!this.ended && pid) { try { process.platform === 'win32' ? this.child.kill('SIGKILL') : process.kill(-pid, 'SIGKILL') } catch { /* already gone */ } }
      await this.exited
    })()
    return this.closing
  }
}
