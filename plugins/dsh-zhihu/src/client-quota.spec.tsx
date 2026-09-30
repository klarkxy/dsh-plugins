import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ZHIHU_RPC_CHANNEL } from './contracts.ts'
import { createZhihuClientState } from './client-state.ts'
import { requestOpenPlatform } from './client-open-platform.tsx'
import { projectQuota, quotaMetric, quotaNumericValue, QuotaCharts, ZhihuQuotaSection } from './client-quota.tsx'

// No DOM/test-renderer dependency is installed. This focused hook harness executes
// the real component's mount/cleanup/request callbacks, not a simulated browser DOM.
const hooks = vi.hoisted(() => ({ enabled: false, cursor: 0, cells: [] as unknown[], effects: [] as (() => void | (() => void))[] }))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual,
    useState(initial: unknown) {
      if (!hooks.enabled) return actual.useState(initial)
      const index = hooks.cursor++
      if (!(index in hooks.cells)) hooks.cells[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [hooks.cells[index], (next: unknown) => { hooks.cells[index] = typeof next === 'function' ? (next as (old: unknown) => unknown)(hooks.cells[index]) : next }]
    },
    useRef(initial: unknown) {
      if (!hooks.enabled) return actual.useRef(initial)
      const index = hooks.cursor++
      if (!(index in hooks.cells)) hooks.cells[index] = { current: initial }
      return hooks.cells[index]
    },
    useCallback(callback: () => unknown, deps: unknown[]) { return hooks.enabled ? callback : actual.useCallback(callback, deps) },
    // Outside a render there is no provider; the harness reads the default (zh).
    useContext(context: import('react').Context<unknown>) { return hooks.enabled ? 'zh' : actual.useContext(context) },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      if (hooks.enabled) hooks.effects.push(effect)
      else actual.useEffect(effect, deps)
    },
  }
})
const response = (data: unknown) => ({ ok: true, value: { version: 1, operation: 'quota', data } })
const deferred = () => {
  let resolve!: (raw: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

describe('official quota conservative projection', () => {
  it('supports the verified RemainingQuota fixture without inventing used or total', () => {
    const projection = projectQuota({ Items: [{ APIID: 'creator', RemainingQuota: '12' }, { APIID: 'user_data', RemainingQuota: 0 }] })
    expect(projection.fields).toEqual(['RemainingQuota'])
    expect(projection.categories[0].metrics).toEqual([{ field: 'RemainingQuota', label: '剩余额度（RemainingQuota）', text: '12', value: 12 }])
    expect(projection.categories[1].metrics[0].value).toBe(0)
    const html = renderToStaticMarkup(<QuotaCharts data={{ Items: [{ APIID: 'creator', RemainingQuota: 12 }] }} />)
    expect(html).toContain('<svg')
    expect(html).toContain('剩余额度（RemainingQuota）')
    expect(html).not.toContain('已用额度（UsedQuota）')
    expect(html).not.toContain('总额度（TotalQuota）')
    expect(html).not.toContain('<pre')
  })
  it('supports keyed rows and each explicit metric with independent scale; no sums or balances', () => {
    const data = { creator: { RemainingQuota: '0.50', UsedQuota: 5, LifetimeCalls: 900 }, user_data: { TotalQuota: 100, UsedQuota: 10 } }
    const projection = projectQuota(data)
    expect(projection.categories.map(category => category.id)).toEqual(['creator', 'user_data'])
    expect(projection.categories[0].metrics[0].text).toBe('0.50')
    expect(projection.fields).toEqual(['RemainingQuota', 'UsedQuota', 'LifetimeCalls', 'TotalQuota'])
    const html = renderToStaticMarkup(<QuotaCharts data={data} />)
    expect(html).toContain('LifetimeCalls')
    expect(html).toContain('条长不表示额度占比')
    expect(html).toContain('如何阅读') // aggregation/period caveats are folded behind this row
    expect(html).toContain('此字段刻度：0–10')
    expect(html).toContain('width="120"') // UsedQuota 5/10, not 5/100 or aggregate.
    expect(html).toContain('不可用') // Missing fields are not zero.
    // Bar colour is the host's, through the stylesheet: an inline literal fill
    // here would pin one theme and shadow the token.
    expect(html).not.toMatch(/<rect[^>]*\sfill=/)
    expect(projectQuota({ Items: { creator: { RemainingQuota: 2 } } }).categories[0].id).toBe('creator')
  })
  it.each([null, undefined, false, true, '', ' ', '1e3', '0x10', 'NaN', 'Infinity', Infinity, NaN, -1, '-1', {}, [], Number.MAX_SAFE_INTEGER + 1, '9007199254740992', '9007199254740991.1'])('does not coerce unsafe or missing %s into a bar', value => {
    expect(quotaNumericValue(value)).toBeNull()
  })
  it.each([0, 1.5, Number.MAX_SAFE_INTEGER, '0', '000.50', ' 12.25 '])('accepts finite nonnegative decimal %s', value => {
    expect(quotaNumericValue(value)).toBe(Number(value))
  })
  it('preserves negative/unlimited markers as text, never as bars', () => {
    expect(quotaMetric('RemainingQuota', -1)).toMatchObject({ value: null, text: '-1（原始标记，不绘图）' })
    const html = renderToStaticMarkup(<QuotaCharts data={{ Items: [{ APIID: 'creator', RemainingQuota: '-1' }, { APIID: 'user_data', RemainingQuota: 'unlimited' }] }} />)
    expect(html).toContain('unlimited（原始标记，不绘图）')
    /* The fold-out icon is also an svg; what must be absent is the bar chart itself. */
    expect(html).not.toContain('zhihu-quota-bar')
    expect(quotaMetric('RemainingQuota', null).text).toBe('不可用')
  })
  it('reports unknown structures readably without dumping JSON or unsafe markup', () => {
    for (const data of [null, {}, { Items: [] }, { unexpected: ['secret'] }, { Items: [{ APIID: 'creator' }] }]) {
      const html = renderToStaticMarkup(<QuotaCharts data={data} />)
      expect(html).toContain('不可用')
      expect(html).not.toContain('secret')
      expect(html).not.toContain('<pre')
    }
    const html = renderToStaticMarkup(<QuotaCharts data={{ Items: [{ APIID: '<script>alert(1)</script>', RemainingQuota: 0 }] }} />)
    expect(html).not.toContain('<script>')
    expect(html).toContain('width="0"')
  })
})

describe('quota initial SSR and host controls', () => {
  it('does not request during SSR; explains auto load and separates local counters', () => {
    const call = vi.fn()
    const html = renderToStaticMarkup(<ZhihuQuotaSection rpc={{ call }} />)
    expect(call).not.toHaveBeenCalled()
    expect(html).toContain('打开此页时自动查询')
    expect(html).toContain('说明') // local-counter separation lives in the folded details
    expect(html).not.toContain('<pre')
  })
  it('reuses the supplied host Button', () => {
    const Button = vi.fn(({ children }: { children?: import('react').ReactNode }) => <button data-host="quota">{children}</button>)
    expect(renderToStaticMarkup(<ZhihuQuotaSection rpc={{ call: vi.fn() }} Button={Button} />)).toContain('data-host="quota"')
    expect(Button).toHaveBeenCalled()
  })
})

describe('quota mount/request lifecycle via focused hook harness', () => {
  it('loads on mount, supersedes refresh, retains successful snapshot on error, aborts on cleanup', async () => {
    const first = deferred(), second = deferred(), third = deferred(), fourth = deferred()
    const call = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise).mockReturnValueOnce(fourth.promise)
    const rpc = { call }
    hooks.enabled = true; hooks.cells = []; hooks.effects = []; hooks.cursor = 0
    try {
      const draw = () => { hooks.cursor = 0; hooks.effects = []; return ZhihuQuotaSection({ rpc }) }
      let tree = draw()
      const cleanup = hooks.effects[0]()
      expect(call.mock.calls[0].slice(0, 3)).toEqual([ZHIHU_RPC_CHANNEL, 'quota', {}])
      const action = (node: ReturnType<typeof draw>, index: number) => {
        const actions = node.props.children[3]
        actions.props.children[index].props.onClick()
      }
      action(tree, 0) // The button is disabled while pending; a direct refresh still supersedes the first request.
      expect(call.mock.calls[0][3].aborted).toBe(true)
      second.resolve(response({ Items: [{ APIID: 'creator', RemainingQuota: 7 }] })); await flush()
      first.resolve(response({ Items: [{ APIID: 'creator', RemainingQuota: 999 }] })); await flush()
      expect(hooks.cells[1]).toMatchObject({ data: { Items: [{ APIID: 'creator', RemainingQuota: 7 }] } })
      const snapshot = hooks.cells[1]
      expect(snapshot).toHaveProperty('timestamp')
      tree = draw(); action(tree, 0)
      third.reject(new Error('refresh failed')); await flush()
      expect(hooks.cells[1]).toBe(snapshot)
      expect(hooks.cells[3]).toBe('refresh failed')
      expect(hooks.cells[4]).toBe(true)
      tree = draw(); action(tree, 0)
      if (typeof cleanup === 'function') cleanup()
      expect(call.mock.calls[3][3].aborted).toBe(true)
      fourth.resolve(response({ Items: [{ APIID: 'creator', RemainingQuota: 888 }] })); await flush()
      expect(hooks.cells[1]).toBe(snapshot)
    } finally { hooks.enabled = false; hooks.cells = []; hooks.effects = [] }
  })
  it('cancellation discards a late quota result even if the transport ignores abort', async () => {
    const pending = deferred(), state = createZhihuClientState(), publish = vi.fn()
    const call = vi.fn(() => pending.promise)
    const request = requestOpenPlatform({ call }, state, 'quota', {}, publish)
    state.cancel()
    pending.resolve(response({ Items: [{ APIID: 'creator', RemainingQuota: 2 }] }))
    await request
    expect((call.mock.calls[0] as unknown as [string, string, unknown, AbortSignal])[3].aborted).toBe(true)
    expect(publish).not.toHaveBeenCalled()
  })
})
