import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Switch, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import {
  DELEGATION_CLIENT_SERVICE, PLUGIN_NAME, RPC_CHANNEL,
  type DelegationSessionStatus, type DelegationSettings, type RpcResult,
} from './contracts.ts'

export const name = 'dsh-delegation-client'
export const inject = ['slots', 'connection', 'locale'] as const

const NS = 'dsh-delegation.action'

const zh = {
  action: '委派',
  normal: '默认',
  mode: '委派模式',
  titleOn: '本会话将使用委派模式：主代理负责拆解、委派和验收；会话开始后保持锁定',
  titleOff: '开启委派模式：主代理把具体工作交给子代理；会话开始后保持锁定',
  locked: '请在会话开始前选择委派模式',
  incapable: '当前预设缺少子代理工具，需切换到带子代理工具的预设',
  stale: '状态已在别处更改，已刷新',
  failed: '切换失败',
}

const en: Record<keyof typeof zh, string> = {
  action: 'Delegate',
  normal: 'Default',
  mode: 'Delegation Mode',
  titleOn: 'This session will use Delegation Mode: the main agent plans, delegates, and reviews. Locked once the session starts.',
  titleOff: 'Turn on Delegation Mode: the main agent hands the work to subagents. Locked once the session starts.',
  locked: 'Choose Delegation Mode before the session starts',
  incapable: 'Delegation Mode unavailable: this preset has no subagent tools',
  stale: 'State changed elsewhere; refreshed',
  failed: 'Could not toggle Delegation Mode',
}

type Key = keyof typeof zh
type Translate = (key: Key) => string

/** A failed RPC keeps its code so the view can name a rejection it understands. */
class RpcError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

async function rpc<T>(call: (endpoint: string, payload: unknown) => Promise<unknown>, endpoint: string, payload: unknown = {}): Promise<T> {
  const result = await call(endpoint, payload) as RpcResult<T> | undefined
  if (!result || result.ok !== true) {
    const failed = result && 'error' in result ? result.error : undefined
    throw new RpcError(failed?.code ?? 'unknown', failed?.message ?? '')
  }
  return result.value
}

export interface DelegationSessionSnapshotLike {
  openState?: string
  running?: boolean
  blank?: boolean
  awaitingFirstTurn?: boolean
  pendingSubmissions?: readonly unknown[]
}

export interface DelegationActionProps {
  sessionId: string
  call: (endpoint: string, payload: unknown) => Promise<unknown>
  /** Host connection-generation subscription; refetches on reconnect. */
  subscribeGeneration?: (listener: () => void) => (() => void) | undefined
  /** Host per-session selector hook; a cold→open transition triggers a refetch. */
  useSession?: <T>(selector: (snapshot: DelegationSessionSnapshotLike) => T) => T
  /** Changing a blank session's preset must refresh tool availability. */
  useProjection?: (key: 'agentPreset') => string | null | undefined
  t: Translate
}

/** Brief notice shown after a toggle problem, in the tooltip and an aria-live span. */
type Notice = '' | 'stale' | 'failed' | 'locked'

export function DelegationAction({ sessionId, call, subscribeGeneration, useSession, useProjection, t }: DelegationActionProps) {
  const [status, setStatus] = useState<DelegationSessionStatus>()
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>('')
  const generationRef = useRef(0)
  const readSeqRef = useRef(0)
  const openState = useSession?.(snapshot => snapshot.openState)
  const sessionRunning = useSession?.(snapshot => snapshot.running === true)
  const sessionBlank = useSession?.(snapshot => snapshot.blank)
  const submitting = useSession?.(snapshot => snapshot.awaitingFirstTurn === true || (snapshot.pendingSubmissions?.length ?? 0) > 0)
  const preset = useProjection?.('agentPreset')

  const load = useCallback(async () => {
    const generation = generationRef.current
    const seq = ++readSeqRef.current
    try {
      const next = await rpc<DelegationSessionStatus>(call, 'session.status', { sessionId })
      if (generationRef.current !== generation || seq !== readSeqRef.current) return
      // Revisions never decrease and records are never deleted, so a stale read
      // that lands after a fresher write must not roll the button back.
      setStatus(prev => prev && prev.sessionId === next.sessionId && next.revision < prev.revision ? prev : next)
    } catch {
      // A failed refetch keeps the last known state; the button stays put.
    }
  }, [call, sessionId])

  useEffect(() => {
    generationRef.current += 1
    readSeqRef.current += 1
    setStatus(undefined)
    setSaving(false)
    setNotice('')
  }, [sessionId])

  useEffect(() => { void load() }, [load, openState, sessionRunning, sessionBlank, preset])

  useEffect(() => {
    const off = subscribeGeneration?.(() => { void load() })
    const win = typeof window === 'undefined' ? undefined : window
    const onFocus = () => { void load() }
    win?.addEventListener('focus', onFocus)
    return () => { off?.(); win?.removeEventListener('focus', onFocus) }
  }, [load, subscribeGeneration])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const toggle = useCallback(async () => {
    if (!status || saving || status.locked || sessionBlank === false || sessionRunning || submitting || status.capable !== true) return
    const generation = generationRef.current
    readSeqRef.current += 1
    setSaving(true)
    setNotice('')
    try {
      const next = await rpc<DelegationSessionStatus>(call, 'session.update', {
        sessionId, enabled: !status.enabled, expectedRevision: status.revision,
      })
      if (generationRef.current !== generation) return
      setStatus(next)
    } catch (reason) {
      if (generationRef.current !== generation) return
      if (reason instanceof RpcError && (reason.code === 'stale' || reason.code === 'session-locked')) {
        setNotice(reason.code === 'stale' ? 'stale' : 'locked')
        void load()
      } else {
        setNotice('failed')
      }
    } finally {
      if (generationRef.current === generation) setSaving(false)
    }
  }, [call, load, saving, sessionId, status, sessionBlank, sessionRunning, submitting])

  if (!status || status.role === 'executor' || sessionBlank === false) return null
  const capable = status.capable === true
  const enabled = status.enabled
  const locked = status.locked || sessionRunning || submitting
  const tooltip = status.capable === false ? t('incapable') : locked ? t('locked') : notice ? t(notice) : enabled ? t('titleOn') : t('titleOff')
  return (
    <span className="dlg-root dlg-action">
      <Tooltip label={tooltip} side="bottom" gap={4}>
        <span className="dlg-mode" data-enabled={enabled}>
          <span className="dlg-mode-label">{enabled ? t('action') : t('normal')}</span>
          <Switch
            className="dlg-toggle"
            checked={enabled}
            label={t('mode')}
            disabled={!capable || locked || saving}
            onChange={() => void toggle()}
          />
        </span>
      </Tooltip>
      {notice ? <span role="status" className="dlg-note">{t(notice)}</span> : null}
    </span>
  )
}

export const clientCss = `${officialUiCss('dlg-root')}
.dlg-root.dlg-action { display: inline-flex; align-items: center; gap: 6px; }
.dlg-root .dlg-mode { display: inline-flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-tertiary); }
.dlg-root .dlg-mode-label { font-size: 13px; line-height: 20px; }
.dlg-root .dlg-mode[data-enabled="true"] { color: var(--dsw-alias-state-business-primary); }
.dlg-root .dlg-toggle[aria-checked="true"] { background: var(--dsw-alias-state-business-primary); }
.dlg-root .dlg-note { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
`

declare module '@deepseek-ai/cordis' {
  interface Context { dshDelegationClient: { active: boolean } }
}

type Client = Context & {
  connection: {
    generation?: { subscribe(listener: () => void): () => void }
    rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
  }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; id: string; order: number; locale: string; inject: () => unknown } | { name: string; key: string }, render: unknown): () => void
  }
  locale: {
    register(ns: string, locales: { zh: Record<string, string>; en: Record<string, string> }): () => void
    getSnapshot?(): { active: string }
    subscribe?(listener: () => void): () => void
  }
}

/** Host UI language, following live switches with the host's English fallback. */
function useHostLocale(client: Client): string {
  const subscribe = useCallback(
    (listener: () => void) => client.locale.subscribe?.(listener) ?? (() => {}),
    [client],
  )
  const snapshot = useCallback(() => client.locale.getSnapshot?.().active ?? 'en', [client])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

const settingsZh = {
  default: '新会话默认启用委派',
  defaultHint: '只影响之后新建的会话；发送第一条消息前可单独选择，会话开始后保持锁定。需要预设包含子代理工具。',
  loading: '正在读取设置…',
  saved: '已保存。',
  stale: '设置已更新，请刷新后重试。',
  failed: '无法读取委派设置。',
  retry: '重试',
  refresh: '刷新设置',
}

const settingsEn: Record<keyof typeof settingsZh, string> = {
  default: 'Enable Delegation Mode for new sessions',
  defaultHint: 'Only affects sessions created later. Choose before sending the first message; the choice stays locked once the session starts. Requires a preset with subagent tools.',
  loading: 'Loading settings…',
  saved: 'Saved.',
  stale: 'Settings changed; refresh and retry.',
  failed: 'Could not load delegation settings.',
  retry: 'Retry',
  refresh: 'Refresh settings',
}

function settingsCopy(locale: string): Record<keyof typeof settingsZh, string> {
  return String(locale).startsWith('zh') ? settingsZh : settingsEn
}

/** Plugin-page card: the default flag applied to sessions created from now on. */
export function DelegationSettingsPanel(props: { client: Client; locale?: string }) {
  const hostLocale = useHostLocale(props.client)
  const text = settingsCopy(props.locale ?? hostLocale)
  const [settings, setSettings] = useState<DelegationSettings>()
  const [error, setError] = useState<'' | 'failed' | 'stale'>('')
  const [note, setNote] = useState(false)
  const [busy, setBusy] = useState(false)
  const operation = useRef({ epoch: 0, active: false, writing: false })

  const call = useCallback(
    (endpoint: string, payload: unknown = {}) => props.client.connection.rpc.call(RPC_CHANNEL, endpoint, payload),
    [props.client],
  )

  const refresh = useCallback(() => {
    const state = operation.current
    if (!state.active || state.writing) return
    const epoch = state.epoch
    setBusy(true)
    void rpc<DelegationSettings>(call, 'settings').then(next => {
      if (!state.active || state.epoch !== epoch) return
      setSettings(next)
      setError('')
    }).catch(() => {
      if (!state.active || state.epoch !== epoch) return
      setError('failed')
    }).finally(() => {
      if (state.active && state.epoch === epoch) setBusy(false)
    })
  }, [call])
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    const state = operation.current
    state.epoch++
    state.active = true
    state.writing = false
    setBusy(false)
    setSettings(undefined)
    setError('')
    setNote(false)
    refreshRef.current()
    return () => { state.active = false; state.epoch++ }
  }, [call])

  const save = useCallback((defaultEnabled: boolean) => {
    const state = operation.current
    if (!settings || !state.active || state.writing) return
    state.writing = true
    const epoch = state.epoch
    setBusy(true)
    setNote(false)
    setError('')
    void rpc<DelegationSettings>(call, 'settings.update', {
      defaultEnabled,
      expectedRevision: settings.revision,
    }).then(next => {
      if (!state.active || state.epoch !== epoch) return
      setSettings(next)
      setNote(true)
    }).catch(reason => {
      if (!state.active || state.epoch !== epoch) return
      setError(reason instanceof RpcError && reason.code === 'stale' ? 'stale' : 'failed')
    }).finally(() => {
      if (state.active && state.epoch === epoch) { state.writing = false; setBusy(false) }
    })
  }, [call, settings])

  if (!settings) {
    return (
      <section className="dlg-root dlg-settings dsh-ui-page">
        {error
          ? <p role="alert" className="dsh-ui-error">{text[error]}</p>
          : <p role="status" className="dsh-ui-hint">{text.loading}</p>}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => refreshRef.current()}>{text.retry}</Button>
      </section>
    )
  }

  return (
    <section className="dlg-root dlg-settings dsh-ui-page" data-testid="delegation-settings">
      <div className="dlg-settings-status">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => refreshRef.current()}>{text.refresh}</Button>
        {error && <p role="alert" className="dsh-ui-error">{text[error]}</p>}
        {note && <p role="status" className="dsh-ui-notice">{text.saved}</p>}
      </div>
      <article className="dlg-root dsh-ui-card">
        <header className="dsh-ui-toggle-row">
          <div className="dsh-ui-toggle-text">
            <h3 className="dsh-ui-toggle-label">{text.default}</h3>
            <p className="dsh-ui-hint">{text.defaultHint}</p>
          </div>
          <Switch
            checked={settings.defaultEnabled}
            label={text.default}
            disabled={busy}
            onChange={next => save(next)}
          />
        </header>
      </article>
    </section>
  )
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.provide(DELEGATION_CLIENT_SERVICE, { active: true })
  ctx.effect(() => client.locale.register(NS, { zh: { ...zh }, en: { ...en } }), 'delegation.locale')
  // Style both the new-session option and the independent settings page.
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', PLUGIN_NAME)
    style.textContent = clientCss
    document.head.appendChild(style)
    return () => style.remove()
  }, 'delegation.styles')
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register(
    { name: 'plugins.bundle.config', key: PLUGIN_NAME },
    () => <DelegationSettingsPanel client={client} />,
  )), 'delegation.settings')
  ctx.effect(() => client.slots.inject('conversation.hero.options', () => client.slots.register(
    {
      name: 'conversation.hero.options',
      id: 'delegation',
      order: 20,
      locale: NS,
      inject: () => ({
        call: (endpoint: string, payload: unknown) => client.connection.rpc.call(RPC_CHANNEL, endpoint, payload),
        subscribeGeneration: (listener: () => void) => client.connection.generation?.subscribe(listener),
      }),
    },
    DelegationAction,
  )), 'delegation.slot')
}
