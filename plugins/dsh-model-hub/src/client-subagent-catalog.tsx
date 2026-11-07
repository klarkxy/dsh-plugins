/**
 * dsh-model-hub — read-only subagent model readout inside the host's own
 * subagent catalog popup.
 *
 * The host owns two session-header cells for the subagent catalog:
 * `conversation.session.header.actions` with id `subagent-catalog` (the
 * descendant count) and `conversation.session.header.lineage` (the breadcrumb
 * switcher plus the descendant count of the current child). This module
 * registers a copy of both cells under the host's own ids with a lower
 * priority, so the plugin's version is the one the header renders while the
 * host's entry stays in the slot ledger and returns when the plugin unloads.
 *
 * The copy keeps the host's tree, navigation, sidebar, hover and keyboard
 * behaviour and adds one read-only line per catalog row: the model and the
 * reasoning effort that child session actually used. Native copy comes from
 * the host's `subagent` locale namespace; only the new route labels are local.
 *
 * The route comes from the session's `modelSelection` projection view, read as
 * `projectionValues.modelSelection.lastUsed`. The host derives that value from
 * the last `request/header` event, so it is the selection a request really
 * used. `next` is the selection intended for the *next* request (a pending
 * choice) and is never shown as an already-used route. A child that never
 * made a model request reports `lastUsed: null`, which is reported as "no
 * model request yet" rather than as a route.
 *
 * The catalog rows live in the host's private DOM contract: this module keeps
 * the host's CSS-module class names (pinned per host build) and its tree
 * roles, so the popup keeps the host's own look. When the host renames those
 * classes the popup falls back to this module's own stylesheet.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent, type MouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconRefreshOutlineRegular, StateDot, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'

/* ------------------------------------------------------------------ *
 * Host contract types
 * ------------------------------------------------------------------ */

/** One entry of a session's projected subagent catalog. */
export interface SubagentCatalogEntry {
  id: string
  label?: string
  mode?: 'one-shot' | 'continuable' | 'unknown' | 'external'
}

/** A model selection as the host records it: provider, model and optional effort. */
export interface SubagentModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/**
 * The host's `modelSelection` projection view.
 *
 * `lastUsed` is the selection the last request used and stays null until a
 * request happens. `next` is the pending selection for the next request; it is
 * part of the host's view but is never rendered as an already-used route.
 */
export interface SubagentModelSelectionProjection {
  lastUsed: SubagentModelSelection | null
  next?: SubagentModelSelection | null
}

/** Projection values the catalog rows read. */
export interface SubagentProjectionValues {
  title?: string
  modelSelection?: SubagentModelSelectionProjection
  subagentTiming?: {
    active?: { since: number; through: number }
    settledMs: number
    lastTurnCompleted?: boolean
  }
  tokenUsage?: {
    uncachedInputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
}

/** One session row of the host's session list. */
export interface SubagentSessionSummary {
  id?: string
  title?: string
  displayTitle?: string
  parentId?: string
  origin?: string
  running?: boolean
  /** Durable format state of the session's stored data. */
  formatStatus?: string
  projectionValues?: SubagentProjectionValues
}

/** One session's projected values, as the host's session store publishes them. */
export interface SubagentProjectionSnapshot {
  state: 'idle' | 'loading' | 'ready' | 'error' | 'migration-required'
  error?: { message?: string } | null
  values: { subagentCatalog?: SubagentCatalogEntry[] }
}

/** The host's session store, as the catalog reads it. */
export interface SubagentSessionsState {
  byId: Record<string, SubagentSessionSummary>
  projectionsBySession: Record<string, SubagentProjectionSnapshot>
}

/** Durable address of one addressed child session. */
export interface SubagentAddress {
  parentSessionId: string
  childSessionId: string
  mode: 'one-shot' | 'continuable' | 'unknown'
}

/** Standard session props the two host cells hand to their occupant. */
export interface SubagentCatalogOwnerProps {
  /** The session the header renders. */
  sessionId: string
  /** Selector over the host's session store. */
  useSessions: <T>(selector: (state: SubagentSessionsState) => T) => T
  /** Selector over the host's session status map. */
  useSessionStatus: <T>(selector: (state: ReadonlyMap<string, { running?: boolean }>) => T) => T
}

/** Owner props of the breadcrumb lineage cell. */
export interface SubagentLineageOwnerProps extends SubagentCatalogOwnerProps {
  /** Session the breadcrumb title represents. */
  lineageSessionId: string
  /** Title shown next to the switcher. */
  displayTitle: string
  /** Navigate to the ancestor title when the combined title is used. */
  openTitle?: () => void
  /** Selector over the current session's snapshot. */
  useSession: <T>(selector: (session: { subagent?: { address?: { childSessionId?: string; parentSessionId?: string } } }) => T) => T
}

/** Business actions the plugin injects into both cells. */
export interface SubagentCatalogInjected {
  /** Open a child session in the main workspace. */
  openChild: (address: SubagentAddress) => void
  /** Open a child session in the right sidebar. */
  openChildAside: (address: SubagentAddress) => void
  /** Ask the host to load a session's projections. */
  refreshProjection: (sessionId: string) => void
  /** Host locale, for live language switching. */
  locale: LocaleLike
  /** Host translator keeps every native catalog language intact. */
  hostT: HostTranslator
}

/* ------------------------------------------------------------------ *
 * Copy
 * ------------------------------------------------------------------ */

/**
 * Native catalog text is supplied by the host's `subagent` translator.
 * Only the new route readout needs local translations.
 */
const TEXT = {
  zh: {
    'route.effort': '思考强度',
    'route.effortDefault': '默认',
    'route.loading': '读取中…',
    'route.failed': '模型信息读取失败，点击重试',
    'route.notApplicable': '不适用',
    'route.noRequest': '尚未发起模型请求',
  },
  en: {
    'route.effort': 'Reasoning',
    'route.effortDefault': 'Default',
    'route.loading': 'Loading…',
    'route.failed': 'Could not load model information. Click to retry.',
    'route.notApplicable': 'Not applicable',
    'route.noRequest': 'No model request yet',
  },
}
/** Exported so the spec can check zh/en key alignment. */
export const subagentCatalogCopy = TEXT
type TextKey = keyof typeof TEXT.zh
type TextParams = Record<string, string | number>
export type Translator = (key: TextKey, params?: TextParams) => string
export type HostTranslator = (key: string, params?: TextParams) => string

type LocaleLike = string | { getSnapshot?: () => { active?: string }; subscribe?: (fn: () => void) => () => void } | undefined
export type { LocaleLike }

/** Replace `{name}` placeholders; unknown names keep the placeholder. */
function interpolate(template: string, params?: TextParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/** The host locale, one language at a time; missing services read as English. */
function useText(locale: LocaleLike): Translator {
  const subscribe = useCallback(
    (notify: () => void) => typeof locale === 'object' ? locale.subscribe?.(notify) ?? (() => {}) : () => {},
    [locale],
  )
  const snapshot = useCallback(
    () => String(typeof locale === 'string' ? locale : locale?.getSnapshot?.()?.active ?? 'en'),
    [locale],
  )
  const active = useSyncExternalStore(subscribe, snapshot, snapshot)
  const table = active.toLowerCase().startsWith('zh') ? TEXT.zh : TEXT.en
  return useCallback<Translator>((key, params) => interpolate(table[key], params), [table])
}

/* ------------------------------------------------------------------ *
 * Styling
 * ------------------------------------------------------------------ */

/**
 * The host's CSS-module class names for the subagent catalog, as of host
 * 0.2.2-rc.1. The host's stylesheet is injected into the document, so these
 * names keep the popup on the host's own look; the `mh-` classes below carry
 * a fallback stylesheet for hosts that renamed them.
 */
const NATIVE_CLASS = {
  activitySlot: 'rezYhW_activitySlot',
  ancestorSwitcherTrigger: 'rezYhW_ancestorSwitcherTrigger',
  children: 'rezYhW_children',
  clickarea: 'rezYhW_clickarea',
  content: 'rezYhW_content',
  currentLabel: 'rezYhW_currentLabel',
  disclosure: 'rezYhW_disclosure',
  disclosureOpen: 'rezYhW_disclosureOpen',
  disclosureSpace: 'rezYhW_disclosureSpace',
  error: 'rezYhW_error',
  label: 'rezYhW_label',
  menu: 'rezYhW_menu',
  menuBody: 'rezYhW_menuBody',
  metricDuration: 'rezYhW_metricDuration',
  metricToken: 'rezYhW_metricToken',
  metrics: 'rezYhW_metrics',
  node: 'rezYhW_node',
  notice: 'rezYhW_notice',
  refresh: 'rezYhW_refresh',
  root: 'rezYhW_root',
  row: 'rezYhW_row',
  rowActivitySlot: 'rezYhW_rowActivitySlot',
  sidebarButton: 'rezYhW_sidebarButton',
  sidebarSpace: 'rezYhW_sidebarSpace',
  summary: 'rezYhW_summary',
  switcherRoot: 'rezYhW_switcherRoot',
  switcherTitle: 'rezYhW_switcherTitle',
  switcherTrigger: 'rezYhW_switcherTrigger',
  trigger: 'rezYhW_trigger',
  triggerOpen: 'rezYhW_triggerOpen',
} as const

/** Join class names, dropping empty ones. */
function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * Fallback stylesheet. Every selector is wrapped in `:where()` so it carries
 * no specificity: while the host's own stylesheet is present, the host wins;
 * when the host renamed its classes, these rules keep the popup readable.
 */
const css = `
.dsh-model-hub-subagent :where(.mh-root){position:relative;display:inline-flex;align-items:center;gap:10px;min-width:0}
.dsh-model-hub-subagent :where(.mh-switcher-root){min-width:0;margin-left:6px}
.dsh-model-hub-subagent :where(.mh-trigger),.dsh-model-hub-subagent :where(.mh-switcher-trigger){display:inline-flex;align-items:center;gap:4px;min-height:28px;padding:3px 2px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:pointer}
.dsh-model-hub-subagent :where(.mh-switcher-trigger){min-width:0;max-width:244px;color:var(--dsw-alias-label-primary);font-weight:500}
.dsh-model-hub-subagent :where(.mh-ancestor-switcher-trigger){color:var(--dsw-alias-label-tertiary);font-weight:400}
.dsh-model-hub-subagent :where(.mh-switcher-title){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-model-hub-subagent :where(.mh-activity-slot){display:inline-flex;flex:none;align-items:center;justify-content:center;width:14px;height:14px}
.dsh-model-hub-subagent :where(.mh-trigger-open){transform:rotate(180deg)}
.dsh-model-hub-subagent :where(.mh-menu){position:fixed;z-index:100;box-sizing:border-box;display:flex;flex-direction:column;width:336px;max-width:min(400px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 140px));padding:3px;overflow:hidden;border-radius:var(--dsw-radius-lg);box-shadow:var(--dsw-elevation-prominent);background:var(--dsw-alias-bg-layer-3)}
.dsh-model-hub-subagent :where(.mh-menu-body){display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:auto}
.dsh-model-hub-subagent :where(.mh-node){position:relative;min-width:0}
.dsh-model-hub-subagent :where(.mh-row){position:relative;display:flex;align-items:flex-start;gap:6px;box-sizing:border-box;width:100%;min-height:44px;padding:6px 7px 6px 9px;border:0;border-radius:var(--dsw-radius-lg);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:17px;text-align:left;cursor:pointer;outline:none}
.dsh-model-hub-subagent :where(.mh-clickarea){box-sizing:border-box;display:flex;flex:1;align-self:stretch;align-items:flex-start;gap:6px;min-width:0;margin:-6px -7px;padding:6px 7px;border-radius:var(--dsw-radius-lg)}
.dsh-model-hub-subagent :where(.mh-row-activity-slot){display:inline-flex;flex:none;align-items:center;justify-content:center;width:14px;height:17px}
.dsh-model-hub-subagent :where(.mh-disclosure),.dsh-model-hub-subagent :where(.mh-disclosure-space){flex:none;width:14px;height:17px}
.dsh-model-hub-subagent :where(.mh-disclosure){display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-model-hub-subagent :where(.mh-disclosure-open){transform:rotate(90deg)}
.dsh-model-hub-subagent :where(.mh-content){display:flex;flex:1;flex-direction:column;min-width:0}
.dsh-model-hub-subagent :where(.mh-label),.dsh-model-hub-subagent :where(.mh-summary){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-model-hub-subagent :where(.mh-summary),.dsh-model-hub-subagent :where(.mh-metrics){color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px}
.dsh-model-hub-subagent :where(.mh-metrics){display:grid;grid-template-rows:17px 15px;flex:none;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.dsh-model-hub-subagent :where(.mh-sidebar-button){display:inline-flex;flex:none;align-items:center;justify-content:center;width:28px;height:28px;margin:4px 0;padding:6px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-model-hub-subagent :where(.mh-children){position:relative;margin-left:16px;padding-left:3px}
.dsh-model-hub-subagent :where(.mh-notice),.dsh-model-hub-subagent :where(.mh-error){padding:8px 10px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-model-hub-subagent :where(.mh-error){display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--dsw-alias-state-error-primary)}
.dsh-model-hub-subagent :where(.mh-refresh){display:inline-flex;flex:none;align-items:center;gap:3px;padding:3px 5px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:inherit;cursor:pointer}
.dsh-model-hub-subagent :where(.mh-route){display:block;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.dsh-model-hub-subagent :where(.mh-route-retry){padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;text-decoration:underline}
.dsh-model-hub-subagent :where(.mh-sidebar-space){flex:none;width:28px}
`

/* ------------------------------------------------------------------ *
 * Route readout
 * ------------------------------------------------------------------ */

/** What the readout knows about one child's route. */
type RouteState =
  /** The child's route is not readable from this session (external/unknown). */
  | { kind: 'notApplicable' }
  /** The child's projections are not loaded yet. */
  | { kind: 'loading' }
  /** The host reported a failed projection read. */
  | { kind: 'failed' }
  /** The child is loaded and never made a model request. */
  | { kind: 'none' }
  /** The child made a model request; this is the route it used. */
  | { kind: 'used'; selection: SubagentModelSelection }

/**
 * Read one child's route.
 *
 * Only `lastUsed` counts: it is the selection a request really used. A child
 * whose projections are not loaded yet is `loading` (the host is asked for
 * them); a loaded child that never requested a model is `none`; the pending
 * `next` selection is never presented as an already-used route.
 */
function readRoute(entry: SubagentCatalogEntry, summary: SubagentSessionSummary | undefined, projection?: SubagentProjectionSnapshot): RouteState {
  if (entry.mode === 'external' || entry.mode === 'unknown') return { kind: 'notApplicable' }
  const selection = summary?.projectionValues?.modelSelection
  if (selection === undefined) {
    if (projection?.state === 'error' || (projection?.state === 'idle' && projection.error)) return { kind: 'failed' }
    return { kind: 'loading' }
  }
  const lastUsed = selection.lastUsed
  if (lastUsed === undefined) return { kind: 'loading' }
  if (lastUsed === null) return { kind: 'none' }
  return { kind: 'used', selection: lastUsed }
}

/** One line of readout text for a child row. */
function routeText(state: RouteState, t: Translator): string {
  switch (state.kind) {
    case 'notApplicable': return t('route.notApplicable')
    case 'loading': return t('route.loading')
    case 'failed': return t('route.failed')
    case 'none': return t('route.noRequest')
    case 'used': {
      const effort = state.selection.reasoningEffort ?? t('route.effortDefault')
      const model = state.selection.model.split('/').filter(Boolean).at(-1) || state.selection.model
      return `${model} · ${effort}`
    }
  }
}

/* ------------------------------------------------------------------ *
 * Catalog tree
 * ------------------------------------------------------------------ */

interface CatalogSnapshot {
  state: 'loading' | 'ready' | 'error' | 'migration-required'
  error?: { message?: string } | null
  entries: (SubagentCatalogEntry & { activity: 'running' | 'inactive' })[]
}
type Catalogs = Readonly<Record<string, CatalogSnapshot>>

/** Focusable rows of one rendered tree. */
function treeItems(root: HTMLDivElement | null): HTMLElement[] {
  if (root === null) return []
  return Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]:not([aria-disabled="true"])'))
}

/** Compact token count shared in shape with the conversation stats strip. */
function formatTokens(value: number, t: HostTranslator): string {
  const scaled = (next: number): string => next >= 100 ? String(Math.round(next)) : String(Math.round(next * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('tokens.thousand', { value: scaled(value / 1_000) })
  return t('tokens.million', { value: scaled(value / 1_000_000) })
}

/** Sum the four disjoint durable provider-usage buckets. */
function tokenTotal(usage: SubagentProjectionValues['tokenUsage']): number | undefined {
  if (usage === undefined) return undefined
  return usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

interface DurationParts {
  seconds: number
  minutes: number
  hours: number
  days: number
  totalMinutes: number
  totalHours: number
}

function splitDuration(ms: number): DurationParts {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  const days = Math.floor(totalHours / 24)
  return {
    seconds: totalSeconds % 60,
    minutes: totalMinutes % 60,
    hours: totalHours % 24,
    days,
    totalMinutes,
    totalHours,
  }
}

/** Format a duration with decreasing visual precision at larger scales. */
function formatDuration(ms: number, t: HostTranslator): string {
  const { seconds, minutes, hours, days, totalMinutes, totalHours } = splitDuration(ms)
  if (days >= 365) {
    const years = Math.floor(days / 365)
    const months = Math.floor(days % 365 / 30)
    return months === 0 ? t('duration.years', { years }) : t('duration.yearsMonths', { years, months })
  }
  if (days >= 30) {
    const months = Math.floor(days / 30)
    const remainingDays = days % 30
    return remainingDays === 0 ? t('duration.months', { months }) : t('duration.monthsDays', { months, days: remainingDays })
  }
  if (days > 0) return hours === 0 ? t('duration.days', { days }) : t('duration.daysHours', { days, hours })
  if (totalHours > 0) {
    return t('duration.hours', { hours, minutes: String(minutes).padStart(2, '0'), seconds: String(seconds).padStart(2, '0') })
  }
  if (totalMinutes > 0) {
    return t('duration.minutes', { minutes: String(minutes).padStart(2, '0'), seconds: String(seconds).padStart(2, '0') })
  }
  return t('duration.seconds', { seconds: String(seconds).padStart(2, '0') })
}

/** Preserve exact whole seconds for hover and accessible naming. */
function formatExactDuration(ms: number, t: HostTranslator): string {
  const { seconds, minutes, hours, days } = splitDuration(ms)
  if (days === 0) return formatDuration(ms, t)
  return t('duration.exactDays', {
    days,
    hours: String(hours).padStart(2, '0'),
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(seconds).padStart(2, '0'),
  })
}

/** Exact whole-second active-turn duration for one catalog row. */
function activityDuration(
  summary: SubagentSessionSummary | undefined,
  activity: 'running' | 'inactive',
  now: number,
): number | undefined {
  if (summary === undefined) return undefined
  const timing = summary.projectionValues?.subagentTiming
  if (timing === undefined) return undefined
  if (timing.active === undefined) return timing.settledMs
  const end = activity === 'running' ? now : timing.active.through
  return timing.settledMs + Math.max(0, end - timing.active.since)
}

interface CatalogRowsProps {
  parentSessionId: string
  currentSessionId: string | undefined
  catalog: CatalogSnapshot
  catalogs: Catalogs
  projections: Readonly<Record<string, SubagentProjectionSnapshot>>
  summaries: Record<string, SubagentSessionSummary>
  expanded: ReadonlySet<string>
  level: number
  openChild: (address: SubagentAddress) => void
  openChildAside: (address: SubagentAddress) => void
  refreshProjection: (sessionId: string) => void
  requestProjection: (sessionId: string, retry?: boolean) => void
  toggleBranch: (childSessionId: string) => void
  closeCatalog: () => void
  t: HostTranslator
  routeT: Translator
}

/** Render one catalog level and recurse only through explicitly expanded rows. */
function CatalogRows({
  parentSessionId, currentSessionId, catalog, catalogs, projections, summaries, expanded, level,
  openChild, openChildAside, refreshProjection, requestProjection, toggleBranch, closeCatalog, t, routeT,
}: CatalogRowsProps) {
  const [now, setNow] = useState(() => Date.now())
  const running = catalog.entries.some((entry) => entry.activity === 'running')
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [running])
  const emptyLoading = catalog.state === 'loading' && catalog.entries.length === 0
  const reserveDisclosure = catalog.entries.some((entry) =>
    entry.mode !== 'external' && !isKnownLeaf(catalogs[entry.id])
    && summaries[entry.id]?.formatStatus !== 'migration-required'
    && catalogs[entry.id]?.state !== 'migration-required')

  /* A child whose projections are not loaded yet is asked for them once. The
   * request is deduplicated by the caller, so a child that stays unreadable
   * never turns into a request loop. */
  useEffect(() => {
    for (const entry of catalog.entries) {
      if (readRoute(entry, summaries[entry.id], projections[entry.id]).kind !== 'loading') continue
      requestProjection(entry.id)
    }
  }, [catalog, projections, summaries, requestProjection])

  return <>
    {emptyLoading ? <div className={cx(NATIVE_CLASS.notice, 'mh-notice')}>{t('loading.label')}</div> : null}
    {catalog.state === 'error' ? <div className={cx(NATIVE_CLASS.error, 'mh-error')}>
      <span>{catalog.error?.message ?? t('load.error')}</span>
      <button type="button" className={cx(NATIVE_CLASS.refresh, 'mh-refresh')} onClick={() => refreshProjection(parentSessionId)}>
        <IconRefreshOutlineRegular size={14} />{t('retry')}
      </button>
    </div> : null}
    {catalog.entries.map((entry) => {
      const external = entry.mode === 'external'
      const childCatalog = catalogs[entry.id]
      const isCurrent = entry.id === currentSessionId
      const knownLeaf = external || isKnownLeaf(childCatalog)
      const requiresOpening = summaries[entry.id]?.formatStatus === 'migration-required' || childCatalog?.state === 'migration-required'
      const canExpand = !knownLeaf && !requiresOpening
      const isExpanded = canExpand && expanded.has(entry.id)
      const childLoading = childCatalog === undefined || (childCatalog.state === 'loading' && childCatalog.entries.length === 0)
      const summary = summaries[entry.id]
      const label = entry.label ?? entry.id
      const mode = external ? t('mode.external')
        : entry.mode === 'unknown' ? t('mode.unknown')
          : entry.mode === 'one-shot' ? t('mode.oneShot') : t('mode.continuable')
      const completed = !external && entry.activity === 'inactive' && summary?.projectionValues?.subagentTiming?.lastTurnCompleted === true
      const activity = external ? undefined
        : entry.activity === 'running' ? t('activity.running')
          : completed ? t('activity.completed') : t('activity.inactive')
      const secondary = [summary?.title, requiresOpening ? t('catalog.migrationRequired') : mode, activity]
        .filter((value) => value !== undefined).join(' · ')
      const totalTokens = tokenTotal(summary?.projectionValues?.tokenUsage)
      const durationMs = activityDuration(summary, entry.activity, now)
      const tokenMetric = totalTokens === undefined ? undefined : t('tokens.total', { value: formatTokens(totalTokens, t) })
      const durationMetric = durationMs === undefined ? undefined : {
        compact: formatDuration(durationMs, t),
        exact: formatExactDuration(durationMs, t),
      }
      const metrics = [tokenMetric, durationMetric?.exact].filter((value) => value !== undefined).join(' · ')
      const route = readRoute(entry, summary, projections[entry.id])
      const routeLine = routeText(route, routeT)
      const open = () => {
        if (external) return
        openChild({ parentSessionId, childSessionId: entry.id, mode: addressMode(entry) })
        closeCatalog()
      }
      const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          open()
        } else if ((event.key === 'ArrowRight' && canExpand && !isExpanded) || (event.key === 'ArrowLeft' && isExpanded)) {
          event.preventDefault()
          event.stopPropagation()
          toggleBranch(entry.id)
        }
      }
      const toggle = (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        event.stopPropagation()
        toggleBranch(entry.id)
      }
      return <div key={entry.id} className={cx(NATIVE_CLASS.node, 'mh-node')}>
        <div
          role="treeitem"
          tabIndex={external ? -1 : 0}
          aria-disabled={external || undefined}
          aria-level={level}
          aria-current={isCurrent || undefined}
          aria-label={[label, secondary, metrics, routeLine].filter((value) => value !== '').join(' ')}
          {...canExpand ? { 'aria-expanded': isExpanded } : {}}
          className={cx(NATIVE_CLASS.row, 'mh-row')}
          onClick={open}
          onKeyDown={handleKey}
        >
          {!canExpand ? (reserveDisclosure ? <span className={cx(NATIVE_CLASS.disclosureSpace, 'mh-disclosure-space')} /> : null)
            : <button type="button" tabIndex={-1}
              className={cx(NATIVE_CLASS.disclosure, 'mh-disclosure', isExpanded ? NATIVE_CLASS.disclosureOpen : '', isExpanded ? 'mh-disclosure-open' : '')}
              aria-label={t(isExpanded ? 'branch.collapse' : 'branch.expand', { label })}
              onClick={toggle}
            >
              <IconChevronRightOutlineRegular />
            </button>}
          <div className={cx(NATIVE_CLASS.clickarea, 'mh-clickarea')}>
            <span className={cx(NATIVE_CLASS.rowActivitySlot, 'mh-row-activity-slot')}>
              <StateDot state={entry.activity === 'running' ? 'ongoing' : completed ? 'done' : 'idle'} />
            </span>
            <span className={cx(NATIVE_CLASS.content, 'mh-content')}>
              <span className={cx(NATIVE_CLASS.label, 'mh-label', isCurrent ? NATIVE_CLASS.currentLabel : '')}>{label}</span>
              <span className={cx(NATIVE_CLASS.summary, 'mh-summary')}>{secondary}</span>
              {route.kind === 'failed'
                ? <button type="button" className="mh-route mh-route-retry" onClick={(event) => { event.stopPropagation(); requestProjection(entry.id, true) }}>{routeLine}</button>
                : <span className="mh-route" title={route.kind === 'used' ? `${route.selection.provider} / ${route.selection.model} · ${route.selection.reasoningEffort ?? routeT('route.effortDefault')}` : undefined}>{routeLine}</span>}
            </span>
            {metrics !== '' ? <span className={cx(NATIVE_CLASS.metrics, 'mh-metrics')}>
              {tokenMetric !== undefined ? <span className={cx(NATIVE_CLASS.metricToken, 'mh-metric-token')}>{tokenMetric}</span> : null}
              {durationMetric !== undefined ? <span className={cx(NATIVE_CLASS.metricDuration, 'mh-metric-duration')} title={t('duration.exactTitle', { duration: durationMetric.exact })}>{durationMetric.compact}</span> : null}
            </span> : null}
            {isCurrent || external ? <span className={cx(NATIVE_CLASS.sidebarSpace, 'mh-sidebar-space')} />
              : <Tooltip label={t('open.sidebar')} side="bottom" align="end">
                <button type="button" className={cx(NATIVE_CLASS.sidebarButton, 'mh-sidebar-button')}
                  aria-label={t('open.sidebar.aria', { label })}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    openChildAside({ parentSessionId, childSessionId: entry.id, mode: addressMode(entry) })
                    closeCatalog()
                  }}
                  onKeyDown={(event) => { event.stopPropagation() }}
                >
                  <IconChevronRightOutlineRegular />
                </button>
              </Tooltip>}
          </div>
        </div>
        {isExpanded ? <div role="group" className={cx(NATIVE_CLASS.children, 'mh-children')} aria-busy={childLoading || undefined}>
          {childCatalog === undefined ? <div className={cx(NATIVE_CLASS.notice, 'mh-notice')}>{t('loading.label')}</div>
            : <CatalogRows
              parentSessionId={entry.id}
              currentSessionId={currentSessionId}
              catalog={childCatalog}
              catalogs={catalogs}
              projections={projections}
              summaries={summaries}
              expanded={expanded}
              level={level + 1}
              openChild={openChild}
              openChildAside={openChildAside}
              refreshProjection={refreshProjection}
              requestProjection={requestProjection}
              toggleBranch={toggleBranch}
              closeCatalog={closeCatalog}
              t={t}
              routeT={routeT}
            />}
        </div> : null}
      </div>
    })}
  </>
}

/** A child becomes a known leaf only after its own authoritative catalog loads empty. */
function isKnownLeaf(catalog: CatalogSnapshot | undefined): boolean {
  return catalog?.state === 'ready' && catalog.entries.length === 0
}

/** The addressable mode of one catalog entry; unreadable modes stay unknown. */
function addressMode(entry: SubagentCatalogEntry): SubagentAddress['mode'] {
  return entry.mode === 'one-shot' || entry.mode === 'continuable' ? entry.mode : 'unknown'
}

const MENU_VIEWPORT_MARGIN = 16

/** Place a portaled catalog below its trigger without crossing the viewport edge. */
function catalogMenuPosition(trigger: HTMLButtonElement): CSSProperties {
  const rect = trigger.getBoundingClientRect()
  const width = Math.min(336, window.innerWidth - MENU_VIEWPORT_MARGIN * 2)
  return {
    top: rect.bottom + 5,
    left: Math.min(Math.max(MENU_VIEWPORT_MARGIN, rect.left), window.innerWidth - width - MENU_VIEWPORT_MARGIN),
  }
}

interface CatalogDropdownProps {
  rootSessionId: string
  currentSessionId?: string
  displayTitle?: string
  openTitle?: () => void
  variant: 'count' | 'switcher'
  useSessions: <T>(selector: (state: SubagentSessionsState) => T) => T
  useSessionStatus: <T>(selector: (state: ReadonlyMap<string, { running?: boolean }>) => T) => T
  openChild: (address: SubagentAddress) => void
  openChildAside: (address: SubagentAddress) => void
  refreshProjection: (sessionId: string) => void
  t: HostTranslator
  routeT: Translator
}

/** One trigger-plus-tree dropdown over the catalog rooted at `rootSessionId`. */
function CatalogDropdown({
  rootSessionId, currentSessionId, displayTitle, openTitle, variant,
  useSessions, useSessionStatus, openChild, openChildAside, refreshProjection, t, routeT,
}: CatalogDropdownProps) {
  const ancestorSwitcher = variant === 'switcher' && openTitle !== undefined
  const projections = useSessions((state) => state.projectionsBySession)
  const summaries = useSessions((state) => state.byId)
  const statuses = useSessionStatus((value) => value)
  const catalogs = useMemo<Catalogs>(() => Object.fromEntries(Object.entries(projections).map(([id, snapshot]) => {
    const projected = snapshot.values.subagentCatalog
    return [id, {
      state: snapshot.state === 'idle'
        ? projected === undefined ? 'loading' as const : 'ready' as const
        : snapshot.state === 'migration-required' && projected !== undefined ? 'ready' as const : snapshot.state,
      error: snapshot.error,
      entries: (projected ?? []).map((entry) => ({
        ...entry,
        activity: (statuses.get(entry.id)?.running ?? summaries[entry.id]?.running) === true ? 'running' as const : 'inactive' as const,
      })),
    }]
  })), [projections, summaries, statuses])
  const catalog = catalogs[rootSessionId]
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<CSSProperties>()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const hoverOpenTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /* A click-opened (pinned) menu ignores hover-out; only explicit dismissal closes it. */
  const pinnedRef = useRef(false)
  /* One projection request per child: a child that stays unreadable must not
   * turn the readout into a request loop. */
  const requestedRef = useRef<Set<string>>(new Set())
  const currentEntry = currentSessionId === undefined
    ? undefined
    : catalog?.entries.find((entry) => entry.id === currentSessionId)
  const switcherDisplayTitle = currentEntry !== undefined ? currentEntry.label ?? currentEntry.id : displayTitle ?? rootSessionId
  const directChildren = catalog?.entries ?? []
  const directCount = directChildren.length
  const runningCount = directChildren.filter((entry) => entry.activity === 'running').length
  const totalCountKey = directCount === 1 ? 'count.total.one' : 'count.total.other'
  const runningCountKey = runningCount === 1 ? 'count.running.one' : 'count.running.other'
  const presentedCatalog: CatalogSnapshot | undefined = catalog ?? (variant === 'switcher'
    ? { entries: [], state: 'loading', error: null }
    : undefined)

  const cancelHoverClose = (): void => {
    if (hoverCloseTimer.current === undefined) return
    clearTimeout(hoverCloseTimer.current)
    hoverCloseTimer.current = undefined
  }
  const cancelHoverOpen = (): void => {
    if (hoverOpenTimer.current === undefined) return
    clearTimeout(hoverOpenTimer.current)
    hoverOpenTimer.current = undefined
  }
  const changeOpen = (next: boolean, restoreFocus = false): void => {
    cancelHoverOpen()
    cancelHoverClose()
    if (next) {
      const trigger = triggerRef.current
      if (trigger === null) return
      setOpen(true)
      setMenuPosition(catalogMenuPosition(trigger))
    } else {
      pinnedRef.current = false
      setOpen(false)
      setMenuPosition(undefined)
      setExpanded(new Set())
    }
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }
  const scheduleHoverOpen = (): void => {
    cancelHoverOpen()
    cancelHoverClose()
    if (open) return
    hoverOpenTimer.current = setTimeout(() => {
      hoverOpenTimer.current = undefined
      changeOpen(true)
    }, 150)
  }
  const scheduleHoverClose = (): void => {
    cancelHoverOpen()
    cancelHoverClose()
    if (pinnedRef.current) return
    hoverCloseTimer.current = setTimeout(() => {
      hoverCloseTimer.current = undefined
      changeOpen(false)
    }, 120)
  }
  const closeBranch = (root: string): void => {
    const closing = new Set<string>()
    const visit = (parentSessionId: string): void => {
      if (closing.has(parentSessionId) || !expanded.has(parentSessionId)) return
      closing.add(parentSessionId)
      const branch = catalogs[parentSessionId]
      for (const entry of branch?.entries ?? []) visit(entry.id)
    }
    visit(root)
    setExpanded((current) => new Set([...current].filter((id) => !closing.has(id))))
  }
  const toggleBranch = (childSessionId: string): void => {
    if (expanded.has(childSessionId)) {
      closeBranch(childSessionId)
      return
    }
    setExpanded((current) => new Set(current).add(childSessionId))
    requestProjection(childSessionId)
  }
  /** Ask the host for one child's projections, at most once per dropdown. */
  const requestProjection = useCallback((childSessionId: string, retry = false): void => {
    if (requestedRef.current.has(childSessionId) && !retry) return
    requestedRef.current.add(childSessionId)
    try {
      refreshProjection(childSessionId)
    } catch {
      // A failed projection read leaves the row on its loading state; the
      // host's own retry control reloads the catalog.
    }
  }, [refreshProjection])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: Event): void => {
      const target = event.target
      if (target instanceof Node
        && !rootRef.current?.contains(target) && !menuRef.current?.contains(target)) changeOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])
  useEffect(() => {
    if (!open) return
    const placeMenu = (): void => {
      const trigger = triggerRef.current
      if (trigger === null) return
      setMenuPosition(catalogMenuPosition(trigger))
    }
    window.addEventListener('resize', placeMenu)
    document.addEventListener('scroll', placeMenu, true)
    return () => {
      window.removeEventListener('resize', placeMenu)
      document.removeEventListener('scroll', placeMenu, true)
    }
  }, [open])
  /* Hover timers outlive an unmount otherwise: a pending open would publish
   * into a tree that is no longer mounted. */
  useEffect(() => () => {
    cancelHoverOpen()
    cancelHoverClose()
  }, [])
  const visible = presentedCatalog !== undefined && (variant === 'switcher' || presentedCatalog.state === 'error' || presentedCatalog.entries.length > 0)
  useEffect(() => {
    if (visible) return
    cancelHoverOpen()
    cancelHoverClose()
    if (!open) return
    pinnedRef.current = false
    setOpen(false)
    setExpanded(new Set())
  }, [visible, open])
  if (!visible) return null

  const focusAt = (index: number): void => {
    const items = treeItems(menuRef.current)
    if (items.length === 0) return
    items[(index + items.length) % items.length]?.focus()
  }
  const navigate = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = treeItems(menuRef.current)
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      changeOpen(false, true)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(items.length - 1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusAt(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusAt(index < 0 ? items.length - 1 : index - 1)
    }
  }
  return <div className={cx('dsh-model-hub-subagent', NATIVE_CLASS.root, 'mh-root', variant === 'switcher' ? NATIVE_CLASS.switcherRoot : '', variant === 'switcher' ? 'mh-switcher-root' : '')}
    ref={rootRef}
    onKeyDown={navigate}
    onPointerLeave={scheduleHoverClose}
  >
    <button
      ref={triggerRef}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') scheduleHoverOpen() }}
      type="button"
      className={variant === 'switcher'
        ? cx(NATIVE_CLASS.switcherTrigger, 'mh-switcher-trigger', ancestorSwitcher ? NATIVE_CLASS.ancestorSwitcherTrigger : '', ancestorSwitcher ? 'mh-ancestor-switcher-trigger' : '')
        : cx(NATIVE_CLASS.trigger, 'mh-trigger')}
      aria-haspopup="tree"
      aria-expanded={open}
      aria-label={variant === 'switcher'
        ? t('switcher.aria', { title: switcherDisplayTitle })
        : t(runningCount > 0 ? runningCountKey : totalCountKey, { count: runningCount > 0 ? runningCount : directCount })}
      onClick={openTitle === undefined ? () => {
        cancelHoverOpen()
        cancelHoverClose()
        pinnedRef.current = true
        if (!open) changeOpen(true)
      } : () => {
        cancelHoverOpen()
        if (open) changeOpen(false)
        openTitle()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown') return
        event.preventDefault()
        if (!open) changeOpen(true)
        queueMicrotask(() => { focusAt(0) })
      }}
    >
      {variant === 'switcher'
        ? <span className={cx(NATIVE_CLASS.switcherTitle, 'mh-switcher-title')}>{switcherDisplayTitle}</span>
        : <>
          {runningCount > 0 ? <span className={cx(NATIVE_CLASS.activitySlot, 'mh-activity-slot')}><StateDot state="ongoing" /></span> : null}
          <span className="mh-count">{t(totalCountKey, { count: directCount })}</span>
        </>}
      {variant === 'switcher' ? <SubagentSwitcherIcon />
        : <IconChevronDownOutlineRegular className={open ? cx(NATIVE_CLASS.triggerOpen, 'mh-trigger-open') : undefined} />}
    </button>
    {open ? createPortal(<div
      ref={menuRef}
      className={cx('dsh-model-hub-subagent', NATIVE_CLASS.menu, 'mh-menu')}
      style={menuPosition}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') cancelHoverClose() }}
      onPointerLeave={scheduleHoverClose}
    >
      <div className={cx(NATIVE_CLASS.menuBody, 'mh-menu-body')} role="tree" aria-label={t('tree.aria')}>
        <CatalogRows
          parentSessionId={rootSessionId}
          currentSessionId={currentSessionId}
          catalog={presentedCatalog}
          catalogs={catalogs}
          projections={projections}
          summaries={summaries}
          expanded={expanded}
          level={1}
          openChild={openChild}
          openChildAside={openChildAside}
          refreshProjection={refreshProjection}
          requestProjection={requestProjection}
          toggleBranch={toggleBranch}
          closeCatalog={() => { changeOpen(false) }}
          t={t}
          routeT={routeT}
        />
      </div>
    </div>, document.body) : null}
  </div>
}

/** The host's chevron pair, used by the lineage switcher. */
function SubagentSwitcherIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M5.99951 12.7L8.95546 14.9478C9.40011 15.2859 9.62244 15.455 9.87526 15.488C9.95774 15.4988 10.0413 15.4988 10.1238 15.488C10.3766 15.455 10.5989 15.2859 11.0436 14.9478L13.9995 12.7"
      stroke="currentColor" strokeWidth="1.5" />
    <path d="M13.9995 7.7417L11.0436 5.49387C10.5989 5.15574 10.3766 4.98668 10.1238 4.95362C10.0413 4.94283 9.95775 4.94283 9.87527 4.95362C9.62245 4.98668 9.40012 5.15574 8.95547 5.49387L5.99952 7.7417"
      stroke="currentColor" strokeWidth="1.5" />
  </svg>
}

/* ------------------------------------------------------------------ *
 * Cells
 * ------------------------------------------------------------------ */

/**
 * Session-header catalog action for root sessions: the descendant count and
 * its dropdown after the preset label in the header actions band. Child
 * sessions render nothing here — their breadcrumb switcher in the lineage
 * slot owns the same navigation.
 */
export function SubagentCatalogAction(props: SubagentCatalogOwnerProps & SubagentCatalogInjected) {
  const t = useText(props.locale)
  const nativeT = (key: string, params?: Record<string, string | number>) => props.hostT(key, params)
  const isChild = props.useSessions((state) => state.byId[props.sessionId]?.origin === 'subagent')
  if (isChild) return null
  return <>
    <style>{css}</style>
    <CatalogDropdown
      rootSessionId={props.sessionId}
      variant="count"
      useSessions={props.useSessions}
      useSessionStatus={props.useSessionStatus}
      openChild={props.openChild}
      openChildAside={props.openChildAside}
      refreshProjection={props.refreshProjection}
      t={nativeT}
      routeT={t}
    />
  </>
}

/**
 * Render one breadcrumb title together with its subagent navigation: the
 * ancestor switcher and, on a child session, its own descendant count.
 */
export function SubagentHeaderLineage(props: SubagentLineageOwnerProps & SubagentCatalogInjected) {
  const routeT = useText(props.locale)
  const address = props.useSession((session) => session.subagent?.address)
  const parentId = props.useSessions((state) => {
    if (address !== undefined && address.childSessionId === props.lineageSessionId) return address.parentSessionId
    for (const [candidate, snapshot] of Object.entries(state.projectionsBySession)) {
      if (snapshot.values.subagentCatalog?.some((entry) => entry.id === props.lineageSessionId)) return candidate
    }
    const summary = state.byId[props.lineageSessionId]
    return summary?.origin === 'subagent' ? summary.parentId : undefined
  })
  if (parentId === undefined) return null
  const shared = {
    useSessions: props.useSessions,
    useSessionStatus: props.useSessionStatus,
    openChild: props.openChild,
    openChildAside: props.openChildAside,
    refreshProjection: props.refreshProjection,
    t: props.hostT,
    routeT,
  }
  return <>
    <style>{css}</style>
    <CatalogDropdown
      rootSessionId={parentId}
      currentSessionId={props.lineageSessionId}
      variant="switcher"
      displayTitle={props.displayTitle}
      {...props.openTitle === undefined ? {} : { openTitle: props.openTitle }}
      {...shared}
    />
    {props.openTitle === undefined ? <CatalogDropdown rootSessionId={props.lineageSessionId} variant="count" {...shared} /> : null}
  </>
}
