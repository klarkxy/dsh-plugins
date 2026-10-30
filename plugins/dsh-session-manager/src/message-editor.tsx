import { useEffect, useRef, useState } from 'react'
import { Button, FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import { unwrap } from './session-actions.ts'
import type { DraftAttachment, EditHost } from './edit-host.ts'
import { uiText, type CopyLocale } from './ui-copy.ts'

function AttachmentPreview(props: { item: DraftAttachment; sessionId: string; host: EditHost; locale: CopyLocale }): React.ReactElement {
  const [src, setSrc] = useState<string>()
  const [failed, setFailed] = useState(false)
  const item = props.item
  const name = item.type === 'upload' ? item.file.name : item.type === 'file' ? item.name : uiText(props.locale, 'editImage')
  useEffect(() => {
    let active = true
    let url: string | undefined
    setSrc(undefined)
    setFailed(false)
    if (item.type === 'upload' && item.file.type.startsWith('image/')) {
      url = URL.createObjectURL(item.file)
      setSrc(url)
    } else if (item.type === 'image' && props.host.attachment) {
      void unwrap(props.host.attachment({ sessionId: props.sessionId, attachmentId: item.attachmentId })).then(value => {
        const image = value as { data?: string; attachment?: { mediaType?: string } }
        if (active && image.data && image.attachment?.mediaType?.startsWith('image/')) setSrc(`data:${image.attachment.mediaType};base64,${image.data}`)
        else if (active) setFailed(true)
      }).catch(() => { if (active) setFailed(true) })
    }
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [item, props.host, props.sessionId])
  return <>
    {src ? <img src={src} alt={name} /> : <FileTypeIcon path={name} />}
    {item.type === 'file' || (item.type === 'upload' && !item.file.type.startsWith('image/')) ? <span title={name}>{name}</span> : null}
    {failed ? <span role="status">{uiText(props.locale, 'editPreviewFailed')}</span> : null}
  </>
}

/** Lives in the original bubble; drafts and attachments remain local until Send. */
export function MessageEditor(props: {
  text: string; setText: (text: string) => void; attachments?: readonly DraftAttachment[]
  setAttachments?: (attachments: DraftAttachment[]) => void
  sessionId: string; host?: EditHost; locale: CopyLocale; busy: boolean; locked?: boolean
  error?: string; onCancel: () => void; onSend: () => void
}): React.ReactElement {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const copy = (key: Parameters<typeof uiText>[1]) => uiText(props.locale, key)
  const attachments = props.attachments ?? []
  const disabled = props.busy || props.locked === true
  useEffect(() => {
    textarea.current?.focus()
    textarea.current?.setSelectionRange(props.text.length, props.text.length)
  }, [])
  useEffect(() => {
    const element = textarea.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.max(80, Math.min(element.scrollHeight, 360))}px`
  }, [props.text])
  const add = (files: File[]) => {
    if (!disabled && files.length > 0) props.setAttachments?.([...attachments, ...files.map(file => ({ type: 'upload' as const, file }))])
  }
  return <div className="dsm-message-edit" role="group" aria-label={copy('editTitle')}
    onDragOver={event => { if (!disabled && props.setAttachments && event.dataTransfer.types.includes('Files')) event.preventDefault() }}
    onDrop={event => { if (props.setAttachments && event.dataTransfer.files.length) { event.preventDefault(); add(Array.from(event.dataTransfer.files)) } }}>
    {attachments.length ? <div className="dsm-edit-attachments">{attachments.map((item, index) => (
      <div className={`dsm-edit-attachment ${item.type === 'image' || (item.type === 'upload' && item.file.type.startsWith('image/')) ? 'dsm-edit-image' : ''}`} key={item.type === 'upload' ? `${index}:${item.file.name}` : `${index}:${item.attachmentId}`}>
        <AttachmentPreview item={item} sessionId={props.sessionId} host={props.host ?? {}} locale={props.locale} />
        {props.setAttachments ? <Button size="sm" variant="ghost" disabled={disabled} aria-label={`${copy('editRemoveAttachment')} ${index + 1}`}
          onClick={() => { props.setAttachments?.(attachments.filter((_, position) => position !== index)) }}>×</Button> : null}
      </div>
    ))}</div> : null}
    <div className="dsm-message-editor">
    <textarea ref={textarea} className="dsh-ui-textarea dsh-free-draft" aria-label={copy('draft')}
      value={props.text} disabled={disabled} onChange={event => { props.setText(event.target.value) }}
      onPaste={event => {
        const files = Array.from(event.clipboardData.files)
        if (files.length && props.setAttachments) { event.preventDefault(); add(files) }
      }} onKeyDown={event => { if (event.key === 'Escape' && !props.busy) { event.stopPropagation(); props.onCancel() } }} />
    {props.error ? <p className="dsh-ui-error" role="alert">{props.error}</p> : null}
    <div className="dsm-edit-footer">
      <span className="dsm-edit-spacer" />
      <Button variant="ghost" disabled={props.busy} onClick={props.onCancel}>{copy('cancel')}</Button>
      <Button variant="primary" disabled={props.busy || (!props.text.trim() && !attachments.length)} onClick={props.onSend}>{copy('send')}</Button>
    </div>
    </div>
  </div>
}
