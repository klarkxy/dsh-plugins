import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Button, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RetryModel } from './session-actions.ts'
import { FREE_CHAT_ROOT } from './styles.ts'
import { failureText, uiText, type CopyLocale } from './ui-copy.ts'

export function UserMessageActions(props: {
  messageId: string
  text: string
  sessionId: string
  locale: CopyLocale
  model: RetryModel
}): React.ReactElement | null {
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
      <Tooltip label={copy('retry')} side="bottom">
        <Button
          size="sm"
          variant="ghost"
          aria-label={copy('retry')}
          disabled={snapshot.busy}
          onClick={() => { void props.model.retry(props.sessionId, props.messageId, signal.current.signal) }}
        >
          {copy('retry')}
        </Button>
      </Tooltip>
      <Tooltip label={copy('edit')} side="bottom">
        <Button
          size="sm"
          variant="ghost"
          aria-label={copy('edit')}
          disabled={snapshot.busy}
          onClick={() => { void props.model.beginEdit(props.sessionId, props.messageId, props.text, signal.current.signal) }}
        >
          {copy('edit')}
        </Button>
      </Tooltip>
      {failure ? <span className="dsh-ui-error dsh-free-alert" role="alert">{failureText(props.locale, failure)}</span> : null}
      <Modal
        open={editing}
        className={FREE_CHAT_ROOT}
        title={copy('editTitle')}
        closeLabel={copy('close')}
        onClose={() => { props.model.cancelEdit() }}
        footer={(
          <>
            <Button variant="ghost" disabled={snapshot.busy} onClick={() => { props.model.cancelEdit() }}>{copy('cancel')}</Button>
            <Button
              variant="primary"
              data-modal-autofocus
              disabled={snapshot.busy}
              onClick={() => { void props.model.sendEdit(props.sessionId, props.messageId, signal.current.signal) }}
            >
              {copy('send')}
            </Button>
          </>
        )}
      >
        <textarea
          className="dsh-free-draft"
          aria-label={copy('draft')}
          value={draft}
          onChange={event => { props.model.setDraft(event.target.value) }}
        />
      </Modal>
    </span>
  )
}
