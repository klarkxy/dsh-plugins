import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { MessageEditor } from './message-editor.tsx'
import { EditMessageIcon } from './edit-icon.tsx'
import type { RetryModel } from './session-actions.ts'
import { FREE_CHAT_ROOT } from './styles.ts'
import { failureText, uiText, type CopyLocale } from './ui-copy.ts'

export function UserMessageActions(props: {
  messageId: string
  text: string
  sessionId: string
  locale: CopyLocale
  model: RetryModel
  hideEdit?: boolean
}): React.ReactElement | null {
  const [confirming, setConfirming] = useState(false)
  const snapshot = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot, props.model.getSnapshot)
  const signal = useRef<AbortController>(new AbortController())
  useEffect(() => {
    const controller = new AbortController()
    signal.current = controller
    return () => {
      controller.abort()
      props.model.retire(props.sessionId, props.messageId)
    }
  }, [props.model, props.sessionId, props.messageId])
  if (props.sessionId === '' || !snapshot.controlsRetry) return null
  const mine = snapshot.sessionId === props.sessionId && snapshot.messageId === props.messageId
  const copy = (key: Parameters<typeof uiText>[1]) => uiText(props.locale, key)
  const failure = mine ? snapshot.failure : undefined
  const editing = mine && snapshot.editing
  const draft = mine ? snapshot.draft : props.text
  return (
    <span className={`${FREE_CHAT_ROOT} dsh-free-actions`}>
      {!props.hideEdit ? <Tooltip label={copy('edit')} side="bottom">
        <Button
          size="sm"
          className="dsm-icon-action"
          variant="ghost"
          aria-label={copy('edit')}
          disabled={snapshot.busy || (snapshot.editing && !mine)}
          onClick={() => { void props.model.beginEdit(props.sessionId, props.messageId, props.text, signal.current.signal) }}
        >
          <EditMessageIcon />
        </Button>
      </Tooltip> : null}
      {failure && !editing ? <span className="dsh-ui-error dsh-free-alert" role="alert">{failureText(props.locale, failure)}</span> : null}
      {editing && !props.hideEdit ? <MessageEditor text={draft} setText={value => { props.model.setDraft(value) }}
        sessionId={props.sessionId} locale={props.locale} busy={snapshot.busy}
        error={failure ? failureText(props.locale, failure) : undefined}
        onCancel={() => { props.model.cancelEdit() }}
        onSend={() => { setConfirming(true) }} /> : null}
      <Modal open={confirming && editing} className={FREE_CHAT_ROOT} title={copy('editTitle')} closeLabel={copy('close')}
        onClose={() => { setConfirming(false) }} footer={<>
          <Button variant="ghost" data-modal-autofocus onClick={() => { setConfirming(false) }}>{copy('cancel')}</Button>
          <Button variant="primary" onClick={() => { setConfirming(false); void props.model.sendEdit(props.sessionId, props.messageId, signal.current.signal, undefined, true) }}>{copy('editConfirm')}</Button>
        </>}><p>{copy('editBranchWarning')}</p></Modal>
    </span>
  )
}
