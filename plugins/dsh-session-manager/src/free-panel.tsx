import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FreeChatModel } from './session-actions.ts'
import { FREE_CHAT_ROOT } from './styles.ts'
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

/** Create failures used to surface inside the standalone panel. The panel is gone,
 * so they get a small overlay instead; closing it dismisses the stored notice. */
export function CreateNoticeDialog(props: { model: FreeChatModel; locale: CopyLocale }): React.ReactElement | null {
  const snapshot = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot, props.model.getSnapshot)
  const notice = snapshot.notice
  if (notice === undefined) return null
  const copy = (key: Parameters<typeof uiText>[1]) => uiText(props.locale, key)
  return (
    <Modal
      open
      className={FREE_CHAT_ROOT}
      title={copy('createFailed')}
      closeLabel={copy('close')}
      onClose={() => { props.model.dismissNotice() }}
      footer={(
        <Button variant="primary" data-modal-autofocus onClick={() => { props.model.dismissNotice() }}>
          {copy('close')}
        </Button>
      )}
    >
      <p className="dsh-ui-error dsh-free-alert" role="alert">{failureText(props.locale, notice)}</p>
    </Modal>
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
          <Button variant="ghost" data-modal-autofocus disabled={request.busy} onClick={() => { props.model.cancelDelete() }}>{copy('cancel')}</Button>
          <Button
            ref={confirmRef}
            variant="primary"
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
