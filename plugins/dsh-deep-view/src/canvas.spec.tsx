import { act } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' })
vi.stubGlobal('window', dom.window)
vi.stubGlobal('document', dom.window.document)
vi.stubGlobal('navigator', dom.window.navigator)
vi.stubGlobal('MessageEvent', dom.window.MessageEvent)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const objectUrls: string[] = []
vi.stubGlobal('Blob', dom.window.Blob)
let createRoot: typeof import('react-dom/client').createRoot
let CanvasToolCall: typeof import('./client.tsx').CanvasToolCall
let readCanvasCall: typeof import('./client.tsx').readCanvasCall
let recordCanvasError: typeof import('./canvas/capture.ts').recordCanvasError
let canvasErrorReportOf: typeof import('./canvas/capture.ts').canvasErrorReportOf
let createCaptureScript: typeof import('./canvas/capture.ts').createCaptureScript
let packCanvasHtml: typeof import('./canvas/pack.ts').packCanvasHtml
let createHtmlDocument: typeof import('./canvas/bootstrap.ts').createHtmlDocument
let insertCaptureScript: typeof import('./canvas/bootstrap.ts').insertCaptureScript
let createReadCanvasRelative: typeof import('./canvas/read-relative.ts').createReadCanvasRelative
let mountCanvasPreview: typeof import('./client.tsx').mountCanvasPreview
let CANVAS_RENDERER_ID: typeof import('./canvas/definition.ts').CANVAS_RENDERER_ID
let apply: typeof import('./client.tsx').apply
beforeAll(async () => {
  createRoot = (await import('react-dom/client')).createRoot
  ;({ CanvasToolCall, readCanvasCall, apply, mountCanvasPreview } = await import('./client.tsx'))
  ;({ recordCanvasError, canvasErrorReportOf, createCaptureScript } = await import('./canvas/capture.ts'))
  ;({ packCanvasHtml } = await import('./canvas/pack.ts'))
  ;({ createHtmlDocument, insertCaptureScript } = await import('./canvas/bootstrap.ts'))
  ;({ createReadCanvasRelative } = await import('./canvas/read-relative.ts'))
  ;({ CANVAS_RENDERER_ID } = await import('./canvas/index.ts'))
  const w = dom.window as { URL: typeof URL }
  w.URL.createObjectURL = (blob: Blob) => {
    const url = `blob:canvas-${objectUrls.length}`
    objectUrls.push(url)
    return url
  }
  w.URL.revokeObjectURL = () => {}
})
afterEach(() => { document.body.innerHTML = '<div id="root"></div>' })
const t = (key: string, params?: Record<string, unknown>) => key.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))
const argsView = (fields: Record<string, unknown>) => ({
  has: (key: string) => key in fields,
  complete: (key: string) => key in fields,
  text: (key: string) => typeof fields[key] === 'string' ? fields[key] as string : undefined,
  value: (key: string) => fields[key],
})
const metaBlock = (callId: string, meta: unknown) => ({ callId, kind: 'tool-result' as const, meta })
const shownMeta = { owner: 'deep-view/canvas', path: 'demo.html', address: 'dsh-resource://file/session/s1/demo.html', title: 'Demo' }

describe('show_canvas tool card', () => {
  it('auto-opens once when a live call settles to a shown result', async () => {
    const opened: string[] = []
    const open = (address: string) => { opened.push(address) }
    const root = createRoot(document.getElementById('root')!)
    const base = { sessionId: 's1', callId: 'call-live-1', t, openCanvas: open }
    await act(async () => root.render(<CanvasToolCall {...base} phase="start" block={{ callId: 'call-live-1', args: argsView({ path: 'demo.html' }) }} />))
    expect(opened).toEqual([])
    await act(async () => root.render(<CanvasToolCall {...base} phase="result" block={metaBlock('call-live-1', shownMeta)} />))
    expect(opened).toEqual(['dsh-resource://file/session/s1/demo.html'])
    // A virtual-scroll remount after settlement must not open again.
    await act(async () => root.unmount())
    const second = createRoot(document.getElementById('root')!)
    await act(async () => second.render(<CanvasToolCall {...base} phase="result" block={metaBlock('call-live-1', shownMeta)} />))
    expect(opened).toEqual(['dsh-resource://file/session/s1/demo.html'])
    await act(async () => second.unmount())
  })
  it('never auto-opens a result seen on the first frame (history replay)', async () => {
    const opened: string[] = []
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<CanvasToolCall sessionId="s1" callId="call-replay" t={t} openCanvas={a => opened.push(a)} phase="result" block={metaBlock('call-replay', shownMeta)} />))
    expect(opened).toEqual([])
    expect(document.querySelector('.dvui-canvas-card-title')?.textContent).toBe('Demo')
    expect(document.querySelector('.dvui-canvas-card-path')?.textContent).toBe('demo.html')
    await act(async () => root.unmount())
  })
  it('hides the open button when the sidebar service is absent', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<CanvasToolCall sessionId="s1" callId="call-nobar" t={t} phase="result" block={metaBlock('call-nobar', shownMeta)} />))
    expect(document.querySelector('.dvui-canvas-card-title')?.textContent).toBe('Demo')
    expect(document.querySelector('button')).toBeNull()
    await act(async () => root.unmount())
  })
  it('renders a live arg card with a computed session address', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<CanvasToolCall sessionId="s1" callId="call-live-2" t={t} openCanvas={() => {}} phase="start" block={{ callId: 'call-live-2', args: argsView({ path: 'dir/my page.html' }) }} />))
    expect(document.querySelector('.dvui-canvas-card-title')?.textContent).toBe('my page.html')
    expect(readCanvasCall({ phase: 'start', block: { callId: 'c', args: argsView({ path: 'a.html' }) } })).toMatchObject({ shown: false, path: 'a.html' })
    expect(readCanvasCall({ phase: 'result', block: metaBlock('c', shownMeta) })).toMatchObject({ shown: true, address: shownMeta.address })
    await act(async () => root.unmount())
  })
  it('shows the host failure without offering a broken preview address', async () => {
    const root = createRoot(document.getElementById('root')!)
    const summary = 'No readable file at "dmeo.html". Write the file first.'
    const block = { callId: 'call-missing', kind: 'tool-result' as const, args: argsView({ path: 'dmeo.html' }), content: [{ type: 'text', text: summary }] }
    const read = readCanvasCall({ phase: 'result', block })
    expect(read).toMatchObject({ shown: false, path: 'dmeo.html', failure: summary })
    expect(read.address).toBeUndefined()
    await act(async () => root.render(<CanvasToolCall sessionId="s1" callId="call-missing" t={t} openCanvas={() => {}} phase="result" block={block} />))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(summary)
    expect(document.querySelector('button')).toBeNull()
    await act(async () => root.unmount())
  })
})

describe('canvas error capture', () => {
  it('embeds the nonce and posts the agreed message shape', () => {
    const script = createCaptureScript('nonce-1')
    expect(script).toContain('"dvui-canvas-error"')
    expect(script).toContain('"nonce-1"')
    expect(script.startsWith('<script>')).toBe(true)
    expect(script.endsWith('</script>')).toBe(true)
    for (const hook of ['unhandledrejection', "'error'", 'console.error']) expect(script).toContain(hook)
  })
  it('accepts only payloads with the matching nonce and a known kind', () => {
    const good = { type: 'dvui-canvas-error', nonce: 'n', kind: 'error', message: 'boom', source: 'f.html', line: 3, column: 1 }
    expect(canvasErrorReportOf(good, 'n')).toMatchObject({ kind: 'error', message: 'boom', source: 'f.html', line: 3, column: 1 })
    expect(canvasErrorReportOf(good, 'other')).toBeUndefined()
    expect(canvasErrorReportOf({ ...good, type: 'elsewhere' }, 'n')).toBeUndefined()
    expect(canvasErrorReportOf({ ...good, kind: 'log' }, 'n')).toBeUndefined()
    expect(canvasErrorReportOf({ ...good, message: 42 }, 'n')).toBeUndefined()
    expect(canvasErrorReportOf('boom', 'n')).toBeUndefined()
    expect(canvasErrorReportOf({ ...good, message: 'x'.repeat(1500) }, 'n')?.message).toHaveLength(1000)
  })
  it('merges identical messages, caps at twenty rows and truncates', () => {
    let errors: import('./canvas/capture.ts').CanvasError[] = []
    errors = recordCanvasError(errors, { kind: 'error', message: 'same' })
    errors = recordCanvasError(errors, { kind: 'error', message: 'same' })
    expect(errors).toEqual([{ message: 'same', count: 2, source: undefined, line: undefined, column: undefined }])
    for (let index = 0; index < 25; index++) errors = recordCanvasError(errors, { kind: 'error', message: `m${index}` })
    expect(errors).toHaveLength(20)
    expect(errors.at(-1)?.message).toBe('m18')
  })
})

describe('canvas HTML packing and bootstrap', () => {
  const bytes = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
  const read = (files: Record<string, string>) => async (reference: string) => {
    const hit = files[reference]
    if (hit === undefined) throw new Error(`missing ${reference}`)
    return { data: bytes(hit), absolutePath: `/work/${reference}` }
  }
  const signal = () => new AbortController().signal
  it('packs relative classic scripts and stylesheets, skipping modules and remote refs', async () => {
    const html = '<html><head><link rel="stylesheet" href="a.css"><link rel="stylesheet" href="https://cdn.test/x.css"><script type="module" src="m.js"></script></head><body><script src="b.js?v=1"></script><script src="/abs.js"></script></body></html>'
    const seen: string[] = []
    const bundle = await packCanvasHtml(bytes(html), async (reference) => { seen.push(reference); return read({ 'a.css': 'a{}', 'b.js?v=1': 'b()' })(reference) }, signal())
    expect(seen).toEqual(['a.css', 'b.js?v=1'])
    expect(bundle.assets.map(asset => asset.reference)).toEqual(['a.css', 'b.js?v=1'])
    const doc = createHtmlDocument(bundle, '<script>capture()</script>')
    expect(doc).toContain('document.write(html)')
    const inner = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(/JSON\.parse\(text\("([^"]+)"\)/.exec(doc)![1]!), c => c.charCodeAt(0))))
    expect(inner.capture).toBeUndefined()
    expect(inner.html.startsWith('<html><head><script>capture()</script>')).toBe(true)
    expect(inner.html).toContain('href="a.css"')
    expect(inner.html).toContain('src="b.js?v=1"')
    expect(inner.assets).toHaveLength(2)
  })
  it('inserts capture into source HTML without dropping a textarea leading newline', () => {
    const source = '<!doctype html><html><head data-author="yes"></head><body><textarea>\n\nhello</textarea><pre>\n\npre</pre></body></html>'
    const next = insertCaptureScript(source, '<script id="capture"></script>')
    expect(next).toContain('<head data-author="yes"><script id="capture"></script>')
    expect(next).toContain('<textarea>\n\nhello</textarea>')
    expect(next).toContain('<pre>\n\npre</pre>')
  })
  async function documentAfterBootstrap(bootstrap: string) {
    let blobs = 0
    const page = new JSDOM(bootstrap, {
      url: 'https://canvas.test/preview',
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      beforeParse(window) {
        window.URL.createObjectURL = () => `blob:canvas-asset-${blobs++}`
        window.URL.revokeObjectURL = () => {}
      },
    })
    await new Promise<void>(resolve => { page.window.setTimeout(resolve, 0) })
    return page.window.document
  }
  it('preserves standards mode, head attributes and leading preformatted newlines in the written document', async () => {
    const source = '<!doctype html><html><head data-author="yes"><script id="author"></script></head><body><textarea>\n\nhello</textarea><pre>\n\npre</pre></body></html>'
    const live = await documentAfterBootstrap(createHtmlDocument({ data: bytes(source), assets: [] }, '<script id="capture"></script>'))
    expect(live.compatMode).toBe('CSS1Compat')
    expect(live.head.getAttribute('data-author')).toBe('yes')
    expect(live.querySelector('textarea')?.value).toBe('\nhello')
    expect(live.querySelector('pre')?.textContent).toBe('\npre')
    expect(live.getElementById('capture')).not.toBeNull()
    expect(live.getElementById('author')).not.toBeNull()
    expect(live.documentElement.innerHTML.indexOf('id="capture"')).toBeLessThan(live.documentElement.innerHTML.indexOf('id="author"'))
  })
  it('rewrites packed assets in source HTML without dropping a textarea leading newline', async () => {
    const source = '<!doctype html><html><head><link rel="stylesheet" href="a.css"></head><body><textarea>\n\nhello</textarea></body></html>'
    const live = await documentAfterBootstrap(createHtmlDocument({
      data: bytes(source),
      assets: [{ kind: 'stylesheet', reference: 'a.css', data: bytes('body{}') }],
    }, '<script id="capture"></script>'))
    expect(live.querySelector('textarea')?.value).toBe('\nhello')
    expect(live.querySelector('link')?.getAttribute('href')).toMatch(/^blob:/)
    expect(live.getElementById('capture')).not.toBeNull()
  })
  it('enforces the per-asset, total and count limits', async () => {
    const big = 'a'.repeat(5 * 1024 * 1024)
    await expect(packCanvasHtml(bytes('<script src="big.js"></script>'), read({ 'big.js': big }), signal())).rejects.toThrow(/byte limit/)
    const many = Array.from({ length: 65 }, (_, index) => `<script src="f${index}.js"></script>`).join('')
    await expect(packCanvasHtml(bytes(many), async r => ({ data: bytes('x'), absolutePath: `/${r}` }), signal())).rejects.toThrow(/count limit/)
    const huge = 'a'.repeat(33 * 1024 * 1024)
    await expect(packCanvasHtml(bytes(huge), read({}), signal())).rejects.toThrow(/total byte limit/)
  })
  it('rejects non-relative and backslash dependency paths', async () => {
    const related = createReadCanvasRelative(async () => ({ ok: true as const, value: { data: bytes('x'), absolutePath: '/work/x' } }), 'dsh-resource://file/session/s1/a.html', new AbortController().signal, () => {})
    // `..` is a relative reference: it reaches the Host, which resolves it against the base file's directory.
    await expect(related('../up.js', signal())).resolves.toMatchObject({ data: expect.anything() })
    await expect(related('C:/x.js', signal())).rejects.toThrow()
    await expect(related('dir\\x.js', signal())).rejects.toThrow()
    await expect(related('ok.js?v=2', signal())).resolves.toMatchObject({ data: expect.anything() })
  })
})

describe('canvas preview registration', () => {
  const enabledStore = (initial: boolean) => {
    const listeners = new Set<() => void>()
    let current = initial
    return {
      getSnapshot: () => current,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
      set(value: boolean) { current = value; for (const listener of listeners) listener() },
    }
  }
  const scopeFixture = (enabled: ReturnType<typeof enabledStore>) => {
    const previews: Record<string, unknown>[] = []
    const bodies: Record<string, unknown>[] = []
    const scope = {
      locale: { bind: () => t },
      documentPreviews: { register(def: Record<string, unknown>) { previews.push(def); return () => { previews.splice(previews.indexOf(def), 1) } } },
      slots: {
        inject(_key: string, fn: () => unknown) { const inner = fn() as () => void; return () => inner() },
        register(spec: Record<string, unknown>) { bodies.push(spec); return () => { bodies.splice(bodies.indexOf(spec), 1) } },
      },
      remote: { workspaceFiles: { readBytes: async () => ({ ok: true, value: { data: new Uint8Array() } }) } },
    }
    return { scope: { ...scope, configForms: { developerTools: { enabled } } }, previews, bodies }
  }
  it('registers while developer tools are enabled and withdraws on off', () => {
    const enabled = enabledStore(true)
    const { scope, previews, bodies } = scopeFixture(enabled)
    const dispose = mountCanvasPreview(scope as never, 'deep-view')
    expect(previews).toHaveLength(1)
    expect(previews[0]).toMatchObject({ id: CANVAS_RENDERER_ID, extensions: ['html', 'htm'], priority: 'extension', loading: 'bytes-complete', wrap: false })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ name: 'sidebar.right.tab.document', key: CANVAS_RENDERER_ID, locale: 'deep-view' })
    enabled.set(false)
    expect(previews).toHaveLength(0)
    expect(bodies).toHaveLength(0)
    enabled.set(true)
    expect(previews).toHaveLength(1)
    dispose()
    expect(previews).toHaveLength(0)
  })
  it('stays unregistered while disabled or when the remote face is missing', () => {
    const enabled = enabledStore(false)
    const { scope, previews } = scopeFixture(enabled)
    const dispose = mountCanvasPreview(scope as never, 'deep-view')
    expect(previews).toHaveLength(0)
    enabled.set(true)
    expect(previews).toHaveLength(1)
    dispose()
    const bare = scopeFixture(enabledStore(true))
    const noRemote = { ...bare.scope, remote: {} }
    const second = mountCanvasPreview(noRemote as never, 'deep-view')
    expect(bare.previews).toHaveLength(0)
    second()
  })
  it('provides the relative reader through the slot inject face', async () => {
    const enabled = enabledStore(true)
    const { scope, bodies } = scopeFixture(enabled)
    mountCanvasPreview(scope as never, 'deep-view')
    const inject = bodies[0]!.inject as () => { readRelated: (address: string, path: string, signal: AbortSignal) => Promise<unknown> }
    const calls: [string, string, { baseFile?: string } | undefined][] = []
    scope.remote.workspaceFiles = { readBytes: async (s: string, p: string, o: { baseFile?: string } | undefined) => { calls.push([s, p, o]); return { ok: true, value: { data: new Uint8Array([65]), absolutePath: '/w/dep.js' } } } }
    const { readRelated } = inject()
    await readRelated('dsh-resource://file/session/s1/dir/page.html', 'dep.js', new AbortController().signal)
    expect(calls).toEqual([['s1', 'dep.js', { baseFile: 'dir/page.html' }]])
  })
  it('returns the same readRelated function on every inject call', () => {
    const enabled = enabledStore(true)
    const { scope, bodies } = scopeFixture(enabled)
    mountCanvasPreview(scope as never, 'deep-view')
    const inject = bodies[0]!.inject as () => { readRelated: unknown }
    expect(inject().readRelated).toBe(inject().readRelated)
  })
  it('wires the canvas tool card and canvas preview through optional inject scopes', async () => {
    const injected: string[][] = []
    const registrations: Record<string, unknown>[] = []
    const ctx = {
      effect(run: () => unknown) { run() },
      provide() {},
      slots: { inject(_key: string, fn: () => unknown) { fn(); return () => {} }, register(spec: Record<string, unknown>) { registrations.push(spec); return () => {} } },
      locale: { register: () => () => {}, bind: () => t },
      connection: { rpc: { call: async () => ({ ok: true, value: null }) } },
      inject(deps: string[], callback: (scope: unknown) => void) { injected.push(deps); return { dispose() {} } },
    }
    apply(ctx as never)
    expect(injected).toEqual([['sidebarRight'], ['documentPreviews', 'configForms', 'remote', 'remote.workspaceFiles']])
    expect(registrations.some(spec => spec.name === 'tool.call.toolview' && spec.key === 'show_canvas')).toBe(true)
  })
})
