import { describe, expect, it } from 'vitest'
import { assertObjectJsonSchema, projectToolSchema, validateJsonSchemaValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createShowCanvasTool, apply, type CanvasServices } from './index.ts'
import { fileAddressFor, sessionFileAddress, sessionFileOf, isAbsoluteWorkspacePath } from './file-address.ts'
import { CANVAS_OWNER } from './contracts.ts'

function hostFixture(options: { cwd?: string; roots?: boolean; existing?: string[] } = {}) {
  const agent = {
    id: 'session-test',
    session: { id: 'session-test', header: options.cwd === undefined ? {} : { cwd: options.cwd } },
    followup() {},
  }
  const warnings: string[] = []
  const registered = new Map<string, unknown>((options.existing ?? []).map(name => [name, { foreign: true }]))
  const host = {
    agents: { get: (id: string) => id === agent.id ? agent : undefined, roots: () => options.roots === false ? [] : [agent] },
    sessionController: { resolveAgent: async (id: string) => ({ agent: id === agent.id ? agent : undefined }) },
    sessions: { flush: async () => true },
    logger: { warn(message: string) { warnings.push(message) } },
    tools: { get: (name: string) => registered.get(name), register: (definition: { name?: string }) => { registered.set(definition.name ?? 'tool', definition); return () => {} } },
    systemPrompt: { context: () => () => {} },
    skills: { register: () => () => {} },
    webServer: { register: () => () => {} },
    connection: { rpc: { call: async () => ({ ok: true, value: null }) } },
  }
  const exec = { agent, callId: 'call-canvas', signal: new AbortController().signal, concludeTurn() {} }
  return { host: host as never, agent, warnings, registered, exec }
}
const services = (current: CanvasServices): { current: CanvasServices } => ({ current })
const statOk = (absolutePath = '/work/demo.html'): CanvasServices['workspaceFiles'] => ({ stat: async () => ({ absolutePath }) })
const statFail = (): CanvasServices['workspaceFiles'] => ({ stat: async () => { throw new Error('no entry') } })
type Tool = { execute(args: unknown, exec: unknown): Promise<Record<string, unknown>>; output: { presentationMeta(args: unknown, value: unknown): unknown } }

describe('show_canvas Host boundary', () => {
  it('exports a valid model-facing schema', () => {
    const { host } = hostFixture()
    const tool = createShowCanvasTool(host, services({})) as unknown as ToolDefinition
    const { parameters } = JSON.parse(JSON.stringify(projectToolSchema(tool, true)))
    assertObjectJsonSchema(parameters)
    expect(parameters.required).toEqual(['path'])
    expect(validateJsonSchemaValue(parameters, { path: 'demo.html', title: 'Demo' })).toEqual([])
    for (const invalid of [{}, { title: 'x' }, { path: 3 }, { path: 'a.html', title: {} }]) {
      expect(validateJsonSchemaValue(parameters, invalid).length).toBeGreaterThan(0)
    }
  })
  it('rejects a missing or over-long path, a non-html extension, and a bad title', async () => {
    const { host, exec } = hostFixture()
    const tool = createShowCanvasTool(host, services({ workspaceFiles: statOk() })) as unknown as Tool
    for (const args of [{}, { path: '' }, { path: 'x'.repeat(1025) }, { path: 'a.txt' }, { path: 'a.HTML5' }, { path: 'a.html', title: 4 }, { path: 'a.html', title: 't'.repeat(121) }]) {
      expect(await tool.execute(args, exec)).toMatchObject({ owner: CANVAS_OWNER, status: 'invalid' })
    }
    for (const args of [{ path: 'a.htm' }, { path: 'a.HTML' }, { path: 'dir/a.html', title: 'T' }]) {
      expect(await tool.execute(args, exec)).toMatchObject({ owner: CANVAS_OWNER, status: 'shown' })
    }
  })
  it('refuses sessions that are not a live root', async () => {
    const { host, agent, exec } = hostFixture({ roots: false })
    const tool = createShowCanvasTool(host, services({})) as unknown as Tool
    expect(await tool.execute({ path: 'a.html' }, { ...exec, agent })).toMatchObject({ status: 'invalid' })
    expect(await tool.execute({ path: 'a.html' }, { ...exec, agent: undefined })).toMatchObject({ status: 'invalid' })
    const value = await tool.execute({ path: 'a.html' }, exec)
    expect(String(value.summary)).toContain('file path')
  })
  it('proceeds without the workspaceFiles service and reports missing on stat failure', async () => {
    const { host, exec } = hostFixture({ cwd: '/work' })
    const noService = createShowCanvasTool(host, services({})) as unknown as Tool
    expect(await noService.execute({ path: 'demo.html' }, exec)).toMatchObject({ status: 'shown', path: 'demo.html', address: 'dsh-resource://file/session/session-test/demo.html' })
    const missing = createShowCanvasTool(host, services({ workspaceFiles: statFail() })) as unknown as Tool
    const value = await missing.execute({ path: 'demo.html' }, exec)
    expect(value).toMatchObject({ status: 'missing' })
    expect(String(value.summary)).toContain('write')
  })
  it('addresses the stat absolute path relative to the session workspace root', async () => {
    const { host, exec } = hostFixture({ cwd: '/work' })
    const tool = createShowCanvasTool(host, services({ workspaceFiles: statOk('/work/sub/demo.html') })) as unknown as Tool
    const value = await tool.execute({ path: 'sub/demo.html', title: 'Demo' }, exec)
    expect(value).toMatchObject({ status: 'shown', path: 'sub/demo.html', address: 'dsh-resource://file/session/session-test/sub/demo.html', title: 'Demo' })
    const meta = tool.output.presentationMeta({ path: 'sub/demo.html' }, value)
    expect(meta).toEqual({ owner: CANVAS_OWNER, path: 'sub/demo.html', address: 'dsh-resource://file/session/session-test/sub/demo.html', title: 'Demo' })
    expect(tool.output.presentationMeta({}, { owner: CANVAS_OWNER, status: 'missing' })).toBeNull()
  })
  it('uses the sandbox policy root when the session header has no cwd', async () => {
    const { host, exec } = hostFixture()
    const statPaths: { scope: { sessionId: string; workspaceRoot: string }; path: string }[] = []
    const tool = createShowCanvasTool(host, services({
      workspaceFiles: { stat: async (scope: { sessionId: string; workspaceRoot: string }, path: string) => { statPaths.push({ scope, path }); return { absolutePath: '/fallback/root/a.html' } } },
      sandboxPolicy: { workspaceRoot: '/fallback/root' },
    })) as unknown as Tool
    const value = await tool.execute({ path: 'a.html' }, exec)
    expect(value).toMatchObject({ status: 'shown', address: 'dsh-resource://file/session/session-test/a.html' })
    expect(statPaths).toEqual([{ scope: { sessionId: 'session-test', workspaceRoot: '/fallback/root' }, path: 'a.html' }])
  })
  it('skips registration but keeps show_view when show_canvas is already registered', async () => {
    const { host, registered, warnings } = hostFixture({ existing: ['show_canvas'] })
    const ctx = host as never as { effect(setup: () => () => void): void; provide(): void; on(): () => void; inject?: undefined }
    ctx.effect = setup => { setup() }
    ctx.provide = () => {}
    ctx.on = () => () => {}
    ctx.inject = undefined
    await apply(ctx as never)
    expect(registered.has('show_view')).toBe(true)
    expect(registered.get('show_canvas')).toEqual({ foreign: true })
    expect(warnings.some(message => message.includes('show_canvas'))).toBe(true)
  })
})
describe('file address grammar', () => {
  it('isAbsoluteWorkspacePath recognises POSIX, drive and UNC spellings', () => {
    expect(isAbsoluteWorkspacePath('/a/b')).toBe(true)
    expect(isAbsoluteWorkspacePath('C:/a/b')).toBe(true)
    expect(isAbsoluteWorkspacePath('c:\\a')).toBe(true)
    expect(isAbsoluteWorkspacePath('\\\\server\\share')).toBe(true)
    for (const path of ['a/b', './a', 'C:a', 'a.html', '']) expect(isAbsoluteWorkspacePath(path)).toBe(false)
  })
  it('sessionFileAddress encodes segments, keeps drive colons and drops ./ prefixes', () => {
    expect(sessionFileAddress('s1', 'demo.html')).toBe('dsh-resource://file/session/s1/demo.html')
    expect(sessionFileAddress('s 1', 'dir/my file.html')).toBe('dsh-resource://file/session/s%201/dir/my%20file.html')
    expect(sessionFileAddress('s1', '中文/页面.html')).toBe(`dsh-resource://file/session/s1/${encodeURIComponent('中文')}/${encodeURIComponent('页面.html')}`)
    // Only leading ./ prefixes are stripped; inner . segments are encoded literally, matching the host grammar.
    expect(sessionFileAddress('s1', './a/./b.html')).toBe('dsh-resource://file/session/s1/a/./b.html')
    expect(sessionFileAddress('s1', 'dir\\sub\\a.html')).toBe('dsh-resource://file/session/s1/dir/sub/a.html')
    expect(sessionFileAddress('s1', 'C:/work/a.html')).toBe('dsh-resource://file/session/s1/C:/work/a.html')
    expect(sessionFileAddress('s:id', 'a.html')).toBe('dsh-resource://file/session/s:id/a.html')
  })
  it('fileAddressFor relatives absolute paths inside the workspace root only', () => {
    expect(fileAddressFor('s1', '/work', '/work/demo.html')).toBe('dsh-resource://file/session/s1/demo.html')
    expect(fileAddressFor('s1', '/work/', '/work')).toBe('dsh-resource://file/session/s1/')
    expect(fileAddressFor('s1', '/work', '/other/demo.html')).toBe('dsh-resource://file/session/s1//other/demo.html')
    expect(fileAddressFor('s1', 'C:\\work', 'C:\\work\\a.html')).toBe('dsh-resource://file/session/s1/a.html')
    expect(fileAddressFor('s1', undefined, 'a.html')).toBe('dsh-resource://file/session/s1/a.html')
    expect(fileAddressFor('s1', '/work', 'sub/a.html')).toBe('dsh-resource://file/session/s1/sub/a.html')
  })
  it('sessionFileOf decodes what sessionFileAddress wrote and rejects foreign addresses', () => {
    expect(sessionFileOf('dsh-resource://file/session/s%201/dir/my%20file.html')).toEqual({ sessionId: 's 1', path: 'dir/my file.html' })
    expect(sessionFileOf('dsh-resource://file/session/s1/a.html?x=1')).toEqual({ sessionId: 's1', path: 'a.html' })
    expect(sessionFileOf('dsh-resource://file/absolute/C:/a.html')).toBeUndefined()
    expect(sessionFileOf('dsh-resource://file/session/')).toBeUndefined()
    expect(sessionFileOf('not-an-address')).toBeUndefined()
  })
})
