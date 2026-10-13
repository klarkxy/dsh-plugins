import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { runCli } from '@klarkxy/dsh-plugin-kit/cli-process'
import { guardInputMatches, guardScript, prepareGuard } from './guard.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'grok-guard-test-')); roots.push(root)
  const input = join(root, 'explicit.png'), path = join(root, 'guard.cjs'), marker = join(root, 'used')
  await writeFile(input, 'data'); await writeFile(path, guardScript({ tool: 'image_edit', inputs: [input], sessionId: 'session', media: true }, marker))
  const execute = async (value: unknown) => {
    const output = await runCli({ command: process.execPath, displayPath: process.execPath }, [path], { cwd: root, signal: new AbortController().signal, input: typeof value === 'string' ? value : JSON.stringify(value), timeoutMs: 5000 })
    expect(output.exitCode).toBe(0); return JSON.parse(output.stdout).hookSpecificOutput.permissionDecision
  }
  const event = { hookEventName: 'pre_tool_use', sessionId: 'session', toolName: 'image_edit', toolInputTruncated: false, toolInput: { image: [input] } }
  return { root, input, marker, event, execute }
}
it('denies changed paths, extra frames, malformed inputs and another tool before granting a valid exact input', async () => {
  const f = await setup()
  expect(await f.execute({ ...f.event, toolInput: { image: ['C:/outside/secret.png'] } })).toBe('deny')
  expect(await f.execute({ ...f.event, toolInput: { image: [f.input], first_frame: 'https://outside' } })).toBe('deny')
  expect(await f.execute('{')).toBe('deny')
  expect(await f.execute({ ...f.event, toolName: 'read_file' })).toBe('deny')
  await expect(readFile(f.marker)).rejects.toThrow()
  expect(await f.execute(f.event)).toBe('allow')
  expect(await readFile(f.marker, 'utf8')).toBe('verified')
  expect(await f.execute(f.event)).toBe('deny')
})
it('installs a native hook config only after its benign rejection smoke passes', async () => {
  const f = await setup(), hook = await prepareGuard(f.root, { tool: 'image_edit', inputs: [f.input], sessionId: 'session', media: true }, new AbortController().signal)
  expect(JSON.parse(await readFile(hook.hookPath, 'utf8'))).toMatchObject({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', timeout: 5 }] }] } })
})
it('preserves exact reference roles/options and rejects a replaced frame or preset voice', () => {
  const nativeInput = { images: ['image'], first_frame: 'first', last_frame: 'last', keyframes: [{ image: 'middle', timestamp_s: 2 }], voices: ['ara'], duration: 10, resolution_name: '720p', aspect_ratio: '9:16' }
  const policy = { tool: 'reference_to_video', inputs: ['image', 'first', 'last', 'middle'], sessionId: 'session', media: true, nativeInput }
  expect(guardInputMatches(policy, nativeInput)).toBe(true)
  expect(guardInputMatches(policy, { ...nativeInput, first_frame: 'image' })).toBe(false)
  expect(guardInputMatches(policy, { ...nativeInput, voices: ['eve'] })).toBe(false)
  expect(guardInputMatches(policy, { ...nativeInput, duration: 15 })).toBe(false)
  expect(guardInputMatches(policy, { ...nativeInput, keyframes: [{ image: 'middle', timestamp_s: 3 }] })).toBe(false)
})
