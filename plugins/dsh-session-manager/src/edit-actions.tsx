import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { MessageEditor } from './message-editor.tsx'
import { EditMessageIcon } from './edit-icon.tsx'
import { HostOperationError, isStaleRetryFailure, readFailure, type RetryModel } from './session-actions.ts'
import { prepareEditContent, previewEdit, type DraftAttachment, type EditHost, type EditSubmission } from './edit-host.ts'
import type { EditPrepareValue } from './contracts.ts'
import { FREE_CHAT_ROOT } from './styles.ts'
import { failureText, uiText, type CopyLocale, type OperationFailure } from './ui-copy.ts'

/** Edit one human prompt in its own Session; the host switches branches when the edit is sent. */
export function EditActions(props: {
  promptSeq?: number; sessionId?: string; messageId?: string; locale: CopyLocale
  host: EditHost; nativeRetry: RetryModel
  useSessionAccess?: (sessionId: string, action: string) => boolean
  ids?: () => string
  render?: (actions: ReactNode, editor: ReactNode) => React.ReactElement
}): React.ReactElement | null {
  const sessionId = props.sessionId ?? ''
  const native = useSyncExternalStore(props.nativeRetry.subscribe, props.nativeRetry.getSnapshot, props.nativeRetry.getSnapshot)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [mediaChanged, setMediaChanged] = useState(false)
  const [locked, setLocked] = useState(false)
  const [failure, setFailure] = useState<OperationFailure>()
  const preview = useRef<EditPrepareValue>()
  const submission = useRef<EditSubmission>()
  const signal = useRef(new AbortController())
  useEffect(() => {
    const controller = new AbortController()
    signal.current = controller
    return () => { controller.abort() }
  }, [sessionId, props.promptSeq])
  const allowed = props.useSessionAccess?.(sessionId, 'session/prompt') ?? true
  const copy = (key: Parameters<typeof uiText>[1]) => uiText(props.locale, key)
  const mine = native.sessionId === sessionId && native.messageId === props.messageId
  useEffect(() => {
    if (editing && !busy && native.controlsRetry && !mine) setEditing(false)
  }, [editing, busy, native.controlsRetry, mine])
  // Host capability is global and false while loading; it must not hide a new session's edit entry.
  if (!allowed || !sessionId || props.promptSeq === undefined || !props.host.prepare) return props.render?.(null, null) ?? null

  const run = async (action: 'edit' | 'send') => {
    if (busy || signal.current.signal.aborted) return
    setBusy(true)
    setFailure(undefined)
    try {
      if (!native.controlsRetry || !props.messageId) throw new HostOperationError('session/lifecycle-unavailable')
      if (action === 'edit') {
        const value = await previewEdit(props.host, sessionId, props.promptSeq!, signal.current.signal)
        await props.nativeRetry.beginEdit(sessionId, props.messageId, value.text, signal.current.signal)
        const state = props.nativeRetry.getSnapshot()
        if (!state.editing) { setFailure(state.failure); return }
        preview.current = value
        submission.current = { requestId: (props.ids ?? (() => crypto.randomUUID()))() }
        setDraft(value.text)
        setAttachments((value.content ?? []).filter((part): part is Exclude<NonNullable<EditPrepareValue['content']>[number], { type: 'text' }> => part.type !== 'text'))
        setMediaChanged(false)
        setLocked(false)
        setEditing(true)
        return
      }
      if (!preview.current || !submission.current) return
      if (mediaChanged && native.controlsContent !== true) throw new HostOperationError('session/retry-media-unavailable')
      setLocked(true)
      const content = mediaChanged ? await prepareEditContent(props.host, preview.current, draft, submission.current, signal.current.signal, attachments) : undefined
      props.nativeRetry.setDraft(draft)
      await props.nativeRetry.sendEdit(sessionId, props.messageId, signal.current.signal, content, true)
      const state = props.nativeRetry.getSnapshot()
      setFailure(state.failure)
      if (!state.editing) setEditing(false)
      else if (isStaleRetryFailure(state.failure)) setLocked(false)
    } catch (error) {
      if (!signal.current.signal.aborted) setFailure(readFailure(error))
    } finally {
      if (!signal.current.signal.aborted) setBusy(false)
    }
  }
  const cancel = () => {
    if (busy) return
    props.nativeRetry.cancelEdit()
    setEditing(false)
    setFailure(undefined)
  }
  const invalidatePrepared = () => {
    if (submission.current) submission.current = { requestId: submission.current.requestId }
  }
  const actions = <span className={`${FREE_CHAT_ROOT} dsh-free-actions`}>
    <Tooltip label={copy('edit')} side="bottom">
      <Button className="dsm-icon-action" size="sm" variant="ghost" aria-label={copy('edit')}
        disabled={busy || native.busy || (native.editing && !mine)} onClick={() => { void run('edit') }}><EditMessageIcon /></Button>
    </Tooltip>
    {failure && !editing ? <span className="dsh-ui-error dsh-free-alert" role="alert">{failureText(props.locale, failure)}</span> : null}
  </span>
  const editor = editing ? <MessageEditor text={draft} setText={text => { invalidatePrepared(); setDraft(text) }} attachments={attachments}
    setAttachments={native.controlsContent ? items => { invalidatePrepared(); setAttachments(items); setMediaChanged(true) } : undefined} sessionId={sessionId} host={props.host}
    locale={props.locale} busy={busy} locked={locked} onCancel={cancel} onSend={() => { setConfirming(true) }}
    error={failure ? failureText(props.locale, failure) : undefined} /> : null
  const content = props.render ? props.render(actions, editor) : <>{actions}{editor}</>
  return <>{content}<Modal open={confirming && editing} className={FREE_CHAT_ROOT} title={copy('editTitle')}
    closeLabel={copy('close')} onClose={() => { setConfirming(false) }} footer={<>
      <Button variant="ghost" data-modal-autofocus onClick={() => { setConfirming(false) }}>{copy('cancel')}</Button>
      <Button variant="primary" onClick={() => { setConfirming(false); void run('send') }}>{copy('editConfirm')}</Button>
    </>}><p>{copy('editBranchWarning')}</p></Modal></>
}
