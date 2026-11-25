import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SIDEBAR_OPEN_TOOL, sessionFileAddress } from './contracts.ts'
import {
  SIDEBAR_OPEN_PROMPT,
  createSidebarOpenToolDefinition,
  executeOpenSidebar,
  formatOpenSidebarResult,
  installSidebarOpenHost,
  parseSidebarUrl,
  toSidebarAddressPath,
  validateSidebarArgs,
} from './sidebar-open.ts'
import {
  OpenSidebarToolRow,
  installSidebarOpenClient,
  type ObservableSnapshotLike,
  type SessionBindingLike,
  type SessionEventRecordLike,
  type SessionEventWindowLike,
} from './sidebar-open-client.tsx'

function makeObservable<T>(initial: T): ObservableSnapshotLike<T> & { set(next: T): void } {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => current,
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    set(next) {
      current = next
      for (const fn of [...listeners]) fn()
    },
  }
}

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('open_sidebar host validation and execution', () => {
  it('validates mutually exclusive path/url arguments and URL safety rules', () => {
    expect(validateSidebarArgs({ path: 'docs/report.html', line: 12, destination: 'float' })).toEqual({
      kind: 'file',
      path: 'docs/report.html',
      line: 12,
      destination: 'float',
    })
    expect(validateSidebarArgs({ url: '  http://127.0.0.1:4173/app#demo  ' })).toEqual({
      kind: 'url',
      url: 'http://127.0.0.1:4173/app#demo',
    })
    for (const invalid of [
      null,
      {},
      { path: 'a.md', url: 'https://example.com' },
      { path: '   ' },
      { path: 'a.md', line: 0 },
      { path: 'a.md', line: 1.5 },
      { path: 'a.md', destination: 'window' },
      { url: 'localhost:3000' },
      { url: 'file:///etc/passwd' },
      { url: 'https://user:secret@example.com/' },
      { url: `https://example.com/${'a'.repeat(MAX_LEN())}` },
      { url: 'https://example.com/', line: 3 },
      { url: 'https://example.com/', destination: 'float' },
    ]) {
      expect(() => validateSidebarArgs(invalid)).toThrow()
    }
    expect(parseSidebarUrl('https://example.com/ok')).toBe('https://example.com/ok')
  })

  it('resolves workspace-relative paths, rejects directories, and hints on isolated /tmp files', async () => {
    expect(toSidebarAddressPath('/home/u/repo/docs/index.html', '/home/u/repo')).toBe('docs/index.html')
    expect(toSidebarAddressPath('C:\\repo\\sub\\a.md', 'C:\\repo')).toBe('sub/a.md')
    expect(toSidebarAddressPath('/tmp/out.html', '/home/u/repo')).toBe('/tmp/out.html')
    expect(sessionFileAddress('wsl:s1', 'docs/a b.html')).toBe('dsh-resource://file/session/wsl:s1/docs/a%20b.html')

    const files = new Map<string, { type: string }>([
      ['/ws/docs/report.html', { type: 'file' }],
      ['/ws/docs', { type: 'dir' }],
      ['/outside/note.md', { type: 'file' }],
    ])
    const deps = {
      workingDirectory: { ensure: async () => '/ws/docs' },
      fs: {
        lstat: async (p: string, opts?: { cwd?: string | undefined } | undefined) =>
          files.get(p.startsWith('/') ? p : `${opts?.cwd ?? ''}/${p}`),
        resolve: async (p: string, opts?: { cwd?: string | undefined } | undefined) =>
          p.startsWith('/') ? p : `${opts?.cwd ?? ''}/${p}`,
        stat: async (target: unknown) => files.get(String(target)),
        processPath: (target: unknown) => String(target),
      },
      now: () => 12_345,
    }
    const exec = { agent: { session: { header: { cwd: '/ws' } } } }

    const fileResult = await executeOpenSidebar({ path: 'report.html', line: 7 }, exec, deps)
    expect(fileResult).toEqual({
      kind: 'file',
      path: 'docs/report.html',
      absolutePath: '/ws/docs/report.html',
      line: 7,
      openedAt: 12_345,
    })
    expect(formatOpenSidebarResult(fileResult)).toContain('Opened docs/report.html:7 in right sidebar preview')

    const outside = await executeOpenSidebar({ path: '/outside/note.md' }, exec, deps)
    expect(outside.path).toBe('/outside/note.md')

    await expect(executeOpenSidebar({ path: '/ws/docs' }, exec, deps)).rejects.toMatchObject({
      code: 'FS_NOT_REGULAR_FILE',
    })
    await expect(executeOpenSidebar({ path: '/tmp/missing.html' }, exec, deps)).rejects.toThrow(/Sandbox \/tmp/)

    const def = createSidebarOpenToolDefinition(deps)
    expect(def.name).toBe(SIDEBAR_OPEN_TOOL)
    const output = def.output as { presentationMeta: (args: unknown, value: unknown) => unknown }
    expect(output.presentationMeta({}, fileResult)).toEqual({ tool: SIDEBAR_OPEN_TOOL, ...fileResult })
  })

  it('registers open_sidebar tool and top-level prompt section via host injection', () => {
    const tools = new Map<string, Record<string, unknown>>()
    const sections: Array<{ name: string; order: number; text: (ctx?: unknown) => string }> = []
    const disposers: Array<() => void> = []
    const scopedHost = {
      tools: {
        get: (name: string) => tools.get(name),
        register: (def: Record<string, unknown>) => {
          tools.set(String(def.name), def)
          return () => tools.delete(String(def.name))
        },
      },
      fs: {
        lstat: async () => undefined,
        resolve: async (p: string) => p,
        stat: async () => undefined,
        processPath: (t: unknown) => String(t),
      },
      systemPrompt: {
        getSectionOrder: () => 600,
        section: (sec: { name: string; order: number; text: (ctx?: unknown) => string }) => {
          sections.push(sec)
          return () => {
            sections.length = 0
          }
        },
      },
      effect(run: () => () => void) {
        disposers.push(run())
      },
    }
    const ctx = {
      inject(_deps: readonly string[], cb: (s: unknown) => void) {
        cb(scopedHost)
      },
    }
    installSidebarOpenHost(ctx as never)
    expect(tools.has(SIDEBAR_OPEN_TOOL)).toBe(true)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.order).toBe(601)
    expect(sections[0]!.text({ agent: { session: { header: { delegationDepth: 0 } } } })).toBe(SIDEBAR_OPEN_PROMPT)
    expect(sections[0]!.text({ agent: { session: { header: { delegationDepth: 1 } } } })).toBe('')
    for (const stop of disposers) stop()
    expect(tools.size).toBe(0)
  })
})

function MAX_LEN() {
  return 16 * 1024 + 10
}

describe('open_sidebar client watcher and toolview row', () => {
  it('opens live targets on the mounted session, queues background sessions until mounted, and skips history', async () => {
    const storage = memoryStorage()
    const mounted = makeObservable<string | null>('s1')
    const bindings = new Map<string, SessionBindingLike & { push(kind: 'append' | 'prepend' | 'replace', entries: SessionEventRecordLike[]): void }>()
    const list = makeObservable({ ids: ['s1', 's2'], byId: { s1: {}, s2: {} } })

    const makeBinding = (id: string, initial: SessionEventRecordLike[] = []) => {
      const src = makeObservable<SessionEventWindowLike | undefined>({
        entries: initial,
        revision: 0,
        change: { kind: 'replace', entries: initial },
      })
      return {
        sessionId: id,
        eventSource: src,
        push(kind: 'append' | 'prepend' | 'replace', entries: SessionEventRecordLike[]) {
          const prev = src.getSnapshot()!
          const merged = kind === 'append'
            ? [...prev.entries, ...entries]
            : kind === 'prepend'
              ? [...entries, ...prev.entries]
              : entries
          src.set({ entries: merged, revision: prev.revision + 1, change: { kind, entries } })
        },
      }
    }

    const mkEvent = (callId: string, time: number, meta: Record<string, unknown>, type: 'tool/result' | 'tool/ptc-dispatch' = 'tool/result'): SessionEventRecordLike => ({
      type: 'event',
      event: type === 'tool/result'
        ? { type, seq: 1, time, data: { message: { isError: false, source: { callId } }, meta } }
        : { type, seq: 2, time, data: { subCallId: callId, name: SIDEBAR_OPEN_TOOL, isError: false, meta } },
    })

    const b1 = makeBinding('s1', [mkEvent('old', 1_000, { tool: SIDEBAR_OPEN_TOOL, kind: 'file', path: 'old.md', openedAt: 1_000 })])
    const b2 = makeBinding('s2')
    bindings.set('s1', b1)
    bindings.set('s2', b2)

    let adopted = 's1'
    const openedResources: Array<[string | null, string, unknown]> = []
    const openedTabs: Array<[string | null, string, unknown]> = []
    const host = {
      sessions: { list, binding: (id: string) => bindings.get(id) },
      sidebarRight: {
        mounted,
        openResource: (addr: string, opts?: unknown) => {
          if (adopted !== mounted.getSnapshot()) throw new Error('sidebarRight: no session surface is mounted')
          openedResources.push([mounted.getSnapshot(), addr, opts])
        },
        openTab: (kind: string, opts?: unknown) => {
          if (adopted !== mounted.getSnapshot()) throw new Error('sidebarRight: no session surface is mounted')
          openedTabs.push([mounted.getSnapshot(), kind, opts])
        },
      },
      sidebarRightTabs: { get: (id: string) => (id === 'browser' ? {} : undefined) },
      locale: { register: () => () => {} },
      slots: { inject: (_k: string, fn: () => unknown) => { fn(); return () => {} }, register: () => () => {} },
      effect: () => {},
    }

    const dispose = installSidebarOpenClient(host as never, { storage, now: () => 5_000 })
    expect(openedResources).toEqual([])
    b1.push('prepend', [mkEvent('paged', 9_999, { tool: SIDEBAR_OPEN_TOOL, kind: 'file', path: 'paged.md', openedAt: 9_999 })])
    expect(openedResources).toEqual([])

    b1.push('append', [mkEvent('c1', 5_100, { tool: SIDEBAR_OPEN_TOOL, kind: 'file', path: 'docs/a b.html', line: 3, destination: 'float', openedAt: 5_100 })])
    b1.push('append', [mkEvent('c2', 5_200, { tool: SIDEBAR_OPEN_TOOL, kind: 'url', url: 'http://127.0.0.1:4173/', openedAt: 5_200 }, 'tool/ptc-dispatch')])
    expect(openedResources).toEqual([['s1', 'dsh-resource://file/session/s1/docs/a%20b.html', { params: { line: 3 }, destination: 'float' }]])
    expect(openedTabs).toEqual([['s1', 'browser', { params: { url: 'http://127.0.0.1:4173/' } }]])

    // Off-screen session s2 queues until mounted + seat adoption completes.
    b2.push('append', [mkEvent('c3', 5_300, { tool: SIDEBAR_OPEN_TOOL, kind: 'file', path: 'chart.svg', openedAt: 5_300 })])
    expect(openedResources).toHaveLength(1)
    mounted.set('s2')
    expect(openedResources).toHaveLength(1)
    adopted = 's2'
    await new Promise(resolve => setTimeout(resolve, 45))
    expect(openedResources[1]).toEqual(['s2', 'dsh-resource://file/session/s2/chart.svg', {}])

    dispose()

    // Reloading with persisted handled keys does not re-open c3.
    const reopened: unknown[] = []
    const stopSecond = installSidebarOpenClient(
      {
        ...host,
        sidebarRight: { mounted, openResource: (...args: unknown[]) => reopened.push(args), openTab: () => {} },
      } as never,
      { storage, now: () => 5_000 },
    )
    expect(reopened).toEqual([])
    stopSecond()
  })

  it('renders a .sl-root-scoped toolview row and falls back to window.open on manual URL click', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>')
    const opens: unknown[] = []
    dom.window.open = ((...args: unknown[]) => {
      opens.push(args)
      return null
    }) as typeof window.open
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)

    const html = renderToStaticMarkup(
      <OpenSidebarToolRow
        phase="result"
        block={{
          kind: 'tool-result',
          isError: false,
          content: [{ type: 'text', text: 'Opened https://example.com/ in right sidebar browser.' }],
          meta: { kind: 'url', url: 'https://example.com/', openedAt: 100 },
          call: { argsRaw: '{"url":"https://example.com/"}' },
        }}
      />,
    )
    expect(html).toContain('class="sl-root sl-open-card"')
    expect(html).toContain('https://example.com/')
  })
})
