// Error capture, first-paint health probe, dual sizing regime (`content` vs
// `viewport`), ResizeObserver height sync, broken `<img>` alt fallback, and live
// theme-token bridge injected at the front of the sandboxed canvas document.
// Dual sizing (`data-card-sizing="content|viewport"`) to prevent `100vh` +
// ResizeObserver feedback loops and the passive broken-image `alt` placeholder
// shim are inspired by liliMozi/showcard (Agent Showcard 1.0 Specification §1.4,
// §1.7, §7.1, §7.8, https://github.com/liliMozi/showcard).
import { isRecord } from '../contracts.ts'

/** Message type posted from the canvas document to the preview owner on error. */
export const CANVAS_ERROR_EVENT = 'dvui-canvas-error'
/** Message type posted once after `load` + two animation frames for first-paint health probing. */
export const CANVAS_READY_EVENT = 'dvui-canvas-ready'
/** Message type posted when an inline (`content`-sized) card changes intrinsic height. */
export const CANVAS_RESIZE_EVENT = 'dvui-canvas-resize'
/** Message type posted from the host to refresh bridged theme tokens without reloading the iframe. */
export const CANVAS_THEME_EVENT = 'dvui-canvas-theme'

export const CANVAS_ERROR_MESSAGE_LIMIT = 1000
export const CANVAS_ERROR_LIMIT = 20
export const CANVAS_INLINE_MIN_HEIGHT = 80
export const CANVAS_INLINE_MAX_HEIGHT = 1600

export type CanvasErrorKind = 'error' | 'rejection' | 'console' | 'resource'
export type CanvasSizingMode = 'content' | 'viewport'

export type CaptureScriptOptions = {
  readonly sizing?: CanvasSizingMode
  readonly themeDeclarations?: string
}

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

/** Intrinsic content height update reported by an inline sandboxed card. */
export type CanvasResizeReport = {
  readonly height: number
  readonly overflow?: boolean
}

/** One row of the error bar: identical messages merge into a count. */
export type CanvasError = {
  readonly message: string
  readonly count: number
  readonly source?: string
  readonly line?: number
  readonly column?: number
}

export function clampCanvasInlineHeight(value: number): number {
  return Math.round(Math.min(CANVAS_INLINE_MAX_HEIGHT, Math.max(CANVAS_INLINE_MIN_HEIGHT, value)))
}

/**
 * Build the capture and host-bridge script inserted at the start of `<head>`.
 * String lines keep `{name:` patterns out of template literals (stylesheet
 * scope guard) — the assembled text is HTML/JS inside the sandboxed iframe.
 * @param nonce - per-load token the parent checks before accepting a report.
 * @param options - surface sizing regime (`content` vs `viewport`) and initial theme tokens.
 * @returns the complete `<script>` element text.
 */
export function createCaptureScript(nonce: string, options?: CaptureScriptOptions): string {
  const sizing: CanvasSizingMode = options?.sizing === 'content' ? 'content' : 'viewport'
  const themeDeclarations = options?.themeDeclarations ?? ''
  const sizingCss = 'html[data-card-sizing="viewport"],html[data-card-sizing="viewport"]>body{height:100%;margin:0}'
    + 'html[data-card-sizing="content"]{height:auto}html[data-card-sizing="content"]>body{height:auto;min-height:0;margin:0;overflow-y:hidden}'
  return [
    '<script>(function(nonce,sizing,initTheme,sizingCss){',
    'var rootEl=document.documentElement;',
    'if(rootEl)rootEl.setAttribute(\'data-card-sizing\',sizing);',
    'function mountStyle(id,cssText){',
    'if(!cssText)return;',
    'var el=document.getElementById(id);',
    'if(!el){el=document.createElement(\'style\');el.id=id;(document.head||rootEl).appendChild(el)}',
    'el.textContent=cssText;',
    '}',
    'mountStyle(\'dvui-sizing-bridge\',sizingCss);',
    'if(initTheme)mountStyle(\'dvui-theme-bridge\',\'html{\' + initTheme + \'}\');',
    'addEventListener(\'message\',function(ev){',
    'var d=ev&&ev.data;',
    'if(!d||d.type!==' + JSON.stringify(CANVAS_THEME_EVENT) + '||d.nonce!==nonce||typeof d.declarations!==\'string\')return;',
    'mountStyle(\'dvui-theme-bridge\',d.declarations?\'html{\' + d.declarations + \'}\':\'\');',
    '});',
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
    'if(tag===\'img\'&&!t.getAttribute(\'data-dvui-img-fallback\')&&t.parentNode){',
    't.setAttribute(\'data-dvui-img-fallback\',\'1\');',
    'var alt=(t.getAttribute(\'alt\')||\'\').trim()||ref||\'Image unavailable\';',
    'var box=document.createElement(\'span\');',
    'box.setAttribute(\'role\',\'img\');',
    'box.setAttribute(\'aria-label\',alt);',
    'box.setAttribute(\'data-dvui-img-placeholder\',\'1\');',
    'box.style.cssText=\'display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border:1px dashed currentColor;border-radius:6px;opacity:0.72;font-size:12px;line-height:1.4;max-width:100%;box-sizing:border-box\';',
    'box.textContent=alt;',
    't.parentNode.replaceChild(box,t);',
    '}',
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
    'var lastHeight=0,lastOverflow=false;',
    'function emitResize(){',
    'if(sizing!==\'content\')return;',
    'var b=document.body,r=document.documentElement;',
    'var quirks=document.compatMode===\'BackCompat\';',
    'var raw=Math.ceil(Math.max(b?b.scrollHeight:0,b&&!quirks?b.offsetHeight:0,r&&!quirks?r.offsetHeight:0));',
    'if(raw<=0)return;',
    'var over=raw>' + CANVAS_INLINE_MAX_HEIGHT + ';',
    'if(b)b.style.overflowY=over?\'auto\':\'hidden\';',
    'var clamped=Math.min(' + CANVAS_INLINE_MAX_HEIGHT + ',Math.max(' + CANVAS_INLINE_MIN_HEIGHT + ',raw));',
    'if(Math.abs(clamped-lastHeight)<1&&over===lastOverflow)return;',
    'lastHeight=clamped;lastOverflow=over;',
    'var msg={type:' + JSON.stringify(CANVAS_RESIZE_EVENT) + ',nonce:nonce,height:clamped,overflow:over};',
    'try{parent.postMessage(msg,\'*\')}catch(e){}',
    '}',
    'if(sizing===\'content\'){',
    'addEventListener(\'load\',emitResize);',
    'if(typeof ResizeObserver===\'function\'){',
    'var ro=new ResizeObserver(function(){emitResize()});',
    'if(rootEl)ro.observe(rootEl);',
    'addEventListener(\'DOMContentLoaded\',function(){if(document.body)ro.observe(document.body);emitResize()},{once:true});',
    '}',
    '}',
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
    'emitResize();',
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
    '})(',
    JSON.stringify(nonce), ',',
    JSON.stringify(sizing), ',',
    JSON.stringify(themeDeclarations), ',',
    JSON.stringify(sizingCss),
    ');</script>',
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

/** Read one postMessage payload as an inline content-sizing height update. */
export function canvasResizeReportOf(data: unknown, nonce: string): CanvasResizeReport | undefined {
  if (!isRecord(data) || data.type !== CANVAS_RESIZE_EVENT || data.nonce !== nonce) return undefined
  if (typeof data.height !== 'number' || !Number.isFinite(data.height) || data.height <= 0) return undefined
  return {
    height: clampCanvasInlineHeight(data.height),
    ...(data.overflow === true ? { overflow: true } : {}),
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
