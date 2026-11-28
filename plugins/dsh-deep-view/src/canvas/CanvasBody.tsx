// Deep View canvas body: an opaque runnable HTML iframe (`sandbox="allow-scripts"`,
// never `allow-same-origin`) supporting both full-height sidebar (`viewport`) and
// chat-stream inline auto-resizing (`content`) modes, bridged to host `--dsw-*`
// theme tokens. The packing pipeline is adapted from
// @deepseek-ai/dsh-client-ui-sidebar-documentpreview 0.2.2-rc.5 (MIT License);
// dual sizing (`data-card-sizing="content|viewport"`) is inspired by
// liliMozi/showcard (Agent Showcard 1.0 Specification §1.4, §1.7).
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { sessionFileOf } from '../file-address.ts'
import { fillComposerDraft, type ComposerActions, type InputSnapshot } from '../draft.ts'
import { createHtmlDocument } from './bootstrap.ts'
import { packCanvasHtml, type CanvasFileBytes } from './pack.ts'
import { createReadCanvasRelative, type ReadCanvasRelated, type RemoteResult } from './read-relative.ts'
import { serializeHostThemeDeclarations } from './theme-bridge.ts'
import {
  CANVAS_THEME_EVENT,
  canvasErrorReportOf,
  canvasReadyReportOf,
  canvasResizeReportOf,
  createCaptureScript,
  formatCanvasError,
  recordCanvasError,
  type CanvasError,
  type CanvasSizingMode,
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

/** Owner share of the keyed `sidebar.right.tab.document` slot plus injected canvas props. */
export type CanvasBodyProps = {
  readonly resourceAddress: string
  readonly content: CanvasContent
  readonly addResource: (address: string) => void
  readonly setResources: (addresses: readonly string[]) => void
  readonly readRelated: ReadCanvasRelated
  readonly sizing?: CanvasSizingMode
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

const DEFAULT_INLINE_HEIGHT = 220

function makeNonce(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const NEVER = new AbortController().signal
const NOOP_RESOURCE = () => {}

/** The file's workspace path for messages; falls back to the raw address. */
function displayPath(resourceAddress: string): string {
  return sessionFileOf(resourceAddress)?.path ?? resourceAddress
}

export function CanvasBody(props: CanvasBodyProps): ReactNode {
  const { resourceAddress, readRelated, addResource, setResources, reportFirstPaint, t } = props
  const sizing: CanvasSizingMode = props.sizing === 'content' ? 'content' : 'viewport'
  const data = props.content.kind === 'bytes' && props.content.data !== undefined ? props.content.data : undefined
  const signal = props.useTabInfo?.().tab.signal ?? NEVER
  const [frame, setFrame] = useState<CanvasFrame>()
  const [inlineHeight, setInlineHeight] = useState<number>(DEFAULT_INLINE_HEIGHT)
  const [errors, setErrors] = useState<readonly CanvasError[]>([])
  const errorsRef = useRef<readonly CanvasError[]>([])
  const [copied, setCopied] = useState(false)
  const [draftChoice, setDraftChoice] = useState(false)
  const [filled, setFilled] = useState<boolean | undefined>()
  const rootRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const input = props.useInput?.(value => value) ?? { draft: '', phase: 'plain' as const }

  // Build the bootstrap document and its Blob URL; each content revision
  // owns one opaque browsing context and one nonce.
  useEffect(() => {
    if (data === undefined) return
    errorsRef.current = []
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
        const themeDeclarations = typeof document === 'undefined'
          ? ''
          : serializeHostThemeDeclarations(document, rootRef.current)
        const html = createHtmlDocument(bundle, createCaptureScript(nonce, { sizing, themeDeclarations }))
        url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        setFrame({ data, url, nonce })
      } catch (packError) {
        if (!controller.signal.aborted) {
          setFrame({ data, url: undefined, nonce })
          reportFirstPaint?.(resourceAddress, {
            collapsed: true,
            height: 0,
            errors: [packError instanceof Error ? packError.message : String(packError)],
          })
        }
      } finally {
        if (!controller.signal.aborted && !signal.aborted) setResources([...resources])
      }
    })()
    return () => {
      controller.abort()
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [data, resourceAddress, readRelated, addResource, setResources, reportFirstPaint, sizing, signal])

  const live = frame !== undefined && frame.data === data
  useEffect(() => {
    if (!live) return
    const nonce = frame.nonce
    let readyReported = false
    const listener = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const report = canvasErrorReportOf(event.data, nonce)
      if (report !== undefined) {
        const next = recordCanvasError(errorsRef.current, report)
        errorsRef.current = next
        setErrors(next)
        return
      }
      const resized = canvasResizeReportOf(event.data, nonce)
      if (resized !== undefined) {
        setInlineHeight(resized.height)
        return
      }
      if (!readyReported) {
        const ready = canvasReadyReportOf(event.data, nonce)
        if (ready !== undefined) {
          readyReported = true
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
  }, [live, frame, resourceAddress, reportFirstPaint])

  // Refresh bridged `--dsw-*` tokens and `color-scheme` smoothly when the host toggles light/dark theme.
  useEffect(() => {
    if (!live || typeof document === 'undefined' || typeof MutationObserver !== 'function') return
    const nonce = frame.nonce
    const pushTheme = () => {
      const target = iframeRef.current?.contentWindow
      if (!target) return
      const declarations = serializeHostThemeDeclarations(document, rootRef.current)
      try {
        target.postMessage({ type: CANVAS_THEME_EVENT, nonce, declarations }, '*')
      } catch {
        // Ignore transient detached frame states.
      }
    }
    const observer = new MutationObserver(pushTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'],
    })
    return () => observer.disconnect()
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
  const frameStyle: CSSProperties | undefined = sizing === 'content' ? { height: `${inlineHeight}px` } : undefined
  return <div ref={rootRef} className={sizing === 'content' ? 'dvui-root dvui-canvas dvui-canvas-inline' : 'dvui-root dvui-canvas'}>
    {!live ? <p className="dvui-canvas-status" role="status">{t('canvasLoading')}</p>
      : frame.url === undefined ? <p className="dvui-canvas-status" role="alert">{t('canvasFailed')}</p>
      : <iframe key={frame.url} ref={iframeRef} className={sizing === 'content' ? 'dvui-canvas-frame dvui-canvas-frame-inline' : 'dvui-canvas-frame'} style={frameStyle} src={frame.url} sandbox="allow-scripts" title={t('canvasFrame')} data-deep-view-canvas data-card-sizing={sizing} />}
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

export type ReadWorkspaceCanvasBytes = (
  sessionId: string,
  path: string,
  options?: { baseFile?: string },
  signal?: AbortSignal,
) => Promise<RemoteResult<CanvasFileBytes>>

export type InlineCanvasCardProps = {
  readonly sessionId: string
  readonly address: string
  readonly path: string
  readonly revisionKey?: string | number
  readonly preferredWidth?: number
  readonly readBytes: ReadWorkspaceCanvasBytes
  readonly reportFirstPaint?: (address: string, report: CanvasFirstPaintReport) => void
  readonly t: (key: string, params?: Record<string, unknown>) => string
  readonly inputActions?: ComposerActions
  readonly useInput?: <T>(selector: (snapshot: InputSnapshot) => T, equal?: (left: T, right: T) => boolean) => T
}

/** Chat-stream inline sandboxed HTML/SVG card (`data-card-sizing="content"`). */
export function InlineCanvasPreview(props: InlineCanvasCardProps): ReactNode {
  const { sessionId, address, path, revisionKey, preferredWidth, readBytes, reportFirstPaint, t } = props
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Uint8Array<ArrayBuffer> }>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void readBytes(sessionId, path, undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (result.ok) setState({ status: 'ready', data: result.value.data })
      else setState({ status: 'error', message: result.error.message ?? t('canvasFailed') })
    }).catch(error => {
      if (controller.signal.aborted) return
      setState({ status: 'error', message: error instanceof Error ? error.message : t('canvasFailed') })
    })
    return () => controller.abort()
  }, [sessionId, path, revisionKey, readBytes, t])

  const readRelated = useCallback<ReadCanvasRelated>((targetAddress, relativePath, signal) => {
    const file = sessionFileOf(targetAddress)
    const baseFile = file?.path ?? path
    const targetSession = file?.sessionId ?? sessionId
    return readBytes(targetSession, relativePath, { baseFile }, signal)
  }, [sessionId, path, readBytes])

  const shellStyle: CSSProperties | undefined = preferredWidth !== undefined
    ? { maxWidth: `${preferredWidth}px` }
    : undefined

  return <div className="dvui-canvas-inline-shell" style={shellStyle} data-deep-view-inline-canvas>
    {state.status === 'loading' ? <p className="dvui-canvas-status" role="status">{t('canvasLoading')}</p>
      : state.status === 'error' ? <p className="dvui-tool-error" role="alert">{state.message}</p>
      : <CanvasBody
          resourceAddress={address}
          content={{ kind: 'bytes', data: state.data }}
          addResource={NOOP_RESOURCE}
          setResources={NOOP_RESOURCE}
          readRelated={readRelated}
          sizing="content"
          {...(reportFirstPaint !== undefined ? { reportFirstPaint } : {})}
          sessionId={sessionId}
          t={t}
          {...(props.inputActions !== undefined ? { inputActions: props.inputActions } : {})}
          {...(props.useInput !== undefined ? { useInput: props.useInput } : {})}
        />}
  </div>
}
