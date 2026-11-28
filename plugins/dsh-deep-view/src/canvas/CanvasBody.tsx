// Deep View canvas body: an opaque runnable HTML iframe (same sandbox posture
// as the host's builtin HTML preview) plus an error bar that reports runtime
// failures back to the conversation. The packing pipeline is adapted from
// @deepseek-ai/dsh-client-ui-sidebar-documentpreview 0.2.2-rc.5 (MIT License).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { sessionFileOf } from '../file-address.ts'
import { fillComposerDraft, type ComposerActions, type InputSnapshot } from '../draft.ts'
import { createHtmlDocument } from './bootstrap.ts'
import { packCanvasHtml } from './pack.ts'
import { createReadCanvasRelative, type ReadCanvasRelated } from './read-relative.ts'
import { canvasErrorReportOf, createCaptureScript, formatCanvasError, recordCanvasError, type CanvasError } from './capture.ts'

export type CanvasContent = {
  readonly kind: string
  readonly data?: Uint8Array<ArrayBuffer>
}

/** Owner share of the keyed `sidebar.right.tab.document` slot plus injected canvas props. */
export type CanvasBodyProps = {
  readonly resourceAddress: string
  readonly content: CanvasContent
  readonly addResource: (address: string) => void
  readonly setResources: (addresses: readonly string[]) => void
  readonly readRelated: ReadCanvasRelated
  readonly useTabInfo?: () => { tab: { id: string; signal: AbortSignal } }
  readonly sessionId: string
  readonly t: (key: string, params?: Record<string, unknown>) => string
  readonly inputActions?: ComposerActions
  readonly useInput?: <T>(selector: (snapshot: InputSnapshot) => T, equal?: (left: T, right: T) => boolean) => T
}

type CanvasFrame = {
  readonly data: Uint8Array<ArrayBuffer>
  readonly url: string | undefined
  readonly nonce: string
}

function makeNonce(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const NEVER = new AbortController().signal

/** The file's workspace path for messages; falls back to the raw address. */
function displayPath(resourceAddress: string): string {
  return sessionFileOf(resourceAddress)?.path ?? resourceAddress
}

export function CanvasBody(props: CanvasBodyProps): ReactNode {
  const { resourceAddress, readRelated, addResource, setResources, t } = props
  const data = props.content.kind === 'bytes' && props.content.data !== undefined ? props.content.data : undefined
  const signal = props.useTabInfo?.().tab.signal ?? NEVER
  const [frame, setFrame] = useState<CanvasFrame>()
  const [errors, setErrors] = useState<readonly CanvasError[]>([])
  const [copied, setCopied] = useState(false)
  const [draftChoice, setDraftChoice] = useState(false)
  const [filled, setFilled] = useState<boolean | undefined>()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const input = props.useInput?.(value => value) ?? { draft: '', phase: 'plain' as const }

  // Build the bootstrap document and its Blob URL; each content revision
  // owns one opaque browsing context and one nonce.
  useEffect(() => {
    if (data === undefined) return
    setErrors([])
    setCopied(false)
    setFilled(undefined)
    setDraftChoice(false)
    const controller = new AbortController()
    const resources = new Set<string>()
    const readRelative = createReadCanvasRelative(readRelated, resourceAddress, signal, (address) => {
      resources.add(address)
      addResource(address)
    })
    const nonce = makeNonce()
    let url: string | undefined
    void (async () => {
      try {
        const bundle = await packCanvasHtml(data, readRelative, controller.signal)
        controller.signal.throwIfAborted()
        const html = createHtmlDocument(bundle, createCaptureScript(nonce))
        url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        setFrame({ data, url, nonce })
      } catch {
        if (!controller.signal.aborted) setFrame({ data, url: undefined, nonce })
      } finally {
        if (!controller.signal.aborted && !signal.aborted) setResources([...resources])
      }
    })()
    return () => {
      controller.abort()
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [data, resourceAddress, readRelated, addResource, setResources, signal])

  const live = frame !== undefined && frame.data === data
  useEffect(() => {
    if (!live) return
    const nonce = frame.nonce
    const listener = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const report = canvasErrorReportOf(event.data, nonce)
      if (report !== undefined) setErrors(list => recordCanvasError(list, report))
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [live, frame])

  const path = displayPath(resourceAddress)
  const reportText = errors.map((error, index) =>
    `${index + 1}. ${formatCanvasError(error)}${error.count > 1 ? ` (x${error.count})` : ''}`).join('\n')
  const fillText = () => t('canvasReport', { path, list: reportText })
  const fill = useCallback((replace: boolean) => {
    const accepted = fillComposerDraft(input, props.inputActions, fillText(), replace)
    setFilled(accepted)
    setDraftChoice(false)
  }, [input, props.inputActions, reportText, path, t])
  const copy = useCallback(() => {
    try {
      void navigator.clipboard.writeText(fillText()).then(() => setCopied(true), () => setCopied(false))
    } catch { setCopied(false) }
  }, [reportText, path, t])

  if (data === undefined) return null
  return <div className="dvui-root dvui-canvas">
    {!live ? <p className="dvui-canvas-status" role="status">{t('canvasLoading')}</p>
      : frame.url === undefined ? <p className="dvui-canvas-status" role="alert">{t('canvasFailed')}</p>
      : <iframe key={frame.url} ref={iframeRef} className="dvui-canvas-frame" src={frame.url} sandbox="allow-scripts" title={t('canvasFrame')} data-deep-view-canvas />}
    {errors.length > 0 ? <div className="dvui-canvas-errors" role="group" aria-label={t('canvasErrors')}>
      <ul className="dvui-canvas-errors-list">
        {errors.map((error, index) => <li key={index}>
          {formatCanvasError(error)}{error.count > 1 ? ` ×${error.count}` : ''}
        </li>)}
      </ul>
      <div className="dvui-canvas-actions dvui-actions">
        {props.inputActions ? <Button variant="primary" onClick={() => input.draft.trim() === '' ? fill(false) : setDraftChoice(true)}>{t('fillDraft')}</Button> : null}
        <Button onClick={copy}>{copied ? t('copied') : t('copy')}</Button>
      </div>
      {filled === true ? <p className="dvui-status" role="status">{t('filled')}</p> : null}
      {filled === false ? <p className="dvui-tool-error" role="alert">{t('fillFailed')}</p> : null}
      {draftChoice ? <div className="dvui-draft-choice" role="group" aria-label={t('draftConflict')}>
        <p>{t('draftConflict')}</p><div className="dvui-actions">
          <Button variant="primary" onClick={() => fill(true)}>{t('replaceDraft')}</Button>
          <Button onClick={() => fill(false)}>{t('appendDraft')}</Button>
          <Button onClick={() => setDraftChoice(false)}>{t('cancel')}</Button>
        </div>
      </div> : null}
    </div> : null}
  </div>
}
