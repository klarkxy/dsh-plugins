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
    default: return field
  }
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

export function QuotaCharts({ data }: { data: unknown }) {
  const t = useT()
  const { categories, fields } = projectQuota(data, t)
  if (!categories.length || !fields.length) return <p className="dsh-ui-empty">{t('官方额度数据不可用：响应中没有可识别的额度字段。', 'Official quota data is unavailable: the response has no recognisable quota fields.')}</p>
  return <div className="dsh-ui-stack">
    <p className="dsh-ui-help">{t('每个字段独立缩放，条长不表示额度占比。', 'Each field is scaled on its own; bar length is not a share of quota.')}</p>
    <ZhihuDetails title={t('如何阅读', 'How to read this')}>
      <li>{t('条长以该字段当前返回的最大非负数值为基准，不同字段不可按条长比较。', 'Bars are relative to the largest non-negative value of that field; do not compare bars across fields.')}</li>
      <li>{t('不合计不同 API，不推算已用、总额或余额。', 'Different APIs are not summed; used, total and balance are never inferred.')}</li>
      <li>{t('统计周期以官方定义为准，不把累计数据当作今日用量。', 'Periods follow the official definition; cumulative figures are not treated as today’s usage.')}</li>
    </ZhihuDetails>
    {fields.map(field => {
      const maximum = categories.reduce((max, category) => Math.max(max, category.metrics.find(metric => metric.field === field)?.value ?? 0), 0)
      const heading = fieldLabel(field, t)
      return <section className="dsh-ui-card dsh-ui-card--flat" key={field} aria-label={heading}>
        <h4 className="dsh-ui-heading">{heading}</h4>
        <p className="dsh-ui-hint">{t(`此字段刻度：0–${maximum}`, `Scale for this field: 0–${maximum}`)}</p>
        {categories.map((category, index) => {
          const metric = category.metrics.find(value => value.field === field) ?? quotaMetric(field, undefined, t)
          return <div className="zhihu-quota-row" key={`${category.id}-${index}`}>
            <span className="dsh-ui-meta dsh-ui-wrap">{category.label}</span>
            {metric.value !== null && <svg className="zhihu-quota-bar" viewBox="0 0 240 16" width="240" height="16" role="img" aria-label={`${category.label} · ${metric.label}：${metric.text}`} style={{ maxWidth: '100%' }}>
              <title>{`${category.label} · ${metric.label}：${metric.text}`}</title>
              <rect className="zhihu-quota-track" width="240" height="16" rx="3" />
              <rect className="zhihu-quota-fill" width={maximum > 0 ? metric.value / maximum * 240 : 0} height="16" rx="3" />
            </svg>}
            <span className="zhihu-quota-value dsh-ui-compact">{metric.text}</span>
          </div>
        })}
      </section>
    })}
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
