/**
 * dsh-model-hub — browser half. One settings-page section listing every
 * detected model-route field across plugins. Each row is edited with the
 * contract's standard ModelMenu (dsh-model-route/ui) and written back through
 * the hub's host RPC — `settings.mutate` on the host, CAS by descriptor
 * revision. An empty route means "follow the host default" and unsets the
 * field.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Button, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  modelMenuEffortOptions, normalizeModelRoute, parseModelMenuChoices, type ModelRoute,
} from '@klarkxy/dsh-model-route'
import { ModelMenu, modelMenuCss } from '@klarkxy/dsh-model-route/ui'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'

export const name = 'dsh-model-hub-client'
/* `remote.session` is a nested service of the injected `remote` face: cordis
 * checks the dotted path against this list, so the parent `remote` entry alone
 * is not enough — omitting it throws "cannot get property without inject". */
export const inject = ['slots', 'connection', 'remote', 'remote.session', 'locale']
export const CHANNEL = '/dsh-model-hub'
export const BUNDLE = '@klarkxy/dsh-model-hub'

/* One language at a time, chosen from the host locale. */
const TEXT = {
  zh: {
    title: '模型枢纽',
    intro: '一页查看并修改各插件的模型路由；改动立即写入对应插件自己的设置。',
    loading: '正在读取…',
    empty: '没有检测到模型字段。插件可用 x-model-route 标记声明模型字段。',
    failed: (message: string) => `读取失败：${message}`,
    writeFailed: (message: string) => `写入失败：${message}`,
    refresh: '刷新',
    follow: '跟随宿主默认',
    viaMarker: '契约标记',
    viaShape: '形状识别',
    model: '模型',
    effort: '思考强度',
    effortDefault: '默认',
    searchModels: '搜索模型…',
    noModels: '没有匹配的模型',
    clearSearch: '清除搜索',
    collectionTemplate: '集合中没有可编辑的条目；请先在所属插件中添加条目。',
  },
  en: {
    title: 'Model Hub',
    intro: "View and edit every plugin's model route on one page; changes write into the owning plugin's own settings at once.",
    loading: 'Loading…',
    empty: 'No model fields detected. A plugin can declare one with the x-model-route marker.',
    failed: (message: string) => `Load failed: ${message}`,
    writeFailed: (message: string) => `Write failed: ${message}`,
    refresh: 'Refresh',
    follow: 'Follow host default',
    viaMarker: 'contract marker',
    viaShape: 'shape match',
    model: 'Model',
    effort: 'Reasoning',
    effortDefault: 'Default',
    searchModels: 'Search models…',
    noModels: 'No matching models',
    clearSearch: 'Clear search',
    collectionTemplate: 'No collection item to edit. Add an item in the owning plugin first.',
  },
}
type TextKey = keyof typeof TEXT.en

type LocaleLike = string | { getSnapshot?: () => { active?: string }; subscribe?: (fn: () => void) => () => void } | undefined
function useText(locale: LocaleLike) {
  const active = typeof locale === 'string' ? locale : locale?.getSnapshot?.()?.active
  const table = String(active || 'en').toLowerCase().startsWith('zh') ? TEXT.zh : TEXT.en
  return useMemo(() => (key: TextKey, ...args: string[]) => {
    const value = table[key]
    return typeof value === 'function' ? (value as (...rest: string[]) => string)(...args) : value
  }, [table])
}

export interface HubField {
  path: string[]
  via: 'marker' | 'shape'
  marker?: { purpose?: string; label?: string }
  current?: ModelRoute
  editable?: false
  arrayItem?: true
}
export interface HubEntry {
  ns: string
  revision: number
  fields: HubField[]
}

interface HubApi {
  list(): Promise<HubEntry[]>
  setField(payload: { ns: string; path: string[]; route: unknown; expectedRevision?: number }): Promise<HubEntry[]>
  modelCatalog(): Promise<unknown>
}

const css = `${officialUiCss('dsh-model-hub')}${modelMenuCss}`
function Style() {
  return <style>{css}</style>
}

/** One detected field's standard editor: the same ModelMenu every marked field gets. */
export function FieldMenu({ t, catalog, current, disabled, onSet }: {
  t: ReturnType<typeof useText>
  catalog: unknown
  current: ModelRoute | undefined
  disabled: boolean
  onSet: (route: ModelRoute) => void
}) {
  const [open, setOpen] = useState(false)
  const route = normalizeModelRoute(current)
  const follow = !route.provider || !route.model
  const choices = useMemo(() => parseModelMenuChoices(catalog, follow ? undefined : route), [catalog, follow, route.provider, route.model])
  const selected = follow ? undefined : choices.find(choice => choice.provider === route.provider && choice.model === route.model)
  const efforts = follow ? [] : modelMenuEffortOptions(selected, route.reasoningEffort || '')
  const currentLabel = follow ? t('follow') : selected?.label ?? `${route.provider} / ${route.model}`
  const effortName = efforts.find(item => item.id === (route.reasoningEffort || ''))?.name
  return <ModelMenu
    open={open}
    onOpenChange={setOpen}
    listClassName="dsh-model-hub"
    anchor={<button type="button" className="dsh-model-menu-trigger" disabled={disabled} aria-haspopup="menu" aria-expanded={open}>
      <span className="dsh-model-menu-triggerLabel">{currentLabel}</span>
      {!follow && efforts.length ? <span className="dsh-model-menu-triggerEffort">{effortName ?? t('effortDefault')}</span> : null}
      <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${open ? ' dsh-model-menu-chevronOpen' : ''}`} />
    </button>}
    choices={choices}
    selected={follow ? undefined : { provider: route.provider, model: route.model }}
    onPick={picked => onSet({ provider: picked.provider, model: picked.model })}
    leading={[{ id: 'follow', label: t('follow'), selected: follow }]}
    onPickLeading={() => onSet({ provider: '', model: '' })}
    efforts={efforts}
    selectedEffort={route.reasoningEffort || ''}
    onPickEffort={effort => onSet(follow
      ? { provider: '', model: '' }
      : { provider: route.provider, model: route.model, ...(effort ? { reasoningEffort: effort } : {}) })}
    modelLabel={t('model')}
    modelValue={currentLabel}
    effortLabel={t('effort')}
    defaultEffortLabel={t('effortDefault')}
    searchPlaceholder={t('searchModels')}
    emptyLabel={t('noModels')}
    clearSearchLabel={t('clearSearch')}
  />
}

export function HubPage({ view, api, locale, initialEntries = null, initialCatalog = null }: {
  view?: string
  api: HubApi
  locale: LocaleLike
  initialEntries?: HubEntry[] | null
  initialCatalog?: unknown
}) {
  const t = useText(locale)
  const [entries, setEntries] = useState<HubEntry[] | null>(initialEntries)
  const [catalog, setCatalog] = useState<unknown>(initialCatalog)
  const [error, setError] = useState('')
  const [writing, setWriting] = useState('')
  useEffect(() => {
    let alive = true
    api.list().then(value => { if (alive) { setEntries(value); setError('') } },
      error => { if (alive) setError(t('failed', error instanceof Error ? error.message : String(error))) })
    Promise.resolve().then(() => api.modelCatalog()).then(value => { if (alive) setCatalog(value) }, () => {})
    return () => { alive = false }
  }, [api])
  const setRoute = (entry: HubEntry, field: HubField, route: ModelRoute) => {
    const key = `${entry.ns}:${field.path.join('.')}`
    if (writing) return
    setWriting(key)
    api.setField({ ns: entry.ns, path: field.path, route, expectedRevision: entry.revision })
      .then(value => { setEntries(value); setError('') },
        error => setError(t('writeFailed', error instanceof Error ? error.message : String(error))))
      .finally(() => setWriting(''))
  }
  if (view === 'summary') {
    return <div className="dsh-model-hub"><Style /><p className="dsh-ui-compact dsh-ui-wrap">{t('intro')}</p></div>
  }
  return <section className="dsh-model-hub dsh-ui-stack" aria-label={t('title')}>
    <Style />
    <p className="dsh-ui-compact dsh-ui-wrap">{t('intro')}</p>
    {entries === null && !error ? <p className="dsh-ui-loading">{t('loading')}</p> : null}
    {entries !== null && entries.length === 0 ? <p className="dsh-ui-help">{t('empty')}</p> : null}
    {(entries ?? []).map(entry => <fieldset key={entry.ns} className="dsh-ui-card">
      <legend className="dsh-ui-heading">{entry.ns}</legend>
      {entry.fields.map(field => {
        const key = `${entry.ns}:${field.path.join('.')}`
        return <div key={key} className="dsh-ui-field">
          <span className="dsh-ui-label">{field.marker?.label || field.path.join('.')}</span>
          {field.editable === false ? <span className="dsh-ui-help">{t('collectionTemplate')}</span> : <FieldMenu
            t={t}
            catalog={catalog}
            current={field.current}
            disabled={writing === key}
            onSet={route => setRoute(entry, field, route)}
          />}
          <span className="dsh-ui-help">
            {field.marker?.purpose ? `${field.marker.purpose} · ` : ''}
            {field.via === 'marker' ? t('viaMarker') : t('viaShape')} · {field.path.join('.')}
          </span>
        </div>
      })}
    </fieldset>)}
    <div className="dsh-ui-actions">
      <Button variant="ghost" disabled={writing !== ''} onClick={() => {
        setEntries(null)
        api.list().then(value => { setEntries(value); setError('') },
          error => setError(t('failed', error instanceof Error ? error.message : String(error))))
      }}>{t('refresh')}</Button>
    </div>
    {error ? <p role="alert" className="dsh-ui-error dsh-ui-wrap">{error}</p> : null}
  </section>
}

interface HubClientContext {
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register(options: unknown, component: unknown): unknown
  }
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: unknown; error?: { message?: string } }> } }
  remote: { session: { modelCatalog(): Promise<unknown> } }
  locale: LocaleLike
}

export function apply(ctx: unknown): void {
  const client = ctx as unknown as HubClientContext
  const call = async (endpoint: string, payload: unknown): Promise<never> => {
    const result = await client.connection.rpc.call(CHANNEL, endpoint, payload)
    if (!result?.ok) throw new Error(result?.error?.message || 'Request failed')
    return result.value as never
  }
  const api: HubApi = Object.freeze({
    list: () => call('fields.list', {}),
    setField: (payload: { ns: string; path: string[]; route: unknown; expectedRevision?: number }) => call('fields.set', payload),
    modelCatalog: () => client.remote.session.modelCatalog(),
  })
  client.slots.inject('plugins.bundle.config', () => client.slots.register({
    name: 'plugins.bundle.config', key: BUNDLE, inject: () => ({ api, locale: (ctx as { locale?: LocaleLike }).locale }),
  }, HubPage))
}
