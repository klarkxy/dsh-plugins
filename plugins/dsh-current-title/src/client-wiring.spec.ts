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

import { apply } from './client.tsx'
import { TITLE_CLIENT_SERVICE } from './contracts.ts'

it('mounts the changes service before subscribing, registers the settings seat and provides the marker', () => {
  wiring.calls.length = 0
  const provided: string[] = []
  const slotKeys: string[] = []
  apply({
    provide: (key: string) => { provided.push(key) },
    effect: (fn: () => unknown) => { fn() },
    inject: (_deps: string[], callback: (scope: unknown) => void) => callback({ remote: { $mount: async () => async () => {} }, effect() {} }),
    slots: { inject: (key: string) => { slotKeys.push(key); return () => {} } },
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
  } as never)
  // The subscriber must come after the mount it resolves through; the old
  // source-text indexOf assertion pinned the same order with a regex.
  expect(wiring.calls).toEqual(['mount', 'subscribe'])
  expect(slotKeys).toContain('plugins.bundle.config')
  expect(provided).toContain(TITLE_CLIENT_SERVICE)
})
