import { describe, expect, it } from 'vitest'
import { MODEL_CENTER_PLUGIN, MODEL_SETTINGS_SLOT } from './contracts.ts'
import {
  COPY, PLUGIN_SETTINGS_SLOT, isHostEnabledStatus, pluginSettingsSlotSpec, readHostEnabled,
  registerPluginSettings, tabLabel, tablistKey, unwrapRpc, type SlotHandle, type SlotSpec,
} from './client-view.ts'

function slotsMock(initial: string[]) {
  const declared = new Set(initial)
  const injected: string[] = []
  const registered: SlotSpec[] = []
  const listeners = new Map<string, Set<{ attach(): void; detach(): void }>>()
  const slots: SlotHandle & {
    injected: string[]; registered: SlotSpec[]; declare(key: string): void; undeclare(key: string): void
  } = {
    injected, registered,
    inject(key, callback) {
      injected.push(key)
      let cleanup: (() => void) | undefined
      const listener = {
        attach() { cleanup ??= callback() as () => void },
        detach() { cleanup?.(); cleanup = undefined },
      }
      const set = listeners.get(key) ?? new Set()
      listeners.set(key, set)
      set.add(listener)
      if (declared.has(key)) listener.attach()
      return () => { listener.detach(); set.delete(listener) }
    },
    register(spec) {
      registered.push(spec)
      return () => {
        const index = registered.indexOf(spec)
        if (index >= 0) registered.splice(index, 1)
      }
    },
    declare(key) {
      declared.add(key)
      for (const listener of listeners.get(key) ?? []) listener.attach()
    },
    undeclare(key) {
      declared.delete(key)
      for (const listener of listeners.get(key) ?? []) listener.detach()
    },
  }
  return slots
}

describe('client view helpers', () => {
  it('only attaches when host status is enabled', () => {
    expect(isHostEnabledStatus({ ok: true, value: { enabled: true, plugin: MODEL_CENTER_PLUGIN } })).toBe(true)
    expect(isHostEnabledStatus({ ok: true, value: { enabled: false, plugin: MODEL_CENTER_PLUGIN } })).toBe(false)
    expect(isHostEnabledStatus({ ok: false, error: { code: 'x', message: 'no' } })).toBe(false)
  })

  it('moves through 模型配置 / 运行设置 / 供应商', () => {
    expect(tabLabel('providers', 'zh')).toBe('供应商')
    expect(tabLabel('runtime', 'zh')).toBe('运行设置')
    expect(tabLabel('policy', 'zh')).toBe('模型配置')
    expect(tablistKey('policy', 'ArrowRight')).toBe('runtime')
    expect(tablistKey('runtime', 'ArrowRight')).toBe('providers')
    expect(tablistKey('policy', 'ArrowLeft')).toBe('providers')
    expect(tablistKey('providers', 'Home')).toBe('policy')
    expect(COPY.zh.nativeHint).toBe('凭据请在原生设置中编辑。')
    expect(COPY.zh.noPurposes).toBe('没有其他功能需要单独配置。')
  })

  it('registers by package name only, even when old settings seats exist', () => {
    const slots = slotsMock([PLUGIN_SETTINGS_SLOT, MODEL_SETTINGS_SLOT, 'settings.section'])
    registerPluginSettings(slots, () => null)
    expect(slots.injected).toEqual([PLUGIN_SETTINGS_SLOT])
    expect(slots.registered).toEqual([{ name: PLUGIN_SETTINGS_SLOT, key: MODEL_CENTER_PLUGIN }])
    expect(pluginSettingsSlotSpec()).toEqual(slots.registered[0])
  })

  it('waits for the plugin page without falling back to Settings', () => {
    const slots = slotsMock([MODEL_SETTINGS_SLOT, 'settings.section'])
    registerPluginSettings(slots, () => null)
    expect(slots.registered).toEqual([])
    slots.declare(PLUGIN_SETTINGS_SLOT)
    expect(slots.registered).toEqual([pluginSettingsSlotSpec()])
  })

  it('retracts and reattaches exactly once across page redeclaration and unload', () => {
    const slots = slotsMock([PLUGIN_SETTINGS_SLOT])
    const dispose = registerPluginSettings(slots, () => null)
    slots.undeclare(PLUGIN_SETTINGS_SLOT)
    expect(slots.registered).toEqual([])
    slots.declare(PLUGIN_SETTINGS_SLOT)
    slots.declare(PLUGIN_SETTINGS_SLOT)
    expect(slots.registered).toEqual([pluginSettingsSlotSpec()])
    dispose()
    dispose()
    slots.declare(PLUGIN_SETTINGS_SLOT)
    expect(slots.registered).toEqual([])
  })

  it('cancels a pending registration when the plugin unloads first', () => {
    const slots = slotsMock([])
    registerPluginSettings(slots, () => null)()
    slots.declare(PLUGIN_SETTINGS_SLOT)
    expect(slots.registered).toEqual([])
  })

  it('unwraps RpcResult and reads host enabled over the status endpoint', async () => {
    expect(unwrapRpc({ ok: true, value: 1 })).toBe(1)
    expect(() => unwrapRpc({ ok: false, error: { code: 'x', message: '失败' } })).toThrow('失败')
    const calls: string[] = []
    expect(await readHostEnabled(async (channel, endpoint) => {
      calls.push(`${channel}:${endpoint}`)
      return { ok: true, value: { enabled: true } }
    })).toBe(true)
    expect(calls[0]).toBe('/dsh-model-center:status')
  })
})
