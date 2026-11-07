import { expect, it, vi } from 'vitest'

const wiring = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('@klarkxy/dsh-plugin-kit/model-settings-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@klarkxy/dsh-plugin-kit/model-settings-client')>()
  return {
    ...original,
    mountModelSettingsChanges: () => { wiring.calls.push('mount') },
    createModelSettingsSubscriber: () => { wiring.calls.push('subscribe'); return { subscribe: () => () => {} } },
  }
})

import { SESSION_SETTINGS_ITEM_SLOT } from '@klarkxy/dsh-plugin-kit/contracts'
import { apply } from './client.tsx'
import { TITLE_CLIENT_SERVICE } from './contracts.ts'

it('mounts the changes service before subscribing, registers the settings seat and provides the marker', () => {
  wiring.calls.length = 0
  const provided: string[] = []
  const slotKeys: string[] = []
  const services = new Map<string, unknown>()
  const rootCtx = {
    provide: (key: string) => { provided.push(key) },
    effect: (fn: () => unknown) => { fn() },
    inject: (_deps: string[], callback: (scope: unknown) => void) => callback({ remote: { $mount: async () => async () => {} }, effect() {} }),
    slots: { inject: (key: string) => { slotKeys.push(key); return () => {} } },
    // The shared page and card services rendezvous through root provide/get,
    // and Cordis's root returns itself from `.root` — the fake mirrors both.
    root: {
      slots: { inject: (key: string) => { slotKeys.push(`root:${key}`); return () => {} } },
      get: (name: string) => services.get(name),
      provide: (name: string, value: unknown) => {
        services.set(name, value)
        return () => { if (services.get(name) === value) services.delete(name) }
      },
      // mountModelSettingsChanges on the shared card resolves 'remote' lazily.
      inject: () => ({ dispose() {} }),
      root: undefined as unknown,
    },
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
  }
  // Cordis's root context returns itself from `.root`; the fake mirrors that
  // so root-owned services can be handed the root context directly.
  rootCtx.root.root = rootCtx.root
  apply(rootCtx as never)
  // The subscriber must come after the mount it resolves through; the old
  // source-text indexOf assertion pinned the same order with a regex. The
  // shared auxiliary card adds its own subscriber but its watch mount is its
  // internal business, so only our mount-then-subscribe ordering is pinned.
  expect(wiring.calls.slice(0, 2)).toEqual(['mount', 'subscribe'])
  expect(wiring.calls.filter(call => call === 'subscribe')).toHaveLength(2)
  // The row waits on the shared child slot; the shared page service waits on
  // the section seat through the root-bound slots face. The auxiliary card
  // joined the same column — its root-side waits add the item slot and the
  // nav-icon seat a second time, and the old models-footer seat is gone.
  expect(slotKeys).toContain(SESSION_SETTINGS_ITEM_SLOT)
  expect(slotKeys).toContain('root:settings.section')
  expect(slotKeys).toContain(`root:${SESSION_SETTINGS_ITEM_SLOT}`)
  expect(slotKeys).not.toContain('settings.general.item')
  expect(slotKeys).not.toContain('settings.models.footer')
  expect(slotKeys).not.toContain('root:settings.models.footer')
  expect(provided).toContain(TITLE_CLIENT_SERVICE)
})
