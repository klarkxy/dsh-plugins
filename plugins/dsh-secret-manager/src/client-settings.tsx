/**
 * Settings → 密钥管理器 page: one flat list of stored slots plus the grants
 * the currently open session holds. Every write (save, replace, delete,
 * revoke) is an explicit user action behind its own button; values are
 * masked, never read back and never listed.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Checkbox, Input as OfficialInput, Modal, StateDot, TextShimmer, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  isSlot,
  secretRefOf,
  valueProblem,
  RPC,
  type RpcResult,
} from './contracts.ts'
import { readListOutcome, type readSecretEntry } from './client-wire.ts'
import { createSecretClientState } from './client-state.ts'
import type { UiTranslate } from './ui-copy.ts'

export type SecretRpcCall = (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>

type Entry = NonNullable<ReturnType<typeof readSecretEntry>>

type ListLoad =
  | { status: 'loading' }
  | { status: 'ready'; entries: Entry[] }
  | { status: 'error' }

type Confirm =
  | { kind: 'replace'; slot: string }
  | { kind: 'delete'; slot: string }
  | { kind: 'revokeAll'; slot: string }
  | { kind: 'revokeSession'; slot: string }
  | null

function envelope(raw: unknown): RpcResult {
  return isEnvelope(raw) ? raw : { ok: false, error: { code: 'invalid-response', message: 'RPC 返回格式无效。' } }
}
function isEnvelope(raw: unknown): raw is RpcResult {
  return typeof raw === 'object' && raw !== null && (raw as { ok?: unknown }).ok !== undefined
}

/** Shorten a session id for display without pretending it is readable. */
export function sessionLabel(sessionId: string): string {
  return sessionId.length > 12 ? `${sessionId.slice(0, 8)}…` : sessionId
}

function GrantTag(props: { env?: boolean; http?: boolean; t: UiTranslate }): ReactNode {
  const { env, http, t } = props
  const parts: string[] = []
  if (env) parts.push(t('envGrantedHere'))
  if (http) parts.push(t('httpGrantedHere'))
  if (parts.length === 0) return null
  return <span className="dsh-ui-hint">{parts.join(' · ')}</span>
}

function SecretRow(props: {
  entry: Entry
  busy: string | null
  sessionId: string
  onReplace(slot: string): void
  onDelete(slot: string): void
  onRevokeSession(slot: string): void
  onRevokeAll(slot: string): void
  t: UiTranslate
}): ReactNode {
  const { entry, busy, sessionId, t } = props
  const grantedHere = entry.envGranted || entry.httpGranted
  return (
    <li className="dsh-ui-card dsh-ui-card--flat sm-secret-row" data-testid={`sm-secret-${entry.slot}`}>
      <div>
        <div className="dsh-ui-list-name">{entry.slot}</div>
        <div className="sm-secret-meta">
          <span className="dsh-ui-meta sm-mono">{entry.ref}</span>
          <span className="dsh-ui-meta">{t('envName', { envKey: entry.envKey })}</span>
        </div>
        <div className="sm-secret-meta">
          <span className="dsh-ui-meta">
            {entry.envGrantedSessions + entry.httpGrantedSessions === 0
              ? t('noGrants')
              : `${t('grantedEnv', { n: entry.envGrantedSessions })} · ${t('grantedHttp', { n: entry.httpGrantedSessions })}`}
          </span>
          {sessionId && grantedHere ? <GrantTag env={entry.envGranted} http={entry.httpGranted} t={t} /> : null}
        </div>
      </div>
      <div className="sm-secret-actions">
        {sessionId && grantedHere ? (
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => props.onRevokeSession(entry.slot)}>
            {t('revokeThis')}
          </Button>
        ) : null}
        {entry.envGrantedSessions + entry.httpGrantedSessions > 0 ? (
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => props.onRevokeAll(entry.slot)}>
            {t('revokeAll')}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => props.onReplace(entry.slot)}>
          {t('replace')}
        </Button>
        <Button variant="outline" size="sm" className="sm-button-danger" disabled={busy !== null} onClick={() => props.onDelete(entry.slot)}>
          {t('delete')}
        </Button>
      </div>
    </li>
  )
}

function ConfirmDialog(props: {
  confirm: Confirm
  t: UiTranslate
  busy: boolean
  onConfirm(confirm: NonNullable<Confirm>): void
  onClose(): void
}): ReactNode {
  const { confirm, t, busy } = props
  if (!confirm) return null
  const title = confirm.kind === 'replace' ? t('replaceTitle', { slot: confirm.slot })
    : confirm.kind === 'delete' ? t('deleteTitle', { slot: confirm.slot })
    : confirm.kind === 'revokeAll' ? t('revokeAllTitle', { slot: confirm.slot })
    : t('revokeAllTitle', { slot: confirm.slot })
  const body = confirm.kind === 'replace' ? t('replaceBody')
    : confirm.kind === 'delete' ? t('deleteBody')
    : confirm.kind === 'revokeAll' ? t('revokeAllBody')
    : t('sessionHint')
  const danger = confirm.kind !== 'replace'
  return (
    <Modal
      open
      onClose={props.onClose}
      title={title}
      closeLabel={t('close')}
      className="sm-root"
      footer={<div className="dsh-ui-actions dsh-ui-actions-end">
        <Button variant="outline" onClick={props.onClose} disabled={busy}>{t('cancel')}</Button>
        <Button variant={danger ? 'outline' : 'primary'} className={danger ? 'sm-button-danger' : undefined}
          disabled={busy} onClick={() => props.onConfirm(confirm)}>
          {t('confirm')}
        </Button>
      </div>}>
      <p className="dsh-ui-help">{body}</p>
    </Modal>
  )
}

export function SecretManagerSettings(props: {
  call: SecretRpcCall
  sessionId: string
  t: UiTranslate
}): ReactNode {
  const { call, sessionId, t } = props
  const gateRef = useRef<ReturnType<typeof createSecretClientState> | null>(null)
  if (!gateRef.current) gateRef.current = createSecretClientState()
  const gate = gateRef.current

  const [list, setList] = useState<ListLoad>({ status: 'loading' })
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [replaceValue, setReplaceValue] = useState('')
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState<'add' | 'confirm' | null>(null)
  const valueRef = useRef<HTMLInputElement | null>(null)
  const replaceRef = useRef<HTMLInputElement | null>(null)
  const [failure, setFailure] = useState<'load' | 'action' | 'value' | 'name' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => () => gate.cancel(), [gate])

  const load = useCallback(async (): Promise<void> => {
    const { ticket, signal } = gate.begin()
    setList(current => current.status === 'ready' ? current : { status: 'loading' })
    setFailure(null)
    try {
      const raw = await call(RPC.list, sessionId ? { sessionId } : {}, signal)
      if (!gate.isCurrent(ticket)) return
      const result = envelope(raw)
      if (!result.ok) { setList({ status: 'error' }); return }
      const entries = readListOutcome(result.value)
      if (!entries) { setList({ status: 'error' }); return }
      setList({ status: 'ready', entries })
    } catch {
      if (!gate.isCurrent(ticket)) return
      setList({ status: 'error' })
    }
  }, [gate, call, sessionId])

  useEffect(() => { void load() }, [load])

  const add = useCallback(async (): Promise<void> => {
    const slot = name.trim()
    const entered = value
    if (!isSlot(slot)) { setFailure('name'); return }
    const problem = valueProblem(entered)
    if (problem) { setFailure('value'); return }
    if (busy) return
    setBusy('add')
    setFailure(null)
    try {
      // Clear the field — DOM node included — before the request leaves.
      if (valueRef.current) valueRef.current.value = ''
      setValue('')
      const raw = await call(RPC.save, { slot, value: entered })
      const result = envelope(raw)
      if (!result.ok) { setFailure('action'); return }
      setNotice(t('savedDone'))
      setName('')
      await load()
    } catch {
      if (valueRef.current) valueRef.current.value = ''
      setValue('')
      setFailure('action')
    } finally {
      setBusy(null)
    }
  }, [name, value, busy, call, load, t])

  const runConfirm = useCallback(async (target: NonNullable<Confirm>): Promise<void> => {
    if (busy) return
    setBusy('confirm')
    setFailure(null)
    try {
      let raw: unknown
      if (target.kind === 'replace') {
        const entered = replaceValue
        const problem = valueProblem(entered)
        if (problem) { setFailure('action'); return }
        // The typed value leaves the field the moment the request goes out —
        // DOM node included — it never stays behind to be echoed or replayed.
        if (replaceRef.current) replaceRef.current.value = ''
        setReplaceValue('')
        raw = await call(RPC.save, { slot: target.slot, value: entered })
      } else if (target.kind === 'delete') {
        raw = await call(RPC.delete, { slot: target.slot })
      } else if (target.kind === 'revokeAll') {
        raw = await call(RPC.revoke, { slot: target.slot })
      } else {
        raw = await call(RPC.revoke, { slot: target.slot, sessionId })
      }
      const result = envelope(raw)
      if (!result.ok) { setFailure('action'); return }
      setConfirm(null)
      setNotice(target.kind === 'replace' ? t('savedDone')
        : target.kind === 'delete' ? t('deletedDone')
        : t('revokeDone'))
      await load()
    } catch {
      setFailure('action')
    } finally {
      setBusy(null)
    }
  }, [busy, replaceValue, call, sessionId, load, t])

  const entries = list.status === 'ready' ? list.entries : []
  const hasSession = sessionId.length > 0
  const anyGrantedHere = entries.some(entry => entry.envGranted || entry.httpGranted)

  return (
    <section className="sm-root dsh-ui-page" data-testid="sm-settings" aria-label={t('sectionLabel')}>
      <section className="dsh-ui-stack" aria-label={t('secretsTitle')}>
        <h3 className="dsh-ui-heading">{t('secretsTitle')}</h3>
        <p className="dsh-ui-help">{t('addHint')}</p>
        <div className="sm-add-grid">
          <div className="dsh-ui-field">
            <span className="dsh-ui-label" id="sm-name-label">{t('nameLabel')}</span>
            <OfficialInput
              type="text"
              className="sm-input"
              value={name}
              placeholder={t('namePlaceholder')}
              disabled={busy !== null}
              aria-labelledby="sm-name-label"
              onChange={event => { setName(event.target.value); setFailure(current => current === 'name' ? null : current) }}
            />
            {isSlot(name.trim()) ? <span className="dsh-ui-hint sm-mono">{secretRefOf(name.trim())}</span> : null}
          </div>
          <div className="dsh-ui-field">
            <span className="dsh-ui-label" id="sm-value-label">{t('valueLabel')}</span>
            <OfficialInput
              ref={valueRef}
              type="password"
              className="sm-input"
              value={value}
              placeholder={t('placeholder')}
              disabled={busy !== null}
              autoComplete="off"
              aria-labelledby="sm-value-label"
              onChange={event => { setValue(event.target.value); setFailure(current => current === 'value' ? null : current) }}
            />
          </div>
        </div>
        {failure === 'name' ? <p className="dsh-ui-error" role="alert">{t('nameInvalid')}</p> : null}
        {failure === 'value' ? <p className="dsh-ui-error" role="alert">{t('valueInvalid')}</p> : null}
        <div className="dsh-ui-actions">
          <Button variant="primary" disabled={busy !== null || name.trim().length === 0 || value.length === 0}
            onClick={() => void add()}>
            {busy === 'add' ? <TextShimmer active>{t('submitBusy')}</TextShimmer> : t('save')}
          </Button>
          <Button variant="outline" disabled={busy !== null} onClick={() => void load()}>{t('refresh')}</Button>
        </div>
        {failure === 'action' ? <p className="dsh-ui-error" role="alert">{t('actionFailed')}</p> : null}
        {list.status === 'loading' ? (
          <p className="dsh-ui-loading" role="status"><TextShimmer active>{t('listLoading')}</TextShimmer></p>
        ) : null}
        {list.status === 'error' ? (
          <div className="dsh-ui-stack">
            <p className="dsh-ui-error" role="alert">{t('listFailed')}</p>
            <div className="dsh-ui-actions"><Button variant="outline" onClick={() => void load()}>{t('retry')}</Button></div>
          </div>
        ) : null}
        {list.status === 'ready' && entries.length === 0 ? (
          <p className="dsh-ui-empty">{t('listEmpty')}</p>
        ) : null}
        {entries.length > 0 ? (
          <ul className="dsh-ui-list">
            {entries.map(entry => (
              <SecretRow
                key={entry.slot}
                entry={entry}
                busy={busy}
                sessionId={sessionId}
                t={t}
                onReplace={slot => { setReplaceValue(''); setConfirm({ kind: 'replace', slot }) }}
                onDelete={slot => setConfirm({ kind: 'delete', slot })}
                onRevokeSession={slot => setConfirm({ kind: 'revokeSession', slot })}
                onRevokeAll={slot => setConfirm({ kind: 'revokeAll', slot })}
              />
            ))}
          </ul>
        ) : null}
      </section>

      <section className="dsh-ui-stack" aria-label={t('grantsTitle')}>
        <h3 className="dsh-ui-heading">{t('grantsTitle')}</h3>
        {!hasSession ? <p className="dsh-ui-empty">{t('noSession')}</p> : (
          <div className="dsh-ui-stack">
            <p className="dsh-ui-meta">{t('grantsFor', { session: sessionLabel(sessionId) })}</p>
            {!anyGrantedHere ? <p className="dsh-ui-empty">{t('grantsEmpty')}</p> : (
              <p className="dsh-ui-hint">{t('sessionHint')}</p>
            )}
          </div>
        )}
      </section>

      {confirm?.kind === 'replace' ? (
        <Modal
          open
          onClose={() => setConfirm(null)}
          title={t('replaceTitle', { slot: confirm.slot })}
          closeLabel={t('close')}
          className="sm-root"
          footer={<div className="dsh-ui-actions dsh-ui-actions-end">
            <Button variant="outline" disabled={busy !== null} onClick={() => setConfirm(null)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy !== null || replaceValue.length === 0}
              onClick={() => void runConfirm(confirm)}>
              {busy === 'confirm' ? <TextShimmer active>{t('submitBusy')}</TextShimmer> : t('confirm')}
            </Button>
          </div>}>
          <div className="dsh-ui-stack">
            <p className="dsh-ui-help">{t('replaceBody')}</p>
            <div className="dsh-ui-field">
              <span className="dsh-ui-label" id="sm-replace-label">{t('replaceFieldLabel')}</span>
              <OfficialInput
                ref={replaceRef}
                type="password"
                className="sm-input"
                value={replaceValue}
                placeholder={t('placeholder')}
                disabled={busy !== null}
                autoFocus
                autoComplete="off"
                aria-labelledby="sm-replace-label"
                onChange={event => setReplaceValue(event.target.value)}
              />
            </div>
          </div>
        </Modal>
      ) : null}
      {confirm && confirm.kind !== 'replace' ? (
        <ConfirmDialog
          confirm={confirm}
          t={t}
          busy={busy !== null}
          onConfirm={target => void runConfirm(target)}
          onClose={() => setConfirm(null)}
        />
      ) : null}
      {notice ? <Toast text={notice} tone="success" onDone={() => setNotice(null)} /> : null}
    </section>
  )
}
