import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CliProcessError, runCli, type CliExecutable } from './cli-process.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cli-process-'))
  roots.push(root)
  return root
}

const node: CliExecutable = { command: process.execPath, displayPath: process.execPath }

/** One short-lived Node child. It records its own process tree, then does only what the script says. */
function childScript(body: string): string {
  return `
    import { spawn } from 'node:child_process'
    import { writeFileSync } from 'node:fs'
    const tree = process.argv[1]
    const nested = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
    writeFileSync(tree, JSON.stringify({ pid: process.pid, child: nested.pid }))
    await new Promise((resolve, reject) => { nested.once('spawn', resolve); nested.once('error', reject) })
    ${body}
  `
}

async function treeOf(path: string): Promise<{ pid: number; child: number }> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { return JSON.parse(await readFile(path, 'utf8')) as { pid: number; child: number } }
    catch { await new Promise(resolve => setTimeout(resolve, 20)) }
  }
  throw new Error(`The child never recorded its process tree at ${path}`)
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

async function untilGone(pids: number[]): Promise<void> {
  const deadline = Date.now() + 5_000
  while (pids.some(alive)) {
    if (Date.now() > deadline) throw new Error(`A process is still running: ${pids.filter(alive).join(', ')}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

describe('runCli', () => {
  it('runs one real Node child, frames split Unicode lines, and keeps a nonzero exit', async () => {
    const cwd = await workspace()
    const text = '雪\u{1F600}A'
    const script = `
      const chunk = Buffer.from(${JSON.stringify(text)}, 'utf8')
      process.stdout.write(chunk.subarray(0, 3))
      await new Promise(resolve => setImmediate(resolve))
      process.stdout.write(Buffer.concat([chunk.subarray(3), Buffer.from('\\nsecond\\npartial')]))
      process.stderr.write('note\\n')
      process.exitCode = 3
    `
    const lines: string[] = []
    const result = await runCli(node, ['--input-type=module', '-e', script], {
      cwd, signal: new AbortController().signal, input: 'payload',
      onLine: line => { lines.push(line) },
    })
    expect(lines).toEqual([text, 'second', 'partial'])
    expect(result).toMatchObject({ stdout: '', stderr: 'note\n', exitCode: 3 })
    expect(text).toBe('雪\u{1F600}A')
  })

  it('reassembles a multibyte character split across stdout chunks', async () => {
    const cwd = await workspace()
    const script = `
      const bytes = Buffer.from('雪', 'utf8')
      process.stdout.write(bytes.subarray(0, 1))
      await new Promise(resolve => setImmediate(resolve))
      process.stdout.write(bytes.subarray(1))
      process.stderr.write(bytes.subarray(0, 2))
      await new Promise(resolve => setImmediate(resolve))
      process.stderr.write(bytes.subarray(2))
    `
    const result = await runCli(node, ['--input-type=module', '-e', script], { cwd, signal: new AbortController().signal })
    expect(result).toMatchObject({ stdout: '雪', stderr: '雪', exitCode: 0 })
  })

  it('keeps stdout intact when no protocol callback is attached', async () => {
    const cwd = await workspace()
    const result = await runCli(node, ['--input-type=module', '-e', "process.stdout.write('plain'); process.exitCode = 0"], {
      cwd, signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ stdout: 'plain', exitCode: 0 })
  })

  it('terminates the owned child tree on caller abort', async () => {
    const cwd = await workspace()
    const treePath = join(cwd, 'tree.json')
    const controller = new AbortController()
    const pending = runCli(node, ['--input-type=module', '-e', childScript('await new Promise(() => {})'), treePath], {
      cwd, signal: controller.signal, timeoutMs: 60_000,
    })
    const tree = await treeOf(treePath)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'CliProcessError', code: 'cancelled' })
    await untilGone([tree.pid, tree.child])
  })

  it('terminates an ignored, unreferenced grandchild on caller abort', async () => {
    const cwd = await workspace()
    const treePath = join(cwd, 'tree.json')
    const controller = new AbortController()
    const script = childScript('nested.unref(); setInterval(() => {}, 1000)')
    const pending = runCli(node, ['--input-type=module', '-e', script, treePath], {
      cwd, signal: controller.signal, timeoutMs: 60_000,
    })
    // Attach rejection handling before reading the fixture so cancellation cannot
    // produce an unhandled rejection while the test verifies its owned PIDs.
    const result = pending.then(() => undefined, error => error)
    const tree = await treeOf(treePath)
    try {
      expect(alive(tree.pid)).toBe(true)
      expect(alive(tree.child)).toBe(true)
      controller.abort()
      expect(await result).toMatchObject({ name: 'CliProcessError', code: 'cancelled' })
      await untilGone([tree.pid, tree.child])
    } finally {
      controller.abort()
      await result
      // A failing lifecycle assertion must not leave its fixture running.
      for (const pid of [tree.pid, tree.child]) {
        try { process.kill(pid, 'SIGKILL') } catch { /* already exited */ }
      }
    }
  })

  it('terminates the owned child tree when the timeout fires', async () => {
    const cwd = await workspace()
    const treePath = join(cwd, 'tree.json')
    const pending = runCli(node, ['--input-type=module', '-e', childScript('await new Promise(() => {})'), treePath], {
      cwd, signal: new AbortController().signal, timeoutMs: 300,
    })
    // Observe rejection before polling the fixture: the child may already have stopped.
    await expect(pending).rejects.toMatchObject({ name: 'CliProcessError', code: 'timeout' })
    const tree = await treeOf(treePath)
    await untilGone([tree.pid, tree.child])
  })

  it('stops the child when a protocol frame exceeds its byte limit', async () => {
    const cwd = await workspace()
    const treePath = join(cwd, 'tree.json')
    const pending = runCli(node, ['--input-type=module', '-e', childScript("process.stdout.write('x'.repeat(64) + '\\n'); await new Promise(() => {})"), treePath], {
      cwd, signal: new AbortController().signal, maxLineBytes: 8, timeoutMs: 60_000,
      onLine: () => {},
    })
    await expect(pending).rejects.toMatchObject({ name: 'CliProcessError', code: 'output-limit' })
    const tree = await treeOf(treePath)
    await untilGone([tree.pid, tree.child])
  })

  it('stops the child when the combined output exceeds its byte limit', async () => {
    const cwd = await workspace()
    const treePath = join(cwd, 'tree.json')
    const pending = runCli(node, ['--input-type=module', '-e', childScript("process.stdout.write('abcdefghij'); await new Promise(() => {})"), treePath], {
      cwd, signal: new AbortController().signal, maxOutputBytes: 4, timeoutMs: 60_000,
    })
    await expect(pending).rejects.toMatchObject({ name: 'CliProcessError', code: 'output-limit' })
    const tree = await treeOf(treePath)
    await untilGone([tree.pid, tree.child])
  })

  it('stops the child when the protocol callback fails', async () => {
    const cwd = await workspace()
    const treePath = join(cwd, 'tree.json')
    const pending = runCli(node, ['--input-type=module', '-e', childScript("process.stdout.write('ready\\n'); await new Promise(() => {})"), treePath], {
      cwd, signal: new AbortController().signal, timeoutMs: 60_000,
      onLine: () => { throw new Error('callback failed') },
    })
    await expect(pending).rejects.toThrow('callback failed')
    const tree = await treeOf(treePath)
    await untilGone([tree.pid, tree.child])
  })

  it('rejects an already aborted caller before starting a process', async () => {
    const cwd = await workspace()
    const controller = new AbortController()
    controller.abort()
    await expect(runCli(node, ['-e', 'process.exit(0)'], { cwd, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reports an executable that cannot be started', async () => {
    const cwd = await workspace()
    const missing = join(cwd, 'missing-cli')
    await expect(runCli(
      { command: missing, displayPath: missing },
      [],
      { cwd, signal: new AbortController().signal },
    )).rejects.toMatchObject({ name: 'CliProcessError', code: 'unavailable' })
  })

  it('passes the caller environment and prepends executable arguments without a shell', async () => {
    const cwd = await workspace()
    const marker = join(cwd, 'seen.json')
    const executable: CliExecutable = {
      command: process.execPath,
      args: ['--input-type=module'],
      env: { ...process.env, DSH_CLI_MARKER: 'kit-marker' },
      displayPath: process.execPath,
    }
    const script = `
      import { writeFileSync } from 'node:fs'
      writeFileSync(process.argv[1], JSON.stringify({ marker: process.env.DSH_CLI_MARKER, stdin: await new Promise(resolve => {
        const chunks = []
        process.stdin.on('data', chunk => chunks.push(chunk))
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      }) }))
    `
    const result = await runCli(executable, ['-e', script, marker], {
      cwd, signal: new AbortController().signal, input: 'from-caller',
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(await readFile(marker, 'utf8'))).toEqual({ marker: 'kit-marker', stdin: 'from-caller' })
  })

  it('returns when a caller-supplied spawn double emits output and closes', async () => {
    const cwd = await workspace()
    const lines: string[] = []
    const result = await runCli(node, ['--check'], {
      cwd, signal: new AbortController().signal,
      onLine: line => { lines.push(line) },
      spawnChild: ((command, args, options) => {
        expect(command).toBe(process.execPath)
        expect(args).toEqual(['--check'])
        expect(options.shell).toBe(false)
        const child = spawn(process.execPath, ['-e', "process.stdout.write('framed\\n'); process.stderr.write('side')"], {
          cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        })
        return child
      }) as typeof spawn,
    })
    expect(lines).toEqual(['framed'])
    expect(result).toMatchObject({ stdout: '', stderr: 'side', exitCode: 0 })
  })

  it('does not leave the Node child running after a successful framed run', async () => {
    const cwd = await workspace()
    const pidPath = join(cwd, 'pid.txt')
    const lines: string[] = []
    const result = await runCli(node, ['--input-type=module', '-e', `
      import { writeFileSync } from 'node:fs'
      writeFileSync(process.argv[1], String(process.pid))
      process.stdout.write('done\\n')
    `, pidPath], {
      cwd, signal: new AbortController().signal, onLine: line => { lines.push(line) },
    })
    expect(lines).toEqual(['done'])
    expect(result.exitCode).toBe(0)
    await untilGone([Number(await readFile(pidPath, 'utf8'))])
  })

  it('uses PATH only through the supplied executable and never a command string', async () => {
    const cwd = await workspace()
    const bin = await mkdtemp(join(tmpdir(), 'dsh-cli-process-bin-'))
    roots.push(bin)
    const program = process.platform === 'win32' ? 'dsh-kit-echo.cmd' : 'dsh-kit-echo'
    await writeFile(join(bin, program), process.platform === 'win32'
      ? `@echo off\r\necho shell-wrapper\r\n`
      : `#!/bin/sh\necho shell-wrapper\n`)
    const result = await runCli(
      { command: process.execPath, env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` }, displayPath: process.execPath },
      ['-e', "process.stdout.write('node-direct')"],
      { cwd, signal: new AbortController().signal },
    )
    expect(result.stdout).toBe('node-direct')
  })
})

describe('CliProcessError', () => {
  it('keeps a stable code and name for consumers', () => {
    const error = new CliProcessError('timeout', 'The CLI request timed out.')
    expect(error).toMatchObject({ name: 'CliProcessError', code: 'timeout', message: 'The CLI request timed out.' })
  })
})
