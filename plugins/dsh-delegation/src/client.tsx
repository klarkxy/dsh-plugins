import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconUsersOutlineRegular, Pill, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { installClientPluginLogger } from '@klarkxy/dsh-plugin-kit/client-logger'
import {
  DELEGATION_CLIENT_SERVICE, PLUGIN_NAME, RPC_CHANNEL,
  type DelegationSessionStatus, type RpcResult,
} from './contracts.ts'

export const name = 'dsh-delegation-client'
export const inject = ['slots', 'connection', 'locale'] as const

const NS = 'dsh-delegation.action'

const zh = {
  action: '委派',
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
        <Pill
          className="dlg-chip"
          active={enabled}
          aria-pressed={enabled}
          aria-label={t('mode')}
          disabled={!capable || locked || saving}
          onClick={() => void toggle()}
        >
          <IconUsersOutlineRegular />
          <span className="dlg-chip-label">{t('action')}</span>
        </Pill>
      </Tooltip>
      {notice ? <span role="status" className="dlg-note">{t(notice)}</span> : null}
    </span>
  )
}

export const clientCss = `${officialUiCss('dlg-root')}
.dlg-root.dlg-action { display: inline-flex; align-items: center; gap: 6px; }
.dlg-root .dlg-chip { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px; border-radius: 999px; font-size: 13px; line-height: 20px; border: 1px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dlg-root .dlg-chip svg { width: 16px; height: 16px; }
.dlg-root .dlg-chip:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dlg-root .dlg-chip[aria-pressed="true"] { background: var(--dsw-alias-button-primary-fill); border-color: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.dlg-root .dlg-chip[aria-pressed="true"]:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); border-color: var(--dsw-alias-button-primary-hover); }
.dlg-root .dlg-chip:disabled { opacity: 0.5; cursor: default; }
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
    register(spec: { name: string; id: string; order: number; label?: () => string; locale?: string; inject?: () => unknown }, render: unknown): () => void
  }
  locale: {
    register(ns: string, locales: { zh: Record<string, string>; en: Record<string, string> }): () => void
  }
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  installClientPluginLogger(ctx, PLUGIN_NAME)
  ctx.provide(DELEGATION_CLIENT_SERVICE, { active: true })
  ctx.effect(() => client.locale.register(NS, { zh: { ...zh }, en: { ...en } }), 'delegation.locale')
  // Style the new-session Delegate chip.
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', PLUGIN_NAME)
    style.textContent = clientCss
    document.head.appendChild(style)
    return () => style.remove()
  }, 'delegation.styles')
  // No settings row: delegation is chosen per session on the new-session
  // page, so a global default switch was redundant. The settings RPC stays
  // alive so stored rows that already carry defaultEnabled keep working.
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
