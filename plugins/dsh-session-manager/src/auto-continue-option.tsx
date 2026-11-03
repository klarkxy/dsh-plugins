/**
 * The hero-row Auto-continue option: a chip that opens a three-mode menu on a
 * blank session and locks once the session starts. Mirrors the delegation
 * chip's revision discipline: stale reads never roll the chip back, a 'stale'
 * rejection refetches, and 'session-locked' explains itself in the tooltip.
 */
import { IconChevronDownOutlineRegular, IconRefreshOutlineRegular, Menu, Pill, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AUTO_CONTINUE_STATUS_ENDPOINT,
  AUTO_CONTINUE_UPDATE_ENDPOINT,
  type AutoContinueMode,
  type AutoContinueStatus,
} from './contracts.ts'
import { FREE_CHAT_ROOT } from './styles.ts'
import { uiText, type CopyLocale } from './ui-copy.ts'

class RpcError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

async function rpc<T>(call: (endpoint: string, payload: unknown) => Promise<unknown>, endpoint: string, payload: unknown): Promise<T> {
  const result = await call(endpoint, payload) as { ok: true; value: T } | { ok: false; error?: { code?: string; message?: string } } | undefined
  if (!result || result.ok !== true) {
    const failed = result && 'error' in result ? result.error : undefined
    throw new RpcError(failed?.code ?? 'unknown', failed?.message ?? '')
  }
  return result.value
}

export interface AutoContinueSessionSnapshotLike {
  openState?: string
  running?: boolean
  blank?: boolean
  awaitingFirstTurn?: boolean
  pendingSubmissions?: readonly unknown[]
}

export interface AutoContinueOptionProps {
  sessionId: string
  call: (endpoint: string, payload: unknown) => Promise<unknown>
  /** Host connection-generation subscription; refetches on reconnect. */
  subscribeGeneration?: (listener: () => void) => (() => void) | undefined
  /** Host per-session selector hook; a cold→open transition triggers a refetch. */
  useSession?: <T>(selector: (snapshot: AutoContinueSessionSnapshotLike) => T) => T
  locale: CopyLocale
}

type Notice = '' | 'autoContinueStale' | 'autoContinueFailed' | 'autoContinueLocked'

const MODES: readonly AutoContinueMode[] = ['off', 'cautious', 'bold']

export function AutoContinueOption({ sessionId, call, subscribeGeneration, useSession, locale }: AutoContinueOptionProps) {
  const [status, setStatus] = useState<AutoContinueStatus>()
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>('')
  const [open, setOpen] = useState(false)
  const generationRef = useRef(0)
  const readSeqRef = useRef(0)
  const openState = useSession?.(snapshot => snapshot.openState)
  const sessionRunning = useSession?.(snapshot => snapshot.running === true)
  const sessionBlank = useSession?.(snapshot => snapshot.blank)
  const submitting = useSession?.(snapshot => snapshot.awaitingFirstTurn === true || (snapshot.pendingSubmissions?.length ?? 0) > 0)

  const load = useCallback(async () => {
    const generation = generationRef.current
    const seq = ++readSeqRef.current
    try {
      const next = await rpc<AutoContinueStatus>(call, AUTO_CONTINUE_STATUS_ENDPOINT, { sessionId })
      if (generationRef.current !== generation || seq !== readSeqRef.current) return
      setStatus(prev => prev && prev.sessionId === next.sessionId && next.revision < prev.revision ? prev : next)
    } catch {
      // A failed refetch keeps the last known state; the chip stays put.
    }
  }, [call, sessionId])

  useEffect(() => {
    generationRef.current += 1
    readSeqRef.current += 1
    setStatus(undefined)
    setSaving(false)
    setNotice('')
    setOpen(false)
  }, [sessionId])

  useEffect(() => { void load() }, [load, openState, sessionRunning, sessionBlank])

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

  const choose = useCallback(async (mode: AutoContinueMode) => {
    if (!status || saving || status.locked || sessionBlank === false || sessionRunning || submitting || mode === status.mode) return
    const generation = generationRef.current
    readSeqRef.current += 1
    setSaving(true)
    setNotice('')
    try {
      const next = await rpc<AutoContinueStatus>(call, AUTO_CONTINUE_UPDATE_ENDPOINT, {
        sessionId, mode, expectedRevision: status.revision,
      })
      if (generationRef.current !== generation) return
      setStatus(next)
    } catch (reason) {
      if (generationRef.current !== generation) return
      if (reason instanceof RpcError && (reason.code === 'stale' || reason.code === 'session-locked')) {
        setNotice(reason.code === 'stale' ? 'autoContinueStale' : 'autoContinueLocked')
        void load()
      } else {
        setNotice('autoContinueFailed')
      }
    } finally {
      if (generationRef.current === generation) setSaving(false)
    }
  }, [call, load, saving, sessionId, status, sessionBlank, sessionRunning, submitting])

  if (!status || status.role === 'executor' || sessionBlank === false) return null
  const mode = status.mode
  const locked = status.locked || sessionRunning === true || submitting === true
  const tooltip = locked
    ? uiText(locale, 'autoContinueLocked')
    : notice
      ? uiText(locale, notice)
      : uiText(locale, 'autoContinueTooltip')
  const modeKey = mode === 'cautious' ? 'autoContinueCautious' : mode === 'bold' ? 'autoContinueBold' : 'autoContinueOff'
  const label = `${uiText(locale, 'autoContinue')} · ${uiText(locale, modeKey)}`
  return (
    <span className={`${FREE_CHAT_ROOT} smac-option`}>
      <Menu
        open={open}
        align="end"
        portal
        listClassName={FREE_CHAT_ROOT}
        selectedId={mode}
        items={MODES.map(value => ({
          id: value,
          label: uiText(locale, value === 'off' ? 'autoContinueOff' : value === 'cautious' ? 'autoContinueCautious' : 'autoContinueBold'),
        }))}
        onSelect={id => {
          setOpen(false)
          void choose(id as AutoContinueMode)
        }}
        onClose={() => setOpen(false)}
        anchor={(
          <Tooltip label={tooltip} side="bottom" gap={4}>
            <Pill
              className={`smac-chip${mode !== 'off' ? ' smac-chip-on' : ''}`}
              active={mode !== 'off'}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={label}
              disabled={locked || saving}
              onClick={() => setOpen(current => !current)}
            >
              <IconRefreshOutlineRegular />
              <span className="smac-chip-label">{label}</span>
              <IconChevronDownOutlineRegular className="smac-chevron" />
            </Pill>
          </Tooltip>
        )}
      />
      {notice ? <span role="status" className="smac-note">{uiText(locale, notice)}</span> : null}
    </span>
  )
}
