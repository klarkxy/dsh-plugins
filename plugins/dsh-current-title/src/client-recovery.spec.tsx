import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TitleSettings } from './client.tsx'
import { createTitleClientMarker } from './marker.ts'

// Exercise the component's real refresh and generation callbacks without a DOM dependency.
const hooks = vi.hoisted(() => ({ cursor: 0, cells: [] as unknown[], effects: [] as (() => void | (() => void))[], refresh: () => {} }))
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>()
  return { ...actual,
    useState(initial: unknown) {
      const index = hooks.cursor++
      if (!(index in hooks.cells)) hooks.cells[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [hooks.cells[index], (value: unknown) => { hooks.cells[index] = typeof value === 'function' ? (value as (old: unknown) => unknown)(hooks.cells[index]) : value }]
    },
    useRef(initial: unknown) { const index = hooks.cursor++; if (!(index in hooks.cells)) hooks.cells[index] = { current: initial }; return hooks.cells[index] },
    useCallback(callback: unknown) { return callback },
    useMemo(compute: () => unknown) { return compute() },
    useEffect(effect: () => void | (() => void)) { hooks.effects.push(effect) },
  }
})
vi.mock('@klarkxy/dsh-plugin-kit/client-utils', async original => ({
  ...await original<typeof import('@klarkxy/dsh-plugin-kit/client-utils')>(),
  useNativeSeat: () => ({ sessionId: 'session', locale: 'en', hidden: false }),
  useFeatureRefresh: (_client: unknown, _session: string, refresh: () => void) => { hooks.refresh = refresh },
}))
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }
const status = { settings: { revision: 1, prompt: 'saved', model: { provider: '', model: '' } }, support: { weOwn: true }, session: { title: 'Recovered title' } }
function descendants(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as ReactElement<Record<string, unknown>>
  return [element, ...descendants(element.props.children)]
}
afterEach(() => { hooks.cursor = 0; hooks.cells = []; hooks.effects = []; hooks.refresh = () => {} })

describe('title background read recovery', () => {
  it('keeps a legacy saved model selectable without offering or writing reasoning effort', async () => {
    const saved = { ...status, settings: { ...status.settings,
      model: { provider: 'legacy', model: 'saved-model', reasoningEffort: 'high' }, cadence: 'all-prompts' } }
    const writes: Record<string, unknown>[] = []
    const client = {
      remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [{
        id: 'available', name: 'Available provider', models: [{ id: 'new-model', name: 'New model',
          reasoning: { efforts: [{ id: 'high', name: 'High' }] } }],
      }] } }) } },
      connection: { rpc: { async call(_channel: string, endpoint: string, payload: Record<string, unknown>) {
        if (endpoint === 'settings') { writes.push(payload); return { ok: true, value: { ...saved.settings, ...payload } } }
        return { ok: true, value: saved }
      } } },
    }
    const marker = createTitleClientMarker()
    const render = () => { hooks.cursor = 0; hooks.effects = []; return TitleSettings({ client: client as never, marker }) }
    render(); const cleanup = hooks.effects.map(effect => effect()); await flush()
    // Binding the restored route is derived without fetching the catalog again.
    let tree = descendants(render())
    const cadence = tree.find(element => element.type === 'select')!
    const menu = tree.find(element => element.props.choices !== undefined)!
    expect(menu.props.modelValue).toBe('legacy / saved-model')
    expect((menu.props.choices as Array<{ label: string }>).map(choice => choice.label))
      .toEqual(['Available provider / New model', 'legacy / saved-model'])
    expect((menu.props.leading as Array<{ label: string; selected?: boolean }>).map(item => [item.label, item.selected === true]))
      .toEqual([['Use the session model', false]])
    expect((menu.props.efforts as Array<{ id: string }>).map(effort => effort.id)).toEqual(['high'])
    expect(tree.some(element => element.type === 'select' && descendants(element).some(child => child.props.children === 'Reasoning effort'))).toBe(false)
    // An unrelated edit leaves the legacy route under server ownership.
    ;(cadence.props.onChange as (event: unknown) => void)({ target: { value: 'first-prompt' } })
    await flush()
    expect(writes[0]).toEqual({ cadence: 'first-prompt', expectedRevision: 1 })
    tree = descendants(render())
    ;(tree.find(element => element.props.onPick !== undefined)!.props.onPick as (route: unknown) => void)({ provider: 'available', model: 'new-model' })
    await flush()
    expect(writes[1]).toEqual({ model: { provider: 'available', model: 'new-model' }, expectedRevision: 1 })
    cleanup.forEach(dispose => dispose?.())
  })

  it('suppresses repeated callbacks, preserves an edited prompt, and offers a read-only manual retry', async () => {
    let reads = 0, reconnect: (() => void) | undefined, failing = false
    const endpoints: string[] = []
    const client = { connection: { generation: { subscribe(fn: () => void) { reconnect = fn; return () => { reconnect = undefined } } },
      rpc: { async call(_channel: string, endpoint: string) {
        endpoints.push(endpoint); reads++
        if (failing) throw new Error('transport failure for /title/status: HTTP 503')
        return { ok: true, value: status }
      } } } }
    const marker = createTitleClientMarker()
    const render = () => { hooks.cursor = 0; hooks.effects = []; return TitleSettings({ client: client as never, marker }) }
    render(); const cleanup = hooks.effects.map(effect => effect()); await flush()
    const prompt = descendants(render()).find(element => element.type === 'textarea')!
    ;(prompt.props.onChange as (event: unknown) => void)({ target: { value: 'my draft' } })
    failing = true; hooks.refresh(); await flush()
    for (let index = 0; index < 100; index++) hooks.refresh()
    await flush(); expect(reads).toBe(2); expect(marker.active).toBe(true)
    const tree = descendants(render())
    expect(tree.find(element => element.type === 'textarea')?.props.value).toBe('my draft')
    const retry = tree.find(element => element.props.children === 'Retry')!
    failing = false; (retry.props.onClick as () => void)(); await flush()
    expect(reads).toBe(3); expect(endpoints).toEqual(['status', 'status', 'status'])
    reconnect?.(); hooks.refresh(); await flush(); expect(reads).toBe(4)
    cleanup.forEach(dispose => dispose?.()); expect(reconnect).toBeUndefined()
  })

  it('ignores the old read failure after reconnect recovers', async () => {
    let reconnect: (() => void) | undefined
    const pending: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = []
    const client = { connection: { generation: { subscribe(fn: () => void) { reconnect = fn; return () => {} } },
      rpc: { call() { return new Promise((resolve, reject) => pending.push({ resolve, reject })) } } } }
    const marker = createTitleClientMarker()
    TitleSettings({ client: client as never, marker }); const cleanup = hooks.effects.map(effect => effect())
    reconnect?.(); hooks.refresh()
    pending[1]!.resolve({ ok: true, value: status }); await flush()
    pending[0]!.reject(new Error('transport failure for /title/status: HTTP 404')); await flush()
    expect(hooks.cells[0]).toEqual(status); expect(hooks.cells[3]).toBe(''); expect(marker.active).toBe(true)
    hooks.refresh(); expect(pending).toHaveLength(3)
    pending[2]!.resolve({ ok: true, value: status }); await flush()
    cleanup.forEach(dispose => dispose?.())
  })
})
