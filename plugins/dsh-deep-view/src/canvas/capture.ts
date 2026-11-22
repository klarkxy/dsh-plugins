// Error capture injected at the front of the sandboxed canvas document. The
// iframe has no allow-same-origin, so the parent can only learn runtime errors
// through postMessage; a per-load nonce keeps stale or foreign frames from
// feeding the error bar. Deep View addition — not part of the upstream preview.
import { isRecord } from '../contracts.ts'

/** Message type posted from the canvas document to the preview owner. */
export const CANVAS_ERROR_EVENT = 'dvui-canvas-error'

export const CANVAS_ERROR_MESSAGE_LIMIT = 1000
export const CANVAS_ERROR_LIMIT = 20

export type CanvasErrorKind = 'error' | 'rejection' | 'console'

/** One runtime error reported by the canvas document. */
export type CanvasErrorReport = {
  readonly kind: CanvasErrorKind
  readonly message: string
  readonly source?: string
  readonly line?: number
  readonly column?: number
}

/** One row of the error bar: identical messages merge into a count. */
export type CanvasError = {
  readonly message: string
  readonly count: number
  readonly source?: string
  readonly line?: number
  readonly column?: number
}

/**
 * Build the capture script inserted at the start of the canvas document head.
 * It runs before every author script.
 * String lines keep `{name:` patterns out of template literals (stylesheet
 * scope guard) — the assembled text is HTML, not CSS.
 * @param nonce - per-load token the parent checks before accepting a report.
 * @returns the complete `<script>` element text.
 */
export function createCaptureScript(nonce: string): string {
  return [
    '<script>(function(nonce){',
    'function send(kind,message,source,line,column){',
    'var data={type:' + JSON.stringify(CANVAS_ERROR_EVENT) + ',nonce:nonce,kind:kind,message:String(message).slice(0,' + CANVAS_ERROR_MESSAGE_LIMIT + ')};',
    'if(source!=null)data.source=String(source);',
    'if(typeof line===\'number\')data.line=line;',
    'if(typeof column===\'number\')data.column=column;',
    'try{parent.postMessage(data,\'*\')}catch(e){}',
    '}',
    'addEventListener(\'error\',function(e){',
    'var m=e.message||(e.error&&(e.error.stack||e.error.message))||\'Script error\';',
    'send(\'error\',m,e.filename||undefined,e.lineno||undefined,e.colno||undefined);',
    'e.preventDefault();',
    '});',
    'addEventListener(\'unhandledrejection\',function(e){',
    'var r=e.reason;',
    'send(\'rejection\',r&&(r.stack||r.message)||String(r));',
    'e.preventDefault();',
    '});',
    'var orig=console.error;',
    'console.error=function(){',
    'var parts=[];',
    'for(var i=0;i<arguments.length;i++){var a=arguments[i];parts.push(a&&(a.stack||a.message)||String(a))}',
    'send(\'console\',parts.join(\' \'));',
    'return orig.apply(this,arguments);',
    '};',
    '})(', JSON.stringify(nonce), ');</script>',
  ].join('')
}

/**
 * Read one postMessage payload as a canvas error report.
 * @param data - `event.data` from a `message` event (source already matched by the caller).
 * @param nonce - the nonce this frame was loaded with.
 * @returns the report, or `undefined` for foreign or malformed payloads.
 */
export function canvasErrorReportOf(data: unknown, nonce: string): CanvasErrorReport | undefined {
  if (!isRecord(data) || data.type !== CANVAS_ERROR_EVENT || data.nonce !== nonce) return undefined
  const kind = data.kind
  if (kind !== 'error' && kind !== 'rejection' && kind !== 'console') return undefined
  if (typeof data.message !== 'string') return undefined
  return {
    kind,
    message: data.message.slice(0, CANVAS_ERROR_MESSAGE_LIMIT),
    source: typeof data.source === 'string' ? data.source : undefined,
    line: typeof data.line === 'number' && Number.isFinite(data.line) ? data.line : undefined,
    column: typeof data.column === 'number' && Number.isFinite(data.column) ? data.column : undefined,
  }
}

/**
 * Merge one report into the error list: identical messages raise a count, new
 * messages append until the cap, further distinct messages drop.
 * @param errors - current rows.
 * @param report - accepted report.
 * @param limit - maximum distinct rows kept (default {@link CANVAS_ERROR_LIMIT}).
 * @returns the next rows (a new array).
 */
export function recordCanvasError(errors: readonly CanvasError[], report: CanvasErrorReport, limit = CANVAS_ERROR_LIMIT): CanvasError[] {
  const message = report.message.slice(0, CANVAS_ERROR_MESSAGE_LIMIT)
  const index = errors.findIndex(error => error.message === message)
  if (index !== -1) {
    const current = errors[index]!
    return [...errors.slice(0, index), { ...current, count: current.count + 1 }, ...errors.slice(index + 1)]
  }
  if (errors.length >= limit) return [...errors]
  return [...errors, { message, count: 1, source: report.source, line: report.line, column: report.column }]
}
