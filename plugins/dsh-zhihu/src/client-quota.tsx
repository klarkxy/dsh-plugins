import { useCallback, useEffect, useRef, useState } from 'react'
import { createZhihuClientState } from './client-state.ts'
import { requestOpenPlatform, type ZhihuOpenPlatformRpc } from './client-open-platform.tsx'
import { ZhihuButton, ZhihuDetails, type HostButton } from './client-host-ui.tsx'
import { translator, useT, useZhihuLocale, type Translate } from './client-locale.ts'

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const identityFields = new Set(['APIID', 'ApiId', 'apiId', 'api_id', 'id', 'Name', 'name', 'APIName', 'ApiName', 'Description', 'description', 'Date', 'date', 'Period', 'period', 'Unit', 'unit', 'Timestamp', 'timestamp', 'version'])
/** Friendly name first, official field in parentheses so it still maps to the Zhihu docs. */
function fieldLabel(field: string, t: Translate): string {
  switch (field) {
    case 'RemainingQuota': return t('剩余额度（RemainingQuota）', 'Remaining (RemainingQuota)')
    case 'TotalQuota': return t('总额度（TotalQuota）', 'Total (TotalQuota)')
    case 'UsedQuota': return t('已用额度（UsedQuota）', 'Used (UsedQuota)')
    case 'TotalUsed': return t('已用额度（TotalUsed）', 'Used (TotalUsed)')
    default: return field
  }
}
/**
 * A total is a ceiling, not an amount spent, and the used figure is the gap
 * between the two. The roles are what let the view drop the redundant third
 * number and hang the one meaningful bar on the remaining column.
 */
export type QuotaFieldRole = 'total' | 'remaining' | 'used' | 'other'
export function quotaFieldRole(field: string): QuotaFieldRole {
  if (field === 'RemainingQuota') return 'remaining'
  if (field === 'TotalQuota') return 'total'
  if (field === 'UsedQuota' || field === 'TotalUsed') return 'used'
  return 'other'
}
export type QuotaMetric = { field: string; label: string; text: string; value: number | null }
export type QuotaCategory = { id: string; label: string; metrics: QuotaMetric[] }
export type QuotaProjection = { categories: QuotaCategory[]; fields: string[] }

/** Only nonnegative finite, safe magnitudes are chartable; exact decimal text is retained. */
export function quotaNumericValue(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string') {
    const decimal = value.trim()
    if (!/^\+?\d+(?:\.\d+)?$/.test(decimal)) return null
    const [whole, fraction = ''] = decimal.replace(/^\+/, '').split('.')
    const integer = whole.replace(/^0+(?=\d)/, '')
    const limit = String(Number.MAX_SAFE_INTEGER)
    if (integer.length > limit.length || (integer.length === limit.length && (integer > limit || (integer === limit && /[1-9]/.test(fraction))))) return null
  }
  const n = typeof value === 'number' ? value : Number(value.trim())
  if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) return null
  if (typeof value === 'string' && n === 0 && /[1-9]/.test(value)) return null
  return n
}
export function quotaMetric(field: string, raw: unknown, t: Translate = translator()): QuotaMetric {
  const value = quotaNumericValue(raw)
  let text = t('不可用', 'Unavailable')
  if (value !== null) text = typeof raw === 'string' ? raw.trim() : String(raw)
  // Negative / unlimited markers are opaque official text, never interpreted as zero or capacity.
  else if ((typeof raw === 'number' && Number.isFinite(raw))
    || (typeof raw === 'string' && (/^[+-]?\d+(?:\.\d+)?$/.test(raw.trim()) || /^(?:unlimited|infinite|infinity|不限|无限|无限制)$/i.test(raw.trim())))) text = String(raw).trim() + t('（原始标记，不绘图）', ' (raw marker, not charted)')
  return { field, label: fieldLabel(field, t), text, value }
}

const chartableRole = (category: QuotaCategory, role: QuotaFieldRole) => {
  const metric = category.metrics.find(value => quotaFieldRole(value.field) === role)
  return metric !== undefined && metric.value !== null
}

/**
 * The total is the fraction's denominator, not a figure in its own right, so it
 * gets no column: `4998 / 5000` says everything a total column and a remaining
 * column said separately, in less space. Only fields the fraction cannot carry
 * — a cumulative counter, or a used figure its row has no ceiling to subtract
 * from — survive as columns of their own.
 */
export type QuotaColumn = { kind: 'meter' | 'field'; field: string; label: string; role: QuotaFieldRole | 'meter' }

/** The one meter worth drawing: what is left of this API's own ceiling. Both
 *  figures are the server's, for this row; without both the cell stays a number
 *  and never borrows a scale from a neighbouring row or field. */
export function quotaMeter(metrics: QuotaMetric[]): { remaining: QuotaMetric; total: QuotaMetric; share: number } | null {
  const remaining = metrics.find(value => quotaFieldRole(value.field) === 'remaining' && value.value !== null)
  const total = metrics.find(value => quotaFieldRole(value.field) === 'total' && value.value !== null)
  if (!remaining || !total || !total.value) return null
  return { remaining, total, share: remaining.value! / total.value! }
}

export function quotaColumns(categories: QuotaCategory[], fields: string[], t: Translate = translator()): QuotaColumn[] {
  const holders = categories.filter(category => category.metrics.some(value => quotaFieldRole(value.field) === 'used'))
  const derivable = holders.length > 0 && holders.every(category => chartableRole(category, 'total') && chartableRole(category, 'remaining'))
  const rest: QuotaColumn[] = fields
    .filter(field => {
      const role = quotaFieldRole(field)
      if (role === 'total' || role === 'remaining') return false // the fraction carries both
      if (role === 'used') return !derivable
      return true
    })
    .map(field => ({ kind: 'field' as const, field, label: fieldLabel(field, t), role: quotaFieldRole(field) }))
  const hasFraction = fields.some(field => { const role = quotaFieldRole(field); return role === 'total' || role === 'remaining' })
  return hasFraction
    ? [{ kind: 'meter', field: '', label: t('剩余 / 上限', 'Remaining / ceiling'), role: 'meter' }, ...rest]
    : rest
}

/** The one cell every row is read through: the fraction when the row has both
 *  halves, otherwise whichever single figure the server sent, named so a lone
 *  number is never read as the other half. */
function quotaFractionCell(category: QuotaCategory, t: Translate) {
  const total = category.metrics.find(value => quotaFieldRole(value.field) === 'total')
  const remaining = category.metrics.find(value => quotaFieldRole(value.field) === 'remaining')
  const lone = (metric: QuotaMetric, role: 'total' | 'remaining') => <span className="zhihu-quota-value">
    {metric.text}<span className="zhihu-quota-of">{role === 'total' ? t(' 上限', ' ceiling') : t(' 剩余', ' remaining')}</span>
  </span>
  const meter = quotaMeter(category.metrics)
  if (meter) return <span className="zhihu-quota-value">
    {meter.remaining.text}<span className="zhihu-quota-of"> / {meter.total.text}</span>
    <span className="zhihu-quota-track" aria-hidden="true">
      <span className="zhihu-quota-fill" style={{ width: `${Number((meter.share * 100).toFixed(2))}%` }} />
    </span>
  </span>
  // A half Zhihu marked opaque (`-1`, `unlimited`) is still its answer, so it is
  // shown as it came: the other half never stands in for it and it never becomes
  // a fraction, because its value is unknown rather than zero.
  if (remaining) return lone(remaining, 'remaining')
  if (total) return lone(total, 'total')
  return <span className="zhihu-quota-value">{t('不可用', 'Unavailable')}</span>
}

/** Supports direct per-API rows only. No recursive guessing, aggregation, or balance derivation. */
export function projectQuota(data: unknown, t: Translate = translator()): QuotaProjection {
  if (!record(data)) return { categories: [], fields: [] }
  const source = Object.hasOwn(data, 'Items') ? data.Items : data
  const rows: { raw: Record<string, unknown>; key?: string }[] = []
  if (Array.isArray(source)) {
    for (const raw of source) if (record(raw)) rows.push({ raw })
  } else if (record(source)) {
    if (['APIID', 'ApiId', 'apiId', 'api_id', 'id'].some(key => (typeof source[key] === 'string' && !!source[key].trim()) || (typeof source[key] === 'number' && Number.isSafeInteger(source[key])))) rows.push({ raw: source })
    else for (const [key, raw] of Object.entries(source)) if (record(raw)) rows.push({ raw, key })
  }
  const fields = new Set<string>()
  const categories = rows.map(({ raw, key }, index) => {
    const identifier = [raw.APIID, raw.ApiId, raw.apiId, raw.api_id, raw.id, key].find(value => (typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isSafeInteger(value)))
    const id = identifier === undefined ? t(`类别 ${index + 1}`, `Category ${index + 1}`) : String(identifier)
    const name = [raw.APIName, raw.ApiName, raw.Name, raw.name].find(value => typeof value === 'string' && value.trim())
    const metrics = Object.entries(raw).filter(([field, value]) => !identityFields.has(field) && !record(value) && !Array.isArray(value)).map(([field, value]) => {
      fields.add(field)
      return quotaMetric(field, value, t)
    })
    return { id, label: name ? `${String(name)}（${id}）` : id, metrics }
  })
  return { categories, fields: [...fields] }
}

/**
 * One row per API, read as `remaining / ceiling` with the bar under it. The
 * total earns no column of its own — it is the denominator the fraction already
 * prints — and the consumed figure is the gap between the two numbers, so it
 * earns none either. An earlier version gave all three their own panel, which
 * repeated the API list three times and let a full bar mean "exhausted" in one
 * place and "untouched" in another, in the same colour and the same length.
 */
export function QuotaCharts({ data }: { data: unknown }) {
  const t = useT()
  const { categories, fields } = projectQuota(data, t)
  if (!categories.length || !fields.length) return <p className="dsh-ui-empty">{t('官方额度数据不可用：响应中没有可识别的额度字段。', 'Official quota data is unavailable: the response has no recognisable quota fields.')}</p>
  const columns = quotaColumns(categories, fields, t)
  const metered = columns[0]?.kind === 'meter'
  const api = t('接口', 'API')
  return <div className="dsh-ui-stack">
    {metered && <p className="dsh-ui-help">{t('蓝条＝该接口还剩自己上限的多少。各接口上限不同，条长不跨行比较。', 'A bar is what an API has left of its own ceiling. Limits differ per API, so lengths are not comparable across rows.')}</p>}
    <ZhihuDetails title={t('如何阅读', 'How to read this')}>
      <li>{t('「剩余 / 上限」中的上限是知乎给该接口的总额度，蓝条是其中未消耗的部分。', 'The ceiling in “remaining / ceiling” is the total Zhihu reports for that API, and the bar is the unconsumed part of it.')}</li>
      <li>{t('已消耗是上限减剩余，因此不单列；官方未返回上限时只显示剩余数字，不画条。', 'Consumed is the ceiling minus the remaining, so it gets no column. With no total returned, only the remaining shows and no bar is drawn.')}</li>
      <li>{t('不合计不同 API，不推算已用、总额或余额。', 'Different APIs are not summed; used, total and balance are never inferred.')}</li>
      <li>{t('统计周期以官方定义为准，不把累计数据当作今日用量。', 'Periods follow the official definition; cumulative figures are not treated as today’s usage.')}</li>
    </ZhihuDetails>
    <div className="zhihu-quota-scroll">
      <table className="zhihu-quota-table">
        <thead>
          <tr>
            <th scope="col" className="zhihu-quota-corner">{api}</th>
            {columns.map(column => <th scope="col" className="zhihu-quota-head" key={column.field || 'meter'}>
              <span className="zhihu-quota-head-label">{column.label}</span>
              {column.kind === 'meter' && <span className="zhihu-quota-head-scale">RemainingQuota / TotalQuota</span>}
            </th>)}
          </tr>
        </thead>
        <tbody>
          {categories.map((category, index) => <tr key={`${category.id}-${index}`}>
            <th scope="row" className="zhihu-quota-name">{category.label}</th>
            {columns.map(column => <td className="zhihu-quota-cell" key={column.field || 'meter'}>
              {column.kind === 'meter'
                ? quotaFractionCell(category, t)
                : <span className="zhihu-quota-value">
                    {(category.metrics.find(value => value.field === column.field) ?? quotaMetric(column.field, undefined, t)).text}
                  </span>}
            </td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
    {categories.filter(category => !category.metrics.length).map((category, index) => <p className="dsh-ui-hint" key={`${category.id}-${index}`}>{t(`${category.label}：额度字段不可用。`, `${category.label}: quota fields unavailable.`)}</p>)}
  </div>
}

export function ZhihuQuotaSection({ rpc, Button }: { rpc: ZhihuOpenPlatformRpc; Button?: HostButton }) {
  const state = useRef(createZhihuClientState()).current
  const [snapshot, setSnapshot] = useState<{ data: Record<string, unknown>; timestamp: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const t = useT()
  const locale = useZhihuLocale()
  // Stale means "the last refresh failed"; a pending refresh does not demote good data.
  const refresh = useCallback(() => {
    setLoading(true); setError('')
    void requestOpenPlatform(rpc, state, 'quota', {}, outcome => {
      setLoading(false)
      if ('value' in outcome) {
        setSnapshot({ data: outcome.value.data, timestamp: new Date().toISOString() })
        setStale(false)
      } else { setError(outcome.error); setStale(true) }
    })
  }, [rpc, state])
  useEffect(() => { refresh(); return () => state.cancel() }, [refresh, state])
  const title = t('官方额度用量', 'Official quota')
  return <section className="dsh-ui-stack" aria-label={title}>
    <h3 className="dsh-ui-heading">{title}</h3>
    <p className="dsh-ui-help">{t('打开此页时自动查询，不自动重试。', 'Loads when this tab opens; never retried automatically.')}</p>
    <ZhihuDetails title={t('说明', 'Details')}>
      <li>{t('仅显示官方返回字段，不补零，不推算费用。', 'Shows only the fields Zhihu returns; nothing is zero-filled or priced.')}</li>
      <li>{t('官方额度与本地每日调用计数分开，额度查询不计入本地调用次数。', 'Official quota is separate from local daily counts; quota checks are not counted locally.')}</li>
    </ZhihuDetails>
    <div className="dsh-ui-actions">
      <ZhihuButton host={Button} variant="primary" disabled={loading} onClick={refresh}>{t('刷新官方额度', 'Refresh quota')}</ZhihuButton>
      {loading && <ZhihuButton host={Button} onClick={() => { state.cancel(); setLoading(false); setError(t('已取消；晚到的结果将被丢弃。', 'Cancelled; a late response will be discarded.')) }}>{t('取消请求', 'Cancel')}</ZhihuButton>}
    </div>
    {/* The single live region for this section. */}
    <p className={loading ? 'dsh-ui-loading' : 'dsh-ui-hint'} role="status">{loading ? t('正在查询官方额度…', 'Checking official quota…') : !snapshot && !error ? t('等待查询官方额度。', 'Waiting to check official quota.') : ''}</p>
    {error && <p className="dsh-ui-error" role="alert">{error}</p>}
    {snapshot && <div className="dsh-ui-stack">
      <p className={stale ? 'dsh-ui-warn' : 'dsh-ui-hint'}>{stale ? t('旧数据（刷新未成功） · ', 'Old data (refresh failed) · ') : t('最近成功查询 · ', 'Last checked · ')}<time dateTime={snapshot.timestamp}>{new Date(snapshot.timestamp).toLocaleString(locale === 'en' ? 'en' : 'zh-CN')}</time></p>
      <QuotaCharts data={snapshot.data} />
    </div>}
    {!snapshot && !loading && error && <p className="dsh-ui-empty">{t('官方额度暂不可用，请稍后手动刷新。', 'Official quota is unavailable. Refresh again later.')}</p>}
  </section>
}
