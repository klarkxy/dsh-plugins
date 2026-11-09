/**
 * Shared "default auxiliary model" settings card.
 *
 * Any number of feature plugins call `registerAuxiliaryModelSettings(ctx)`
 * from their client half; a single card appears as the `auxiliary-model` row
 * of the shared Session Management settings column for as long as at least
 * one participant lives. The card is root-owned shared infrastructure, not a
 * business plugin: every bundled copy of this helper rendezvouses on the same
 * Cordis root service, so no participant depends on another being enabled, the
 * card is mounted once (duplicate row ids would throw), and the last
 * `release()` removes it. The card also retains the shared page itself, so a
 * lone auxiliary plugin still yields the column — participants never depend
 * on another business plugin providing their settings page.
 *
 * The storage side lives in the shared host service behind the plugin-kit RPC
 * channel: `defaults.get` returns `{revision, model}` and `defaults.set`
 * carries `{model, expectedRevision}` with an empty provider/model clearing
 * the override. Cross-window invalidation rides the existing model-settings
 * change stream — no polling is added anywhere in this file.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Button, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  readModelCatalog, modelMenuEffortLabel, modelMenuEffortOptions, parseModelMenuChoices, type ModelRoute,
} from '@klarkxy/dsh-model-route'
import { ModelCatalogStatus, ModelMenu, modelMenuCss, useModelCatalog } from '@klarkxy/dsh-model-route/ui'
import { officialUiCss } from './official-ui.ts'
import { renderModelPicker, useModelMenuAnchor, type RenderFactorySlot } from './model-picker.tsx'
import {
  createModelSettingsSubscriber, modelSettingsChangesRemote, type ModelSettingsSubscriber,
} from './model-settings-client.ts'
import { registerSessionSettingsItem } from './client-utils.ts'
import {
  AUXILIARY_MODEL_CHANNEL, AUXILIARY_MODEL_CHANGES_IDENTITY, AUXILIARY_MODEL_NS,
  type AuxiliaryModelDefaults, type RpcResult,
} from './contracts.ts'

const AUXILIARY_MODEL_PACKAGE = '@klarkxy/dsh-plugin-kit'

/** The stored row; re-exported so card consumers share the contract shape. */
export type AuxiliaryModelSnapshot = AuxiliaryModelDefaults

/* The card is one row of the shared Session Management column: the item slot
 * is a root-scope list declared by the shared page, and row ids must be
 * unique. The row sorts ahead of every business participant. */
export const AUXILIARY_MODEL_SEAT_ID = 'auxiliary-model'
export const AUXILIARY_MODEL_SEAT_ORDER = 55

/** Private Cordis rendezvous; every bundled copy resolves the same root service. */
const AUXILIARY_MODEL_CARD_SERVICE = 'dshAuxiliaryModelSettingsCard'

/** Theme-token-only stylesheet: officialUiCss scope plus the shared ModelMenu recipe. */
export const auxiliaryModelCss = `${officialUiCss('ams-root')}${modelMenuCss}
.ams-root .ams-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
`

const auxiliaryCopy = {
  zh: {
    title: '默认辅助模型',
    help: '各辅助功能（如标题生成、摘要）没有单独指定模型时使用的模型；仅影响声明使用它的功能。',
    model: '辅助模型',
    modelDefault: '跟随会话或宿主默认',
    modelHint: '不选择模型时，各功能按自己的规则决定对话模型。',
    effortDefault: '跟随模型默认',
    loading: '正在读取设置…',
    failed: '无法读取模型设置。',
    stale: '设置已被其他窗口更新，请刷新后重试。',
    saveFailed: '保存失败，原设置未更改。请重试。',
    saved: '已保存。',
    retry: '重试',
    refresh: '刷新设置',
    syncUnavailable: '自动刷新不可用，请手动刷新设置。',
  },
  en: {
    title: 'Default Auxiliary Model',
    help: 'The model used by auxiliary features (such as title generation or summarizing) that do not name their own model; only features that opted in are affected.',
    model: 'Auxiliary model',
    modelDefault: 'Follow session or host default',
    modelHint: 'With no model selected, each feature follows its own rules for the conversation model.',
    effortDefault: 'Follow model default',
    loading: 'Loading settings…',
    failed: 'Could not load model settings.',
    stale: 'Settings were changed elsewhere; refresh and retry.',
    saveFailed: 'Save failed; the previous setting was not changed. Try again.',
    saved: 'Saved.',
    retry: 'Retry',
    refresh: 'Refresh settings',
    syncUnavailable: 'Automatic refresh unavailable; refresh settings manually.',
  },
} as const
type AuxiliaryCopy = (typeof auxiliaryCopy)['zh'] | (typeof auxiliaryCopy)['en']

/** A failed RPC keeps its code so the card can translate known rejections. */
class AuxiliaryRpcError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'AuxiliaryRpcError' }
}

/** The client services this card reads; the shared service passes ctx.root. */
export interface AuxiliaryModelClient {
  connection: {
    rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
    generation?: { subscribe(listener: () => void): () => void }
  }
  remote?: { session?: { modelCatalog?: () => Promise<unknown> } }
  locale?: { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
}

/** Host UI language, following live switches with the host's English fallback. */
function useAuxiliaryLocale(client: AuxiliaryModelClient): 'zh' | 'en' {
  const subscribe = useCallback((listener: () => void) => client.locale?.subscribe(listener) ?? (() => {}), [client])
  const snapshot = useCallback(() => client.locale?.getSnapshot().active ?? 'en', [client])
  return String(useSyncExternalStore(subscribe, snapshot, snapshot)).startsWith('zh') ? 'zh' : 'en'
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /abort|cancel/i.test(error.message))
}

/* A revision mismatch is a lost race, not a broken save: the stored row moved
 * past the one the user edited. The host reports it as auxiliary-model/conflict;
 * the message fallback covers older hosts that surfaced it as internal. */
function isStaleRejection(error: unknown): boolean {
  if (!(error instanceof AuxiliaryRpcError)) return false
  return error.code === 'stale' || error.code === 'auxiliary-model/conflict'
    || /changed|revision|reload|stale|conflict/i.test(error.message)
}

async function callAuxiliaryRpc<T>(
  client: AuxiliaryModelClient, endpoint: string, payload: unknown = {},
): Promise<T> {
  const result = await client.connection.rpc.call(AUXILIARY_MODEL_CHANNEL, endpoint, payload) as RpcResult<T> | undefined
  if (!result || result.ok !== true) {
    const error = result && 'error' in result ? result.error : undefined
    throw new AuxiliaryRpcError(error?.code ?? 'unknown', error?.message ?? `RPC ${endpoint} failed`)
  }
  return result.value
}

/**
 * The shared card. All state comes from the shared host service over the
 * plugin-kit RPC channel; the card only renders the stored row.
 */
export function AuxiliaryModelCard({ client, subscribe, renderFactorySlot }: {
  client: AuxiliaryModelClient
  /** Settings-change invalidation; injected for tests without a live stream. */
  subscribe?: (change: () => void, error?: (message: string) => void) => () => void
  /** Framework-composed factory renderer; absent under direct test renders. */
  renderFactorySlot?: RenderFactorySlot
}): ReactNode {
  const language = useAuxiliaryLocale(client)
  const text: AuxiliaryCopy = auxiliaryCopy[language]
  const [settings, setSettings] = useState<AuxiliaryModelSnapshot>()
  const loadCatalog = useCallback(() => readModelCatalog(client), [client])
  const subscribeCatalog = useCallback(
    (change: () => void) => client.connection.generation?.subscribe(change), [client])
  const catalogState = useModelCatalog(loadCatalog, { subscribe: subscribeCatalog })
  const { refresh: refreshCatalog } = catalogState
  const choices = parseModelMenuChoices(catalogState.catalog, settings?.model ?? undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<'' | 'failed' | 'stale' | 'saveFailed'>('')
  const [note, setNote] = useState(false)
  const [busy, setBusy] = useState(false)
  const [syncError, setSyncError] = useState('')
  const operation = useRef({ epoch: 0, active: false, reading: false, writing: false, pending: false })
  const refreshRef = useRef<() => void>(() => {})

  const refresh = () => {
    const state = operation.current
    if (!state.active) return
    if (state.reading || state.writing) { state.pending = true; return }
    state.pending = false; state.reading = true; setBusy(true)
    const epoch = state.epoch
    void callAuxiliaryRpc<AuxiliaryModelSnapshot>(client, 'defaults.get').then(next => {
      if (state.active && state.epoch === epoch && !state.pending) {
        setSettings(next); setError('')
      }
    }).catch(reason => {
      if (state.active && state.epoch === epoch && !state.pending && !isAbort(reason)) setError('failed')
    }).finally(() => {
      if (!state.active || state.epoch !== epoch) return
      state.reading = false; setBusy(false)
      if (state.pending) refreshRef.current()
    })
  }
  refreshRef.current = refresh
  useEffect(() => {
    const state = operation.current
    state.epoch++; state.active = true; state.reading = false; state.writing = false; state.pending = false
    setBusy(false); setSettings(undefined); setError(''); setNote(false)
    refreshRef.current()
    return () => { state.active = false; state.epoch++ }
  }, [client])
  // Cross-window invalidation rides the shared model-settings change stream.
  useEffect(() => {
    setSyncError('')
    let live = true
    let stop: (() => void) | undefined
    try {
      stop = subscribe?.(() => {
        if (live) { setSyncError(''); refreshCatalog(); refreshRef.current() }
      }, message => { if (live) setSyncError(message) })
    } catch {
      // A subscriber that cannot even attach degrades to manual refresh.
      if (live) setSyncError('Model settings sync service unavailable')
    }
    return () => { live = false; try { stop?.() } catch { /* detach is best-effort */ } }
  }, [subscribe, refreshCatalog])

  const save = useCallback((model: ModelRoute | null) => {
    const state = operation.current
    if (!settings || !state.active || state.writing || state.reading) return
    state.writing = true
    const epoch = state.epoch
    setBusy(true); setNote(false); setError('')
    void callAuxiliaryRpc<AuxiliaryModelSnapshot>(client, 'defaults.set', {
      model: model ?? { provider: '', model: '' },
      expectedRevision: settings.revision,
    }).then(next => {
      if (state.active && state.epoch === epoch) { setSettings(next); setNote(true); refreshCatalog() }
    }).catch(reason => {
      if (state.active && state.epoch === epoch) {
        setError(isStaleRejection(reason) ? 'stale' : 'saveFailed')
      }
    }).finally(() => {
      if (!state.active || state.epoch !== epoch) return
      state.writing = false; setBusy(false)
      if (state.pending) refreshRef.current()
    })
  }, [client, settings, refreshCatalog])

  const locked = busy
  const current = settings?.model ?? { provider: '', model: '' }
  const follow = !current.provider || !current.model
  const selected = follow ? undefined : choices.find(item => item.provider === current.provider && item.model === current.model)
  const efforts = follow ? [] : modelMenuEffortOptions(selected, current.reasoningEffort)
  const currentLabel = follow ? text.modelDefault : selected?.label ?? `${current.provider} / ${current.model}`
  const selectedEffort = efforts.find(item => item.id === (current.reasoningEffort || ''))
  const effortName = selectedEffort ? modelMenuEffortLabel(selectedEffort, language) : undefined
  // The shared picker's anchor mirrors the trigger the fallback menu renders.
  const anchor = useModelMenuAnchor(`${text.model}: ${settings ? currentLabel : ''}`, undefined,
    () => setMenuOpen(false))
  if (!settings) {
    return <section className="ams-root dsh-ui-card" data-testid="auxiliary-model-settings">
      <span className="dsh-ui-heading">{text.title}</span>
      <p className="dsh-ui-help">{text.help}</p>
      {error
        ? <p role="alert" className="dsh-ui-error">{text[error]}</p>
        : <p role="status" className="dsh-ui-hint">{text.loading}</p>}
      {syncError && <p role="status" className="dsh-ui-hint">{text.syncUnavailable}</p>}
      <div className="dsh-ui-actions">
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => refreshRef.current()}>{text.retry}</Button>
      </div>
    </section>
  }


  return <section className="ams-root dsh-ui-card" data-testid="auxiliary-model-settings">
    <span className="dsh-ui-heading">{text.title}</span>
    <p className="dsh-ui-help">{text.help}</p>
    <div className="dsh-ui-field">
      <span className="dsh-ui-label">{text.model}</span>
      <ModelCatalogStatus state={catalogState} locale={language} />
      {renderModelPicker(renderFactorySlot, {
        locale: language,
        disabled: locked,
        busy: locked,
        onOpenChange: next => setMenuOpen(next && !locked),
        listClassName: 'ams-root ams-menu-portal',
        choices,
        selected: follow ? undefined : { provider: current.provider, model: current.model },
        onPick: picked => save({ provider: picked.provider, model: picked.model }),
        leading: [{ id: 'default', label: text.modelDefault, selected: follow }],
        onPickLeading: () => save(null),
        efforts,
        selectedEffort: current.reasoningEffort || '',
        onPickEffort: effort => save(follow
          ? null
          : { provider: current.provider, model: current.model, ...(effort ? { reasoningEffort: effort } : {}) }),
        triggerLabel: currentLabel,
        triggerEffortLabel: !follow && efforts.length ? (effortName ?? text.effortDefault) : undefined,
        modelLabel: text.model,
        modelValue: currentLabel,
        defaultEffortLabel: text.effortDefault,
      }, {
        anchor,
        fallback: <ModelMenu
          locale={language}
          open={menuOpen && !locked}
          onOpenChange={next => setMenuOpen(next && !locked)}
          listClassName="ams-root ams-menu-portal"
          anchor={<button type="button" className="dsh-model-menu-trigger" disabled={locked}
            aria-label={`${text.model}: ${currentLabel}`}>
            <span className="dsh-model-menu-triggerLabel">{currentLabel}</span>
            {!follow && efforts.length ? <span className="dsh-model-menu-triggerEffort">{effortName ?? text.effortDefault}</span> : null}
            <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${menuOpen && !locked ? ' dsh-model-menu-chevronOpen' : ''}`} />
          </button>}
          choices={choices}
          selected={follow ? undefined : { provider: current.provider, model: current.model }}
          onPick={picked => save({ provider: picked.provider, model: picked.model })}
          leading={[{ id: 'default', label: text.modelDefault, selected: follow }]}
          onPickLeading={() => save(null)}
          efforts={efforts}
          selectedEffort={current.reasoningEffort || ''}
          onPickEffort={effort => save(follow
            ? null
            : { provider: current.provider, model: current.model, ...(effort ? { reasoningEffort: effort } : {}) })}
          modelLabel={text.model}
          modelValue={currentLabel}
          defaultEffortLabel={text.effortDefault}
        />,
      })}
      <span className="dsh-ui-hint">{text.modelHint}</span>
    </div>
    <div className="ams-row">
      {syncError && <p role="status" className="dsh-ui-hint">{text.syncUnavailable}</p>}
      {error && <p role="alert" className="dsh-ui-error">{text[error]}</p>}
      {note && <p role="status" className="dsh-ui-notice">{text.saved}</p>}
      {error || syncError ? (
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => refreshRef.current()}>{text.refresh}</Button>
      ) : null}
    </div>
  </section>
}

interface AuxiliaryRoot {
  get(name: string, strict?: boolean): unknown
  provide(name: string, value: unknown): () => void
  inject(deps: string[], callback: (scope: unknown) => void): AuxiliaryFiber
}
interface AuxiliaryFiber {
  dispose(): void | Promise<void>
}
interface AuxiliaryRemoteMountScope {
  remote: { $mount(contribution: unknown): Promise<unknown> }
  effect(cb: () => () => void | Promise<void>): unknown
}

/* The client-side stream descriptor mount, serialized through one root
 * coordinator. Its tail carries mounts and unmounts in strict order: a new
 * mount cannot start while a previous fiber's unmount is in flight, and a
 * lease that closes before its continuation runs never mounts at all. The
 * coordinator leaves the store only when the queue is drained and no lease
 * is active — a fast teardown→re-acquire chains onto the same tail instead
 * of hitting "already registered" or overlapping a second mount. */
interface AuxiliaryWatchLease {
  fiber: AuxiliaryFiber | undefined
  closed: boolean
  done(): void
}
interface AuxiliaryWatchCoordinator {
  tail: Promise<void>
  active: number
  mount(): AuxiliaryWatchLease
}
const AUXILIARY_MODEL_WATCH_COORDINATOR = 'dshAuxiliaryModelWatchCoordinator'

function acquireWatchCoordinator(root: AuxiliaryRoot): AuxiliaryWatchCoordinator {
  const existing = root.get(AUXILIARY_MODEL_WATCH_COORDINATOR, false) as AuxiliaryWatchCoordinator | undefined
  if (existing) return existing
  let unprovide: (() => void) | undefined
  const coordinator: AuxiliaryWatchCoordinator = {
    tail: Promise.resolve(),
    active: 0,
    mount() {
      coordinator.active += 1
      const previousTail = coordinator.tail
      const lease: AuxiliaryWatchLease = {
        closed: false,
        done() {
          if (lease.closed) return
          lease.closed = true
          coordinator.active -= 1
          const owned = lease.fiber
          lease.fiber = undefined
          // The unmount joins the tail every later mount waits on.
          coordinator.tail = coordinator.tail
            .then(() => Promise.resolve(owned?.dispose()).catch(() => {}))
          // Unprovide only once the queue is really drained: a newer lease
          // already queued on this coordinator must keep it alive.
          void coordinator.tail.then(() => {
            if (coordinator.active > 0) return
            try {
              if (root.get(AUXILIARY_MODEL_WATCH_COORDINATOR, false) === coordinator) {
                void Promise.resolve(unprovide?.()).catch(() => {})
              }
            } catch { /* Root already unloading. */ }
          })
        },
        fiber: undefined,
      }
      void previousTail.then(() => {
        // A release that beat the mount ends here: nothing mounted, nothing
        // to unmount, and the tail already moved on.
        if (lease.closed) return
        // mountModelSettingsChanges performs this exact inject/$mount pair;
        // it is repeated here only because that helper returns void and the
        // fiber must be captured for symmetric teardown.
        try {
          lease.fiber = root.inject(['remote'], injected => {
            const scope = injected as AuxiliaryRemoteMountScope
            const mounting = scope.remote.$mount(
              modelSettingsChangesRemote(AUXILIARY_MODEL_PACKAGE, AUXILIARY_MODEL_CHANGES_IDENTITY),
            ) as Promise<(() => Promise<void>) | undefined>
            void mounting.catch(() => {})
            scope.effect(() => async () => {
              const unmount = await mounting.catch(() => undefined)
              await unmount?.()
            })
          })
        } catch { /* remote unavailable: the card degrades to manual refresh */ }
      })
      return lease
    },
  }
  unprovide = root.provide(AUXILIARY_MODEL_WATCH_COORDINATOR, coordinator)
  return coordinator
}

interface AuxiliaryCardService {
  retain(): void
  release(): void
}

/**
 * Acquire the root-owned card service, creating it on first use. One counter
 * covers participants, the seat wait and the change-stream mount: the last
 * release removes the wait, then the watch contribution, then the provider
 * itself synchronously (Cordis deletes the impl before its async disposer
 * awaits), so a later acquire sees a clean get() miss and can re-establish.
 */
function acquireAuxiliaryModelCard(root: AuxiliaryRoot, ctx: Context): AuxiliaryCardService {
  const existing = root.get(AUXILIARY_MODEL_CARD_SERVICE, false) as AuxiliaryCardService | undefined
  if (existing) return existing
  let users = 0
  let styleElement: HTMLStyleElement | undefined
  let stopItem: (() => void) | undefined
  let unprovide: (() => void) | undefined
  // The client-side stream descriptor hangs off the shared root context —
  // never a plugin fiber — so the first participant's unload cannot take the
  // card's change stream down. The coordinator still unmounts it, in tail
  // order, on the last release.
  const watchLease = acquireWatchCoordinator(root).mount()
  const subscriber: ModelSettingsSubscriber = createModelSettingsSubscriber(
    ctx.root as unknown as Parameters<typeof createModelSettingsSubscriber>[0],
    AUXILIARY_MODEL_PACKAGE,
    AUXILIARY_MODEL_CHANGES_IDENTITY,
    ns => ns === AUXILIARY_MODEL_NS,
  )
  const render = (props: { renderFactorySlot?: RenderFactorySlot }) => <AuxiliaryModelCard
    client={root as unknown as AuxiliaryModelClient}
    subscribe={subscriber.subscribe}
    renderFactorySlot={props.renderFactorySlot} />
  const service: AuxiliaryCardService = {
    retain() {
      // The reservation is counted before the throwing installs, so a failure
      // lets the caller's release() undo it fully instead of leaking the service.
      users += 1
      if (styleElement === undefined && typeof document !== 'undefined') {
        styleElement = document.createElement('style')
        styleElement.setAttribute('data-plugin', 'dsh-auxiliary-model-shared')
        styleElement.textContent = auxiliaryModelCss
        document.head.appendChild(styleElement)
      }
      /* The card is a participant of the shared column too: the root-owned
       * call contributes its row AND retains the page and nav icon, which is
       * what guarantees a lone auxiliary plugin still creates the Session
       * Management section — no business plugin has to provide it. The waits
       * sit on the root context, so they live exactly as long as the card. */
      if (!stopItem) {
        stopItem = registerSessionSettingsItem(ctx.root, {
          id: AUXILIARY_MODEL_SEAT_ID,
          order: AUXILIARY_MODEL_SEAT_ORDER,
        }, render)
      }
    },
    release() {
      if (users <= 0) return
      users -= 1
      if (users > 0) return
      stopItem?.()
      stopItem = undefined
      styleElement?.remove()
      styleElement = undefined
      watchLease.done()
      // The store entry leaves synchronously, like the shared page service:
      // the next acquire must not see a stale "already registered" marker.
      try { void Promise.resolve(unprovide?.()).catch(() => {}) } catch { /* Root already unloading. */ }
      unprovide = undefined
    },
  }
  unprovide = root.provide(AUXILIARY_MODEL_CARD_SERVICE, service)
  return service
}

/**
 * Show the shared "default auxiliary model" card while the calling plugin is
 * enabled.
 *
 * `ctx` is the plugin's own client context: the card itself is retained on the
 * shared root context for as long as any participant lives, so an arbitrary
 * subset of enabled plugins yields the same single card. The mount's slot wait
 * and the change-stream contribution are owned by the root service — the first
 * participant's unload cannot take the card down. Returns a disposer; it may
 * be invoked by both ctx.effect and an explicit caller and releases at most
 * once, so a double call cannot unbalance the shared refcount.
 */
export function registerAuxiliaryModelSettings(ctx: Context): () => void {
  const root = ctx.root as unknown as AuxiliaryRoot
  const service = acquireAuxiliaryModelCard(root, ctx)
  try {
    service.retain()
  } catch (error) {
    // A synchronous failure (for example a duplicate row id) must not pin the
    // shared card for a participant that never joined.
    service.release()
    throw error
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    service.release()
  }
}
