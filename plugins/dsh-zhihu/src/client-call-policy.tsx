import { useEffect, useState } from 'react'
import { ZHIHU_RPC_CHANNEL } from './contracts.ts'
import { useT } from './client-locale.ts'

export function ZhihuCallPolicySummary({ policy }: { policy: { allowPaid: boolean; dailyCallLimit: number } }) {
  const t = useT()
  return <p className="dsh-ui-help">{t(`${policy.allowPaid ? '已显式允许付费' : '仅使用免费额度'} · 每日上限 ${policy.dailyCallLimit} 次（北京时间）`, `${policy.allowPaid ? 'Paid calls explicitly enabled' : 'Free allowance only'} · ${policy.dailyCallLimit} calls per Beijing day`)}</p>
}

export function ZhihuCallPolicySection({ rpc }: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> } }) {
  const t = useT()
  const [policy, setPolicy] = useState<{ allowPaid: boolean; dailyCallLimit: number } | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    rpc.call(ZHIHU_RPC_CHANNEL, 'policy.status', {}).then(result => {
      if (!alive) return
      const value = (result as { ok?: boolean; value?: { allowPaid?: unknown; dailyCallLimit?: unknown } })
      if (value?.ok && typeof value.value?.allowPaid === 'boolean' && typeof value.value.dailyCallLimit === 'number') setPolicy(value.value as { allowPaid: boolean; dailyCallLimit: number })
      else setFailed(true)
    }, () => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [rpc])
  return <section className="dsh-ui-stack" aria-label={t('调用保护', 'Call protection')}>
    <h4 className="dsh-ui-heading">{t('调用保护', 'Call protection')}</h4>
    {policy ? <ZhihuCallPolicySummary policy={policy} /> : <p className="dsh-ui-help">{failed ? t('保护配置不可用；请检查插件配置。', 'Protection settings unavailable. Check plugin configuration.') : t('读取保护配置…', 'Loading protection settings…')}</p>}
    <p className="dsh-ui-hint">{t('付费须在插件配置显式启用。未确认计费的能力仅允许使用已确认的免费额度。本地保护无法排除同账号其他客户端竞争导致的扣费；调用统计不是账单。', 'Enable paid calls explicitly in plugin configuration. Unpriced capabilities require verified free allowance. Other clients on the same account can still cause charges; local counts are not billing.')}</p>
  </section>
}
