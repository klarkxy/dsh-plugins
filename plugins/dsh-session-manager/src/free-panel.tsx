import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Input, Menu, Modal, StateDot, type MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import { COPY_THREAD_FAILED, COPY_THREAD_LABEL, copyThreadId } from './copy-action.ts'
import { formatQuietTime } from './free-list.ts'
import type { FreeChatModel } from './session-actions.ts'
import { FREE_CHAT_ROOT, freeChatCss } from './styles.ts'
import { deleteBody, failureText, uiText, type CopyLocale } from './ui-copy.ts'

export function FreeChatIcon({ size }: { size: number; active?: boolean }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.5 3.5h11v7.5h-4.2L6 13.5V11H2.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

export function FreeChatPanel(props: { model: FreeChatModel; locale: CopyLocale }): React.ReactElement {
  const snapshot = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot, props.model.getSnapshot)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const searchId = useId()
  useEffect(() => {
    if (snapshot.focusNonce === 0) return
    titleRef.current?.focus()
  }, [snapshot.focusNonce])
  const copy = (key: Parameters<typeof uiText>[1]) => uiText(props.locale, key)
  return (
    <section className={`${FREE_CHAT_ROOT} dsh-free-panel`}>
      <style>{freeChatCss}</style>
      <div className="dsh-free-head">
        <h1 ref={titleRef} tabIndex={-1} className="dsh-ui-title">{copy('panel')}</h1>
        {snapshot.controls.create ? (
          <Button variant="primary" size="sm" disabled={snapshot.creating} onClick={() => { void props.model.create() }}>
            {copy('newChat')}
          </Button>
        ) : null}
      </div>
      <Input
        id={searchId}
        className="dsh-free-search"
        type="search"
        value={snapshot.query}
        aria-label={copy('search')}
        onChange={event => { props.model.setQuery(event.target.value) }}
      />
      {snapshot.notice ? <p className="dsh-ui-error dsh-free-alert" role="alert">{failureText(props.locale, snapshot.notice)}</p> : null}
      {snapshot.listStatus === 'loading' ? <p className="dsh-ui-loading">{copy('loading')}</p> : null}
      {snapshot.listStatus === 'error' ? (
        <div className="dsh-ui-empty">
          <p role="alert">{snapshot.listFailure?.reason && snapshot.listFailure.reason !== 'unknown' ? snapshot.listFailure.reason : copy('listError')}</p>
          <Button size="sm" onClick={() => { void props.model.refreshList() }}>{copy('retryList')}</Button>
        </div>
      ) : null}
      {snapshot.listStatus === 'empty' ? <p className="dsh-ui-empty">{copy('empty')}</p> : null}
      {snapshot.listStatus === 'nomatch' ? <p className="dsh-ui-empty">{copy('noMatch')}</p> : null}
      {snapshot.rows.length > 0 ? (
        <ul className="dsh-ui-list" aria-label={copy('panel')}>
          {snapshot.rows.map(row => (
            <FreeChatRow key={row.id} model={props.model} locale={props.locale} row={row} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function FreeChatRow(props: {
  model: FreeChatModel
  locale: CopyLocale
  row: { id: string; displayTitle: string; running: boolean; updatedAt: number }
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const snapshot = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot, props.model.getSnapshot)
  const copy = (key: Parameters<typeof uiText>[1]) => uiText(props.locale, key)
  const items: MenuItem[] = []
  if (snapshot.controls.fork) items.push({ id: 'fork', label: copy('fork') })
  items.push({ id: 'copy', label: copyFailed ? COPY_THREAD_FAILED[props.locale] : COPY_THREAD_LABEL[props.locale] })
  if (snapshot.controls.delete) items.push({ id: 'delete', label: copy('deleteChat'), danger: true })
  const onSelect = (id: string) => {
    if (id === 'copy') {
      void copyThreadId(props.row.id, writeClipboard).then(() => {
        setCopyFailed(false)
        setOpen(false)
      }, () => {
        setCopyFailed(true)
        setOpen(true)
      })
      return
    }
    setOpen(false)
    if (id === 'fork') void props.model.fork(props.row.id)
    if (id === 'delete') props.model.requestDelete(props.row.id)
  }
  const state = props.row.running ? copy('running') : copy('idle')
  return (
    <li className="dsh-ui-list-row dsh-free-line">
      <button type="button" className="dsh-free-open" onClick={() => { props.model.open(props.row.id) }}>
        <StateDot state={props.row.running ? 'ongoing' : 'idle'} size={8} />
        <span className="dsh-free-sr">{state}</span>
        <span className="dsh-free-title">{props.row.displayTitle}</span>
        <time className="dsh-free-time" dateTime={new Date(props.row.updatedAt).toISOString()}>
          {formatQuietTime(props.row.updatedAt, props.locale)}
        </time>
      </button>
      {copyFailed ? <span className="dsh-ui-error dsh-free-alert" role="alert">{COPY_THREAD_FAILED[props.locale]}</span> : null}
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        portal
        listClassName={FREE_CHAT_ROOT}
        anchor={(
          <Button
            size="sm"
            variant="ghost"
            aria-label={copy('menu')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            ···
          </Button>
        )}
        items={items}
        onSelect={onSelect}
      />
    </li>
  )
}

export function DeleteChatDialog(props: { model: FreeChatModel; locale: CopyLocale }): React.ReactElement | null {
  const snapshot = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot, props.model.getSnapshot)
  const request = snapshot.deleteRequest
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (request?.failure) confirmRef.current?.focus()
  }, [request?.failure])
  if (request === undefined) return null
  const copy = (key: Parameters<typeof uiText>[1]) => uiText(props.locale, key)
  const label = request.busy ? copy('deleting') : request.failure ? copy('retryList') : copy('deleteChat')
  return (
    <Modal
      open
      className={FREE_CHAT_ROOT}
      title={copy('deleteChat')}
      closeLabel={copy('close')}
      description={deleteBody(props.locale, request.classification)}
      onClose={() => { props.model.cancelDelete() }}
      footer={(
        <>
          <Button variant="ghost" disabled={request.busy} onClick={() => { props.model.cancelDelete() }}>{copy('cancel')}</Button>
          <Button
            ref={confirmRef}
            variant="primary"
            data-modal-autofocus
            disabled={request.busy}
            onClick={() => { void props.model.confirmDelete() }}
          >
            {label}
          </Button>
        </>
      )}
    >
      <p>{request.title}</p>
      {request.failure ? <p className="dsh-ui-error dsh-free-alert" role="alert">{failureText(props.locale, request.failure)}</p> : null}
    </Modal>
  )
}

export function FreeChatScreen(props: { model: FreeChatModel; locale: CopyLocale }): React.ReactElement {
  return (
    <>
      <FreeChatPanel model={props.model} locale={props.locale} />
      <DeleteChatDialog model={props.model} locale={props.locale} />
    </>
  )
}

async function writeClipboard(value: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard
  if (clipboard === undefined) throw new Error('clipboard unavailable')
  await clipboard.writeText(value)
}
