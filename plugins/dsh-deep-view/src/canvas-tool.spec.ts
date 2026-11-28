import { describe, expect, it } from 'vitest'
import { assertObjectJsonSchema, projectToolSchema, validateJsonSchemaValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createRpc, createShowCanvasTool, apply, type CanvasProbeWaiter, type CanvasServices } from './index.ts'
import { precheckCanvasHtml, scanCanvasSecrets } from './canvas/precheck.ts'
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

describe('show_canvas static precheck and first-paint health probe', () => {
  const utf8 = (value: string) => new TextEncoder().encode(value)

  it('flags JS syntax errors, local module src, base href, missing relative assets, open SVG paths, and redacts all 5 secret patterns', async () => {
    const aws = 'AKIA' + 'IOSFODNN7EXAMPLE'
    const sk = 'sk-' + 'abcdefghijklmnopqrstuvwxyz123456'
    const ghp = 'ghp_' + '1234567890abcdefghijklmnopqrstuvwxyz'
    const pem = '-----BEGIN RSA PRIVATE KEY-----'
    const bearer = 'Bearer ' + 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload'
    const secretHits = scanCanvasSecrets([aws, sk, ghp, pem, bearer].join('\n'), 'demo.html')
    expect(secretHits).toHaveLength(5)
    for (const raw of [aws, sk, ghp, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9']) {
      expect(JSON.stringify(secretHits)).not.toContain(raw)
    }

    const html = [
      '<!doctype html><html><head>',
      '<script type="module" src="./mod.js"></script>',
      '<link rel="stylesheet" href="./missing.css">',
      '<script src="./bad.js"></script>',
      '</head><body>',
      '<svg width="100" height="40"><path d="M 0 10 L 50 30 L 90 10" stroke="red" /><polyline points="0,0 10,10 20,5" /></svg>',
      '<script>const broken = (;</script>',
      `<!-- ${sk} -->`,
      '</body></html>',
    ].join('\n')
    const findings = await precheckCanvasHtml(html, 'demo.html', async rel => {
      if (rel === 'bad.js') return { exists: true, text: 'function oops( { return 1; }' }
      return { exists: false }
    })
    const codes = findings.map(item => item.code)
    expect(codes).toContain('local-module-script')
    expect(codes).toContain('missing-asset')
    expect(codes).toContain('svg-open-path-fill')
    expect(codes).toContain('secret-pattern')
    expect(findings.filter(item => item.code === 'js-syntax')).toHaveLength(2)
    expect(JSON.stringify(findings)).not.toContain(sk)

    const baseHtml = '<!doctype html><html><head><base href="https://example.com/"></head><body>ok</body></html>'
    const baseFindings = await precheckCanvasHtml(baseHtml, 'base.html')
    expect(baseFindings.some(item => item.code === 'base-href')).toBe(true)
  })

  it('settles the bounded first-paint probe on first canvas.report, ignores multi-tab duplicates, falls back on timeout, and cleans up on abort', async () => {
    const { host, exec } = hostFixture({ cwd: '/work' })
    const probes = new Map<string, CanvasProbeWaiter>()
    const rpc = createRpc(host, new Map(), new Map(), undefined, new Map(), new Map(), probes)
    const files: Record<string, string> = {
      'app.html': '<!doctype html><html><body><script src="broken.js"></script></body></html>',
      'broken.js': 'const ok = 1;',
    }
    const ws: CanvasServices['workspaceFiles'] = {
      stat: async (_scope, p) => {
        if (!(p in files)) throw new Error('ENOENT')
        return { absolutePath: `/work/${p}` }
      },
      readBytes: async (_scope, p) => ({ data: utf8(files[p]!) }),
    }
    const tool = createShowCanvasTool(host, services({ workspaceFiles: ws }), undefined, probes, {
      makeId: () => 'probe-1',
      probeTimeoutMs: 500,
    }) as unknown as Tool

    const pendingExec = tool.execute({ path: 'app.html', title: 'App' }, exec)
    await new Promise<void>(r => setTimeout(r, 15))

    const queried = await rpc('canvas.probe', { sessionId: 'session-test', callId: 'call-canvas' }, new AbortController().signal)
    expect(queried).toEqual({
      ok: true,
      value: { probeId: 'probe-1', path: 'app.html', address: 'dsh-resource://file/session/session-test/app.html', title: 'App' },
    })

    const firstReport = await rpc('canvas.report', {
      sessionId: 'session-test',
      probeId: 'probe-1',
      collapsed: true,
      errors: ['TypeError: cannot read x (broken.js:3:2)'],
    }, new AbortController().signal)
    expect(firstReport).toEqual({ ok: true, value: { accepted: true } })

    // Second report from a duplicate browser tab must be a safe no-op.
    const duplicateReport = await rpc('canvas.report', {
      sessionId: 'session-test',
      probeId: 'probe-1',
      collapsed: false,
      errors: ['Should be ignored'],
    }, new AbortController().signal)
    expect(duplicateReport).toEqual({ ok: true, value: { accepted: false } })

    const settled = await pendingExec
    expect(settled).toMatchObject({ owner: CANVAS_OWNER, status: 'shown', path: 'app.html' })
    expect(String(settled.summary)).toContain('First-paint runtime diagnostics:')
    expect(String(settled.summary)).toContain('TypeError: cannot read x (broken.js:3:2)')
    expect(String(settled.summary)).toContain('document.body.scrollHeight === 0')
    expect(String(settled.summary)).not.toContain('Should be ignored')

    // Headless / no-client timeout falls back cleanly without failing the tool call.
    const fastTimeoutTool = createShowCanvasTool(host, services({ workspaceFiles: ws }), undefined, probes, {
      makeId: () => 'probe-timeout',
      probeTimeoutMs: 25,
    }) as unknown as Tool
    const timedOut = await fastTimeoutTool.execute({ path: 'app.html' }, exec)
    expect(timedOut).toMatchObject({ owner: CANVAS_OWNER, status: 'shown' })
    expect(probes.size).toBe(0)

    // Aborting exec.signal while waiting cancels and cleans up the probe waiter immediately.
    const abortController = new AbortController()
    const slowTool = createShowCanvasTool(host, services({ workspaceFiles: ws }), undefined, probes, {
      makeId: () => 'probe-abort',
      probeTimeoutMs: 5000,
    }) as unknown as Tool
    const abortPromise = slowTool.execute({ path: 'app.html' }, { ...exec, signal: abortController.signal })
    await new Promise<void>(r => setTimeout(r, 15))
    expect(probes.has('probe-abort')).toBe(true)
    abortController.abort()
    const cancelled = await abortPromise
    expect(cancelled).toMatchObject({ owner: CANVAS_OWNER, status: 'cancelled' })
    expect(probes.has('probe-abort')).toBe(false)
  })
})
