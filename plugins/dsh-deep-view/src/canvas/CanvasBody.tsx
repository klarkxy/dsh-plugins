// Deep View canvas body: an opaque runnable HTML iframe (same sandbox posture
// as the host's builtin HTML preview) plus an error bar that reports runtime
// failures back to the conversation and a one-shot first-paint health callback.
// The packing pipeline is adapted from
// @deepseek-ai/dsh-client-ui-sidebar-documentpreview 0.2.2-rc.5 (MIT License).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { sessionFileOf } from '../file-address.ts'
import { fillComposerDraft, type ComposerActions, type InputSnapshot } from '../draft.ts'
import { createHtmlDocument } from './bootstrap.ts'
import { packCanvasHtml } from './pack.ts'
import { createReadCanvasRelative, type ReadCanvasRelated } from './read-relative.ts'
import {
  canvasErrorReportOf,
  canvasReadyReportOf,
  createCaptureScript,
  formatCanvasError,
  recordCanvasError,
  type CanvasError,
} from './capture.ts'

export type CanvasContent = {
  readonly kind: string
  readonly data?: Uint8Array<ArrayBuffer>
}

export type CanvasFirstPaintReport = {
  readonly collapsed: boolean
  readonly height: number
  readonly errors: readonly string[]
}

/** Active mounted canvas settlements keyed by resourceAddress so repeat `show_canvas` probes on an already-open tab settle immediately. */
const mountedSettlements = new Map<string, () => CanvasFirstPaintReport | undefined>()

export function readMountedCanvasSettlement(address: string): CanvasFirstPaintReport | undefined {
  return mountedSettlements.get(address)?.()
}

/** Owner share of the keyed `sidebar.right.tab.document` slot plus injected canvas props. */
export type CanvasBodyProps = {
  readonly resourceAddress: string
  readonly content: CanvasContent
  readonly addResource: (address: string) => void
  readonly setResources: (addresses: readonly string[]) => void
  readonly readRelated: ReadCanvasRelated
  readonly reportFirstPaint?: (address: string, report: CanvasFirstPaintReport) => void
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
  const { resourceAddress, readRelated, addResource, setResources, reportFirstPaint, t } = props
  const data = props.content.kind === 'bytes' && props.content.data !== undefined ? props.content.data : undefined
  const signal = props.useTabInfo?.().tab.signal ?? NEVER
  const [frame, setFrame] = useState<CanvasFrame>()
  const [errors, setErrors] = useState<readonly CanvasError[]>([])
  const errorsRef = useRef<readonly CanvasError[]>([])
  const settledRef = useRef<{ data: Uint8Array<ArrayBuffer>; collapsed: boolean; height: number } | undefined>()
  const [copied, setCopied] = useState(false)
  const [draftChoice, setDraftChoice] = useState(false)
  const [filled, setFilled] = useState<boolean | undefined>()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const input = props.useInput?.(value => value) ?? { draft: '', phase: 'plain' as const }

  useEffect(() => {
    const getter = (): CanvasFirstPaintReport | undefined => {
      const snap = settledRef.current
      if (!snap || snap.data !== data) return undefined
      return {
        collapsed: snap.collapsed,
        height: snap.height,
        errors: errorsRef.current.map(formatCanvasError),
      }
    }
    mountedSettlements.set(resourceAddress, getter)
    return () => {
      if (mountedSettlements.get(resourceAddress) === getter) {
        mountedSettlements.delete(resourceAddress)
      }
    }
  }, [resourceAddress, data])

  // Build the bootstrap document and its Blob URL; each content revision
  // owns one opaque browsing context and one nonce.
  useEffect(() => {
    if (data === undefined) return
    errorsRef.current = []
    settledRef.current = undefined
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
        const html = createHtmlDocument(bundle, createCaptureScript(nonce), { rootPath: displayPath(resourceAddress) })
        url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        setFrame({ data, url, nonce })
      } catch (packError) {
        if (!controller.signal.aborted) {
          setFrame({ data, url: undefined, nonce })
          const reason = packError instanceof Error ? packError.message : 'Canvas packing failed'
          settledRef.current = { data, collapsed: false, height: 0 }
          errorsRef.current = [{ message: reason, count: 1 }]
          reportFirstPaint?.(resourceAddress, { collapsed: false, height: 0, errors: [reason] })
        }
      } finally {
        if (!controller.signal.aborted && !signal.aborted) setResources([...resources])
      }
    })()
    return () => {
      controller.abort()
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [data, resourceAddress, readRelated, addResource, setResources, reportFirstPaint, signal])

  const live = frame !== undefined && frame.data === data
  useEffect(() => {
    if (!live || data === undefined) return
    const nonce = frame.nonce
    let readyReported = false
    const listener = (event: MessageEvent) => {
      const sourceWindow = iframeRef.current?.contentWindow
      if (!sourceWindow || event.source !== sourceWindow) return
      const report = canvasErrorReportOf(event.data, nonce)
      if (report !== undefined) {
        const next = recordCanvasError(errorsRef.current, report)
        errorsRef.current = next
        setErrors(next)
        return
      }
      if (!readyReported) {
        const ready = canvasReadyReportOf(event.data, nonce)
        if (ready !== undefined) {
          readyReported = true
          settledRef.current = { data, collapsed: ready.collapsed, height: ready.height }
          reportFirstPaint?.(resourceAddress, {
            collapsed: ready.collapsed,
            height: ready.height,
            errors: errorsRef.current.map(formatCanvasError),
          })
        }
      }
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [live, frame, data, resourceAddress, reportFirstPaint])

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
