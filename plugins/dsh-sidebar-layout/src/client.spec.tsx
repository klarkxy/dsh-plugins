import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OFFICIAL_THEME_TOKEN_NAMES } from '@klarkxy/dsh-plugin-kit/official-ui'
import {
  CENTER_ATTRIBUTE, FRAME_ATTRIBUTE, PLUGIN_NAME, STORAGE_KEY,
  type SidebarLayoutMode,
} from './contracts.ts'
import {
  SidebarLayoutAction, SidebarLayoutRow, apply, inject, sidebarLayoutStyles,
} from './client.tsx'

/* Host-published variables the layout rules legitimately consume: the mask's
 * host transition tokens, the Windows-caption radius and macOS leading
 * clearance the swap mode mirrors, and plugin-kit's code-font token. */
const HOST_PUBLISHED_VARS = new Set([
  '--ds-ease-in-out',
  '--ds-font-family-code',
  '--ds-transition-duration-slow',
  '--dsh-dockkit-strip-inline-start',
  '--dsh-frame-leading-clearance',
  '--dsh-windows-content-radius',
])

const FRAME_HTML = `
  <div id="root">
    <div id="frame" data-rightbar-collapsed>
      <div class="sidebar"></div>
      <div class="centre"></div>
      <div data-rightbar-col></div>
    </div>
  </div>
`

function mountClient(options: {
  html?: string
  locale?: string
  storage?: Record<string, string>
  sidebarRight?: { isExpanded(): boolean; toggleExpanded(): void }
  shortcuts?: { catalog: { getSnapshot(): readonly unknown[]; subscribe(fn: () => void): () => void }; register(command: unknown): () => void }
} = {}) {
  const dom = new JSDOM(options.html ?? FRAME_HTML, { url: 'https://local.test/', pretendToBeVisual: true })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('localStorage', dom.window.localStorage)
  vi.stubGlobal('requestAnimationFrame', dom.window.requestAnimationFrame?.bind(dom.window))
  vi.stubGlobal('cancelAnimationFrame', dom.window.cancelAnimationFrame?.bind(dom.window))
  vi.stubGlobal('MutationObserver', dom.window.MutationObserver)
  for (const [key, value] of Object.entries(options.storage ?? {})) dom.window.localStorage.setItem(key, value)
  const effects: Array<{ label?: string; dispose: (() => void) | void }> = []
  const injected: string[] = []
  const registrations: Array<{ spec: Record<string, unknown>; render: unknown }> = []
  const registeredCommands: Array<Record<string, unknown>> = []
  const context = {
    effect(run: () => (() => void) | void, label?: string) {
      effects.push({ label, dispose: run() })
    },
    slots: {
      inject(key: string, callback: () => unknown) { injected.push(key); callback(); return () => {} },
      register(spec: Record<string, unknown>, render: unknown) { registrations.push({ spec, render }); return () => {} },
    },
    locale: {
      getSnapshot: () => ({ active: options.locale ?? 'zh-CN' }),
      subscribe: () => () => {},
      register: () => () => {},
    },
    layout: {},
    sidebarRight: options.sidebarRight ?? { isExpanded: () => false, toggleExpanded: vi.fn() },
    shortcuts: options.shortcuts ?? {
      catalog: { getSnapshot: () => [], subscribe: () => () => {} },
      register(command: Record<string, unknown>) { registeredCommands.push(command); return () => {} },
    },
  }
  apply(context as never)
  const disposeAll = () => { for (const effect of [...effects].reverse()) effect.dispose?.() }
  return {
    dom, effects, injected, registrations, registeredCommands, disposeAll,
    selectMode: (mode: SidebarLayoutMode) => {
      const injectFace = (registrations[0].spec.inject as () => { selectMode: (mode: SidebarLayoutMode) => void })()
      injectFace.selectMode(mode)
    },
    storeMode: () => dom.window.localStorage.getItem(STORAGE_KEY) ?? 'push',
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('sidebar layout client contract', () => {
  it('injects exactly the services it consumes', () => {
    expect([...inject]).toEqual(['slots', 'locale', 'layout', 'sidebarRight', 'shortcuts'])
  })

  it('keeps every referenced colour/radius token on the official whitelist', () => {
    const tokens = new Set<string>()
    for (const match of sidebarLayoutStyles.matchAll(/var\((--[\w-]+)/g)) tokens.add(match[1])
    const whitelist = new Set(OFFICIAL_THEME_TOKEN_NAMES)
    const offenders = [...tokens].filter(name => !whitelist.has(name) && !HOST_PUBLISHED_VARS.has(name))
    expect(offenders).toEqual([])
  })

  it('mounts one owned stylesheet and removes it with the effects', () => {
    const { dom, disposeAll } = mountClient()
    const style = dom.window.document.head.querySelector(`style[data-plugin="${PLUGIN_NAME}"]`)
    expect(style?.textContent).toContain("[data-dsh-sidebar-layout='swap']")
    disposeAll()
    expect(dom.window.document.head.querySelector(`style[data-plugin="${PLUGIN_NAME}"]`)).toBeNull()
  })
})

describe('sidebar layout frame locator', () => {
  it('tags the frame and its centre column with the current mode', () => {
    const { dom } = mountClient()
    const frame = dom.window.document.getElementById('frame')!
    const centre = dom.window.document.querySelector('.centre')!
    expect(frame.getAttribute(FRAME_ATTRIBUTE)).toBe('push')
    expect(centre.hasAttribute(CENTER_ATTRIBUTE)).toBe(true)
  })

  it('restores a persisted mode onto the frame attribute', () => {
    const { dom } = mountClient({ storage: { [STORAGE_KEY]: 'swap' } })
    expect(dom.window.document.getElementById('frame')!.getAttribute(FRAME_ATTRIBUTE)).toBe('swap')
  })

  it('updates the frame attribute when the mode changes', () => {
    const { dom, selectMode } = mountClient()
    const frame = dom.window.document.getElementById('frame')!
    selectMode('drawer')
    expect(frame.getAttribute(FRAME_ATTRIBUTE)).toBe('drawer')
  })

  it('retags a replaced frame', async () => {
    const { dom } = mountClient()
    const root = dom.window.document.getElementById('root')!
    const old = dom.window.document.getElementById('frame')!
    const next = old.cloneNode(true) as Element
    next.id = 'frame-2'
    old.replaceWith(next)
    // The MutationObserver delivery is asynchronous.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(next.getAttribute(FRAME_ATTRIBUTE)).toBe('push')
    expect(next.querySelector('.centre')!.hasAttribute(CENTER_ATTRIBUTE)).toBe(true)
    expect(root.contains(old)).toBe(false)
  })

  it('locates a frame that mounts after the effect', async () => {
    const { dom } = mountClient({ html: '<div id="root"></div>' })
    expect(dom.window.document.querySelector(`[${FRAME_ATTRIBUTE}]`)).toBeNull()
    const frame = dom.window.document.createElement('div')
    frame.innerHTML = '<div class="sidebar"></div><div class="centre"></div><div data-rightbar-col></div>'
    dom.window.document.getElementById('root')!.appendChild(frame)
    // The rAF retry picks up the late frame.
    await new Promise(resolve => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(frame.getAttribute(FRAME_ATTRIBUTE)).toBe('push')
  })

  it('removes attributes and stops on dispose', () => {
    const { dom, disposeAll, selectMode } = mountClient()
    const frame = dom.window.document.getElementById('frame')!
    const centre = dom.window.document.querySelector('.centre')!
    disposeAll()
    expect(frame.hasAttribute(FRAME_ATTRIBUTE)).toBe(false)
    expect(centre.hasAttribute(CENTER_ATTRIBUTE)).toBe(false)
    selectMode('drawer')
    expect(frame.hasAttribute(FRAME_ATTRIBUTE)).toBe(false)
  })
})

describe('drawer mask click', () => {
  function mountDrawer(options: { expanded?: boolean } = {}) {
    const toggle = vi.fn()
    const mounted = mountClient({
      sidebarRight: {
        isExpanded: () => options.expanded ?? true,
        toggleExpanded: toggle,
      },
    })
    mounted.selectMode('drawer')
    const centre = mounted.dom.window.document.querySelector('.centre')!
    return { toggle, centre, window: mounted.dom.window }
  }

  it('toggles the panel once when the mask itself is clicked while expanded', () => {
    const { toggle, centre, window } = mountDrawer()
    centre.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('does not toggle when a centre child is clicked', () => {
    const { toggle, centre, window } = mountDrawer()
    const child = centre.ownerDocument.createElement('button')
    centre.appendChild(child)
    child.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(toggle).not.toHaveBeenCalled()
  })

  it('does not toggle when the panel is collapsed', () => {
    const { toggle, centre, window } = mountDrawer({ expanded: false })
    // Selecting drawer already attempted the expansion; the mask click itself
    // must not toggle while the panel is closed.
    toggle.mockClear()
    centre.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(toggle).not.toHaveBeenCalled()
  })

  it('does not toggle in a non-drawer mode', () => {
    const toggle = vi.fn()
    const mounted = mountClient({ sidebarRight: { isExpanded: () => true, toggleExpanded: toggle } })
    const centre = mounted.dom.window.document.querySelector('.centre')!
    centre.dispatchEvent(new mounted.dom.window.MouseEvent('click', { bubbles: true }))
    expect(toggle).not.toHaveBeenCalled()
  })
})

describe('sidebar layout cycle command', () => {
  it('registers sidebar.layout.cycle and cycles the modes', () => {
    const toggle = vi.fn()
    const mounted = mountClient({ sidebarRight: { isExpanded: () => true, toggleExpanded: toggle } })
    expect(mounted.registeredCommands).toHaveLength(1)
    const command = mounted.registeredCommands[0] as unknown as {
      id: string
      defaults: Record<string, { code: string; modifiers: string[] }>
      regions: string[]
      modals: string[]
      resolve(context: unknown): { status: string; run(): void }
    }
    expect(command.id).toBe('sidebar.layout.cycle')
    expect(command.regions).toEqual(['page', 'editable', 'terminal'])
    expect(command.modals).toEqual([])
    // One triple-modifier default per admitted profile; web:linux admits no
    // three-modifier Web binding, so it stays unbound like the native commands.
    for (const profile of ['desktop:macos', 'desktop:windows', 'desktop:linux', 'web:macos', 'web:windows']) {
      expect(command.defaults[profile]).toEqual({ code: 'KeyB', modifiers: ['primary', 'alt', 'shift'] })
    }
    expect(command.defaults['web:linux']).toBeUndefined()
    const resolution = command.resolve({})
    expect(resolution.status).toBe('handled')
    resolution.run()
    expect(mounted.storeMode()).toBe('drawer')
    resolution.run()
    expect(mounted.storeMode()).toBe('swap')
    resolution.run()
    expect(mounted.storeMode()).toBe('push')
  })

  it('expands the panel when cycling into a non-push mode', () => {
    const toggle = vi.fn()
    const mounted = mountClient({ sidebarRight: { isExpanded: () => false, toggleExpanded: toggle } })
    const command = mounted.registeredCommands[0] as unknown as { resolve(context: unknown): { run(): void } }
    command.resolve({}).run()
    expect(mounted.storeMode()).toBe('drawer')
    expect(toggle).toHaveBeenCalledTimes(1)
    // Swap expands too (the double never reports expanded), and cycling back
    // to push leaves the panel alone.
    command.resolve({}).run()
    expect(toggle).toHaveBeenCalledTimes(2)
    command.resolve({}).run()
    expect(mounted.storeMode()).toBe('push')
    expect(toggle).toHaveBeenCalledTimes(2)
  })

  it('still cycles when isExpanded throws (no mounted session)', () => {
    const mounted = mountClient({
      sidebarRight: {
        isExpanded: () => { throw new Error('no session') },
        toggleExpanded: () => { throw new Error('no session') },
      },
    })
    const command = mounted.registeredCommands[0] as unknown as { resolve(context: unknown): { run(): void } }
    expect(() => command.resolve({}).run()).not.toThrow()
    expect(mounted.storeMode()).toBe('drawer')
  })
})

describe('sidebar layout slot registrations', () => {
  it('waits on the two seats and registers both entries', () => {
    const mounted = mountClient()
    expect(mounted.injected).toEqual(['conversation.session.header.utilities', 'settings.general.item'])
    expect(mounted.registrations).toHaveLength(2)
    const header = mounted.registrations[0]
    expect(header.spec).toMatchObject({
      name: 'conversation.session.header.utilities',
      id: 'sidebar-layout',
      order: 10,
      locale: 'dsh-sidebar-layout',
    })
    const settings = mounted.registrations[1]
    expect(settings.spec).toMatchObject({
      name: 'settings.general.item',
      id: 'sidebar-layout',
      order: 40,
      locale: 'dsh-sidebar-layout',
    })
    // Both entries inject the shared store and one selectMode action.
    for (const registration of mounted.registrations) {
      const face = (registration.spec.inject as () => Record<string, unknown>)()
      expect(typeof face.selectMode).toBe('function')
      expect((face.hooks as Record<string, unknown>).mode).toBeDefined()
    }
  })
})

describe('sidebar layout components', () => {
  const dict: Record<string, string> = {
    'trigger.label': '侧栏布局',
    'mode.push': '常规',
    'mode.drawer': '抽屉',
    'mode.swap': '正文',
    'settings.title': '侧栏布局',
    'settings.description': '右侧边栏的呈现方式。',
  }
  const t = (key: string) => dict[key] ?? key

  it('renders the settings row with title, description and a select', () => {
    const html = renderToStaticMarkup(
      <SidebarLayoutRow t={t} useMode={selector => selector('drawer')} selectMode={() => {}} />,
    )
    expect(html).toContain('sl-root sl-row')
    expect(html).toContain('侧栏布局')
    expect(html).toContain('dsh-ui-select')
    expect(html).toContain('常规')
    expect(html).toContain('抽屉')
    expect(html).toContain('正文')
    expect(html).toContain('value="drawer"')
  })

  it('renders the header trigger with the mode menu', () => {
    const html = renderToStaticMarkup(
      <SidebarLayoutAction t={t} useMode={selector => selector('push')} selectMode={() => {}} />,
    )
    expect(html).toContain('aria-label="侧栏布局"')
    expect(html).toContain('aria-haspopup="menu"')
  })
})
