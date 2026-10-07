import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkSearchSettings } from './client.tsx'
import { defaultSettings } from './contracts.ts'

// Real mount/poll/reconnect callbacks; no DOM or test-renderer package is needed.
const hooks = vi.hoisted(() => ({ cursor: 0, cells: [] as unknown[], effects: [] as (() => void | (() => void))[] }))
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>()
  return { ...actual,
    useState(initial: unknown) {
      const index = hooks.cursor++
      if (!(index in hooks.cells)) hooks.cells[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [hooks.cells[index], (value: unknown) => { hooks.cells[index] = typeof value === 'function' ? (value as (old: unknown) => unknown)(hooks.cells[index]) : value }]
    },
    useRef(initial: unknown) { const index = hooks.cursor++; if (!(index in hooks.cells)) hooks.cells[index] = { current: initial }; return hooks.cells[index] },
    useId: () => 'settings-test',
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    useCallback: (callback: unknown) => callback,
    useEffect(effect: () => void | (() => void)) { hooks.effects.push(effect) },
    useLayoutEffect(effect: () => void | (() => void)) { hooks.effects.push(effect) },
  }
})
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
const status = () => ({ settings: defaultSettings(), providers: [], searchActive: false, fetchActive: false, storageFailed: false })
function descendants(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as ReactElement<Record<string, unknown>>
  return [element, ...descendants(element.props.children)]
}
afterEach(() => { vi.useRealTimers(); hooks.cursor = 0; hooks.cells = []; hooks.effects = [] })

describe('network search background read recovery', () => {
  it('pauses status polling, retains limit drafts, and manually retries reads', async () => {
    vi.useFakeTimers(); let reconnect: (() => void) | undefined, failing = false
    const endpoints: string[] = []
    const client = { connection: { generation: { subscribe(fn: () => void) { reconnect = fn; return () => { reconnect = undefined } } },
      rpc: { async call(_channel: string, endpoint: string) {
        endpoints.push(endpoint)
        if (failing) throw new Error('transport failure for /web-search-manager/status: HTTP 503')
        return { ok: true, value: status() }
      } } }, locale: { getSnapshot: () => ({ active: 'en' }) } }
    const render = () => { hooks.cursor = 0; hooks.effects = []; return NetworkSearchSettings({ client: client as never }) }
    render(); const cleanup = hooks.effects.map(effect => effect()); await flush()
    const input = descendants(render()).find(element => element.props.value === '5' && element.props.onChange)!
    ;(input.props.onChange as (event: unknown) => void)({ target: { value: '8' } })
    failing = true; await vi.advanceTimersByTimeAsync(3000); await flush()
    // Nine scheduled ticks fit inside the fixed thirty-second cooldown.
    await vi.advanceTimersByTimeAsync(27_000); await flush()
    expect(endpoints).toEqual(['status', 'status'])
    const tree = descendants(render())
    expect(tree.some(element => element.props.value === '8')).toBe(true)
    const retry = tree.find(element => element.props.children === 'Reconnect')!
    failing = false; (retry.props.onClick as () => void)(); await flush()
    expect(endpoints).toEqual(['status', 'status', 'status'])
    expect(descendants(render()).some(element => element.props.value === '8')).toBe(true)
    reconnect?.(); await flush(); expect(endpoints).toHaveLength(4)
    cleanup.forEach(dispose => dispose?.()); expect(reconnect).toBeUndefined(); expect(vi.getTimerCount()).toBe(0)
  })

  it('starts a fresh read on reconnect even while an obsolete read is pending', async () => {
    vi.useFakeTimers(); let reconnect: (() => void) | undefined
    const pending: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = []
    const client = { connection: { generation: { subscribe(fn: () => void) { reconnect = fn; return () => {} } },
      rpc: { call() { return new Promise((resolve, reject) => pending.push({ resolve, reject })) } } } }
    NetworkSearchSettings({ client: client as never }); const cleanup = hooks.effects.map(effect => effect())
    reconnect?.(); expect(pending).toHaveLength(2)
    pending[1]!.resolve({ ok: true, value: status() }); await flush()
    pending[0]!.reject(new Error('transport failure for /web-search-manager/status: HTTP 404')); await flush()
    hooks.cursor = 0; hooks.effects = []
    const tree = descendants(NetworkSearchSettings({ client: client as never }))
    expect(tree.some(element => element.props.role === 'alert')).toBe(false)
    await vi.advanceTimersByTimeAsync(3000); expect(pending).toHaveLength(3)
    pending[2]!.resolve({ ok: true, value: status() }); await flush()
    cleanup.forEach(dispose => dispose?.())
  })
})
