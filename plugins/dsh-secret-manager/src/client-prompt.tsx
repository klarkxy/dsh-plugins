/**
 * The `request_secret` tool view: a compact chat row that owns the dedicated
 * secret dialog. The dialog opens itself while the call is pending, closes
 * and clears its field the moment it submits, cancels or the call settles —
 * and never echoes an entered value back into an error.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Checkbox, Input as OfficialInput, Modal, StateDot, TextShimmer, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { RPC, valueProblem, type PendingView, type SubmitOutcome } from './contracts.ts'
import { readPendingView, readSubmitOutcome, readToolResult } from './client-wire.ts'
import { translator, type UiTranslate } from './ui-copy.ts'

export type RpcCaller = (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>

/** The lazy argument view the tool-call owner hands out (ui-tool contract). */
export type ToolArgsView = {
  has(key: string): boolean
  complete(key: string): boolean
  text(key: string): string | undefined
  value(key: string): unknown
}

export type ToolViewBlock = {
  callId: string
  name?: string
  args?: ToolArgsView
  kind?: 'tool-result'
  meta?: unknown
  isError?: boolean
}

export type SecretToolViewProps = {
  sessionId: string
  callId: string
  phase: 'preparing' | 'start' | 'result'
  block: ToolViewBlock
  t(key: string, params?: Record<string, unknown>): string
  call?: RpcCaller
}

const PENDING_ARG_KEYS = ['pending', 'request', 'dialog'] as const

function argField(args: ToolArgsView | undefined, key: string): unknown {
  if (!args) return undefined
  const value = args.value(key)
  return value !== undefined ? value : args.text(key)
}

/** The request object inside the call args, wherever the tool carries it. */
function readArgsPending(block: ToolViewBlock): PendingView | undefined {
  const args = block.args
  for (const key of PENDING_ARG_KEYS) {
    const view = readPendingView(argField(args, key))
    if (view) return view
  }
  return undefined
}

/** Whether the streaming argument set has a readable pending request yet. */
export function pendingComplete(block: ToolViewBlock): boolean {
  const args = block.args
  if (!args) return false
  return PENDING_ARG_KEYS.some(key => args.has(key) && args.complete(key))
}

export type PromptDone =
  | { kind: 'submitted'; outcome: SubmitOutcome }
  | { kind: 'cancelled' }
  | { kind: 'error'; fixed: 'submit' | 'cancel' }

export type PromptRead = {
  phase: 'preparing' | 'start' | 'result'
  pending?: PendingView
  status?: 'ready' | 'cancelled' | 'failed' | 'other'
  summary?: string
}

/**
 * What the row should show at this phase. A result block's `meta` mirrors the
 * Host's presentation record; while the call is open the args carry the dialog.
 */
export function readToolCall(props: Pick<SecretToolViewProps, 'phase' | 'block'>): PromptRead {
  const phase = props.phase ?? (props.block.kind === 'tool-result' ? 'result' : 'start')
  if (phase === 'result') {
    if (props.block.isError === true) return { phase, status: 'failed' }
    const meta = readToolResult(props.block.meta)
    if (!meta) return { phase, status: 'other' }
    const status = meta.status === 'stored' || meta.status === 'ready' ? 'ready'
      : meta.status === 'cancelled' ? 'cancelled'
      : 'failed'
    return { phase, status, summary: meta.summary }
  }
  if (phase === 'preparing' && !pendingComplete(props.block)) return { phase }
  return { phase, pending: readArgsPending(props.block) }
}

/** The one place the entered value exists; the dialog clears it before settle. */
export function SecretPromptDialog(props: {
  pending: PendingView
  open: boolean
  call: RpcCaller
  t: UiTranslate
  onDone(result: PromptDone): void
  onClose(): void
}) {
  const { pending, open, call, t } = props
  const [value, setValue] = useState('')
  const [grantEnv, setGrantEnv] = useState(pending.requestEnv)
  const [grantHttp, setGrantHttp] = useState(pending.httpOrigin !== undefined)
  const [busy, setBusy] = useState<'submit' | 'cancel' | null>(null)
  const [fixedError, setFixedError] = useState<'submit' | 'cancel' | null>(null)
  /** A decline that the Host never confirmed — the card shows it until retried. */
  const [declineFailed, setDeclineFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // A user gesture fires once: the id is consumed by the first call and a
  // re-render can never replay the same sensitive request.
  const used = useRef<'submit' | 'cancel' | null>(null)

  // Re-sync the scope defaults when a different pending request mounts.
  useEffect(() => {
    setValue('')
    setGrantEnv(pending.requestEnv)
    setGrantHttp(pending.httpOrigin !== undefined)
    setBusy(null)
    setFixedError(null)
    used.current = null
    setDeclineFailed(false)
  }, [pending.id, pending.requestEnv, pending.httpOrigin])

  useEffect(() => {
    if (!open) {
      if (inputRef.current) inputRef.current.value = ''
      setValue('')
    }
  }, [open])

  const done = props.onDone
  const doneRef = useRef(done)
  doneRef.current = done

  const submit = useCallback(async () => {
    if (busy || used.current) return
    const entered = value
    const reuse = entered.length === 0 && pending.configured
    if (!reuse) {
      const problem = valueProblem(entered)
      if (problem) { setFixedError('submit'); return }
    }
    used.current = 'submit'
    setBusy('submit')
    setFixedError(null)
    // The typed value leaves the field the moment the request goes out — the
    // DOM node itself is cleared, not just the controlled state, so a stale
    // element cannot hold the secret even for a frame.
    if (inputRef.current) inputRef.current.value = ''
    setValue('')
    try {
      const raw = await call(RPC.submit, {
        id: pending.id, sessionId: pending.sessionId, callId: pending.callId,
        ...(entered.length > 0 ? { value: entered } : {}),
        grantEnv: pending.requestEnv ? grantEnv : false,
        grantHttp: pending.httpOrigin !== undefined ? grantHttp : false,
      })
      const envelope = raw as { ok?: unknown; value?: unknown }
      const outcome = envelope?.ok === true ? readSubmitOutcome(envelope.value) : undefined
      if (!outcome) { used.current = null; setFixedError('submit'); return }
      doneRef.current({ kind: 'submitted', outcome })
    } catch {
      used.current = null
      setFixedError('submit')
    } finally {
      setBusy(null)
    }
  }, [busy, value, pending, grantEnv, grantHttp, call])

  const cancel = useCallback(async () => {
    if (busy || used.current) return
    if (inputRef.current) inputRef.current.value = ''
    setValue('')
    used.current = 'cancel'
    setBusy('cancel')
    setFixedError(null)
    setDeclineFailed(false)
    try {
      const raw = await call(RPC.cancel, { id: pending.id, sessionId: pending.sessionId, callId: pending.callId })
      setValue('')
      const envelope = raw as { ok?: unknown }
      if (envelope?.ok !== true) { used.current = null; setFixedError('cancel'); setDeclineFailed(true); return }
      doneRef.current({ kind: 'cancelled' })
    } catch {
      used.current = null
      setFixedError('cancel')
      setDeclineFailed(true)
    } finally {
      setBusy(null)
    }
  }, [busy, pending, call])

  // Closing is a user decline: the request is cancelled, never left hanging.
  const onClose = props.onClose
  const requestCancel = useCallback(() => {
    onClose()
    void cancel()
  }, [onClose, cancel])

  const reuse = pending.configured
  const canSubmit = (reuse || value.length > 0) && busy === null
  const expiry = new Date(pending.expiresAt)
  const expiryText = Number.isFinite(expiry.getTime())
    ? expiry.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : ''
  const header = pending.httpOrigin !== undefined
    ? `${pending.authHeader}: ${pending.authPrefix} •••`
    : ''

  return (
    <>
    <Modal
      open={open}
      onClose={requestCancel}
      title={t('title', { slot: pending.slot })}
      closeLabel={t('close')}
      className="sm-root"
      footer={<div className="dsh-ui-actions dsh-ui-actions-end">
        <Button variant="outline" onClick={() => void cancel()} disabled={busy !== null}>
          {busy === 'cancel' ? t('cancelBusy') : t('cancelRequest')}
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
          {busy === 'submit' ? t('submitBusy') : grantEnv || grantHttp ? t('submit') : t('submitSaveOnly')}
        </Button>
      </div>}>
      <div className="dsh-ui-stack">
        <p className="dsh-ui-help">{t('description', { slot: pending.slot, purpose: pending.purpose })}</p>
        <dl className="dsh-ui-readonly">
          <dt>{t('refLine', { ref: pending.ref })}</dt>
          <dd>{t('envKeyLine', { envKey: pending.envKey })}</dd>
          {pending.resource ? <dd>{t('resourceLine', { resource: pending.resource })}</dd> : null}
        </dl>
        {pending.requestEnv ? (
          <label className="sm-grant">
            <Checkbox checked={grantEnv} onChange={setGrantEnv} label={t('grantEnv', { envKey: pending.envKey })} />
          </label>
        ) : null}
        {pending.httpOrigin !== undefined ? (
          <label className="sm-grant">
            <Checkbox checked={grantHttp} onChange={setGrantHttp} label={t('grantHttp', { httpOrigin: pending.httpOrigin, header })} />
          </label>
        ) : null}
        {expiryText ? <p className="dsh-ui-hint">{t('expiry', { at: expiryText })}</p> : null}
        <div className="sm-separator" />
        <div className="dsh-ui-field">
          <span className="dsh-ui-label" id="sm-secret-input-label">{t('inputLabel')}</span>
          <OfficialInput
            // Standard masked field. Never type anything else here — a made-up
            // input type falls back to plain text and shows the secret.
            ref={inputRef}
            type="password"
            className="sm-input"
            value={value}
            placeholder={t('placeholder')}
            disabled={busy !== null}
            autoFocus
            autoComplete="off"
            aria-labelledby="sm-secret-input-label"
            onChange={event => { setValue(event.target.value); setFixedError(current => current === 'submit' ? null : current) }}
          />
          <p className="dsh-ui-hint">{reuse ? t('reuseHint', { slot: pending.slot }) : t('requiredHint', { slot: pending.slot })}</p>
          <p className="dsh-ui-hint">{t('valueGoesToHost')}</p>
          {fixedError === 'submit' ? <p className="dsh-ui-error" role="alert">{t('submitFailed')}</p> : null}
          {fixedError === 'cancel' && open ? <p className="dsh-ui-error" role="alert">{t('cancelFailed')}</p> : null}
        </div>
      </div>
    </Modal>
    {/* A decline that never reached the Host surfaces on the card itself —
        the dialog may be closed, so hiding the failure here would lie about
        the request being cancelled. */}
    {declineFailed && !open ? (
      <div className="sm-prompt-row" role="alert">
        <span className="dsh-ui-error">{t('cancelFailed')}</span>
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void cancel()}>
          {busy === 'cancel' ? t('cancelBusy') : t('retry')}
        </Button>
      </div>
    ) : null}
    </>
  )
}

/**
 * The chat row registered under `key: 'request_secret'`. It owns nothing but
 * the pending window and the settled line; the dialog does the dangerous work.
 */
export function SecretToolView(props: SecretToolViewProps): ReactNode {
  const { phase, block, callId, sessionId } = props
  const t = (props.t ?? translator('zh')) as UiTranslate
  const call = props.call
  const read = readToolCall({ phase, block })

  const [pending, setPending] = useState<PendingView | undefined>(read.pending)
  const [open, setOpen] = useState(false)
  const [settled, setSettled] = useState<'submitted' | 'cancelled' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const opened = useRef(false)

  // Fetch the live request while the call is open. The Host primes its store
  // before the pending record exists, so the first read can legitimately come
  // back empty — retry with a short bounded backoff instead of giving up, and
  // stop entirely once the request shows, the call settles, or the row unmounts.
  useEffect(() => {
    if (phase !== 'start' || pending || !call) return
    let stale = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    const poll = () => {
      if (stale) return
      void call(RPC.pending, { sessionId, callId })
        .then(raw => {
          if (stale) return
          const envelope = raw as { ok?: unknown; value?: unknown }
          const view = envelope?.ok === true ? readPendingView(envelope.value) : undefined
          if (view) { setPending(view); return }
          if (attempt < 8) {
            attempt += 1
            timer = setTimeout(poll, Math.min(200 * 2 ** attempt, 2000))
          }
        })
        .catch(() => {
          if (stale) return
          if (attempt < 8) {
            attempt += 1
            timer = setTimeout(poll, Math.min(200 * 2 ** attempt, 2000))
          }
        })
    }
    poll()
    return () => { stale = true; if (timer !== undefined) clearTimeout(timer) }
  }, [phase, pending, call, sessionId, callId])

  // The pending phase opens the dialog proactively, once per mount.
  useEffect(() => {
    if (phase === 'start' && pending && !opened.current && !settled) {
      opened.current = true
      setOpen(true)
    }
  }, [phase, pending, settled])

  // The call settling any other way (submit elsewhere, timeout, error) closes
  // the dialog and clears whatever was typed.
  useEffect(() => {
    if (phase === 'result') setOpen(false)
  }, [phase])

  const onDone = useCallback((result: PromptDone) => {
    if (result.kind === 'submitted') {
      setSettled('submitted')
      setOpen(false)
      setNotice(result.outcome.envGranted || result.outcome.httpGranted
        ? t('grantedNotice', { slot: result.outcome.slot })
        : t('savedNotice', { slot: result.outcome.slot }))
    } else if (result.kind === 'cancelled') {
      setSettled('cancelled')
      setOpen(false)
      setNotice(t('cancelled'))
    }
  }, [t])

  const reopen = useCallback(() => {
    if (!call) { setOpen(pending !== undefined); return }
    void call(RPC.pending, { sessionId, callId }).then(raw => {
      const envelope = raw as { ok?: unknown; value?: unknown }
      const view = envelope?.ok === true ? readPendingView(envelope.value) : undefined
      if (view) { setPending(view); setOpen(true) }
    }).catch(() => {})
  }, [call, sessionId, callId, pending])

  if (read.phase === 'preparing' && !read.pending) {
    return <div className="sm-root sm-prompt" role="status"><TextShimmer active>{t('preparing')}</TextShimmer></div>
  }

  const result = read.phase === 'result' ? read : undefined
  const reference = pending?.ref ?? readToolResult(block.meta)?.ref
  const awaiting = phase === 'start' && settled === null
  const statusText = settled === 'submitted' ? t('ready')
    : settled === 'cancelled' ? t('declined')
    : awaiting ? t('awaiting', { slot: pending?.slot ?? '' })
    : result?.status === 'ready' ? t('ready')
    : result?.status === 'cancelled' ? t('declined')
    : result?.status === 'failed' ? t('failed')
    : result?.summary ?? t('ready')
  const dot = settled === 'submitted' || result?.status === 'ready' ? 'done'
    : settled === 'cancelled' || result?.status === 'cancelled' ? 'warning'
    : result?.status === 'failed' ? 'error'
    : awaiting ? 'ongoing' : 'idle'

  return (
    <div className="sm-root sm-prompt" data-testid="sm-toolview">
      <div className="sm-prompt-row">
        <StateDot state={dot} />
        <span className="dsh-ui-compact">{statusText}</span>
        {reference ? <span className="dsh-ui-meta sm-mono">{reference}</span> : null}
        {phase === 'start' && settled === null ? (
          <Button variant="outline" size="sm" onClick={reopen}>{t('reopen')}</Button>
        ) : null}
      </div>
      {pending && call ? (
        <SecretPromptDialog
          pending={pending}
          open={open}
          call={call}
          t={t}
          onDone={onDone}
          onClose={() => setOpen(false)}
        />
      ) : null}
      {notice ? <Toast text={notice} tone="success" onDone={() => setNotice(null)} /> : null}
    </div>
  )
}
