/**
 * dsh-model-hub — subagent cast tab. Lists the allowlist of models subagents
 * may pick from, each with an optional free-text task tendency the main agent
 * consults when delegating. Every write goes through the hub host's cast RPC
 * with the native settings revision as CAS; `cast.setTendency` uses its own
 * durable file revision. The page owns its own fetch,
 * subscription and write locking, following the HubPage RequestScope pattern.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { modelCatalogFailures, normalizeModelRoute, type ModelRoute } from '@klarkxy/dsh-model-route'
import { ModelCatalogStatus } from '@klarkxy/dsh-model-route/ui'
import { hubMessage } from './client-copy.ts'
import { FieldMenu, checkedCatalog, messageOf } from './client-model-menu.tsx'
import type { CastCommit } from './cast.ts'
import type { RunningSubagentEntry, RunningSubagentsState } from './running.ts'
export type { RunningSubagentEntry, RunningSubagentsState } from './running.ts'

/** One cast entry as served by the host: a concrete route plus its tendency. */
export interface CastRoute {
  /** Raw index in the native allowedModels array; the write handle. The host
   * skips malformed entries when reading, so a route's position in `routes`
   * can diverge from this index — always address writes by `index`. */
  index?: number
  provider: string
  model: string
  reasoningEffort?: string
  tendency?: string
}
/** Write payload for add/set: the tendency is edited by its own endpoint. */
export type CastRouteInput = ModelRoute
export interface CastState {
  enabled: boolean
  revision: number
  tendencyRevision?: number
  tendencyError?: string
  routes: CastRoute[]
}

/** The slice of the hub API this tab needs; the full HubApi extends it. */
export interface CastApi {
  getCast(): Promise<CastState>
  setCastEnabled(payload: { enabled: boolean; expectedRevision: number }): Promise<CastCommit>
  addCastRoute(payload: { route: CastRouteInput; expectedRevision: number }): Promise<CastCommit>
  setCastRoute(payload: { index: number; route: CastRouteInput; expectedRevision: number }): Promise<CastCommit>
  removeCastRoute(payload: { index: number; expectedRevision: number }): Promise<CastCommit>
  setCastTendency(payload: { provider: string; model: string; tendency: string; expectedRevision: number }): Promise<CastState>
  listRunning(): Promise<RunningSubagentsState>
  modelCatalog(): Promise<unknown>
  subscribeChanges?(onChange: () => void, onError?: (message: string) => void): () => void
}

/* One language at a time, chosen from the host locale. */
const TEXT = {
  zh: {
    title: '子代理阵容',
    enabledLabel: '启用子代理阵容',
    enabledHint: '此名单限制子代理的显式选模；不指定模型时仍可继承父会话。名单修改对新建会话生效，已有会话及其子代理沿用原名单。任务倾向供委派时参考。',
    loading: '正在读取…',
    failed: (message: string) => `读取失败：${message}`,
    syncFailed: (message: string) => `自动同步不可用：${message}`,
    writeFailed: (message: string) => `未保存：${message}。请刷新后重试。`,
    saved: '已保存。名单修改对新建会话生效。',
    savedRefreshFailed: (message: string) => `已保存；阵容刷新失败：${message}。请刷新以读取最新设置。`,
    conflict: '阵容设置已在别处修改，当前输入保留。请刷新核对后重试。',
    tendencyFailed: (message: string) => `任务倾向不可用：${message}。原文件已保留；修复后刷新。`,
    draftChanged: (saved: string) => `此任务倾向已在别处更新。当前已保存：${saved || '（空）'}。输入已保留；刷新核对后再保存。`,
    refresh: '刷新',
    refreshing: '正在刷新…',
    saving: '正在保存…',
    empty: '先添加模型，再启用显式模型选择。移除最后一个模型会关闭开关。',
    addModel: '添加模型…',
    remove: '移除',
    removeRoute: (label: string) => `移除 ${label}`,
    tendencyLabel: (label: string) => `${label} 的任务倾向`,
    tendencyPlaceholder: '例如：代码审查、快速问答…',
    routeExists: (route: string) => `路由 ${route} 已在列表中`,
    follow: '跟随宿主默认',
    model: '模型',
    effort: '思考强度',
    effortDefault: '默认',
    searchModels: '搜索模型…',
    noModels: '没有匹配的模型',
    clearSearch: '清除搜索',
    runningTitle: '运行中的子代理',
    runningEmpty: '当前没有运行中的子代理。',
    runningPending: '尚未发起模型请求',
    runningRemote: '远程子代理，无法读取路由',
    runningFailed: (message: string) => `运行状态读取失败：${message}`,
    effortAdapterDefault: (effort: string) => `${effort}（适配器默认）`,
  },
  en: {
    title: 'Subagent Cast',
    enabledLabel: 'Enable subagent cast',
    enabledHint: 'This list limits explicit subagent model choices; omitting a model can still inherit the parent session. List changes apply to new conversations. Existing conversations and their subagents keep their saved lists. Task tendencies guide delegation.',
    loading: 'Loading…',
    failed: (message: string) => `Load failed: ${message}`,
    syncFailed: (message: string) => `Live sync unavailable: ${message}`,
    writeFailed: (message: string) => `Not saved: ${message}. Refresh, then try again.`,
    saved: 'Saved. List changes apply to new conversations.',
    savedRefreshFailed: (message: string) => `Saved; cast refresh failed: ${message}. Refresh to read the latest settings.`,
    conflict: 'Cast settings changed elsewhere; your draft is preserved. Refresh, review, then try again.',
    tendencyFailed: (message: string) => `Task tendencies unavailable: ${message}. The original file is preserved; repair it, then refresh.`,
    draftChanged: (saved: string) => `This tendency changed elsewhere. Currently saved: ${saved || '(empty)'}. Your draft is preserved; refresh and review before saving.`,
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    saving: 'Saving…',
    empty: 'Add a model before enabling explicit model selection. Removing the last model turns the switch off.',
    addModel: 'Add model…',
    remove: 'Remove',
    removeRoute: (label: string) => `Remove ${label}`,
    tendencyLabel: (label: string) => `Task tendency for ${label}`,
    tendencyPlaceholder: 'e.g. code review, quick Q&A…',
    routeExists: (route: string) => `Route ${route} is already in the list`,
    follow: 'Follow host default',
    model: 'Model',
    effort: 'Reasoning',
    effortDefault: 'Default',
    searchModels: 'Search models…',
    noModels: 'No matching models',
    clearSearch: 'Clear search',
    runningTitle: 'Running subagents',
    runningEmpty: 'No subagents are running.',
    runningPending: 'No model request yet',
    runningRemote: 'Remote subagent; route unavailable',
    runningFailed: (message: string) => `Running state failed: ${message}`,
    effortAdapterDefault: (effort: string) => `${effort} (adapter default)`,
  },
}
/* Exported so the i18n spec can check zh/en key alignment. */
export const castCopy = TEXT
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

const castCss = `
.dsh-model-hub .cast-head{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.dsh-model-hub .cast-row{display:grid;grid-template-columns:minmax(180px,1fr) minmax(160px,1fr) auto;gap:12px;align-items:center;padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.dsh-model-hub .cast-row-model{min-width:0}
.dsh-model-hub .cast-row-model .dsh-model-menu-root{max-width:100%}
.dsh-model-hub .cast-row-model .dsh-model-menu-trigger{max-width:100%}
.dsh-model-hub .cast-row-tendency{min-width:0}
.dsh-model-hub .cast-banner{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.dsh-model-hub .cast-add{display:flex}
.dsh-model-hub .cast-add .dsh-model-menu-root{max-width:100%}
.dsh-model-hub .cast-running{margin-top:16px}
.dsh-model-hub .cast-running-title{font-size:14px;line-height:22px;font-weight:600;margin:0 0 4px;color:var(--dsw-alias-label-primary)}
.dsh-model-hub .cast-running-row{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;padding:6px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.dsh-model-hub .cast-running-label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;min-width:0}
.dsh-model-hub .cast-running-route{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;min-width:0}
@media(max-width:520px){.dsh-model-hub .cast-row{grid-template-columns:minmax(0,1fr);gap:8px}}
`

/** CAS rejections all carry a refresh hint in either language. */
function isConflict(message: string): boolean {
  return /refresh and retry|reload and retry|刷新后重试|重新加载后重试|请先刷新/i.test(message)
}

/** The host's duplicate-route error interpolates the route; localize it here. */
function localizeCastError(message: string, t: ReturnType<typeof useText>): string {
  const duplicate = /^Route "(.+)" already exists$/.exec(message)
  if (duplicate) return t('routeExists', duplicate[1]!)
  return hubMessage(message, t.language)
}

function routeInput(route: ModelRoute): CastRouteInput {
  const normalized = normalizeModelRoute(route)
  return normalized.reasoningEffort
    ? { provider: normalized.provider, model: normalized.model, reasoningEffort: normalized.reasoningEffort }
    : { provider: normalized.provider, model: normalized.model }
}

interface RequestScope { api: CastApi; active: boolean; busy: boolean; queued: boolean }

/** One live subagent row: label (or short id) plus its effective route. */
function runningRouteText(entry: RunningSubagentEntry, t: ReturnType<typeof useText>): string {
  if (!entry.local) return t('runningRemote')
  const route = entry.route
  if (!route) return t('runningPending')
  const effort = route.reasoningEffort
    ? entry.effortIsAdapterDefault ? t('effortAdapterDefault', route.reasoningEffort) : route.reasoningEffort
    : ''
  return `${route.provider} / ${route.model}${effort ? ` · ${effort}` : ''}`
}

/** One cast entry: model picker, tendency input saved on blur, remove button. */
function CastRow({ t, catalog, route, tendencyRevision, draftReview, disabled, tendencyDisabled, menuDisabled, onSetRoute, onSetTendency, onRemove }: {
  t: ReturnType<typeof useText>
  catalog: unknown
  route: CastRoute
  tendencyRevision: number | undefined
  draftReview: number
  disabled: boolean
  tendencyDisabled: boolean
  menuDisabled: boolean
  onSetRoute: (route: ModelRoute) => void
  onSetTendency: (tendency: string, expectedRevision: number) => void
  onRemove: () => void
}) {
  const label = `${route.provider} / ${route.model}`
  const saved = route.tendency ?? ''
  const [draft, setDraft] = useState({ text: saved, saved, revision: tendencyRevision, review: draftReview })
  useEffect(() => {
    setDraft(current => {
      if (current.text.trim() === current.saved || current.text.trim() === saved) return { text: saved, saved, revision: tendencyRevision, review: draftReview }
      // Only an explicit user refresh rebases an unsaved draft. Automatic
      // notifications keep the version it was based on, so blur cannot clobber.
      return current.review !== draftReview ? { ...current, saved, revision: tendencyRevision, review: draftReview } : current
    })
  }, [saved, tendencyRevision, draftReview])
  return <div className="cast-row">
    <div className="cast-row-model">
      {/* The native AllowedModelRoute schema is {provider, model} only, so the
       * effort picker stays hidden; an effort carried by older data still
       * round-trips through reads but is dropped when the route is re-picked. */}
      <FieldMenu t={t} catalog={catalog} current={route} label={label} allowFollow={false} reasoningEffort={false} disabled={menuDisabled} onSet={onSetRoute} />
    </div>
    <div className="cast-row-tendency">
      <Input type="text" aria-label={t('tendencyLabel', label)} placeholder={t('tendencyPlaceholder')}
        value={draft.text} disabled={tendencyDisabled} maxLength={500}
        onChange={event => setDraft(current => ({ ...current, text: event.target.value }))}
        onBlur={() => { const tendency = draft.text.trim(); if (!tendencyDisabled && draft.revision !== undefined && tendency !== saved) onSetTendency(tendency, draft.revision) }} />
      {draft.text.trim() !== saved && draft.revision !== tendencyRevision ? <p role="status" className="dsh-ui-help dsh-ui-wrap">{t('draftChanged', saved)}</p> : null}
    </div>
    <Button variant="outline" aria-label={t('removeRoute', label)} disabled={disabled} onClick={onRemove}>{t('remove')}</Button>
  </div>
}

export function CastPage({ api, locale }: { api: CastApi; locale: LocaleLike }) {
  const t = useText(locale)
  const [cast, setCast] = useState<CastState | null>(null)
  const [catalog, setCatalog] = useState<unknown>(null)
  const [running, setRunning] = useState<RunningSubagentsState | null>(null)
  const [runningError, setRunningError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [writeError, setWriteError] = useState('')
  const [saved, setSaved] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [saving, setSaving] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [draftReview, setDraftReview] = useState(0)
  const scopeRef = useRef<RequestScope | null>(null)
  const refresh = useCallback(async (scope: RequestScope, reviewDrafts = false) => {
    if (!scope.active) return
    if (scope.busy) { scope.queued = true; return }
    scope.queued = false
    scope.busy = true
    setRefreshing(true)
    // These independent reads all run even when one fails. Retain each last
    // successful result, and never replay a rejected write after refreshing.
    const [castResult, models, live] = await Promise.allSettled([
      Promise.resolve().then(() => scope.api.getCast()),
      Promise.resolve().then(() => scope.api.modelCatalog()).then(checkedCatalog),
      Promise.resolve().then(() => scope.api.listRunning()),
    ])
    if (!scope.active) return
    if (castResult.status === 'fulfilled') {
      setCast(castResult.value); setLoadError(''); setWriteError(''); setConflict(false); setSaved(false)
      if (reviewDrafts) setDraftReview(current => current + 1)
    }
    else setLoadError(messageOf(castResult.reason))
    if (models.status === 'fulfilled') { setCatalog(models.value); setCatalogError('') }
    else setCatalogError(messageOf(models.reason))
    if (live.status === 'fulfilled') { setRunning(live.value); setRunningError('') }
    else setRunningError(messageOf(live.reason))
    scope.busy = false
    setRefreshing(false)
    if (scope.queued) void refresh(scope)
  }, [])
  useEffect(() => {
    const scope: RequestScope = { api, active: true, busy: false, queued: false }
    scopeRef.current = scope
    setSaving('')
    setWriteError('')
    setSaved(false)
    setConflict(false)
    setLoadError('')
    setCatalogError('')
    setSyncError('')
    setCast(null)
    setCatalog(null)
    setRunning(null)
    setRunningError('')
    void refresh(scope)
    const unsubscribe = api.subscribeChanges?.(() => {
      if (!scope.active) return
      setSyncError('')
      void refresh(scope)
    }, message => { if (scope.active) setSyncError(message) })
    return () => { scope.active = false; unsubscribe?.(); scopeRef.current = null }
  }, [api, refresh])
  const mutate = (key: string, run: (scope: RequestScope) => Promise<CastState | CastCommit>) => {
    const scope = scopeRef.current
    if (!scope?.active || scope.api !== api || scope.busy || writeError || (saved && loadError)) return
    // Lock before React's next commit so same-tick selections cannot race CAS.
    scope.busy = true
    setSaved(false)
    setSaving(key)
    Promise.resolve().then(() => run(scope))
      .then(value => {
        if (!scope.active) return
        if ('committed' in value) { setSaved(true); scope.queued = true }
        else setCast(value)
        setWriteError(''); setConflict(false)
      },
        error => { if (scope.active) { const message = messageOf(error); setWriteError(message); setConflict(isConflict(message)) } })
      .finally(() => {
        if (scope.active) {
          scope.busy = false
          setSaving('')
          if (scope.queued) void refresh(scope)
        }
      })
  }
  const refreshNow = async () => {
    const scope = scopeRef.current
    if (scope?.api === api && !scope.busy) await refresh(scope, true)
  }
  const disabled = saving !== '' || refreshing || writeError !== '' || (saved && loadError !== '')
  const catalogStatus = {
    loading: refreshing,
    error: catalogError ? hubMessage(catalogError, t.language) : '',
    failures: modelCatalogFailures(catalog),
    refresh: refreshNow,
  }
  /* The root also carries the hub root class so officialUiCss('dsh-model-hub')
   * and castCss (both scoped under .dsh-model-hub) still apply when CastPage
   * renders outside HubPage's own subtree. */
  return <div className="cast-root dsh-model-hub dsh-ui-stack" aria-label={t('title')} aria-busy={saving !== '' || refreshing}>
    <style>{castCss}</style>
    <div className="cast-head">
      <Switch checked={cast?.enabled ?? false} label={t('enabledLabel')} disabled={disabled || cast === null || (!cast.enabled && cast.routes.length === 0)}
        onChange={next => { if (cast) mutate('enabled', scope => scope.api.setCastEnabled({ enabled: next, expectedRevision: cast.revision })) }} />
      <Button variant="ghost" disabled={saving !== '' || refreshing} onClick={refreshNow}>{refreshing ? t('refreshing') : t('refresh')}</Button>
    </div>
    <p className="dsh-ui-help">{t('enabledHint')}</p>
    {loadError ? <p role="alert" className="dsh-ui-error dsh-ui-wrap">{t(saved ? 'savedRefreshFailed' : 'failed', hubMessage(loadError, t.language))}</p> : null}
    {cast?.tendencyError ? <p role="alert" className="dsh-ui-error dsh-ui-wrap">{t('tendencyFailed', hubMessage(cast.tendencyError, t.language))}</p> : null}
    {syncError ? <p role="alert" className="dsh-ui-error dsh-ui-wrap">{t('syncFailed', hubMessage(syncError, t.language))}</p> : null}
    <ModelCatalogStatus state={catalogStatus} locale={t.language} />
    {writeError ? <div className="dsh-ui-banner dsh-ui-banner--danger cast-banner" role="alert">
      <span className="dsh-ui-wrap">{conflict ? t('conflict') : t('writeFailed', localizeCastError(writeError, t))}</span>
      <Button variant="outline" size="sm" disabled={saving !== '' || refreshing} onClick={refreshNow}>{refreshing ? t('refreshing') : t('refresh')}</Button>
    </div> : null}
    {saving ? <p role="status" className="dsh-ui-help">{t('saving')}</p> : null}
    {saved && !loadError ? <p role="status" className="dsh-ui-help">{t('saved')}</p> : null}
    {cast === null && !loadError ? <p className="dsh-ui-loading">{t('loading')}</p> : null}
    {cast !== null && cast.routes.length === 0 ? <p className="dsh-ui-help">{t('empty')}</p> : null}
    {cast?.routes.map((route, position) => {
      /* Writes address the host's raw route index; fall back to the array
       * position only for contract-conforming hosts that omit it. */
      const handle = route.index ?? position
      return <CastRow key={JSON.stringify([route.provider, route.model])}
        t={t} catalog={catalog} route={route}
        tendencyRevision={cast.tendencyRevision} draftReview={draftReview}
        tendencyDisabled={disabled || !!cast.tendencyError || cast.tendencyRevision === undefined}
        disabled={disabled} menuDisabled={disabled || catalog === null}
        onSetRoute={next => mutate(`route:${handle}`, scope => scope.api.setCastRoute({ index: handle, route: routeInput(next), expectedRevision: cast.revision }))}
        onSetTendency={(tendency, expectedRevision) => mutate(`tendency:${handle}`, scope => scope.api.setCastTendency({ provider: route.provider, model: route.model, tendency, expectedRevision }))}
        onRemove={() => mutate(`remove:${handle}`, scope => scope.api.removeCastRoute({ index: handle, expectedRevision: cast.revision }))}
      />
    })}
    {cast !== null ? <div className="cast-add">
      <FieldMenu t={t} catalog={catalog} current={undefined} label={t('addModel')} allowFollow={false} followLabel={t('addModel')}
        reasoningEffort={false} disabled={disabled || catalog === null}
        onSet={picked => mutate('add', scope => scope.api.addCastRoute({ route: routeInput(picked), expectedRevision: cast.revision }))} />
    </div> : null}
    <section className="cast-running" aria-label={t('runningTitle')}>
      <h3 className="cast-running-title">{t('runningTitle')}</h3>
      {runningError ? <p role="alert" className="dsh-ui-error dsh-ui-wrap">{t('runningFailed', hubMessage(runningError, t.language))}</p> : null}
      {running === null && !runningError ? <p className="dsh-ui-loading">{t('loading')}</p> : null}
      {running !== null && running.entries.length === 0 ? <p className="dsh-ui-help">{t('runningEmpty')}</p> : null}
      {running?.entries.map(entry => <div key={entry.id} className="cast-running-row">
        <span className="cast-running-label">{entry.label || entry.id}</span>
        <span className="cast-running-route">{runningRouteText(entry, t)}</span>
      </div>)}
    </section>
  </div>
}
