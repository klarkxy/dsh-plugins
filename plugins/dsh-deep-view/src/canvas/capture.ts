// Error capture injected at the front of the sandboxed canvas document. The
// iframe has no allow-same-origin, so the parent can only learn runtime errors
// through postMessage; a per-load nonce keeps stale or foreign frames from
// feeding the error bar. Deep View addition — not part of the upstream preview.
import { isRecord } from '../contracts.ts'

/** Message type posted from the canvas document to the preview owner. */
export const CANVAS_ERROR_EVENT = 'dvui-canvas-error'

export const CANVAS_ERROR_MESSAGE_LIMIT = 1000
export const CANVAS_ERROR_LIMIT = 20

export type CanvasErrorKind = 'error' | 'rejection' | 'console' | 'resource'

/** One runtime or subresource error reported by the canvas document. */
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
 * It runs before every author script and listens in capture phase so non-bubbling
 * `<img>`, `<script>` and `<link rel="stylesheet">` load failures are reported too,
 * while rewriting packed `blob:` asset URLs back to relative workspace paths.
 * String lines keep `{name:` patterns out of template literals (stylesheet
 * scope guard) — the assembled text is HTML, not CSS.
 * @param nonce - per-load token the parent checks before accepting a report.
 * @returns the complete `<script>` element text.
 */
export function createCaptureScript(nonce: string): string {
  return [
    '<script>(function(nonce){',
    'function rewrite(v){',
    'var s=String(v);',
    'var m=window.__dvuiAssets;',
    'if(m&&typeof m===\'object\'){for(var k in m){if(Object.prototype.hasOwnProperty.call(m,k)&&k&&s.indexOf(k)!==-1)s=s.split(k).join(m[k])}}',
    'return s;',
    '}',
    'function send(kind,message,source,line,column){',
    'var data={type:' + JSON.stringify(CANVAS_ERROR_EVENT) + ',nonce:nonce,kind:kind,message:rewrite(message).slice(0,' + CANVAS_ERROR_MESSAGE_LIMIT + ')};',
    'if(source!=null)data.source=rewrite(source);',
    'if(typeof line===\'number\'&&line>0)data.line=line;',
    'if(typeof column===\'number\'&&column>0)data.column=column;',
    'try{parent.postMessage(data,\'*\')}catch(e){}',
    '}',
    'addEventListener(\'error\',function(e){',
    'var t=e&&e.target;',
    'if(t&&t!==window&&t!==self&&typeof t.tagName===\'string\'){',
    'var tag=t.tagName.toLowerCase();',
    'if(tag===\'img\'||tag===\'script\'||tag===\'link\'){',
    'var raw=(t.getAttribute&&(t.getAttribute(\'src\')||t.getAttribute(\'href\')))||t.src||t.href||\'\';',
    'var sRaw=rewrite(raw);',
    'var ref=/^data:/i.test(sRaw)?sRaw.slice(0,48)+\'…\':sRaw.slice(0,300);',
    'send(\'resource\',\'Failed to load <\'+tag+\'>: \'+(ref||\'(empty)\'),ref||undefined);',
    '}',
    'return;',
    '}',
    'var m=e.message||(e.error&&(e.error.stack||e.error.message))||\'Script error\';',
    'send(\'error\',m,e.filename||undefined,e.lineno||undefined,e.colno||undefined);',
    'if(e.preventDefault)e.preventDefault();',
    '},true);',
    'addEventListener(\'unhandledrejection\',function(e){',
    'var r=e.reason;',
    'send(\'rejection\',r&&(r.stack||r.message)||String(r));',
    'if(e.preventDefault)e.preventDefault();',
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
  if (kind !== 'error' && kind !== 'rejection' && kind !== 'console' && kind !== 'resource') return undefined
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
 * Merge one report into the error list: identical messages raise a count and
 * backfill missing source/line/column metadata when a later occurrence provides it.
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
    const merged: CanvasError = {
      message: current.message,
      count: current.count + 1,
      source: current.source ?? report.source,
      line: current.line ?? report.line,
      column: current.column ?? report.column,
    }
    return [...errors.slice(0, index), merged, ...errors.slice(index + 1)]
  }
  if (errors.length >= limit) return [...errors]
  return [...errors, { message, count: 1, source: report.source, line: report.line, column: report.column }]
}

/** Format one aggregated canvas error with its resolved workspace file/line location when available. */
export function formatCanvasError(error: CanvasError): string {
  const cleanSource = typeof error.source === 'string' && error.source !== '' && !/^(?:blob|data|about):/iu.test(error.source)
    ? error.source
    : undefined
  const location = cleanSource !== undefined && error.line !== undefined
    ? `${cleanSource}:${error.line}${error.column !== undefined ? `:${error.column}` : ''}`
    : cleanSource !== undefined
      ? cleanSource
      : error.line !== undefined
        ? `line ${error.line}${error.column !== undefined ? `:${error.column}` : ''}`
        : undefined
  if (location === undefined) return error.message
  if (error.message.includes(location)) return error.message
  if (error.line === undefined && cleanSource !== undefined && error.message.includes(cleanSource)) return error.message
  return `${error.message} (${location})`
}
