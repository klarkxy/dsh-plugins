import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ZHIHU_RPC_CHANNEL } from './contracts.ts'
import { createZhihuClientState } from './client-state.ts'
import { requestOpenPlatform } from './client-open-platform.tsx'
import { projectQuota, quotaColumns, quotaMetric, quotaNumericValue, QuotaCharts, ZhihuQuotaSection } from './client-quota.tsx'

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
/** Text only: what a reader sees, so an assertion is not hostage to where a
 *  value and its suffix happen to sit in the markup. */
const seen = (html: string) => html.replace(/<[^>]+>/g, '')
const bars = (html: string) => [...html.matchAll(/zhihu-quota-fill" style="width:([\d.]+)%"/g)].map(match => match[1])

describe('official quota conservative projection', () => {
  it('supports the verified RemainingQuota fixture without inventing used or total', () => {
    const projection = projectQuota({ Items: [{ APIID: 'creator', RemainingQuota: '12' }, { APIID: 'user_data', RemainingQuota: 0 }] })
    expect(projection.fields).toEqual(['RemainingQuota'])
    expect(projection.categories[0].metrics).toEqual([{ field: 'RemainingQuota', label: '剩余额度（RemainingQuota）', text: '12', value: 12 }])
    expect(projection.categories[1].metrics[0].value).toBe(0)
    const html = renderToStaticMarkup(<QuotaCharts data={{ Items: [{ APIID: 'creator', RemainingQuota: 12 }] }} />)
    expect(html).toContain('zhihu-quota-table')
    // The official names stay on the column so the figure still maps to the docs.
    expect(html).toContain('RemainingQuota / TotalQuota')
    expect(html).not.toContain('已用额度（UsedQuota）')
    expect(html).not.toContain('总额度（TotalQuota）')
    expect(html).not.toContain('<pre')
  })
  it('supports keyed rows and each explicit metric; no sums or balances', () => {
    const data = { creator: { RemainingQuota: '0.50', UsedQuota: 5, LifetimeCalls: 900 }, user_data: { TotalQuota: 100, UsedQuota: 10 } }
    const projection = projectQuota(data)
    expect(projection.categories.map(category => category.id)).toEqual(['creator', 'user_data'])
    expect(projection.categories[0].metrics[0].text).toBe('0.50')
    expect(projection.fields).toEqual(['RemainingQuota', 'UsedQuota', 'LifetimeCalls', 'TotalQuota'])
    // user_data has no remaining, so its used figure is the only number it does
    // not already imply and the column has to stay.
    expect(quotaColumns(projection.categories, projection.fields).map(column => column.field))
      .toEqual(['', 'UsedQuota', 'LifetimeCalls'])
    const html = renderToStaticMarkup(<QuotaCharts data={data} />)
    expect(html).toContain('LifetimeCalls')
    expect(html).toContain('如何阅读')
    // creator has a remaining but no ceiling; user_data a ceiling but no remaining.
    // Neither row may borrow the other's scale, so no bar is drawn anywhere.
    expect(html).not.toContain('zhihu-quota-track')
    expect(seen(html)).toContain('0.50 剩余')
    expect(seen(html)).toContain('100 上限')
    expect(seen(html)).toContain('不可用') // Missing fields are not zero.
    // Bar colour is the host's, through the stylesheet: an inline literal fill
    // here would pin one theme and shadow the token.
    expect(html).not.toMatch(/style="[^"]*(?:fill|background)/)
    expect(projectQuota({ Items: { creator: { RemainingQuota: 2 } } }).categories[0].id).toBe('creator')
  })
  it('reads one row as remaining / ceiling and drops the two columns that fraction replaces', () => {
    const data = { Items: [
      { APIID: 'global_search', TotalQuota: 10000, TotalUsed: 5002, RemainingQuota: 4998 },
      { APIID: 'hot_list', TotalQuota: 100, TotalUsed: 0, RemainingQuota: 100 },
      { APIID: 'knowledge', TotalQuota: 500, TotalUsed: 1, RemainingQuota: 499 },
    ] }
    const projection = projectQuota(data)
    // The ceiling is the fraction's denominator and the used figure is the gap
    // between the two halves, so neither is a column.
    expect(quotaColumns(projection.categories, projection.fields).map(column => column.field)).toEqual([''])
    const html = renderToStaticMarkup(<QuotaCharts data={data} />)
    expect(seen(html)).not.toContain('已用额度')
    expect(seen(html)).not.toContain('5002')
    expect(seen(html)).toContain('4998 / 10000')
    expect(seen(html)).toContain('499 / 500')
    // One bar per row, on the fraction, each against that row's own ceiling.
    expect(bars(html)).toEqual(['49.98', '100', '99.8'])
    expect((html.match(/zhihu-quota-track/g) ?? []).length).toBe(3)
  })
  it('names the lone half so a single number is never read as the other one', () => {
    const data = { Items: [
      { APIID: 'creator', TotalQuota: 200, RemainingQuota: 200 },
      { APIID: 'tools', TotalQuota: 10, TotalUsed: 4 },
      { APIID: 'user_data', RemainingQuota: 7 },
    ] }
    const projection = projectQuota(data)
    // tools reports used with no remaining, so that number is not a gap and stays.
    expect(quotaColumns(projection.categories, projection.fields).map(column => column.field)).toEqual(['', 'TotalUsed'])
    const html = renderToStaticMarkup(<QuotaCharts data={data} />)
    expect(seen(html)).toContain('200 / 200')
    expect(seen(html)).toContain('10 上限') // a ceiling with nothing spent cannot be a fraction
    expect(seen(html)).toContain('7 剩余') // nor can a remaining with no ceiling
    expect(seen(html)).toContain('已用额度（TotalUsed）')
    expect(seen(html)).toContain('4')
    // Only creator has both halves, so only it gets a bar.
    expect((html.match(/zhihu-quota-track/g) ?? []).length).toBe(1)
  })
  it('draws no bar at all when the official response has no ceiling to measure against', () => {
    const html = renderToStaticMarkup(<QuotaCharts data={{ Items: [{ APIID: 'creator', RemainingQuota: '12' }] }} />)
    expect(html).not.toContain('zhihu-quota-track')
    expect(seen(html)).toContain('12 剩余')
  })
  it('treats a zero remaining as spent, not as missing', () => {
    const html = renderToStaticMarkup(<QuotaCharts data={{ Items: [{ APIID: 'creator', TotalQuota: 500, RemainingQuota: 0 }] }} />)
    // An empty track is a real reading; a missing track would be indistinguishable
    // from a response that never reported a ceiling.
    expect(seen(html)).toContain('0 / 500')
    expect(html).toContain('zhihu-quota-track')
    expect(html).toContain('width:0%')
  })
  it('shows a raw marker as the remaining half instead of letting the ceiling stand in for it', () => {
    const html = renderToStaticMarkup(<QuotaCharts data={{ Items: [
      { APIID: 'creator', TotalQuota: 500, RemainingQuota: 'unlimited' },
      { APIID: 'user_data', TotalQuota: 100, RemainingQuota: 50 },
    ] }} />)
    // The marker is still Zhihu's answer, so it is shown — and it is not turned
    // into a fraction, because its value is unknown rather than zero.
    expect(seen(html)).toContain('unlimited（原始标记，不绘图） 剩余')
    expect(seen(html)).not.toContain('/ 500')
    expect((html.match(/zhihu-quota-track/g) ?? []).length).toBe(1)
    expect(seen(html)).toContain('50 / 100')
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
    // The fold-out icon is also an svg; what must be absent is the bar itself.
    expect(html).not.toContain('zhihu-quota-track')
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
    expect(html).toContain('&lt;script&gt;')
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
