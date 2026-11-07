import { Context } from '@deepseek-ai/cordis'
import { SlotCore, type StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it } from 'vitest'
import { SESSION_SETTINGS_ITEM_SLOT, SESSION_SETTINGS_SECTION_ID, SETTINGS_SECTION_ICON_SLOT } from './contracts.ts'
import { IconSessionSettings, registerSessionSettingsItem } from './client-utils.ts'

/*
 * The shared Session Management page lives or dies with its contributors
 * through the root-context service `dshSessionSettingsPage`. These tests run a
 * real Cordis `Context` (fibers, provide/get, effects) against a real
 * `SlotCore` (declarations, cell uniqueness, children cascade) instead of
 * stubs, because the failure modes this feature exists to prevent are exactly
 * the ones a stub cannot see: double ownership, unbalanced refcounts, stale
 * slot waits and leaked child declarations.
 */

interface SlotsLike {
  inject(key: string, callback: () => (() => void) | void): () => void
  register(spec: Record<string, unknown>, render: unknown): () => void
}

interface RootLike {
  get(name: string, strict?: boolean): unknown
  provide(name: string, value: unknown): () => void
  readonly slots?: SlotsLike
}

const SECTION = 'settings.section'
const PAGE_SERVICE = 'dshSessionSettingsPage'
const noop = () => null

/**
 * One application: a real root context plus a caller-bound `slots` service
 * built on `ctx.accessor`, so every context reads a slots face whose effects
 * register against the accessing fiber — the same ownership the runtime
 * service gives plugins, exercised against the real SlotCore ledger.
 */
function createApp(failures: { inject?: (key: string) => void } = {}) {
  const app = new Context()
  const core = new SlotCore()
  const slotsFor = (caller: Context): SlotsLike => ({
    inject(key, callback) {
      failures.inject?.(key)
      let cleanup: (() => void) | undefined
      const guarded = () => {
        cleanup?.()
        cleanup = undefined
        if (!core.specDynamic(key)) return
        const disposer = callback()
        cleanup = () => disposer?.()
      }
      const stopListening = core.subscribeDeclaration(key, guarded)
      let stopped = false
      const stop = () => {
        if (stopped) return
        stopped = true
        stopListening()
        cleanup?.()
      }
      try {
        guarded()
      } catch (error) {
        stop()
        throw error
      }
      caller.effect(() => stop)
      return stop
    },
    register(spec, render) {
      const unregister = core.register(spec, render)
      caller.effect(() => unregister)
      return unregister
    },
  })
  app.accessor('slots', {
    get() {
      return slotsFor(this as unknown as Context)
    },
  })
  return {
    app,
    core,
    /** The host declaring the settings.section seat (and reclaiming it). */
    declareSection(spec: Record<string, unknown> = { kind: 'list', scope: 'root' }) {
      return core.register({ name: 'root', children: { [SECTION]: spec } }, noop)
    },
    sections: () => core.entriesOfSlot(SECTION),
    items: () => core.entriesOfSlot(SESSION_SETTINGS_ITEM_SLOT),
    rawItems: () => core.entries(SESSION_SETTINGS_ITEM_SLOT),
    itemSpec: () => core.specDynamic(SESSION_SETTINGS_ITEM_SLOT),
    /** The host declaring the nav-icon seat, separately from the section list.
     * Same-name root declarations collide by priority, so a distinct priority
     * keeps this an independent declaration that can collapse on its own. */
    declareIconSeat(spec: Record<string, unknown> = { kind: 'list', scope: 'root' }, priority = 1) {
      return core.register({ name: 'root', priority, children: { [SETTINGS_SECTION_ICON_SLOT]: spec } }, noop)
    },
    icons: () => core.entriesOfSlot(SETTINGS_SECTION_ICON_SLOT),
    rawIcons: () => core.entries(SETTINGS_SECTION_ICON_SLOT),
    sectionSpec: () => core.specDynamic(SECTION),
    pageService: () => app.get(PAGE_SERVICE, false),
    async dispose() { await app.fiber.dispose() },
  }
}

type App = ReturnType<typeof createApp>

async function plugin(app: App, name: string, apply: (ctx: Context) => void) {
  const fiber = app.app.plugin({ name, apply })
  await fiber
  return fiber
}

const ids = (entries: readonly StoredEntry[]) => entries.map(entry => entry.options.id)

/**
 * A second copy of the contribution helper, standing in for another plugin's
 * separately bundled client-utils: nothing module-level is shared except the
 * string constants. If these two copies can coordinate, real bundles can.
 */
function registerSessionSettingsItemCopy(
  ctx: Context,
  item: { id: string; order: number },
  component: (props: never) => unknown,
): () => void {
  const slots = (ctx as unknown as { slots: SlotsLike }).slots
  const root = ctx.root as unknown as RootLike
  const acquire = (): { retain(): void; release(): void } => {
    const existing = root.get('dshSessionSettingsPage', false) as { retain(): void; release(): void } | undefined
    if (existing) return existing
    const rootSlots = root.slots as SlotsLike
    let users = 0
    let stopPage: (() => void) | undefined
    let unprovide: (() => void) | undefined
    const page = {
      retain() {
        users += 1
        if (!stopPage) {
          stopPage = rootSlots.inject(SECTION, () => rootSlots.register(
            {
              name: SECTION,
              id: 'session-manager',
              order: 30,
              label: () => 'Session Management',
              children: { 'dsh.session-settings.item': { kind: 'list', scope: 'root' } },
            },
            (props: { renderSlot: (key: string, owner: Record<string, never>) => unknown }) =>
              props.renderSlot('dsh.session-settings.item', {}),
          ))
        }
      },
      release() {
        if (users <= 0) return
        users -= 1
        if (users !== 0) return
        stopPage?.()
        stopPage = undefined
        unprovide?.()
      },
    }
    unprovide = root.provide('dshSessionSettingsPage', page)
    return page
  }
  const page = acquire()
  let stopItem: (() => void) | undefined
  let stopIcon: (() => void) | undefined
  try {
    page.retain()
    stopItem = slots.inject('dsh.session-settings.item', () => slots.register({ name: 'dsh.session-settings.item', ...item }, component))
    stopIcon = slots.inject('settings.section.icon', () => slots.register(
      { name: 'settings.section.icon', id: 'session-manager', order: item.order, priority: item.order },
      () => null,
    ))
  } catch (error) {
    stopIcon?.()
    stopItem?.()
    page.release()
    throw error
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    stopIcon?.()
    stopItem?.()
    page.release()
  }
}

describe('shared session settings page', () => {
  it('lets any single contributor yield the same one section, ordered rows and zh label', async () => {
    const app = createApp()
    try {
      const host = app.declareSection()
      const fiber = await plugin(app, 'delegation', ctx => {
        ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'delegation', order: 60 }, noop))
      })
      expect(ids(app.sections())).toEqual([SESSION_SETTINGS_SECTION_ID])
      expect(app.sections()[0]!.options.order).toBe(30)
      expect(app.itemSpec()).toMatchObject({ kind: 'list', scope: 'root' })
      expect(ids(app.items())).toEqual(['delegation'])
      // The label thunk follows the root locale.
      app.app.provide('locale', { getSnapshot: () => ({ active: 'zh-CN' }) })
      const label = app.sections()[0]!.options.label
      expect(typeof label === 'function' ? label() : label).toBe('会话管理')
      await fiber.dispose()
      expect(app.sections()).toEqual([])
      expect(app.itemSpec()).toBeUndefined()
      expect(app.pageService()).toBeUndefined()
      host()
    } finally {
      await app.dispose()
    }
  })

  it('lets contributors from separate bundles share one page in any order', async () => {
    const app = createApp()
    try {
      const host = app.declareSection()
      const first = await plugin(app, 'delegation', ctx => {
        ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'delegation', order: 60 }, noop))
      })
      const second = await plugin(app, 'current-title', ctx => {
        ctx.effect(() => registerSessionSettingsItemCopy(ctx, { id: 'current-title', order: 70 }, noop))
      })
      expect(app.sections()).toHaveLength(1)
      expect(ids(app.items())).toEqual(['delegation', 'current-title'])
      expect(app.items().map(entry => entry.options.order)).toEqual([60, 70])
      // The first contributor leaving keeps the page and the other row alive.
      await first.dispose()
      expect(app.sections()).toHaveLength(1)
      expect(ids(app.items())).toEqual(['current-title'])
      await second.dispose()
      expect(app.sections()).toEqual([])
      expect(app.itemSpec()).toBeUndefined()
      expect(app.pageService()).toBeUndefined()
      host()
    } finally {
      await app.dispose()
    }
  })

  it('lets a contributor re-establish the page immediately after the last release', async () => {
    const app = createApp()
    try {
      const host = app.declareSection()
      const first = await plugin(app, 'delegation', ctx => {
        ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'delegation', order: 60 }, noop))
      })
      await first.dispose()
      expect(app.pageService()).toBeUndefined()
      const second = await plugin(app, 'current-title', ctx => {
        ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'current-title', order: 70 }, noop))
      })
      expect(app.sections()).toHaveLength(1)
      expect(ids(app.items())).toEqual(['current-title'])
      await second.dispose()
      host()
    } finally {
      await app.dispose()
    }
  })

  it('keeps contributions independent and the disposer idempotent', async () => {
    const app = createApp()
    try {
      const host = app.declareSection()
      let firstDispose: (() => void) | undefined
      await plugin(app, 'delegation', ctx => {
        ctx.effect(() => { firstDispose = registerSessionSettingsItem(ctx, { id: 'delegation', order: 60 }, noop) })
      })
      const second = await plugin(app, 'current-title', ctx => {
        ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'current-title', order: 70 }, noop))
      })
      firstDispose!()
      firstDispose!() // a repeat call must not unbalance the shared refcount
      expect(ids(app.items())).toEqual(['current-title'])
      expect(app.sections()).toHaveLength(1)
      await second.dispose()
      expect(app.sections()).toEqual([])
      host()
    } finally {
      await app.dispose()
    }
  })

  it('waits for the section seat and cleans up when the seat collapses and returns', async () => {
    const app = createApp()
    try {
      // Contributors register while settings.section is still undeclared.
      const fiber = await plugin(app, 'delegation', ctx => {
        ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'delegation', order: 60 }, noop))
      })
      expect(app.sections()).toEqual([])
      expect(app.itemSpec()).toBeUndefined()
      const host = app.declareSection()
      expect(app.sections()).toHaveLength(1)
      expect(ids(app.items())).toEqual(['delegation'])
      // Losing the seat collapses the page and its child slot; the rows' stale
      // disposers become no-ops without disturbing the refcount.
      host()
      expect(app.sections()).toEqual([])
      expect(app.itemSpec()).toBeUndefined()
      app.declareSection()
      expect(app.sections()).toHaveLength(1)
      expect(ids(app.items())).toEqual(['delegation'])
      await fiber.dispose()
      expect(app.sections()).toEqual([])
      expect(app.itemSpec()).toBeUndefined()
    } finally {
      await app.dispose()
    }
  })

  it('isolates pages across two applications', async () => {
    const one = createApp()
    const two = createApp()
    try {
      const hostOne = one.declareSection()
      const hostTwo = two.declareSection()
      const fiberOne = await plugin(one, 'delegation', ctx => {
        ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'delegation', order: 60 }, noop))
      })
      await plugin(two, 'current-title', ctx => {
        ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'current-title', order: 70 }, noop))
      })
      expect(ids(one.items())).toEqual(['delegation'])
      expect(ids(two.items())).toEqual(['current-title'])
      await fiberOne.dispose()
      expect(one.sections()).toEqual([])
      expect(two.sections()).toHaveLength(1)
      hostOne()
      hostTwo()
    } finally {
      await one.dispose()
      await two.dispose()
    }
  })

  it('does not pin the page for a contribution whose row id collides', async () => {
    const app = createApp()
    try {
      const host = app.declareSection()
      await plugin(app, 'delegation', ctx => {
        ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'delegation', order: 60 }, noop))
      })
      // A second bundle trying to occupy the same row id throws synchronously
      // and must leave the existing row and the refcount untouched.
      await plugin(app, 'delegation-duplicate', ctx => {
        expect(() => registerSessionSettingsItemCopy(ctx, { id: 'delegation', order: 61 }, noop)).toThrow()
      })
      expect(ids(app.items())).toEqual(['delegation'])
      expect(app.items()[0]!.options.order).toBe(60)
      // The failed attempt left no share: once the original unloads, the page
      // and its child slot are gone and the root service is removed.
      await app.app.fiber.dispose()
      const fresh = createApp()
      try {
        const hostFresh = fresh.declareSection()
        const fiber = await plugin(fresh, 'delegation', ctx => {
          ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'delegation', order: 60 }, noop))
        })
        await fiber.dispose()
        expect(fresh.sections()).toEqual([])
        expect(fresh.pageService()).toBeUndefined()
        hostFresh()
      } finally {
        await fresh.dispose()
      }
      host()
    } finally {
      await app.dispose()
    }
  })

  it('leaves no service behind when installing the page itself fails', async () => {
    // The first inject the root slots face sees is the page's own section wait:
    // a synchronous failure there must release the reservation AND the provider.
    let injects = 0
    const app = createApp({ inject: key => { if (key === 'settings.section' && ++injects === 1) throw new Error('page install failed') } })
    try {
      app.declareSection()
      await plugin(app, 'broken', ctx => {
        expect(() => registerSessionSettingsItem(ctx, { id: 'broken', order: 1 }, noop)).toThrow('page install failed')
      })
      expect(app.sections()).toEqual([])
      expect(app.itemSpec()).toBeUndefined()
      expect(app.pageService()).toBeUndefined()
      // Once the install path works again a normal contribution builds the page.
      const fiber = await plugin(app, 'delegation', ctx => {
        ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'delegation', order: 60 }, noop))
      })
      expect(app.sections()).toHaveLength(1)
      expect(ids(app.items())).toEqual(['delegation'])
      await fiber.dispose()
      expect(app.sections()).toEqual([])
      expect(app.pageService()).toBeUndefined()
    } finally {
      await app.dispose()
    }
  })

  it('releases cleanly when a contributor fails while the child slot is declared', async () => {
    // The slots face throws on the fourth inject call (page wait + good row
    // wait + good icon wait succeed; the broken row wait fails before arming).
    let injects = 0
    const app = createApp({ inject: () => { if (++injects === 4) throw new Error('inject failed') } })
    try {
      const host = app.declareSection()
      const first = await plugin(app, 'delegation', ctx => {
        ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'delegation', order: 60 }, noop))
      })
      const broken = await plugin(app, 'broken', ctx => {
        expect(() => registerSessionSettingsItem(ctx, { id: 'broken', order: 1 }, noop)).toThrow('inject failed')
      })
      await broken.dispose()
      expect(ids(app.items())).toEqual(['delegation'])
      await first.dispose()
      expect(app.sections()).toEqual([])
      expect(app.pageService()).toBeUndefined()
      host()
    } finally {
      await app.dispose()
    }
  })

  it('lets contributors share one nav icon through independent waits', async () => {
    const app = createApp()
    try {
      app.declareSection()
      app.declareIconSeat()
      const first = await plugin(app, 'delegation', ctx => {
        ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'delegation', order: 60 }, noop))
      })
      const second = await plugin(app, 'current-title', ctx => {
        ctx.effect(() => registerSessionSettingsItemCopy(ctx, { id: 'current-title', order: 70 }, noop))
      })
      // Every contributor registers the same icon id under its own priority;
      // the ledger keeps both entries while the section renders one icon.
      const rawIcons = app.rawIcons()
      expect(rawIcons).toHaveLength(2)
      expect(rawIcons.map(entry => entry.options.id)).toEqual(['session-manager', 'session-manager'])
      expect(rawIcons.map(entry => entry.options.priority)).toEqual([60, 70])
      expect(ids(app.icons())).toEqual([SESSION_SETTINGS_SECTION_ID])
      // The winner (lowest priority value) is the real bubble icon component.
      const winner = app.icons()[0]!
      expect(winner.options.priority).toBe(60)
      expect(winner.component).toBe(IconSessionSettings)
      // Icon owner props are {size, active}: size sets the edge, active only
      // colors through currentColor and must not reach the markup.
      const element = (winner.component as (props: { size?: number; active?: boolean }) =>
        { type: string; props: Record<string, unknown> })({ size: 18, active: true })
      expect(element.type).toBe('svg')
      expect(element.props['aria-hidden']).toBe('true')
      expect(element.props.width).toBe(18)
      expect(element.props.stroke).toBe('currentColor')
      await first.dispose()
      // The remaining contributor keeps the icon under its own priority.
      expect(app.rawIcons()).toHaveLength(1)
      expect(app.rawIcons()[0]!.options.priority).toBe(70)
      await second.dispose()
      expect(app.rawIcons()).toHaveLength(0)
      // The page and row ledger stay unrelated to the icon seat.
      expect(app.sections()).toEqual([])
    } finally {
      await app.dispose()
    }
  })

  it('keeps the icon wait pending until the icon seat is declared and restores defaults on unload', async () => {
    const app = createApp()
    try {
      app.declareSection()
      const fiber = await plugin(app, 'delegation', ctx => {
        ctx.effect(() => registerSessionSettingsItem(ctx, { id: 'delegation', order: 60 }, noop))
      })
      // The icon seat is undeclared: the page and row exist, no icon yet.
      expect(app.sections()).toHaveLength(1)
      expect(ids(app.items())).toEqual(['delegation'])
      expect(app.rawIcons()).toHaveLength(0)
      const undeclare = app.declareIconSeat()
      expect(ids(app.icons())).toEqual([SESSION_SETTINGS_SECTION_ID])
      // Losing the icon seat retracts only the icon; the page stays.
      undeclare()
      expect(app.rawIcons()).toHaveLength(0)
      expect(app.sections()).toHaveLength(1)
      app.declareIconSeat()
      expect(app.rawIcons()).toHaveLength(1)
      await fiber.dispose()
      expect(app.rawIcons()).toHaveLength(0)
      expect(app.sections()).toEqual([])
    } finally {
      await app.dispose()
    }
  })
})
