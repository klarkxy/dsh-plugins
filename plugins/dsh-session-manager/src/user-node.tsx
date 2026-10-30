import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconCheckOutlineRegular,
  IconCopyOutlineRegular,
  fileExtension,
  FileTypeIcon,
  fileSizeText,
  JsonBlock,
  Tooltip,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { EditActions } from './edit-actions.tsx'
import type { EditHost } from './edit-host.ts'
import type { RetryModel } from './session-actions.ts'
import { UserMessageActions } from './user-actions.tsx'
import { FREE_CHAT_ROOT } from './styles.ts'
import type { CopyLocale } from './ui-copy.ts'

interface ContentBlock {
  type?: string
  text?: string
  attachment?: unknown
}

interface PresentedImage {
  readonly type: 'image'
  readonly image: { readonly attachment: unknown }
}

interface PresentedFile {
  readonly type: 'file'
  readonly file: {
    readonly attachmentId: string
    readonly name: string
    readonly bytes: number
  }
}

interface UserNodeData {
  readonly seq: number
  readonly time: number
  readonly content: readonly ContentBlock[]
  readonly referenceLabels?: readonly string[]
  readonly skillNames?: readonly string[]
}

interface UserNode {
  readonly id: string
  readonly data: UserNodeData
}

interface UserContentInput {
  readonly content: {
    readonly text: string
    readonly attachments: readonly (PresentedImage | PresentedFile)[]
    readonly extraBlocks: readonly ContentBlock[]
    readonly referenceLabels?: readonly string[]
  }
  readonly loadImage?: unknown
  readonly facts: { readonly sessionLabels?: readonly string[]; readonly skillNames?: readonly string[] }
  readonly interactive: boolean
}

interface UserNodeProps {
  readonly node: UserNode
  readonly sessionId?: string
  readonly locale: CopyLocale
  readonly host: EditHost
  readonly nativeRetry: RetryModel
  readonly useSessionAccess?: (sessionId: string, action: string) => boolean
  /** Current hosts own the complete content stack, including images and reference chips. */
  readonly renderFactorySlot?: (name: 'conversation.chat.user.content', input: UserContentInput) => ReactNode
  readonly loadImage?: unknown
  /** Older hosts expose only the image renderer. */
  readonly renderMessageImages?: (input: {
    readonly images: readonly { readonly attachment: unknown }[]
    readonly align: 'end'
    readonly compact: boolean
  }) => ReactNode
  readonly t: (key: string, params?: Record<string, unknown>) => string
  readonly ids?: () => string
}

function contentParts(content: readonly ContentBlock[]): {
  text: string
  attachments: (PresentedImage | PresentedFile)[]
  rest: ContentBlock[]
} {
  const texts: string[] = []
  const attachments: (PresentedImage | PresentedFile)[] = []
  const rest: ContentBlock[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
    else if (block.type === 'image' && block.attachment !== undefined) {
      attachments.push({ type: 'image', image: { attachment: block.attachment } })
    } else if (block.type === 'file' && block.attachment !== undefined) {
      attachments.push({ type: 'file', file: block.attachment as PresentedFile['file'] })
    } else rest.push(block)
  }
  return { text: texts.join(''), attachments, rest }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function messageClock(time: number, t: UserNodeProps['t']): string {
  const date = new Date(time)
  const now = new Date()
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) return clock
  const params = { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() }
  const day = date.getFullYear() === now.getFullYear() ? t('clock.md', params) : t('clock.ymd', params)
  return `${day} ${clock}`
}

function MessageChrome(props: {
  text: string
  time: number
  t: UserNodeProps['t']
  children?: ReactNode
}): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef(false)
  useEffect(() => () => {
    pending.current = false
    if (timer.current !== undefined) clearTimeout(timer.current)
  }, [])
  const copy = () => {
    if (copied || pending.current) return
    pending.current = true
    void writeClipboard(props.text).then(ok => {
      pending.current = false
      if (!ok) return
      setCopied(true)
      timer.current = setTimeout(() => { setCopied(false) }, 1000)
    })
  }
  return (
    <div className="dsm-user-chrome">
      <span className="dsm-user-time">{messageClock(props.time, props.t)}</span>
      {props.children}
      <Tooltip label={copied ? props.t('copied') : props.t('copy')} side="bottom">
        <Button size="sm" variant="ghost" className="dsm-icon-action" aria-label={copied ? props.t('copied') : props.t('copy')} onClick={copy}>
          {copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
        </Button>
      </Tooltip>
    </div>
  )
}

/** User-message bubble whose own action row edits the exact prompt in place. */
export function UserNodeWithEdit(props: UserNodeProps): React.ReactElement {
  const { text, attachments, rest } = contentParts(props.node.data.content)
  const compactImages = attachments.length > 1
  const truncated = (total: number) => props.t('json.truncated', { total })
  const data = props.node.data
  return (
    <EditActions promptSeq={data.seq} sessionId={props.sessionId} locale={props.locale} host={props.host}
      nativeRetry={props.nativeRetry} useSessionAccess={props.useSessionAccess} ids={props.ids} messageId={props.node.id}
      render={(actions, editor) => <div className={`${FREE_CHAT_ROOT} dsm-user-row`}>
      {editor}
      <div className="dsm-user-original" hidden={Boolean(editor)}>{!props.renderMessageImages && props.renderFactorySlot ? props.renderFactorySlot('conversation.chat.user.content', {
        content: {
          text, attachments, extraBlocks: rest,
          ...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels },
        },
        loadImage: props.loadImage,
        facts: {
          ...data.referenceLabels === undefined ? {} : { sessionLabels: data.referenceLabels },
          ...data.skillNames === undefined ? {} : { skillNames: data.skillNames },
        },
        interactive: true,
      }) : <div className="dsm-user-stack">
        {attachments.length > 0 ? (
          <div className="dsm-user-attachments" data-message-attachments>
            {attachments.map((attachment, index) => attachment.type === 'image' ? (
              <Fragment key={`image:${index}`}>
                {props.renderMessageImages?.({ images: [attachment.image], align: 'end', compact: compactImages })}
              </Fragment>
            ) : (
              <span key={`file:${index}`} className="dsm-file-card" title={attachment.file.name}>
                <FileTypeIcon path={attachment.file.name} className="dsm-file-icon" />
                <span className="dsm-file-content">
                  <span className="dsm-file-name">{attachment.file.name}</span>
                  <span className="dsm-file-meta">
                    {[fileExtension(attachment.file.name).toUpperCase().slice(0, 8), fileSizeText(attachment.file.bytes)].filter(Boolean).join(' ')}
                  </span>
                </span>
              </span>
            ))}
          </div>
        ) : null}
        {text !== '' || rest.length > 0 ? (
          <div className="dsm-user-bubble">
            {text}
            {rest.map((block, index) => <JsonBlock key={index} label={props.t('message.extraBlock')} payload={block} truncatedLabel={truncated} />)}
          </div>
        ) : null}
        {data.referenceLabels !== undefined && data.referenceLabels.length > 0 ? (
          <div className="dsm-reference-summary">
            {props.t('message.referenceSummary', { labels: data.referenceLabels.join(props.t('message.referenceSeparator')) })}
          </div>
        ) : null}
      </div>}
      <MessageChrome text={text} time={data.time} t={props.t}>
        <UserMessageActions
          messageId={props.node.id}
          text={text}
          sessionId={props.sessionId ?? ''}
          locale={props.locale}
          model={props.nativeRetry}
          hideEdit={Boolean(actions)}
        />
        {actions}
      </MessageChrome></div>
    </div>} />
  )
}
