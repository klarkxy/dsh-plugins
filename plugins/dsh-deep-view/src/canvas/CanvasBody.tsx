// Deep View canvas body: an opaque runnable HTML iframe (`sandbox="allow-scripts"`,
// never `allow-same-origin`) supporting both full-height sidebar (`viewport`) and
// chat-stream inline auto-resizing (`content`) modes, bridged to host `--dsw-*`
// theme tokens. The packing pipeline is adapted from
// @deepseek-ai/dsh-client-ui-sidebar-documentpreview 0.2.2-rc.5 (MIT License);
// dual sizing (`data-card-sizing="content|viewport"`) is inspired by
// liliMozi/showcard (Agent Showcard 1.0 Specification §1.4, §1.7).
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { sessionFileAddress, sessionFileOf } from '../file-address.ts'
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

const mountedSettlements = new Map<string, (expectedByteLength?: number) => CanvasFirstPaintReport | undefined>()
const inlineRefreshListeners = new Map<string, Set<() => void>>()

export function readMountedCanvasSettlement(address: string, expectedByteLength?: number): CanvasFirstPaintReport | undefined {
  return mountedSettlements.get(address)?.(expectedByteLength)
}

/** Notify any mounted inline cards watching `address` (root HTML or packed dependency) to revalidate bytes. */
export function notifyInlineCanvasResource(address: string): void {
  const set = inlineRefreshListeners.get(address)
  if (!set) return
  for (const fn of [...set]) fn()
}

/** Notify all mounted inline cards belonging to `sessionId` (e.g. when a turn or file-editing tool call settles). */
export function notifySessionInlineCanvases(sessionId: string): void {
  const notified = new Set<() => void>()
  for (const [address, set] of inlineRefreshListeners) {
    if (sessionFileOf(address)?.sessionId !== sessionId) continue
    for (const fn of set) notified.add(fn)
  }
  for (const fn of notified) fn()
}

/** Owner share of the keyed `sidebar.right.tab.document` slot plus injected canvas props. */
export type CanvasBodyProps = {
  readonly resourceAddress: string
  readonly content: CanvasContent
  readonly addResource: (address: string) => void
  readonly setResources: (addresses: readonly string[]) => void
  readonly readRelated: ReadCanvasRelated
  readonly sizing?: CanvasSizingMode
  readonly reloadNonce?: number
  readonly reportFirstPaint?: (address: string, report: CanvasFirstPaintReport) => void
  readonly useTabInfo?: () => { tab: { id: string; signal: AbortSignal } }
  readonly sessionId: string
  readonly t: (key: string, params?: Record<string, unknown>) => string
  readonly inputActions?: ComposerActions
  readonly useInput?: <T>(selector: (snapshot: InputSnapshot) => T, equal?: (left: T, right: T) => boolean) => T
}

type CanvasFrame = {
  readonly data: Uint8Array<ArrayBuffer>
  readonly reloadNonce: number
  readonly url: string | undefined
  readonly nonce: string
}

const DEFAULT_INLINE_HEIGHT = 220

function makeNonce(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left === right) return true
  if (left.byteLength !== right.byteLength) return false
  for (let idx = 0; idx < left.byteLength; idx += 1) {
    if (left[idx] !== right[idx]) return false
  }
  return true
}

const NEVER = new AbortController().signal

/** The file's workspace path for messages; falls back to the raw address. */
function displayPath(resourceAddress: string): string {
  return sessionFileOf(resourceAddress)?.path ?? resourceAddress
}

export function CanvasBody(props: CanvasBodyProps): ReactNode {
  const { resourceAddress, readRelated, addResource, setResources, reportFirstPaint, t } = props
  const sizing: CanvasSizingMode = props.sizing === 'content' ? 'content' : 'viewport'
  const reloadNonce = props.reloadNonce ?? 0
  const data = props.content.kind === 'bytes' && props.content.data !== undefined ? props.content.data : undefined
  const signal = props.useTabInfo?.().tab.signal ?? NEVER
  const [frame, setFrame] = useState<CanvasFrame>()
  const [inlineHeight, setInlineHeight] = useState<number>(DEFAULT_INLINE_HEIGHT)
  const [inlineOverflow, setInlineOverflow] = useState(false)
  const [errors, setErrors] = useState<readonly CanvasError[]>([])
  const errorsRef = useRef<readonly CanvasError[]>([])
  const settledRef = useRef<{ data: Uint8Array<ArrayBuffer>; collapsed: boolean; height: number } | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const [draftChoice, setDraftChoice] = useState(false)
  const [filled, setFilled] = useState<boolean | undefined>()
  const rootRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const input = props.useInput?.(value => value) ?? { draft: '', phase: 'plain' as const }

  const pushThemeToFrame = useCallback((nonce: string) => {
    if (typeof document === 'undefined') return
    const target = iframeRef.current?.contentWindow
    if (!target) return
    const declarations = serializeHostThemeDeclarations(document, rootRef.current)
    try {
      target.postMessage({ type: CANVAS_THEME_EVENT, nonce, declarations }, '*')
    } catch {
      // Ignore transient detached frame states.
    }
  }, [])

  useEffect(() => {
    const getter = (expectedByteLength?: number): CanvasFirstPaintReport | undefined => {
      const snap = settledRef.current
      if (!snap || snap.data !== data) return undefined
      if (expectedByteLength !== undefined && snap.data.byteLength !== expectedByteLength) return undefined
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
    setInlineOverflow(false)
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
        const html = createHtmlDocument(
          bundle,
          createCaptureScript(nonce, { sizing, themeDeclarations }),
          {
            rootPath: displayPath(resourceAddress),
            ensureDoctype: sizing === 'content',
            inlineCsp: sizing === 'content',
          },
        )
        url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        setFrame({ data, reloadNonce, url, nonce })
      } catch (packError) {
        if (!controller.signal.aborted) {
          setFrame({ data, reloadNonce, url: undefined, nonce })
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
  }, [data, reloadNonce, resourceAddress, readRelated, addResource, setResources, reportFirstPaint, sizing, signal])

  const live = frame !== undefined && frame.data === data && frame.reloadNonce === reloadNonce
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
      if (sizing === 'content') {
        const resized = canvasResizeReportOf(event.data, nonce)
        if (resized !== undefined) {
          setInlineHeight(resized.height)
          setInlineOverflow(resized.overflow === true)
          return
        }
      }
      if (!readyReported) {
        const ready = canvasReadyReportOf(event.data, nonce)
        if (ready !== undefined) {
          readyReported = true
          settledRef.current = { data, collapsed: ready.collapsed, height: ready.height }
          pushThemeToFrame(nonce)
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
  }, [live, frame, data, sizing, resourceAddress, reportFirstPaint, pushThemeToFrame])

  // Refresh bridged `--dsw-*` tokens and `color-scheme` smoothly when the host or OS toggles light/dark theme.
  useEffect(() => {
    if (!live || typeof document === 'undefined') return
    const nonce = frame.nonce
    const pushTheme = () => pushThemeToFrame(nonce)
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(pushTheme) : undefined
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'],
    })
    const mql = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : undefined
    mql?.addEventListener?.('change', pushTheme)
    return () => {
      observer?.disconnect()
      mql?.removeEventListener?.('change', pushTheme)
    }
  }, [live, frame, pushThemeToFrame])

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
  const frameStyle: CSSProperties | undefined = sizing === 'content'
    ? { height: `${inlineHeight}px`, ...(inlineOverflow ? { overflowY: 'auto' } : {}) }
    : undefined
  return <div ref={rootRef} className={sizing === 'content' ? 'dvui-root dvui-canvas dvui-canvas-inline' : 'dvui-root dvui-canvas'}>
    {!live ? <p className="dvui-canvas-status" role="status">{t('canvasLoading')}</p>
      : frame.url === undefined ? <p className="dvui-canvas-status" role="alert">{t('canvasFailed')}</p>
      : <iframe
          key={frame.url}
          ref={iframeRef}
          className={sizing === 'content' ? 'dvui-canvas-frame dvui-canvas-frame-inline' : 'dvui-canvas-frame'}
          {...(frameStyle !== undefined ? { style: frameStyle } : {})}
          src={frame.url}
          sandbox="allow-scripts"
          title={t('canvasFrame')}
          data-deep-view-canvas
          data-card-sizing={sizing}
        />}
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

export type SubscribeCanvasResource = (address: string, listener: () => void) => () => void

export type InlineCanvasCardProps = {
  readonly sessionId: string
  readonly address: string
  readonly path: string
  readonly reloadSeq?: number
  readonly revalidateToken?: string | number
  readonly preferredWidth?: number
  readonly readBytes: ReadWorkspaceCanvasBytes
  readonly subscribeResource?: SubscribeCanvasResource
  readonly reportFirstPaint?: (address: string, report: CanvasFirstPaintReport) => void
  readonly t: (key: string, params?: Record<string, unknown>) => string
  readonly inputActions?: ComposerActions
  readonly useInput?: <T>(selector: (snapshot: InputSnapshot) => T, equal?: (left: T, right: T) => boolean) => T
}

/** Chat-stream inline sandboxed HTML/SVG card (`data-card-sizing="content"`). */
export function InlineCanvasPreview(props: InlineCanvasCardProps): ReactNode {
  const { sessionId, address, path, reloadSeq = 0, revalidateToken, preferredWidth, readBytes, subscribeResource, reportFirstPaint, t } = props
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Uint8Array<ArrayBuffer> }>({ status: 'loading' })
  const [watchedDeps, setWatchedDeps] = useState<readonly string[]>([])
  const [watchTick, setWatchTick] = useState(0)
  const [depRev, setDepRev] = useState(0)
  const prevTargetRef = useRef(`${sessionId}:${path}`)
  const watchedDepsRef = useRef<readonly string[]>([])
  const depBytesRef = useRef<Map<string, Uint8Array<ArrayBuffer>>>(new Map())
  watchedDepsRef.current = watchedDeps

  const addResource = useCallback((depAddress: string) => {
    setWatchedDeps(prev => prev.includes(depAddress) ? prev : [...prev, depAddress])
  }, [])

  const setResources = useCallback((addresses: readonly string[]) => {
    setWatchedDeps(prev => (
      prev.length === addresses.length && prev.every((item, idx) => item === addresses[idx])
        ? prev
        : [...addresses]
    ))
  }, [])

  // Subscribe to root HTML + packed dependency addresses (plus window focus recovery) so edits refresh inline cards automatically without reloading unchanged frames.
  useEffect(() => {
    const targets = [address, ...watchedDeps]
    const trigger = () => setWatchTick(v => v + 1)
    const cleanups: (() => void)[] = []
    for (const target of targets) {
      let bucket = inlineRefreshListeners.get(target)
      if (!bucket) {
        bucket = new Set()
        inlineRefreshListeners.set(target, bucket)
      }
      bucket.add(trigger)
      cleanups.push(() => {
        bucket?.delete(trigger)
        if (bucket && bucket.size === 0) inlineRefreshListeners.delete(target)
      })
      if (subscribeResource) cleanups.push(subscribeResource(target, trigger))
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', trigger)
      cleanups.push(() => window.removeEventListener('focus', trigger))
    }
    return () => { for (const fn of cleanups) fn() }
  }, [address, watchedDeps, subscribeResource])

  useEffect(() => {
    const controller = new AbortController()
    const targetKey = `${sessionId}:${path}`
    if (prevTargetRef.current !== targetKey) {
      prevTargetRef.current = targetKey
      depBytesRef.current.clear()
      setWatchedDeps([])
      setState({ status: 'loading' })
    }
    void (async () => {
      try {
        const result = await readBytes(sessionId, path, undefined, controller.signal)
        if (controller.signal.aborted) return
        if (!result.ok) {
          setState({ status: 'error', message: result.error.message ?? t('canvasFailed') })
          return
        }
        const nextBytes = result.value.data
        let rootUnchanged = false
        setState(prev => {
          if (prev.status === 'ready' && bytesEqual(prev.data, nextBytes)) {
            rootUnchanged = true
            return prev
          }
          return { status: 'ready', data: nextBytes }
        })
        if (rootUnchanged && watchedDepsRef.current.length > 0) {
          let depChanged = false
          for (const depAddr of watchedDepsRef.current) {
            const depFile = sessionFileOf(depAddr)
            if (!depFile) continue
            const depRes = await readBytes(depFile.sessionId, depFile.path, undefined, controller.signal)
            if (controller.signal.aborted) return
            if (depRes.ok) {
              const prevDep = depBytesRef.current.get(depAddr)
              if (!prevDep || !bytesEqual(prevDep, depRes.value.data)) {
                depBytesRef.current.set(depAddr, depRes.value.data)
                depChanged = true
              }
            }
          }
          if (depChanged && !controller.signal.aborted) setDepRev(v => v + 1)
        }
      } catch (error) {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: error instanceof Error ? error.message : t('canvasFailed') })
      }
    })()
    return () => controller.abort()
  }, [sessionId, path, reloadSeq, revalidateToken, watchTick, readBytes, t])

  const readRelated = useCallback<ReadCanvasRelated>(async (targetAddress, relativePath, signal) => {
    const file = sessionFileOf(targetAddress)
    const baseFile = file?.path ?? path
    const targetSession = file?.sessionId ?? sessionId
    const res = await readBytes(targetSession, relativePath, { baseFile }, signal)
    if (res.ok && res.value.absolutePath !== undefined) {
      depBytesRef.current.set(sessionFileAddress(targetSession, res.value.absolutePath), res.value.data)
    }
    return res
  }, [sessionId, path, readBytes])

  const shellStyle: CSSProperties | undefined = preferredWidth !== undefined
    ? { maxWidth: `${preferredWidth}px` }
    : undefined

  return <div className="dvui-canvas-inline-shell" {...(shellStyle !== undefined ? { style: shellStyle } : {})} data-deep-view-inline-canvas>
    {state.status === 'loading' ? <p className="dvui-canvas-status" role="status">{t('canvasLoading')}</p>
      : state.status === 'error' ? <p className="dvui-tool-error" role="alert">{state.message}</p>
      : <CanvasBody
          resourceAddress={address}
          content={{ kind: 'bytes', data: state.data }}
          addResource={addResource}
          setResources={setResources}
          readRelated={readRelated}
          sizing="content"
          reloadNonce={reloadSeq + depRev}
          {...(reportFirstPaint !== undefined ? { reportFirstPaint } : {})}
          sessionId={sessionId}
          t={t}
          {...(props.inputActions !== undefined ? { inputActions: props.inputActions } : {})}
          {...(props.useInput !== undefined ? { useInput: props.useInput } : {})}
        />}
  </div>
}
