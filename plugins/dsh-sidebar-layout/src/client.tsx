import type { Context } from '@deepseek-ai/cordis'
import { Button, IconPanelLeftOutlineRegular, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { installClientPluginLogger } from '@klarkxy/dsh-plugin-kit/client-logger'
import { useId, useState } from 'react'
import {
  CENTER_ATTRIBUTE, FRAME_ATTRIBUTE, PLUGIN_NAME, STORAGE_KEY,
  createSidebarLayoutStore, nextMode,
  type SidebarLayoutMode, type SidebarLayoutStorage, type SidebarLayoutStore,
} from './contracts.ts'

export const name = 'dsh-sidebar-layout-client'
export const inject = ['slots', 'locale', 'layout', 'sidebarRight', 'shortcuts'] as const

const NS = 'dsh-sidebar-layout'
const ROOT_CLASS = 'sl-root'

const zh = {
  'trigger.label': '侧栏布局',
  'mode.push': '常规',
  'mode.drawer': '抽屉',
  'mode.swap': '正文',
  'settings.title': '侧栏布局',
  'settings.description': '右侧边栏的呈现方式：常规挤压对话，抽屉覆盖对话，正文将面板移入中间列、对话移到右侧。',
  'command.cycle': '切换侧栏布局',
} as const
const en: Record<keyof typeof zh, string> = {
  'trigger.label': 'Sidebar layout',
  'mode.push': 'Push',
  'mode.drawer': 'Drawer',
  'mode.swap': 'Body',
  'settings.title': 'Sidebar layout',
  'settings.description': 'How the right Sidebar presents: Push squeezes the conversation, Drawer overlays it, Body moves the panel into the centre column and the conversation to the right.',
  'command.cycle': 'Cycle sidebar layout',
}

/* Every rule is anchored on the frame attribute the locator writes (or, for
 * the header trigger and settings row, the plugin root class) — the
 * stylesheet scope guard and the token whitelist both read this sheet.
 * [data-rightbar-fullscreen] is excluded everywhere: fullscreen (including the
 * <768px auto-fullscreen) keeps native host behaviour in every mode. */
const layoutCss = `
/* Drawer: the conversation column spans the right track as well, so the
 * panel's open/close track animation never reflows it — the panel overlays.
 * The tag attribute, not a :has() selector, keeps this match stable while the
 * streaming chat mutates the subtree (better-sidebar documents the cost). */
[data-dsh-sidebar-layout='drawer']:not([data-rightbar-fullscreen]) [data-dsh-sidebar-layout-center] {
  grid-column: 2 / 4;
  position: relative;
  isolation: isolate;
}
[data-dsh-sidebar-layout='drawer']:not([data-rightbar-fullscreen]) [data-dsh-sidebar-layout-center]::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 90;
  background: var(--dsw-alias-bg-mask-1);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out);
}
[data-dsh-sidebar-layout='drawer']:not([data-rightbar-collapsed]):not([data-rightbar-fullscreen]) [data-dsh-sidebar-layout-center]::after {
  opacity: 1;
  pointer-events: auto;
}
/* A soft left edge keeps the overlay panel legible over the dimmed column:
 * overflow-clip-margin lets the shadow escape the panel's own right clip.
 * No filter or transform on the panel — either would break its fixed
 * floating windows. */
[data-dsh-sidebar-layout='drawer']:not([data-rightbar-collapsed]):not([data-rightbar-fullscreen]) [data-sidebar-right-panel] {
  overflow-clip-margin: 0px 0px 0px 24px;
  box-shadow: var(--dsw-elevation-soft);
}
@media (prefers-reduced-motion: reduce) {
  [data-dsh-sidebar-layout='drawer']:not([data-rightbar-fullscreen]) [data-dsh-sidebar-layout-center]::after { transition: none; }
}
/* Swap ("正文"): only while the panel is open — the collapsed state keeps the
 * native push geometry so closing lands back on host behaviour. The
 * conversation column becomes the right track and the panel column the
 * centre; the host's right-edge drag handle then resizes the conversation. */
[data-dsh-sidebar-layout='swap']:not([data-rightbar-collapsed]):not([data-rightbar-fullscreen]) {
  & [data-dsh-sidebar-layout-center] {
    grid-column: 3;
    border-left: 0.5px solid var(--dsw-alias-border-l3);
  }
  & [data-rightbar-col] {
    grid-column: 2;
  }
  /* The panel fills its column: host writes inline width + --dsh-sidebar-width,
   * both overridden so the body surface tracks the frame instead of the
   * stored drag width. */
  & [data-sidebar-right-panel] {
    width: 100% !important;
    --dsh-sidebar-width: 100% !important;
  }
  /* Track drags resize the panel instantly; the docked items' slide
   * transforms would lag a frame behind the pointer. */
  & [data-sidebar-right-panel] [data-dockkit-host='dock'],
  & [data-sidebar-right-panel] [data-dockkit-empty],
  & [data-sidebar-right-panel] [data-dockkit-divider] {
    transition: none;
  }
  /* Windows caption mode: the 16px content radius belongs to the body surface
   * — swap moves it from the conversation column to the panel's first pane,
   * mirroring the host's own fullscreen rule. */
  html[data-windows-titlebar] & [data-dockkit-column='0'][data-dockkit-pane] {
    border-radius: var(--dsh-windows-content-radius) 0 0 0;
    corner-shape: round;
  }
  html[data-windows-titlebar] & [data-dsh-sidebar-layout-center] {
    border-radius: 0;
  }
  /* macOS: the panel's first dock strip takes over the leading clearance the
   * conversation column held (traffic lights / shell.leading seat). */
  html[data-platform='darwin'] & [data-dockkit-host='dock'][data-dockkit-column='0'] {
    --dsh-dockkit-strip-inline-start: var(--dsh-frame-leading-clearance, 10px);
  }
  html[data-platform='darwin'] & [data-dsh-sidebar-layout-center] {
    --dsh-frame-leading-clearance: 0px;
  }
}
`

/* The settings row mirrors the native Settings → General item geometry (16px
 * padding, 0.5px l2 hairline, 14/22 title over a 12/18 description, a 240px
 * trailing control); the header trigger keeps the utilities strip's 28px
 * ghost-button shape. */
const rowCss = `
.sl-root.sl-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.sl-root .sl-row-text { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; padding-right: 40px; }
.sl-root .sl-row-title { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.sl-root .sl-row-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.sl-root .sl-row-control { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.sl-root .sl-select { flex: 0 1 240px; width: auto; }
.sl-root.sl-trigger { display: inline-flex; align-items: center; justify-content: center; padding: 0; line-height: 0; }
@media (max-width: 767px) {
  .sl-root .sl-row-text { padding-right: 16px; }
  .sl-root .sl-select { flex: 0 1 auto; width: 240px; max-width: 100%; }
}
`

/** One sheet: shared UI recipes under the plugin root class, the settings-row
 * geometry, then the frame-attribute layout rules. */
export const sidebarLayoutStyles = `${officialUiCss(ROOT_CLASS)}
` + rowCss + layoutCss

/** The client services the bundle declares. `layout` is injected for the
 * AppFrame contract (its DOM is the tagging target); nothing on its service
 * face is called. */
interface SidebarRightFace {
  isExpanded(): boolean
  toggleExpanded(): void
}
interface ShortcutCatalogEntryLike {
  readonly id: string
  readonly keys: readonly string[]
  readonly aria: string | undefined
}
interface ShortcutBindingLike {
  code: string
  modifiers: readonly string[]
}
type ShortcutResolutionLike = {
  status: 'handled'
  run(): void
} | {
  status: 'blocked'
  reason: string
} | {
  status: 'pass'
}
interface ShortcutCommandLike {
  id: string
  label: () => string
  aliases: readonly string[]
  defaults: Readonly<Partial<Record<string, ShortcutBindingLike>>>
  regions: readonly string[]
  modals: readonly string[]
  resolve(context: unknown): ShortcutResolutionLike
}
type Client = {
  locale: {
    getSnapshot(): { active: string }
    subscribe(fn: () => void): () => void
    register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: Record<string, unknown>, render: unknown): () => void
  }
  layout: unknown
  sidebarRight: SidebarRightFace
  shortcuts: {
    catalog: { getSnapshot(): readonly ShortcutCatalogEntryLike[]; subscribe(fn: () => void): () => void }
    register(command: ShortcutCommandLike): () => void
  }
}

function readStorage(): SidebarLayoutStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** Drawer and body modes show the panel, so choosing one while it is
 * collapsed expands it. `isExpanded`/`toggleExpanded` throw when no session
 * is mounted — the mode change must survive that. */
function ensureExpanded(client: Client): void {
  try {
    if (!client.sidebarRight.isExpanded()) client.sidebarRight.toggleExpanded()
  } catch {
    /* no mounted session surface: the mode still applies once one exists */
  }
}

/** Selector hook share produced by the slot framework from `inject.hooks`,
 * plus the action face the registrations hand down. */
interface InjectedProps {
  useMode?: <T>(selector: (mode: SidebarLayoutMode) => T) => T
  selectMode?: (mode: SidebarLayoutMode) => void
  t(key: string): string
}

/** The session-header utility: an icon button that opens the three-mode
 * primitives Menu, current mode checked. The shortcut catalog hook feeds the
 * tooltip's keycap and the menu row's visible binding. */
export function SidebarLayoutAction(props: InjectedProps & {
  useShortcuts?: <T>(selector: (entries: readonly ShortcutCatalogEntryLike[]) => T) => T
}) {
  const mode = props.useMode ? props.useMode(value => value) : 'push'
  const shortcut = props.useShortcuts?.(entries => entries.find(entry => entry.id === 'sidebar.layout.cycle'))
  const [open, setOpen] = useState(false)
  const { t } = props
  const items: MenuEntry[] = ['push', 'drawer', 'swap'].map(id => ({ id, label: t(`mode.${id}`) }))
  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      anchor={
        <Tooltip label={t('trigger.label')} shortcutKeys={shortcut?.keys} side="bottom" delayMs={500}>
          <Button
            variant="ghost"
            size="sm"
            icon={<IconPanelLeftOutlineRegular />}
            aria-label={t('trigger.label')}
            aria-keyshortcuts={shortcut?.aria}
            aria-haspopup="menu"
            aria-expanded={open}
            className={ROOT_CLASS}
            onClick={() => setOpen(value => !value)}
          />
        </Tooltip>
      }
      items={items}
      selectedId={mode}
      onSelect={id => { setOpen(false); props.selectMode?.(id as SidebarLayoutMode) }}
      align="end"
      side="bottom"
      portal
      listClassName={ROOT_CLASS}
    />
  )
}

/** The Settings → General row: own title and description on the left, a
 * native platform select (plugin-kit `dsh-ui-select`) on the trailing edge —
 * the same shape as the General column's own rows. */
export function SidebarLayoutRow(props: InjectedProps) {
  const mode = props.useMode ? props.useMode(value => value) : 'push'
  const labelId = useId()
  const { t } = props
  return (
    <div className={`${ROOT_CLASS} sl-row`} data-sidebar-layout-row>
      <div className="sl-row-text">
        <div className="sl-row-title" id={labelId}>{t('settings.title')}</div>
        <div className="sl-row-desc">{t('settings.description')}</div>
      </div>
      <div className="sl-row-control">
        <select
          className="dsh-ui-select sl-select"
          aria-labelledby={labelId}
          value={mode}
          onChange={event => props.selectMode?.(event.target.value as SidebarLayoutMode)}
        >
          {['push', 'drawer', 'swap'].map(id => (
            <option key={id} value={id}>{t(`mode.${id}`)}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function apply(ctx: Context): void {
  const logger = installClientPluginLogger(ctx, PLUGIN_NAME)
  const client = ctx as unknown as Client & { effect: Context['effect'] }
  const store = createSidebarLayoutStore(readStorage())
  /** Every entry point funnels here: store first, then the panel expansion
   * non-push modes need to be visible at all. */
  const selectMode = (mode: SidebarLayoutMode): void => {
    store.set(mode)
    if (mode !== 'push') ensureExpanded(client)
  }

  ctx.effect(() => client.locale.register(NS, { zh: { ...zh }, en: { ...en } }), 'sidebar-layout.locale')

  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', PLUGIN_NAME)
    style.textContent = sidebarLayoutStyles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'sidebar-layout.styles')

  /* Locate the host AppFrame once it mounts and tag it plus its centre
   * column; the frame is `grid sidebar|center|rightbar`, so the centre is the
   * rightbar column's previous sibling — a structural/data-attribute anchor,
   * never a positional path. Retries ride rAF until the frame exists, a
   * MutationObserver on the frame's own parent catches the host replacing the
   * frame element, and disposal removes every tag and listener. */
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    let frame: Element | null = null
    let centre: Element | null = null
    let observer: MutationObserver | undefined
    let raf: number | undefined
    let disposed = false
    const schedule = (callback: () => void) => {
      const request = globalThis.requestAnimationFrame ?? ((fn: () => void) => setTimeout(fn, 16) as unknown as number)
      return request(callback)
    }
    const cancel = (handle: number) => {
      const release = globalThis.cancelAnimationFrame ?? clearTimeout
      release(handle)
    }
    const applyMode = () => {
      frame?.setAttribute(FRAME_ATTRIBUTE, store.get())
    }
    /* The drawer's dim mask is a ::after on the centre column; a click that
     * lands on it reports the column element itself as target, while any real
     * descendant reports the descendant — exactly the click-should-close
     * boundary. */
    const onClick = (event: Event) => {
      if (centre === null || event.target !== centre) return
      if (store.get() !== 'drawer') return
      try {
        if (client.sidebarRight.isExpanded()) client.sidebarRight.toggleExpanded()
      } catch (error) {
        logger.debug('drawer.mask-toggle-failed', 'Could not toggle the right panel from the drawer mask.', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const untag = () => {
      centre?.removeEventListener('click', onClick)
      centre?.removeAttribute(CENTER_ATTRIBUTE)
      frame?.removeAttribute(FRAME_ATTRIBUTE)
      centre = null
      frame = null
    }
    const watchParent = () => {
      observer?.disconnect()
      observer = undefined
      const parent = frame?.parentElement ?? null
      if (parent === null) return
      observer = new MutationObserver(() => ensureLocated())
      observer.observe(parent, { childList: true })
    }
    const locate = (): boolean => {
      const rightbar = document.querySelector('[data-rightbar-col]')
      const nextFrame = rightbar?.parentElement ?? null
      const nextCentre = rightbar?.previousElementSibling ?? null
      if (nextFrame !== null && nextCentre !== null && nextFrame === frame && nextCentre === centre) return true
      untag()
      if (nextFrame === null || nextCentre === null) return false
      frame = nextFrame
      centre = nextCentre
      centre.setAttribute(CENTER_ATTRIBUTE, '')
      centre.addEventListener('click', onClick)
      applyMode()
      watchParent()
      return true
    }
    const ensureLocated = () => {
      if (disposed) return
      if (!locate()) raf = schedule(ensureLocated)
    }
    const unsubscribe = store.subscribe(applyMode)
    ensureLocated()
    return () => {
      disposed = true
      unsubscribe()
      observer?.disconnect()
      if (raf !== undefined) cancel(raf)
      untag()
    }
  }, 'sidebar-layout.frame')

  // The session-scoped utilities strip: the panel's own tab chrome has no
  // extension seat, so the header is where the switcher lives. Session inject
  // args are unused — the mode is global, not per session.
  ctx.effect(() => client.slots.inject('conversation.session.header.utilities', () => client.slots.register(
    {
      name: 'conversation.session.header.utilities',
      id: 'sidebar-layout',
      order: 10,
      locale: NS,
      inject: () => ({
        hooks: { mode: store, shortcuts: client.shortcuts.catalog },
        selectMode,
      }),
    },
    SidebarLayoutAction,
  )), 'sidebar-layout.header')

  // A merged-group General row: no own page, the component renders its own
  // title and description inside the native column's geometry.
  ctx.effect(() => client.slots.inject('settings.general.item', () => client.slots.register(
    {
      name: 'settings.general.item',
      id: 'sidebar-layout',
      order: 40,
      locale: NS,
      inject: () => ({ hooks: { mode: store }, selectMode }),
    },
    SidebarLayoutRow,
  )), 'sidebar-layout.settings')

  /* Ctrl/Cmd+Alt+Shift+B cycles push → drawer → swap → push. The registry
   * checks every runtime/platform profile: the binding overlaps none of the
   * host's KeyB commands (sidebar.right.toggle is primary+alt / primary+shift,
   * the layout toggle is primary), and three modifiers are the admitted
   * desktop + web macOS/windows combination. web:linux stays unbound —
   * that profile admits only primary+Slash, primary+shift+Comma and
   * primary+shift+Period, so no default survives registration there. A
   * conflict is a loud log, not a silent rebind. */
  ctx.effect(() => {
    try {
      return client.shortcuts.register({
        id: 'sidebar.layout.cycle',
        label: () => (client.locale.getSnapshot().active.toLowerCase().startsWith('zh') ? zh['command.cycle'] : en['command.cycle']),
        aliases: ['sidebar layout', 'cycle sidebar layout', '侧栏布局'],
        defaults: {
          'desktop:macos': { code: 'KeyB', modifiers: ['primary', 'alt', 'shift'] },
          'desktop:windows': { code: 'KeyB', modifiers: ['primary', 'alt', 'shift'] },
          'desktop:linux': { code: 'KeyB', modifiers: ['primary', 'alt', 'shift'] },
          'web:macos': { code: 'KeyB', modifiers: ['primary', 'alt', 'shift'] },
          'web:windows': { code: 'KeyB', modifiers: ['primary', 'alt', 'shift'] },
        },
        regions: ['page', 'editable', 'terminal'],
        modals: [],
        resolve: () => ({ status: 'handled', run: () => selectMode(nextMode(store.get())) }),
      })
    } catch (error) {
      logger.warn('shortcut.register-failed', 'Could not register the sidebar-layout cycle command; its default binding was rejected by the host registry.', error)
      return () => {}
    }
  }, 'sidebar-layout.shortcut')
}
