import { act } from 'react'
import { JSDOM, VirtualConsole } from 'jsdom'
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
let formatCanvasError: typeof import('./canvas/capture.ts').formatCanvasError
let CanvasBody: typeof import('./canvas/CanvasBody.tsx').CanvasBody
let packCanvasHtml: typeof import('./canvas/pack.ts').packCanvasHtml
let createHtmlDocument: typeof import('./canvas/bootstrap.ts').createHtmlDocument
let insertCaptureScript: typeof import('./canvas/bootstrap.ts').insertCaptureScript
let prepareCanvasSource: typeof import('./canvas/bootstrap.ts').prepareCanvasSource
let createReadCanvasRelative: typeof import('./canvas/read-relative.ts').createReadCanvasRelative
let mountCanvasPreview: typeof import('./client.tsx').mountCanvasPreview
let createCanvasRuntimeStore: typeof import('./client.tsx').createCanvasRuntimeStore
let CANVAS_RENDERER_ID: typeof import('./canvas/definition.ts').CANVAS_RENDERER_ID
let apply: typeof import('./client.tsx').apply
beforeAll(async () => {
  createRoot = (await import('react-dom/client')).createRoot
  ;({ CanvasToolCall, readCanvasCall, apply, mountCanvasPreview, createCanvasRuntimeStore } = await import('./client.tsx'))
  ;({ recordCanvasError, canvasErrorReportOf, createCaptureScript, formatCanvasError } = await import('./canvas/capture.ts'))
  ;({ CanvasBody } = await import('./canvas/CanvasBody.tsx'))
  ;({ packCanvasHtml } = await import('./canvas/pack.ts'))
  ;({ createHtmlDocument, insertCaptureScript, prepareCanvasSource } = await import('./canvas/bootstrap.ts'))
  ;({ createReadCanvasRelative } = await import('./canvas/read-relative.ts'))
  ;({ CANVAS_RENDERER_ID } = await import('./canvas/index.ts'))
  const w = dom.window as { URL: typeof URL }
  w.URL.createObjectURL = (blob: Blob) => {
    const url = `blob:canvas-${objectUrls.length}`
    objectUrls.push(url)
    return url
  }
  w.URL.revokeObjectURL = () => {}
  URL.createObjectURL = w.URL.createObjectURL
  URL.revokeObjectURL = w.URL.revokeObjectURL
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
  it('surfaces a notice and enable-and-open recovery when Show coding view is disabled', async () => {
    const opened: string[] = []
    let current = false
    const listeners = new Set<() => void>()
    const developerTools = {
      getSnapshot: () => current,
      subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) },
      setValue(next: boolean) { current = next; for (const fn of listeners) fn() },
    }
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<CanvasToolCall sessionId="s1" callId="call-dev-off" t={t} openCanvas={a => opened.push(a)} developerTools={developerTools} phase="start" block={{ callId: 'call-dev-off', args: argsView({ path: 'demo.html' }) }} />))
    await act(async () => root.render(<CanvasToolCall sessionId="s1" callId="call-dev-off" t={t} openCanvas={a => opened.push(a)} developerTools={developerTools} phase="result" block={metaBlock('call-dev-off', shownMeta)} />))
    expect(opened).toEqual([])
    expect(document.querySelector('.dvui-canvas-card-notice')?.textContent).toBe('canvasCodingViewOff')
    const buttons = [...document.querySelectorAll('button')]
    expect(buttons.map(btn => btn.textContent)).toEqual(['canvasEnableCodingView', 'canvasOpenStatic'])
    await act(async () => buttons[0]!.click())
    expect(current).toBe(true)
    expect(opened).toEqual([shownMeta.address])
    expect(document.querySelector('.dvui-canvas-card-notice')).toBeNull()
    await act(async () => root.unmount())

    // Toggling coding view on later must not batch-open older settled cards, and async runtime waits for previewMounted.
    const batchOpened: string[] = []
    let asyncEnabled = false
    const runtime = createCanvasRuntimeStore({
      sidebarRight: { openResource: addr => { batchOpened.push(addr) } },
      hasWorkspaceFiles: true,
      previewMounted: false,
    })
    const asyncDevTools = {
      getSnapshot: () => asyncEnabled,
      subscribe: (fn: () => void) => runtime.subscribe(fn),
      setValue(next: boolean) {
        asyncEnabled = next
        setTimeout(() => { runtime.update({ previewMounted: next }) }, 10)
      },
    }
    runtime.update({ developerTools: asyncDevTools })
    const multiRoot = createRoot(document.getElementById('root')!)
    await act(async () => multiRoot.render(<div>
      <CanvasToolCall sessionId="s1" callId="call-old-a" t={t} runtime={runtime} phase="start" block={{ callId: 'call-old-a', args: argsView({ path: 'a.html' }) }} />
      <CanvasToolCall sessionId="s1" callId="call-old-b" t={t} runtime={runtime} phase="start" block={{ callId: 'call-old-b', args: argsView({ path: 'b.html' }) }} />
    </div>))
    await act(async () => multiRoot.render(<div>
      <CanvasToolCall sessionId="s1" callId="call-old-a" t={t} runtime={runtime} phase="result" block={metaBlock('call-old-a', { ...shownMeta, path: 'a.html', address: 'dsh-resource://file/session/s1/a.html' })} />
      <CanvasToolCall sessionId="s1" callId="call-old-b" t={t} runtime={runtime} phase="result" block={metaBlock('call-old-b', { ...shownMeta, path: 'b.html', address: 'dsh-resource://file/session/s1/b.html' })} />
    </div>))
    expect(batchOpened).toEqual([])
    const enableBtns = [...document.querySelectorAll('button')].filter(b => b.textContent === 'canvasEnableCodingView')
    await act(async () => enableBtns[1]!.click())
    // Before previewMounted turns true asynchronously, openResource has not fired prematurely.
    expect(batchOpened).toEqual([])
    await act(async () => { await new Promise<void>(r => setTimeout(r, 20)) })
    // Only card B (the clicked one) opens once previewMounted is true; card A never batch-pops.
    expect(batchOpened).toEqual(['dsh-resource://file/session/s1/b.html'])
    await act(async () => multiRoot.unmount())
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
  it('backfills missing source/line/column when duplicate messages arrive and formats locations cleanly', () => {
    let errors: import('./canvas/capture.ts').CanvasError[] = []
    errors = recordCanvasError(errors, { kind: 'error', message: 'ReferenceError: x is not defined' })
    errors = recordCanvasError(errors, { kind: 'error', message: 'ReferenceError: x is not defined', source: 'sub/app.js', line: 12, column: 4 })
    expect(errors).toEqual([{ message: 'ReferenceError: x is not defined', count: 2, source: 'sub/app.js', line: 12, column: 4 }])
    expect(formatCanvasError(errors[0]!)).toBe('ReferenceError: x is not defined (sub/app.js:12:4)')
    expect(formatCanvasError({ message: 'Failed to load <img>: hero.png', count: 1, source: 'hero.png' })).toBe('Failed to load <img>: hero.png')
    expect(formatCanvasError({ message: 'Uncaught boom', count: 1, source: 'blob:null/1234', line: 9 })).toBe('Uncaught boom (line 9)')
  })
  it('captures non-bubbling <img>, <script> and <link> subresource load failures and truncates data URIs', async () => {
    const html = [
      '<!doctype html><html><head>',
      createCaptureScript('nonce-res'),
      '<link id="icon" rel="icon" href="favicon.ico">',
      '</head><body><img id="i" src="missing.png"><img id="empty" src=""><script id="s" src="https://cdn.test/404.js"></script><link id="l" rel="stylesheet" href="  data:text/css;base64,',
      'A'.repeat(120),
      '"></body></html>',
    ].join('')
    const page = new JSDOM(html, {
      url: 'https://canvas.test/res',
      runScripts: 'dangerously',
      virtualConsole: new VirtualConsole(),
    })
    const messages: unknown[] = []
    page.window.addEventListener('message', event => messages.push(event.data))
    for (const id of ['icon', 'i', 'empty', 's', 'l']) {
      const el = page.window.document.getElementById(id)!
      el.dispatchEvent(new page.window.Event('error', { bubbles: false }))
    }
    await new Promise<void>(resolve => { page.window.setTimeout(resolve, 0) })
    const reports = messages.map(data => canvasErrorReportOf(data, 'nonce-res')).filter(Boolean)
    expect(reports.some(r => r?.kind === 'resource' && r.message.includes('favicon.ico'))).toBe(false)
    expect(reports.some(r => r?.kind === 'resource' && r.message === 'Failed to load <img>: missing.png')).toBe(true)
    const emptyImg = reports.find(r => r?.kind === 'resource' && r.message === 'Failed to load <img>: (empty)')
    expect(emptyImg).toBeDefined()
    expect(emptyImg!.source).toBeUndefined()
    expect(reports.some(r => r?.kind === 'resource' && r.message === 'Failed to load <script>: https://cdn.test/404.js')).toBe(true)
    const linkReport = reports.find(r => r?.kind === 'resource' && r.message.startsWith('Failed to load <link>: data:text/css;base64,'))
    expect(linkReport).toBeDefined()
    expect(linkReport!.message.endsWith('…')).toBe(true)
    expect(linkReport!.message.length).toBeLessThan(90)
    page.window.close()
  })
  it('maps packed script blob URLs back to workspace relative paths via sourceURL and __dvuiAssets in CanvasBody', async () => {
    const bytes = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
    const bundle = await packCanvasHtml(
      bytes('<!doctype html><html><head><script src="./sub/app.js?v=2"></script></head><body></body></html>'),
      async () => ({ data: bytes('throw new Error("boom")'), absolutePath: '/work/sub/app.js' }),
      new AbortController().signal,
    )
    const prepared = prepareCanvasSource(bundle, createCaptureScript('nonce-map'))
    expect(prepared.assets[0]!.reference).toBe('sub/app.js')
    expect(prepared.assets[0]!.text).toContain('//# sourceURL=sub/app.js')

    const mapHtml = [
      '<!doctype html><html><head>',
      createCaptureScript('nonce-map'),
      '</head><body></body></html>',
    ].join('')
    const page = new JSDOM(mapHtml, {
      url: 'https://canvas.test/map',
      runScripts: 'dangerously',
      virtualConsole: new VirtualConsole(),
    })
    ;(page.window as unknown as { __dvuiAssets: Record<string, string> }).__dvuiAssets = { 'blob:null/uuid-99': 'sub/app.js' }
    const posted: unknown[] = []
    page.window.addEventListener('message', event => posted.push(event.data))
    const err = new page.window.Error('boom')
    err.stack = 'Error: boom\n    at run (blob:null/uuid-99:8:3)'
    page.window.dispatchEvent(new page.window.ErrorEvent('error', {
      message: err.stack,
      filename: 'blob:null/uuid-99',
      lineno: 8,
      colno: 3,
      error: err,
    }))
    await new Promise<void>(resolve => { page.window.setTimeout(resolve, 0) })
    const report = posted.map(d => canvasErrorReportOf(d, 'nonce-map')).find(Boolean)!
    expect(report.source).toBe('sub/app.js')
    expect(report.line).toBe(8)
    expect(report.message).toContain('sub/app.js:8:3')
    expect(report.message).not.toContain('blob:null/uuid-99')
    page.window.close()

    const setDraft = vi.fn()
    let lastBootstrapHtml = ''
    const OrigBlob = globalThis.Blob
    globalThis.Blob = class extends OrigBlob {
      constructor(parts?: BlobPart[], opts?: BlobPropertyBag) {
        super(parts, opts)
        if (parts && typeof parts[0] === 'string') lastBootstrapHtml = parts[0]
      }
    } as typeof Blob
    const root = createRoot(document.getElementById('root')!)
    try {
      await act(async () => root.render(<CanvasBody
        resourceAddress="dsh-resource://file/session/s1/index.html"
        content={{ kind: 'bytes', data: bytes('<!doctype html><html><body>ok</body></html>') }}
        addResource={() => {}}
        setResources={() => {}}
        readRelated={async () => ({ ok: true, value: { data: new Uint8Array() } })}
        sessionId="s1"
        t={t}
        inputActions={{ captureInsertion: () => ({ start: 0, end: 0 }), insertText: () => false, setDraft, persistDraft: () => {} }}
        useInput={sel => sel({ draft: '', phase: 'plain' })}
      />))
      await act(async () => { await new Promise<void>(r => setTimeout(r, 20)) })
    } finally {
      globalThis.Blob = OrigBlob
    }
    const encodedBundle = await packCanvasHtml(
      bytes('<!doctype html><html><head><script src="./sub/my%20app.js"></script><script src="./sub/pre.js"></script></head><body></body></html>'),
      async ref => ({ data: bytes(ref.includes('pre.js') ? 'ok()\n//# sourceURL=custom.js' : 'ok()') }),
      new AbortController().signal,
    )
    const encodedPrepared = prepareCanvasSource(encodedBundle, '<script></script>')
    expect(encodedPrepared.assets[0]!.reference).toBe('sub/my app.js')
    expect(encodedPrepared.assets[0]!.text).toContain('//# sourceURL=sub/my%20app.js')
    expect(encodedPrepared.assets[1]!.text.match(/sourceURL=/g)).toHaveLength(1)

    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    expect(iframe).toBeTruthy()
    const fillDoc = createHtmlDocument({ data: bytes('<!doctype html><html><body></body></html>'), assets: [] }, '<script></script>', { rootPath: 'index.html' })
    const fillPayload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(/JSON\.parse\(text\("([^"]+)"\)\)/.exec(fillDoc)![1]!), c => c.charCodeAt(0))))
    expect(fillPayload.rootPath).toBe('index.html')
    expect(formatCanvasError({ message: 'TypeError: bad', count: 1, source: 'sub/app.js', line: 8, column: 3 })).toBe('TypeError: bad (sub/app.js:8:3)')

    const mountedPayload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(/JSON\.parse\(text\("([^"]+)"\)\)/.exec(lastBootstrapHtml)![1]!), c => c.charCodeAt(0))))
    const mountedNonce = /\}\)\("([^"]+)"(?:,|\);<\/script>)/.exec(mountedPayload.html)![1]!
    await act(async () => {
      window.dispatchEvent(new window.MessageEvent('message', {
        data: { type: 'dvui-canvas-error', nonce: mountedNonce, kind: 'error', message: 'TypeError: bad', source: 'sub/app.js', line: 8, column: 3 },
        source: iframe.contentWindow,
      }))
    })
    const fillBtn = [...document.querySelectorAll('.dvui-canvas-actions button')].find(btn => btn.textContent === 'fillDraft') as HTMLButtonElement | undefined
    expect(fillBtn).toBeTruthy()
    await act(async () => { fillBtn!.click() })
    expect(setDraft).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
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
    // Packed attributes carry markers, not the author reference; the iframe substitutes them verbatim.
    expect(inner.html).not.toContain('a.css')
    expect(inner.assets).toHaveLength(2)
    const written = inner.assets.reduce((html: string, asset: { marker: string }, index: number) => html.split(asset.marker).join(`blob:a-${index}`), inner.html)
    expect(written).toContain('href="blob:a-0"')
    expect(written).toContain('src="blob:a-1"')
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
    const bundle = await packCanvasHtml(bytes(source), read({ 'a.css': 'body{}' }), signal())
    const live = await documentAfterBootstrap(createHtmlDocument(bundle, '<script id="capture"></script>'))
    expect(live.querySelector('textarea')?.value).toBe('\nhello')
    expect(live.querySelector('link')?.getAttribute('href')).toMatch(/^blob:/)
    expect(live.getElementById('capture')).not.toBeNull()
  })
  const substituted = (prepared: ReturnType<typeof prepareCanvasSource>, url: (index: number) => string = index => `blob:asset-${index}`) =>
    prepared.assets.reduce((html, asset, index) => html.split(asset.marker).join(url(index)), prepared.html)
  it('rewrites every packed attribute form by source range, entity-decoded and tag-scoped', async () => {
    const source = [
      '<!doctype html><html><head>',
      '<link rel="stylesheet" href="style.css">',
      '<script src="app.js?v=1&amp;lang=zh"></script>',
      '</head><body>',
      '<script src=a.js></script>',
      '<script src = "sp.js"></script>',
      "<script src='q.js'></script>",
      '<a href="style.css">page</a>',
      '<div id="app.js">app.js</div>',
      '<script src="data.js"></script>',
      '</body></html>',
    ].join('')
    const files = { 'style.css': 's{}', 'app.js?v=1&lang=zh': 'a()', 'a.js': 'b()', 'sp.js': 'c()', 'q.js': 'd()', 'data.js': 'e()' }
    const bundle = await packCanvasHtml(bytes(source), read(files), signal())
    // Reads follow the entity-decoded attribute values, in document order.
    expect(bundle.assets.map(asset => asset.reference)).toEqual(['style.css', 'app.js?v=1&lang=zh', 'a.js', 'sp.js', 'q.js', 'data.js'])
    const prepared = prepareCanvasSource(bundle, '<script>capture()</script>')
    const written = substituted(prepared)
    // Every qualifying attribute — encoded, unquoted, spaced or single-quoted —
    // is replaced in place; nothing else carrying the same text is touched.
    expect(written).toContain('href="blob:asset-0"')
    expect(written).toContain('src="blob:asset-1"')
    expect(written).toContain('src="blob:asset-2"')
    expect(written).toContain('src="blob:asset-3"')
    expect(written).toContain('src="blob:asset-4"')
    expect(written).toContain('src="blob:asset-5"')
    expect(written).toContain('<a href="style.css">page</a>')
    expect(written).toContain('<div id="app.js">app.js</div>')
    expect(written).not.toContain('src=ablob:')
  })
  it('marks every quote form of a repeated reference under one asset', async () => {
    const source = '<html><body><script src="s.js"></script><script src=\'s.js\'></script></body></html>'
    let reads = 0
    const bundle = await packCanvasHtml(bytes(source), async () => { reads += 1; return { data: bytes('x()') } }, signal())
    expect(reads).toBe(1)
    expect(bundle.assets).toHaveLength(1)
    expect(bundle.assets[0]!.ranges).toHaveLength(2)
    const written = substituted(prepareCanvasSource(bundle, '<script>capture()</script>'))
    expect(written.match(/src="blob:asset-0"/g)).toHaveLength(2)
  })
  it('inserts capture into the real head, never a comment or a quoted attribute', () => {
    const commented = '<!doctype html><!-- Template inserts <head> here --><html><head><script>a</script></head></html>'
    const next = insertCaptureScript(commented, '<script id="c"></script>')
    expect(next).toContain('--><html><head><script id="c"></script><script>a</script>')
    const quoted = '<html><head data-x="a>b"><script>a</script></head></html>'
    expect(insertCaptureScript(quoted, '<script id="c"></script>')).toContain('<head data-x="a>b"><script id="c"></script><script>a</script>')
  })
  it('falls back through the explicit html tag, the doctype and the document start', () => {
    expect(insertCaptureScript('<html><body>x</body></html>', '<script id="c"></script>'))
      .toBe('<html><head><script id="c"></script></head><body>x</body></html>')
    expect(insertCaptureScript('<!doctype html><p>x', '<script id="c"></script>'))
      .toBe('<!doctype html><script id="c"></script><p>x')
    expect(insertCaptureScript('<p>x', '<script id="c"></script>')).toBe('<script id="c"></script><p>x')
  })
  async function runPreparedDocument(html: string) {
    const page = new JSDOM(html, {
      url: 'https://canvas.test/doc',
      runScripts: 'dangerously',
      resources: 'usable',
      virtualConsole: new VirtualConsole(),
    })
    const messages: unknown[] = []
    page.window.addEventListener('message', event => messages.push(event.data))
    await new Promise<void>(resolve => {
      if (page.window.document.readyState === 'complete') { resolve(); return }
      page.window.addEventListener('load', () => resolve())
    })
    // postMessage delivery is a queued task after the last script.
    await new Promise<void>(resolve => { page.window.setTimeout(resolve, 0) })
    return { page, messages }
  }
  it('runs the capture script before author code and reports console errors and throws', async () => {
    const source = '<!doctype html><html><head></head><body><script>console.error("boom");throw new Error("bang")</script></body></html>'
    const prepared = prepareCanvasSource({ data: bytes(source), assets: [] }, createCaptureScript('nonce-live'))
    const { page, messages } = await runPreparedDocument(prepared.html)
    const reports = messages.map(data => canvasErrorReportOf(data, 'nonce-live'))
    expect(reports.some(report => report?.kind === 'console' && report.message === 'boom')).toBe(true)
    expect(reports.some(report => report?.kind === 'error' && report.message.includes('bang'))).toBe(true)
    page.window.close()
  })
  it('executes packed scripts under their marker URLs and still reports, head comment or not', async () => {
    for (const prefix of ['<!doctype html><html>', '<!doctype html><!-- Template inserts <head> here --><html>']) {
      const source = `${prefix}<head><script src="e.js"></script></head><body><script>console.error("boom")</script></body></html>`
      const bundle = await packCanvasHtml(bytes(source), read({ 'e.js': 'console.error("packed-boom")' }), signal())
      const prepared = prepareCanvasSource(bundle, createCaptureScript('nonce-marked'))
      const doc = substituted(prepared, index => `data:text/javascript;base64,${btoa(prepared.assets[index]!.text)}`)
      const { page, messages } = await runPreparedDocument(doc)
      const reports = messages.map(data => canvasErrorReportOf(data, 'nonce-marked'))
      expect(reports.some(report => report?.kind === 'console' && report.message === 'packed-boom')).toBe(true)
      expect(reports.some(report => report?.kind === 'console' && report.message === 'boom')).toBe(true)
      page.window.close()
    }
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
