import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

/** Only OS/runtime discovery facts cross the default CLI boundary. CLI-specific login configuration must opt in. */
export function cliEnvironment(parent: NodeJS.ProcessEnv = process.env, extra: readonly string[] = []): NodeJS.ProcessEnv {
  const allowed = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', ...extra.map(key => key.toUpperCase())])
  return Object.fromEntries(Object.entries(parent).filter(([key, value]) => value !== undefined && !key.toUpperCase().startsWith('DSH_') && allowed.has(key.toUpperCase())))
}

/** A resolved executable, never a shell command or an argument string. */
export type CliExecutable = { command: string; args?: string[]; env?: NodeJS.ProcessEnv; displayPath: string }
export type CliOutput = { stdout: string; stderr: string; exitCode: number }
export class CliProcessError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'CliProcessError' }
}
export type CliOptions = {
  cwd: string; signal: AbortSignal; input?: string; timeoutMs?: number;
  maxOutputBytes?: number; maxLineBytes?: number;
  onLine?: (line: string) => void | Promise<void>;
  spawnChild?: typeof spawn;
}

/** Own one process tree until it exits, including caller cancellation and protocol failure. */
export async function runCli(executable: CliExecutable, args: string[], options: CliOptions): Promise<CliOutput> {
  options.signal.throwIfAborted()
  const timed = AbortSignal.timeout(options.timeoutMs ?? 900_000)
  const signal = AbortSignal.any([options.signal, timed])
  const maxBytes = options.maxOutputBytes ?? 16 * 1024 * 1024
  const maxLine = options.maxLineBytes ?? 8 * 1024 * 1024
  let child: ChildProcessWithoutNullStreams
  try {
    child = (options.spawnChild ?? spawn)(executable.command, [...(executable.args ?? []), ...args], {
      cwd: options.cwd, env: executable.env ?? cliEnvironment(), shell: false,
      windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams
  } catch { throw new CliProcessError('unavailable', 'Unable to start the official CLI.') }
  let failure: unknown, total = 0, stderr = '', stdout = '', pending = Buffer.alloc(0)
  const stdoutDecoder = new StringDecoder('utf8'), stderrDecoder = new StringDecoder('utf8')
  let exited = false, exitCode = -1, stopping: Promise<void> | undefined
  let lineWork = Promise.resolve()
  const closed = new Promise<void>(resolve => {
    child.once('close', code => { exited = true; exitCode = code ?? -1; resolve() })
  })
  const stop = () => stopping ??= (async () => {
    if (exited) return
    const pid = child.pid
    if (pid && process.platform === 'win32') {
      await new Promise<void>(resolve => {
        const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { env: cliEnvironment(), windowsHide: true, shell: false, stdio: 'ignore' })
        let timer: ReturnType<typeof setTimeout>
        const done = () => { clearTimeout(timer); resolve() }
        killer.once('error', () => { child.kill(); done() })
        killer.once('close', done)
        timer = setTimeout(() => { killer.kill(); child.kill(); resolve() }, 5_000)
      })
    } else if (pid) {
      try { process.kill(-pid, 'SIGTERM') } catch { child.kill() }
    } else child.kill()
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([closed, new Promise<void>(resolve => { timer = setTimeout(resolve, 2_000) })])
    if (timer) clearTimeout(timer)
    if (!exited) {
      try { pid && process.platform !== 'win32' ? process.kill(-pid, 'SIGKILL') : child.kill('SIGKILL') } catch { /* already exited */ }
    }
    await closed
  })()
  const fail = (error: unknown) => { failure ??= error; void stop() }
  const abort = () => fail(new CliProcessError(timed.aborted && !options.signal.aborted ? 'timeout' : 'cancelled', timed.aborted && !options.signal.aborted ? 'The CLI request timed out.' : 'The CLI request was cancelled.'))
  signal.addEventListener('abort', abort, { once: true })
  child.on('error', () => fail(new CliProcessError('unavailable', 'Unable to start the official CLI.')))
  child.stdin.on('error', () => { if (!exited) fail(new CliProcessError('process-io', 'The CLI input stream closed unexpectedly.')) })
  child.stdout.on('error', () => fail(new CliProcessError('process-io', 'The CLI output stream failed.')))
  child.stderr.on('error', () => fail(new CliProcessError('process-io', 'The CLI error stream failed.')))
  const count = (chunk: Buffer) => {
    total += chunk.length
    if (total > maxBytes) { fail(new CliProcessError('output-limit', 'The CLI output exceeded its limit.')); return false }
    return true
  }
  const acceptLine = (line: string) => {
    if (!options.onLine || !line.trim()) return
    child.stdout.pause()
    lineWork = lineWork.then(async () => { if (!failure) await options.onLine!(line) }).catch(fail).finally(() => child.stdout.resume())
  }
  child.stdout.on('data', (chunk: Buffer) => {
    if (failure || !count(chunk)) return
    if (!options.onLine) { stdout += stdoutDecoder.write(chunk); return }
    pending = Buffer.concat([pending, chunk])
    for (;;) {
      const end = pending.indexOf(10)
      if (end < 0) break
      if (end > maxLine) { fail(new CliProcessError('output-limit', 'A CLI protocol frame exceeded its limit.')); return }
      acceptLine(pending.subarray(0, end).toString('utf8'))
      pending = pending.subarray(end + 1)
    }
    if (pending.length > maxLine) fail(new CliProcessError('output-limit', 'A CLI protocol frame exceeded its limit.'))
  })
  child.stderr.on('data', (chunk: Buffer) => { if (count(chunk)) stderr = (stderr + stderrDecoder.write(chunk)).slice(-16_384) })
  try {
    if (signal.aborted) abort()
    if (!failure) child.stdin.end(options.input ?? '')
    await closed
    stdout += stdoutDecoder.end(); stderr += stderrDecoder.end()
    if (pending.length && !failure) acceptLine(pending.toString('utf8'))
    await lineWork
    if (failure) throw failure
    signal.throwIfAborted()
    return { stdout, stderr, exitCode }
  } finally {
    signal.removeEventListener('abort', abort)
    if (!exited) await stop()
    if (stopping) await stopping
  }
}
