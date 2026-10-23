/**
 * dsh-model-hub — browser half. One settings-page section listing every
 * detected model-route field across plugins. Each row is edited with the
 * contract's standard ModelMenu (dsh-model-route/ui) and written back through
 * the hub's host RPC — `settings.mutate` on the host, CAS by descriptor
 * revision. An empty route means "follow the host default" and unsets the
 * field.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Input, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  MODEL_CATALOG_INJECT, modelCatalogFailures, normalizeModelRoute, parseModelMenuChoices, readModelCatalog, type ModelRoute,
} from '@klarkxy/dsh-model-route'
import { ModelCatalogStatus, modelMenuCss } from '@klarkxy/dsh-model-route/ui'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { createModelSettingsSubscriber, mountModelSettingsChanges, type ModelSettingsSubscriberContext } from '@klarkxy/dsh-plugin-kit/model-settings-client'
import type { ModelSettingsText } from '@klarkxy/dsh-plugin-kit/model-settings'
import { FieldMenu, catalogFailures, checkedCatalog, messageOf } from './client-model-menu.tsx'
export { FieldMenu, catalogFailures } from './client-model-menu.tsx'
import type { FieldCommit } from './owners.ts'
import { hubMessage, hubText } from './client-copy.ts'
import { CastPage, type CastApi } from './client-cast.tsx'

export const name = 'dsh-model-hub-client'
export const inject = ['slots', 'connection', ...MODEL_CATALOG_INJECT, 'locale']
export const CHANNEL = '/dsh-model-hub'
export const BUNDLE = '@klarkxy/dsh-model-hub'

/* One language at a time, chosen from the host locale. */
const TEXT = {
  zh: {
    title: '模型枢纽',
    intro: '一页查看并修改各插件的模型路由；改动立即写入对应插件自己的设置。',
    tabsLabel: '模型枢纽分区',
    tabFields: '字段总览',
    tabCast: '子代理阵容',
    loading: '正在读取…',
    empty: '没有检测到模型字段。',
    failed: (message: string) => `读取失败：${message}`,
    syncFailed: (message: string) => `自动同步不可用：${message}`,
    catalogFailed: (message: string) => `模型列表读取失败：${message}`,
    writeFailed: (message: string) => `未保存：${message}。请刷新后重新选择。`,
    saved: '已保存，正在刷新…',
    savedRefreshFailed: (message: string) => `已保存；页面刷新失败：${message}。请刷新以读取最新设置。`,
    refresh: '刷新',
    refreshing: '正在刷新…',
    saving: '正在保存…',
    search: '搜索插件、字段或当前模型…',
    noFields: '没有匹配的模型字段',
    follow: '跟随宿主默认',
    restorePluginDefault: '恢复插件默认',
    model: '模型',
    effort: '思考强度',
    effortDefault: '默认',
    searchModels: '搜索模型…',
    noModels: '没有匹配的模型',
    clearSearch: '清除搜索',
    collectionTemplate: '集合中没有可编辑的条目；请先在所属插件中添加条目。',
    items: '条目',
  },
  en: {
    title: 'Model Hub',
    intro: "View and edit every plugin's model route on one page; changes write into the owning plugin's own settings at once.",
    tabsLabel: 'Model Hub sections',
    tabFields: 'Fields',
    tabCast: 'Subagent Cast',
    loading: 'Loading…',
    empty: 'No model fields detected.',
    failed: (message: string) => `Load failed: ${message}`,
    syncFailed: (message: string) => `Live sync unavailable: ${message}`,
    catalogFailed: (message: string) => `Model list failed: ${message}`,
    writeFailed: (message: string) => `Not saved: ${message}. Refresh, then choose again.`,
    saved: 'Saved; refreshing…',
    savedRefreshFailed: (message: string) => `Saved; page refresh failed: ${message}. Refresh to read the latest settings.`,
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    saving: 'Saving…',
    search: 'Search plugins, fields or current models…',
    noFields: 'No matching model fields',
    follow: 'Follow host default',
    restorePluginDefault: 'Restore plugin default',
    model: 'Model',
    effort: 'Reasoning',
    effortDefault: 'Default',
    searchModels: 'Search models…',
    noModels: 'No matching models',
    clearSearch: 'Clear search',
    collectionTemplate: 'No collection item to edit. Add an item in the owning plugin first.',
    items: 'Items',
  },
}
type TextKey = keyof typeof TEXT.en

type LocaleLike = string | { getSnapshot?: () => { active?: string }; subscribe?: (fn: () => void) => () => void } | undefined
function useText(locale: LocaleLike) {
  const subscribe = useCallback((notify: () => void) => typeof locale === 'object' ? locale.subscribe?.(notify) ?? (() => {}) : () => {}, [locale])
  const snapshot = useCallback(() => typeof locale === 'string' ? locale : locale?.getSnapshot?.()?.active ?? 'en', [locale])
  const active = useSyncExternalStore(subscribe, snapshot, snapshot)
  const table = String(active || 'en').toLowerCase().startsWith('zh') ? TEXT.zh : TEXT.en
  return useMemo(() => Object.assign((key: TextKey, ...args: string[]) => {
    const value = table[key]
    return typeof value === 'function' ? (value as (...rest: string[]) => string)(...args) : value
  }, { language: table === TEXT.zh ? 'zh' as const : 'en' as const }), [table])
}

export interface HubField {
  path: string[]
  via: 'marker' | 'shape' | 'contribution'
  marker?: { purpose?: string; label?: ModelSettingsText; reasoningEffort?: boolean }
  label?: ModelSettingsText
  description?: ModelSettingsText
  allowFollow?: boolean
  followLabel?: string | { zh: string; en: string }
  supportsReasoning?: false
  current?: ModelRoute
  editable?: false
  arrayItem?: true
}
export interface HubEntry {
  ns: string
  title?: ModelSettingsText
  source?: 'owner'
  ownerId?: string
  catalog?: unknown
  error?: ModelSettingsText
  catalogError?: ModelSettingsText
  revision: number
  fields: HubField[]
}

export interface HubApi extends CastApi {
  list(): Promise<HubEntry[]>
  setField(payload: { ns: string; path: string[]; route: unknown; expectedRevision: number; ownerId?: string }): Promise<FieldCommit>
}

const css = `${officialUiCss('dsh-model-hub')}${modelMenuCss}
.dsh-model-hub .hub-toolbar{display:flex;gap:12px;align-items:center}
.dsh-model-hub .hub-search{flex:1;min-width:0}
.dsh-model-hub .hub-group{min-width:0}
.dsh-model-hub .hub-group-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin:12px 0 4px}
.dsh-model-hub .hub-group-title{font-size:14px;line-height:22px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary)}
.dsh-model-hub .hub-namespace{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.dsh-model-hub .hub-row{display:grid;grid-template-columns:minmax(140px,1fr) minmax(180px,1fr);gap:16px;align-items:center;padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.dsh-model-hub .hub-row-copy{min-width:0}
.dsh-model-hub .hub-row-label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.dsh-model-hub .hub-row-description{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:2px 0 0}
.dsh-model-hub .hub-editor{min-width:0;display:flex;justify-content:flex-end}
.dsh-model-hub .hub-editor .dsh-model-menu-root{max-width:100%}
.dsh-model-hub .hub-editor .dsh-model-menu-trigger{max-width:100%}
@media(max-width:520px){.dsh-model-hub .hub-toolbar{gap:8px}.dsh-model-hub .hub-row{grid-template-columns:minmax(0,1fr);gap:4px}.dsh-model-hub .hub-editor{justify-content:flex-start}.dsh-model-hub .hub-namespace{width:100%}}
`
function Style() {
  return <style>{css}</style>
}


function humanize(value: string): string {
  const text = value.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function fieldLabel(field: HubField, t: ReturnType<typeof useText>): string {
  return hubText(field.marker?.label || field.label, t.language) || field.path.map(part => part === '[]' ? t('items') : part === 'model' ? t('model') : /^\d+$/.test(part) ? `#${Number(part) + 1}` : humanize(part)).join(' / ')
}

function followLabel(field: HubField, t: ReturnType<typeof useText>): string {
  return typeof field.followLabel === 'string' ? field.followLabel : field.followLabel?.[t.language]
    || t(field.via === 'contribution' || field.arrayItem ? 'follow' : 'restorePluginDefault')
}

function pluginTitle(entry: HubEntry, t: ReturnType<typeof useText>): string {
  return hubText(entry.title, t.language) || humanize((entry.ns.split('/').at(-1) || entry.ns).replace(/^dsh-/, ''))
}


interface RequestScope { api: HubApi; active: boolean; busy: boolean; queued: boolean }

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
  const [listError, setListError] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [writeError, setWriteError] = useState('')
  const [saved, setSaved] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [writing, setWriting] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'fields' | 'cast'>('fields')
  const scopeRef = useRef<RequestScope | null>(null)
  const refresh = useCallback(async (scope: RequestScope) => {
    if (!scope.active) return
    if (scope.busy) { scope.queued = true; return }
    scope.queued = false
    scope.busy = true
    setRefreshing(true)
    // These independent reads both run even when one fails. Retain each last
    // successful result, and never replay a rejected write after refreshing.
    const [fields, models] = await Promise.allSettled([
      Promise.resolve().then(() => scope.api.list()),
      Promise.resolve().then(() => scope.api.modelCatalog()).then(checkedCatalog),
    ])
    if (!scope.active) return
    if (fields.status === 'fulfilled') { setEntries(fields.value); setListError(''); setWriteError(''); setSaved(false) }
    else setListError(messageOf(fields.reason))
    if (models.status === 'fulfilled') { setCatalog(models.value); setCatalogError('') }
    else setCatalogError(messageOf(models.reason))
    scope.busy = false
    setRefreshing(false)
    if (scope.queued) void refresh(scope)
  }, [])
  useEffect(() => {
    if (view === 'summary') return
    const scope: RequestScope = { api, active: true, busy: false, queued: false }
    scopeRef.current = scope
    setWriting('')
    setWriteError('')
    setSaved(false)
    setListError('')
    setCatalogError('')
    setSyncError('')
    setEntries(initialEntries)
    setCatalog(initialCatalog)
    void refresh(scope)
    const unsubscribe = api.subscribeChanges?.(() => {
      if (!scope.active) return
      setSyncError('')
      void refresh(scope)
    }, message => { if (scope.active) setSyncError(message) })
    return () => { scope.active = false; unsubscribe?.(); scopeRef.current = null }
    // Initial data seeds a new API lifetime; it is not a subscription.
  }, [api, view, refresh])
  const setRoute = (entry: HubEntry, field: HubField, route: ModelRoute) => {
    const scope = scopeRef.current
    if (!scope?.active || scope.api !== api || scope.busy || writeError) return
    const key = `${entry.ns}:${field.path.join('.')}`
    // Lock before React's next commit so same-tick selections cannot race CAS.
    scope.busy = true
    setSaved(false)
    setWriting(key)
    Promise.resolve().then(() => scope.api.setField({ ns: entry.ns, path: field.path, route, expectedRevision: entry.revision, ...(entry.ownerId ? { ownerId: entry.ownerId } : {}) }))
      .then(() => { if (scope.active) { setSaved(true); setWriteError(''); scope.queued = true } },
        error => { if (scope.active) setWriteError(messageOf(error)) })
      .finally(() => {
        if (scope.active) {
          scope.busy = false
          setWriting('')
          if (scope.queued) void refresh(scope)
        }
      })
  }
  if (view === 'summary') {
    return <div className="dsh-model-hub" lang={t.language}><Style /><p className="dsh-ui-compact dsh-ui-wrap">{t('intro')}</p></div>
  }
  const needle = query.trim().toLocaleLowerCase()
  /* The native subagent cast settings live on their own tab below; the fields
   * matrix must not offer a second editor for the same data. */
  const groups = (entries ?? []).map(entry => ({ ...entry, fields: entry.fields.filter(field =>
    !(entry.ns === BUNDLE && field.path.length === 1 && ['selfTestMeta', 'selfTestRole'].includes(field.path[0] || ''))) }))
    .filter(entry => entry.ns !== 'subagent-model-selection-settings' && (entry.fields.length > 0 || entry.error || entry.catalogError))
  const visible = groups.map(entry => ({ ...entry, fields: entry.fields.filter(field => {
    if (!needle) return true
    const route = normalizeModelRoute(field.current)
    const model = parseModelMenuChoices(entry.catalog !== undefined ? entry.catalog : catalog, route).find(choice => choice.provider === route.provider && choice.model === route.model)?.label || ''
    return [entry.ns, pluginTitle(entry, t), fieldLabel(field, t), hubText(field.description, t.language), field.path.join('.'), route.provider, route.model, model, !route.model ? followLabel(field, t) : '']
      .some(text => text?.toLocaleLowerCase().includes(needle))
  }) })).filter(entry => entry.fields.length > 0 || ((entry.error || entry.catalogError) && (!needle || [entry.ns, pluginTitle(entry, t)].some(text => text.toLocaleLowerCase().includes(needle)))))
  const disabled = writing !== '' || refreshing || writeError !== '' || (saved && listError !== '')
  const refreshNow = async () => {
    const scope = scopeRef.current
    // A status retry uses the same coordinated read and cannot queue behind a
    // write or rebase a descriptor until the current operation has settled.
    if (scope?.api === api && !scope.busy) await refresh(scope)
  }
  const catalogStatus = {
    loading: refreshing,
    error: catalogError ? hubMessage(catalogError, t.language) : '',
    failures: modelCatalogFailures(catalog),
    refresh: refreshNow,
  }
  return <section className="dsh-model-hub dsh-ui-page" lang={t.language} aria-label={t('title')} aria-busy={writing !== '' || refreshing}>
    <Style />
    <SegmentedTabs<'fields' | 'cast'>
      value={tab}
      onChange={setTab}
      label={t('tabsLabel')}
      className="hub-tabs"
      items={[
        { value: 'fields', label: t('tabFields'), id: 'dsh-model-hub-tab-fields', panelId: 'dsh-model-hub-panel-fields' },
        { value: 'cast', label: t('tabCast'), id: 'dsh-model-hub-tab-cast', panelId: 'dsh-model-hub-panel-cast' },
      ]}
    />
    <div role="tabpanel" id="dsh-model-hub-panel-fields" aria-labelledby="dsh-model-hub-tab-fields" hidden={tab !== 'fields'} className="dsh-ui-stack">
    <div className="hub-toolbar">
      <Input className="hub-search" type="search" aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} />
      <Button variant="ghost" disabled={writing !== '' || refreshing} onClick={refreshNow}>{refreshing ? t('refreshing') : t('refresh')}</Button>
    </div>
    {listError ? <p role="alert" className="dsh-ui-error dsh-ui-wrap">{t(saved ? 'savedRefreshFailed' : 'failed', hubMessage(listError, t.language))}</p> : null}
    {syncError ? <p role="alert" className="dsh-ui-error dsh-ui-wrap">{t('syncFailed', hubMessage(syncError, t.language))}</p> : null}
    <ModelCatalogStatus state={catalogStatus} locale={t.language} />
    {writeError ? <p role="alert" className="dsh-ui-error dsh-ui-wrap">{t('writeFailed', hubMessage(writeError, t.language))}</p> : null}
    {writing ? <p role="status" className="dsh-ui-help">{t('saving')}</p> : null}
    {saved && !listError ? <p role="status" className="dsh-ui-help">{t('saved')}</p> : null}
    {entries === null && !listError ? <p className="dsh-ui-loading">{t('loading')}</p> : null}
    {entries !== null && groups.length === 0 ? <p className="dsh-ui-help">{t('empty')}</p> : null}
    {groups.length > 0 && visible.length === 0 ? <p className="dsh-ui-help">{t('noFields')}</p> : null}
    {visible.map(entry => <section key={entry.ns} className="hub-group" aria-label={pluginTitle(entry, t)}>
      <div className="hub-group-head"><h3 className="hub-group-title">{pluginTitle(entry, t)}</h3><span className="hub-namespace">{entry.ns}</span></div>
      {entry.error ? <p role="alert" className="dsh-ui-error dsh-ui-wrap">{t('failed', hubMessage(hubText(entry.error, t.language), t.language))}</p> : null}
      {entry.catalogError ? <p role="alert" className="dsh-ui-error dsh-ui-wrap">{t('catalogFailed', hubMessage(hubText(entry.catalogError, t.language), t.language))}</p> : null}
      {entry.catalog !== undefined ? catalogFailures(entry.catalog).map((failure, index) => <p key={index} role="alert" className="dsh-ui-error dsh-ui-wrap">{t('catalogFailed', hubMessage(failure, t.language))}</p>) : null}
      {entry.fields.map(field => {
        const key = `${entry.ns}:${field.path.join('.')}`
        const label = fieldLabel(field, t)
        return <div key={key} className="hub-row">
          <div className="hub-row-copy"><div className="hub-row-label">{label}</div>
            {field.description ? <p className="hub-row-description">{hubText(field.description, t.language)}</p> : null}</div>
          <div className="hub-editor">{field.editable === false ? field.description ? null : <span className="dsh-ui-help">{t('collectionTemplate')}</span> : <FieldMenu
            t={t}
            catalog={entry.catalog !== undefined ? entry.catalog : catalog}
            current={field.current}
            label={label}
            allowFollow={field.allowFollow}
            followLabel={followLabel(field, t)}
            reasoningEffort={field.supportsReasoning === false ? false : field.marker?.reasoningEffort}
            disabled={disabled || !!entry.error || !!entry.catalogError || (entry.catalog === undefined && catalog === null)}
            onSet={route => setRoute(entry, field, route)}
          />}</div>
        </div>
      })}
    </section>)}
    </div>
    <div role="tabpanel" id="dsh-model-hub-panel-cast" aria-labelledby="dsh-model-hub-tab-cast" hidden={tab !== 'cast'}>
      {tab === 'cast' ? <CastPage api={api} locale={locale} /> : null}
    </div>
  </section>
}

interface HubClientContext {
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register(options: unknown, component: unknown): unknown
  }
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: unknown; error?: { message?: string } }> } }
  remote: { session: { modelCatalog(): Promise<unknown> } }
  effect(callback: () => () => void | Promise<void>): unknown
  locale: LocaleLike
}

export function apply(ctx: unknown): void {
  const client = ctx as unknown as HubClientContext
  mountModelSettingsChanges(ctx as ModelSettingsSubscriberContext, BUNDLE)
  const changes = createModelSettingsSubscriber(ctx as ModelSettingsSubscriberContext, BUNDLE, modelSettingsChangesIdentity(BUNDLE), () => true)
  const call = async (endpoint: string, payload: unknown): Promise<never> => {
    const result = await client.connection.rpc.call(CHANNEL, endpoint, payload)
    if (!result?.ok) throw new Error(result?.error?.message || 'Request failed')
    return result.value as never
  }
  const api: HubApi = Object.freeze({
    list: () => call('fields.list', {}),
    setField: (payload: { ns: string; path: string[]; route: unknown; expectedRevision: number; ownerId?: string }) => call('fields.set', payload),
    modelCatalog: () => readModelCatalog(client),
    subscribeChanges: changes.subscribe,
    getCast: () => call('cast.get', {}),
    setCastEnabled: (payload: { enabled: boolean; expectedRevision: number }) => call('cast.setEnabled', payload),
    addCastRoute: (payload: { route: unknown; expectedRevision: number }) => call('cast.addRoute', payload),
    setCastRoute: (payload: { index: number; route: unknown; expectedRevision: number }) => call('cast.setRoute', payload),
    removeCastRoute: (payload: { index: number; expectedRevision: number }) => call('cast.removeRoute', payload),
    setCastTendency: (payload: { provider: string; model: string; tendency: string; expectedRevision: number }) => call('cast.setTendency', payload),
    listRunning: () => call('cast.running', {}),
  })
  client.slots.inject('plugins.bundle.config', () => client.slots.register({
    name: 'plugins.bundle.config', key: BUNDLE, inject: () => ({ api, locale: (ctx as { locale?: LocaleLike }).locale }),
  }, HubPage))
}
