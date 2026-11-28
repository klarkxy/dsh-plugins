// Error and first-paint health capture injected at the front of the sandboxed
// canvas document. The iframe has no allow-same-origin, so the parent can only
// learn runtime errors and first-paint settlement through postMessage; a per-load
// nonce keeps stale or foreign frames from feeding the error bar or probe.
import { isRecord } from '../contracts.ts'

/** Message type posted from the canvas document to the preview owner on error. */
export const CANVAS_ERROR_EVENT = 'dvui-canvas-error'
/** Message type posted once after `load` + two animation frames for first-paint health probing. */
export const CANVAS_READY_EVENT = 'dvui-canvas-ready'

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

/** One-shot first-paint settlement payload posted from the canvas document. */
export type CanvasReadyReport = {
  readonly collapsed: boolean
  readonly height: number
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
 * It runs before every author script, listens in capture phase so non-bubbling
 * subresource load failures are reported, rewrites packed `blob:` URLs back to
 * workspace relative paths, and posts one first-paint settlement receipt after
 * `load` + two `requestAnimationFrame` ticks.
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
    'var isStyleLink=tag===\'link\'&&/(?:^|\\s)stylesheet(?:\\s|$)/i.test((t.getAttribute&&t.getAttribute(\'rel\'))||\'\');',
    'if(tag===\'img\'||tag===\'script\'||isStyleLink){',
    'var attr=tag===\'link\'?\'href\':\'src\';',
    'var raw=t.hasAttribute&&t.hasAttribute(attr)?(t.getAttribute(attr)||\'\'):\'\';',
    'var sRaw=rewrite(raw).trim();',
    'if(/^blob:/i.test(sRaw))sRaw=\'blob:(local)\';',
    'var ref=/^data:/i.test(sRaw)?(sRaw.length>48?sRaw.slice(0,48)+\'…\':sRaw):sRaw.slice(0,300);',
    'send(\'resource\',\'Failed to load <\'+tag+\'>: \'+(ref||\'(empty)\'),ref&&ref!==\'blob:(local)\'?ref:undefined);',
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
    'var readySent=false;',
    'function measureVisualHeight(){',
    'var bo=document.body,de=document.documentElement;',
    'var bh=bo?bo.scrollHeight:0;',
    'var dh=de?de.scrollHeight:0;',
    'var br=bo&&bo.getBoundingClientRect?Math.ceil(bo.getBoundingClientRect().height):0;',
    'var h=Math.max(bh,br);',
    'if(h<=0&&bo&&bo.children){',
    'for(var i=0;i<bo.children.length&&i<32;i++){',
    'var cr=bo.children[i].getBoundingClientRect&&bo.children[i].getBoundingClientRect();',
    'if(cr&&cr.height>0)h=Math.max(h,Math.ceil(cr.height));',
    '}',
    '}',
    'return {h:Math.max(h,dh),bodyH:h,hidden:innerWidth===0&&innerHeight===0,hasBody:!!bo};',
    '}',
    'function reportReady(){',
    'if(readySent)return;',
    'readySent=true;',
    'var m=measureVisualHeight();',
    'var collapsed=!m.hidden&&(!m.hasBody||m.bodyH<=0);',
    'var payload={type:' + JSON.stringify(CANVAS_READY_EVENT) + ',nonce:nonce,collapsed:collapsed,height:m.h};',
    'try{parent.postMessage(payload,\'*\')}catch(e){}',
    '}',
    'function afterLoad(){',
    'var raf=typeof requestAnimationFrame===\'function\'?requestAnimationFrame:function(cb){return setTimeout(cb,16)};',
    'raf(function(){raf(reportReady)});',
    'setTimeout(reportReady,48);',
    '}',
    'if(document.readyState===\'complete\')afterLoad();',
    'else addEventListener(\'load\',afterLoad,{once:true});',
    '})(', JSON.stringify(nonce), ');</script>',
  ].join('')
}

/** Read one postMessage payload as a canvas error report. */
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

/** Read one postMessage payload as a first-paint readiness receipt. */
export function canvasReadyReportOf(data: unknown, nonce: string): CanvasReadyReport | undefined {
  if (!isRecord(data) || data.type !== CANVAS_READY_EVENT || data.nonce !== nonce) return undefined
  const height = typeof data.height === 'number' && Number.isFinite(data.height) ? Math.max(0, Math.round(data.height)) : 0
  return {
    collapsed: data.collapsed === true,
    height,
  }
}

/**
 * Merge one report into the error list: identical messages raise a count and
 * backfill missing source/line/column metadata when a later occurrence provides it.
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
