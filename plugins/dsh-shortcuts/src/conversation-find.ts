/**
 * Full-history, denoised in-conversation literal search engine for
 * `@klarkxy/dsh-shortcuts` (`conversation.findInSession`).
 *
 * Adapted from `herenfor/dsh-runtime-tuning` (MIT License).
 */

export const FIND_COMMAND_ID = 'conversation.findInSession'
export const FIND_LOCALE_NS = 'dsh-shortcuts-find'
export const FIND_POS_STORAGE_KEY = 'klarkxy.dsh-shortcuts.find-pos.v1'
export const FIND_WEB_CTRL_F_KEY = 'klarkxy.dsh-shortcuts.find-web-ctrl-f.v1'
export const HIGHLIGHT_ALL_NAME = 'dsh-shortcuts-find-match'
export const HIGHLIGHT_CURRENT_NAME = 'dsh-shortcuts-find-current'
export const MAX_HISTORY_CACHE_BYTES = 8 * 1024 * 1024
export const DEFAULT_PAGE_OPTIONS = {
  maxMessages: 500,
  turnWindow: { minMessages: 50, minTurns: 2 },
} as const
export const FIND_DEBOUNCE_MS = 150
export const POS_EDGE_MARGIN = 8
export const SCOPE_EXTRA_KEYS = [
  'reasoning',
  'tool',
  'command',
  'context',
  'compaction',
  'todo',
  'error',
] as const
export type ExtraScopeKey = (typeof SCOPE_EXTRA_KEYS)[number]
export type SearchScopeKey = 'body' | ExtraScopeKey
export interface SearchScope {
  readonly body: boolean
  readonly reasoning: boolean
  readonly tool: boolean
  readonly command: boolean
  readonly context: boolean
  readonly compaction: boolean
  readonly todo: boolean
  readonly error: boolean
}
export const DEFAULT_SEARCH_SCOPE: SearchScope = Object.freeze({
  body: true,
  reasoning: false,
  tool: false,
  command: false,
  context: false,
  compaction: false,
  todo: false,
  error: false,
})
export const FIND_SHORTCUT_DEFAULTS = {
  'desktop:windows': { code: 'KeyF', modifiers: ['primary'] as const },
  'desktop:macos': { code: 'KeyF', modifiers: ['primary'] as const },
  'desktop:linux': { code: 'KeyF', modifiers: ['primary'] as const },
  'web:windows': { code: 'KeyF', modifiers: ['primary', 'alt'] as const },
  'web:macos': { code: 'KeyF', modifiers: ['primary', 'alt'] as const },
} as const
export const FIND_LOCALES = {
  zh: {
    openLabel: '在当前对话中查找',
    placeholder: '在当前对话中查找…',
    caseSensitive: '区分大小写',
    prev: '上一处',
    next: '下一处',
    close: '关闭',
    searchHistory: '搜索全部历史',
    pause: '暂停',
    resume: '继续',
    retry: '重试',
    scanning: '正在搜索更早历史…',
    statusMore: '仍有更早历史',
    statusDone: '已查完',
    statusPaused: '已暂停',
    statusError: '读取失败',
    statusLoadingTarget: '正在加载该轮历史…',
    foundCount: '已找到 {count} 处',
    noMatches: '无匹配',
    fallbackTurn: '已定位到消息/轮次',
    fallbackHidden: '当前视图未展示此内容',
    relocate: '重新定位',
    dragHandle: '拖动浮窗位置（双击重置）',
    scopeBtn: '搜索范围（默认仅正文；右键浮窗亦可打开）',
    scopeMenuTitle: '搜索范围',
    scopeBody: '正文（提问与回复）',
    scopeDefaultTag: '默认',
    scopeReset: '仅搜正文',
    scopeAll: '全部范围',
    webCtrlFTitle: '网页端 Ctrl+F / Cmd+F 对话内查找',
    webCtrlFHint: '开启后，当主对话处于活动状态且焦点不在外部输入框或弹窗内时，在网页端按 Ctrl+F / Cmd+F 直接打开对话全历史查找浮窗；默认关闭以保留浏览器原生查找（网页端始终可用 Ctrl+Alt+F / Cmd+Alt+F 或会话右上角放大镜按钮）。',
    webCtrlFLabel: '在网页端接管主对话内的 Ctrl+F / Cmd+F',
    src_user: '用户输入',
    src_steering: '插话消息',
    src_context: '注入上下文',
    src_reasoning: '思考过程',
    src_response: '助手回复',
    src_tool: '工具调用/结果',
    src_command: '斜杠命令',
    src_compaction: '压缩摘要',
    src_todo: '待办列表',
    src_error: '轮次错误',
  },
  en: {
    openLabel: 'Find in conversation',
    placeholder: 'Find in conversation…',
    caseSensitive: 'Match case',
    prev: 'Previous match',
    next: 'Next match',
    close: 'Close',
    searchHistory: 'Search full history',
    pause: 'Pause',
    resume: 'Resume',
    retry: 'Retry',
    scanning: 'Searching older history…',
    statusMore: 'More history available',
    statusDone: 'Searched all history',
    statusPaused: 'Paused',
    statusError: 'Load failed',
    statusLoadingTarget: 'Loading turn history…',
    foundCount: '{count} matches',
    noMatches: 'No matches',
    fallbackTurn: 'Located in message/turn',
    fallbackHidden: 'Content not visible in current view',
    relocate: 'Relocate',
    dragHandle: 'Drag to move (double-click to reset)',
    scopeBtn: 'Search scope (body text only by default; right-click bar)',
    scopeMenuTitle: 'Search scope',
    scopeBody: 'Conversation body (user & replies)',
    scopeDefaultTag: 'Default',
    scopeReset: 'Body only',
    scopeAll: 'Select all',
    webCtrlFTitle: 'Web Ctrl+F / Cmd+F conversation find',
    webCtrlFHint: 'When enabled on Web, pressing Ctrl+F / Cmd+F while an active conversation has focus opens the full-history conversation find bar instead of native browser find. Disabled by default (Ctrl+Alt+F / Cmd+Alt+F and the session header button are always available).',
    webCtrlFLabel: 'Intercept Ctrl+F / Cmd+F inside active Web conversations',
    src_user: 'User message',
    src_steering: 'Steering',
    src_context: 'Context',
    src_reasoning: 'Reasoning',
    src_response: 'Assistant reply',
    src_tool: 'Tool call/output',
    src_command: 'Command',
    src_compaction: 'Compaction summary',
    src_todo: 'Todo list',
    src_error: 'Turn error',
  },
} as const
export interface HitExcerpt {
  readonly before: string
  readonly match: string
  readonly after: string
  readonly leftContext: string
  readonly rightContext: string
  readonly relStart: number
}
export interface SearchHit {
  readonly hitKey: string
  readonly seq: number
  readonly durable: boolean
  turn?: number | undefined
  turnStartSeq?: number | undefined
  pendingTurn: boolean
  readonly nodeKey: string | null
  readonly groupPart: string | null
  readonly sourceKind: string
  readonly subCallId: string | null
  readonly parentCallId: string | null
  readonly fieldKey: string
  readonly fieldOrder: number
  readonly offset: number
  readonly length: number
  readonly fieldOrdinal: number
  readonly blockOrdinal: number
  readonly matchText: string
  fieldText?: string | undefined
  excerpt: HitExcerpt | null
  pageKey?: string | undefined
}
export interface HighlightBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly current: boolean
}
export interface OverlayPosition {
  readonly left: number
  readonly top: number
}
export type ScanState = 'idle' | 'scanning' | 'paused' | 'done' | 'error'
export interface FindSnapshot {
  readonly open: boolean
  readonly sessionId: string | null
  readonly query: string
  readonly caseSensitive: boolean
  readonly scope: SearchScope
  readonly hasCustomScope: boolean
  readonly scopeMenuOpen: boolean
  readonly hits: readonly SearchHit[]
  readonly navigated: boolean
  readonly selectedIndex: number
  readonly selectedHitKey: string | null
  readonly scanState: ScanState
  readonly scanError: string | null
  readonly remoteHasMore: boolean
  readonly hasEvictedPending: boolean
  readonly loadingTarget: boolean
  readonly fallbackNotice: string | null
  readonly hasRemote: boolean
  readonly canScanHistory: boolean
  readonly runtime: string
  readonly platform: string
  readonly activeHit: SearchHit | null
  readonly focusSeq: number
  readonly highlightRects: readonly HighlightBox[]
}
export function conversationContextKey(kind: string, id: string): string {
  return `${kind.length}:${kind}${id}`
}
export function normalizeSearchScope(raw: Partial<Record<SearchScopeKey, unknown>> | null | undefined): SearchScope {
  return {
    body: typeof raw?.body === 'boolean' ? raw.body : DEFAULT_SEARCH_SCOPE.body,
    reasoning: typeof raw?.reasoning === 'boolean' ? raw.reasoning : false,
    tool: typeof raw?.tool === 'boolean' ? raw.tool : false,
    command: typeof raw?.command === 'boolean' ? raw.command : false,
    context: typeof raw?.context === 'boolean' ? raw.context : false,
    compaction: typeof raw?.compaction === 'boolean' ? raw.compaction : false,
    todo: typeof raw?.todo === 'boolean' ? raw.todo : false,
    error: typeof raw?.error === 'boolean' ? raw.error : false,
  }
}
export function isCustomScope(scope: SearchScope | null | undefined): boolean {
  if (!scope) return false
  return !scope.body || SCOPE_EXTRA_KEYS.some(key => Boolean(scope[key]))
}
export function resolveEnabledSourceKinds(scope: SearchScope): Set<string> {
  const normalized = normalizeSearchScope(scope)
  const kinds = new Set<string>()
  if (normalized.body) {
    kinds.add('user')
    kinds.add('response')
  }
  for (const key of SCOPE_EXTRA_KEYS) {
    if (normalized[key]) kinds.add(key)
  }
  return kinds
}
export function resolveExcludedGroupParts(enabledKinds: ReadonlySet<string> | null): Set<string> | null {
  if (!enabledKinds) return null
  const excluded = new Set<string>()
  if (!enabledKinds.has('reasoning')) excluded.add('reasoning')
  if (!enabledKinds.has('response')) excluded.add('response')
  return excluded.size > 0 ? excluded : null
}
export function buildAllowedDomTargets(hitsList: readonly SearchHit[]): Set<string> {
  const targets = new Set<string>()
  for (const hit of hitsList) {
    if (!hit?.nodeKey) continue
    targets.add(hit.nodeKey)
    targets.add(`${hit.nodeKey}|${hit.groupPart ?? ''}`)
  }
  return targets
}
export function extractMarkdownVisibleText(markdown: string): string {
  if (!markdown) return ''
  const withoutDefs = markdown.replace(/^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S+.*$/gm, '')
  const stash: string[] = []
  const put = (literal: string): string => {
    const token = `\uE000${stash.length}\uE001`
    stash.push(literal)
    return token
  }
  let out = withoutDefs.replace(/(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:\n[ \t]*\3[ \t]*(?=\n|$)|$)/g, (_m, lead: string, _indent: string, _fence: string, code: string) => `${lead}${put(code)}`)
  out = out.replace(/(`+)([^\n]*?)\1/g, (_m, _ticks: string, code: string) => put(code))
  out = out.replace(/!\[([^\]]*)\]\([^)\n]*\)/g, '$1')
  out = out.replace(/\[([^\]]+)\]\([^)\n]*\)/g, '$1')
  out = out.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
  out = out.replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
  out = out.replace(/\\([\\`*_{}[\]()#+\-.!~|])/g, (_m, ch: string) => put(ch))
  out = out.replace(/\*\*([^\n*]+?)\*\*/g, '$1')
  out = out.replace(/~~([^\n~]+?)~~/g, '$1')
  out = out.replace(/\*([^\n*]+?)\*/g, '$1')
  out = out.replace(/(^|[\s([{"'])__([^\n_]+?)__(?=$|[\s)\]}"'.,;:!?])/g, '$1$2')
  out = out.replace(/(^|[\s([{"'])_([^\n_]+?)_(?=$|[\s)\]}"'.,;:!?])/g, '$1$2')
  out = out.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
  out = out.replace(/\uE000(\d+)\uE001/g, (_m, idx: string) => stash[Number(idx)] ?? '')
  return out
}
const replyTextCache = new WeakMap<object, string>()
function searchableReplyText(
  block: { readonly text?: unknown },
  customExtractor?: ((markdown: string) => string) | undefined,
): string {
  const raw = typeof block.text === 'string' ? block.text : ''
  if (!raw) return ''
  const cached = replyTextCache.get(block)
  if (cached !== undefined) return cached
  let visible = raw
  try {
    visible = customExtractor ? customExtractor(raw) : extractMarkdownVisibleText(raw)
  } catch {
    visible = raw
  }
  replyTextCache.set(block, visible)
  return visible
}
function isReplacementOp(op: unknown): boolean {
  return op !== undefined && op !== 'append'
}
function isAppendSurface(event: Record<string, unknown> | null | undefined): boolean {
  return Boolean(event) && !isReplacementOp(event?.surfaceOp)
}
function isCompactCheckpoint(event: Record<string, unknown> | null | undefined): boolean {
  if (!event || event.type !== 'user/message' || !isReplacementOp(event.surfaceOp)) return false
  const data = event.data as { source?: { kind?: unknown } } | undefined
  return data?.source?.kind === 'compact-checkpoint'
}
function extractBlocksText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const out: string[] = []
  for (const block of content) {
    if (block && typeof block === 'object') {
      const rec = block as { type?: unknown; text?: unknown }
      if (rec.type === 'text' && typeof rec.text === 'string' && rec.text !== '') {
        out.push(rec.text)
      }
    }
  }
  return out.join('\n')
}
function stringifyArgs(args: unknown): string {
  if (typeof args === 'string') return args
  if (args === undefined || args === null) return ''
  try {
    return JSON.stringify(args)
  } catch {
    return String(args)
  }
}
export function sanitizeFailure(err: unknown): string {
  if (!err || typeof err !== 'object') return err ? String(err) : ''
  const rec = err as { code?: unknown; message?: unknown; reason?: unknown; name?: unknown }
  if (rec.code === 'AUTH') return 'AUTH'
  const parts: string[] = []
  if (typeof rec.message === 'string' && rec.message) parts.push(rec.message)
  else if (typeof rec.reason === 'string' && rec.reason) parts.push(rec.reason)
  if (typeof rec.name === 'string' && rec.name && !parts.includes(rec.name)) parts.push(rec.name)
  if (typeof rec.code === 'string' && rec.code && !parts.includes(rec.code)) parts.push(rec.code)
  return parts.join(' ').trim()
}
export interface ExtractedField {
  readonly fieldKey: string
  readonly text: string
  readonly groupPart?: string | undefined
  readonly sourceKind?: string | undefined
  readonly overrideNodeKey?: string | undefined
}
export interface BoundaryRecord {
  readonly kind: string
  readonly seq: number
  readonly turn?: number | undefined
  readonly step?: number | undefined
}
export interface RawEventRecord {
  readonly seq: number
  readonly stableId?: string | undefined
  readonly linkKind?: string | undefined
  readonly linkId?: string | undefined
  readonly compactionId?: string | undefined
  readonly sourceCommandId?: string | undefined
  readonly subCallId?: string | undefined
  readonly parentCallId?: string | undefined
  readonly rootCallId?: string | undefined
  readonly nodeKind: string | null
  readonly nodeId: string | null
  readonly sourceKind: string
  readonly explicitTurn?: number | null | undefined
  readonly explicitStep?: number | undefined
  readonly fields?: readonly ExtractedField[] | undefined
  readonly fallbackTools?: readonly { callId: string; name: string; argsRaw: string }[] | undefined
  readonly name?: string | undefined
  readonly argsRaw?: string | undefined
  readonly resultText?: string | undefined
  readonly errorText?: string | undefined
}
function eventBytes(fields: readonly ExtractedField[]): number {
  let bytes = 0
  for (const field of fields) {
    bytes += field.text.length * 2
  }
  return bytes
}
function pushField(
  fields: ExtractedField[],
  fieldKey: string,
  text: unknown,
  extra?: { groupPart?: string | undefined; sourceKind?: string | undefined; overrideNodeKey?: string | undefined } | undefined,
): void {
  if (typeof text !== 'string' || text === '') return
  fields.push({ fieldKey, text, ...extra })
}
export function extractDurableEvent(
  event: Record<string, unknown> | null | undefined,
  markdownExtractor?: ((markdown: string) => string) | undefined,
): { boundary?: BoundaryRecord | undefined; rec: RawEventRecord | null } | null {
  if (!event || typeof event !== 'object') return null
  const seq = event.seq
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return null
  const d = (event.data ?? {}) as Record<string, unknown>
  const turn = typeof d.turn === 'number' ? d.turn : undefined
  const step = typeof d.step === 'number' ? d.step : undefined
  if (event.type === 'turn/start' || event.type === 'turn/end' || event.type === 'step/start' || event.type === 'step/end') {
    const boundary: BoundaryRecord = { kind: event.type, seq, turn, step }
    const reason = d.reason as { kind?: unknown; error?: unknown } | undefined
    if (event.type === 'turn/end' && reason?.kind === 'error') {
      const fields: ExtractedField[] = []
      pushField(fields, 'error', sanitizeFailure(reason.error))
      return {
        boundary,
        rec: fields.length > 0
          ? { seq, stableId: `turnerr:${String(d.turn ?? '')}`, nodeKind: 'turn-error', nodeId: String(d.turn ?? ''), sourceKind: 'error', explicitTurn: turn, fields }
          : null,
      }
    }
    return { boundary, rec: null }
  }
  if (isCompactCheckpoint(event)) {
    const src = d.source as { compactionId?: unknown; sourceCommandId?: unknown } | undefined
    const cid = typeof src?.compactionId === 'string' ? src.compactionId : ''
    if (!cid) return null
    const cmdId = src?.sourceCommandId !== undefined ? String(src.sourceCommandId) : undefined
    const fields: ExtractedField[] = []
    pushField(fields, 'checkpoint', extractBlocksText(d.content))
    return {
      rec: {
        seq,
        linkKind: 'compact-checkpoint',
        compactionId: cid,
        sourceCommandId: cmdId,
        nodeKind: cmdId ? 'command' : 'compaction',
        nodeId: cmdId ?? cid,
        sourceKind: 'compaction',
        explicitTurn: turn,
        fields,
      },
    }
  }
  if (event.type === 'compaction/summary') {
    const cid = typeof d.compactionId === 'string' ? d.compactionId : ''
    if (!cid) return null
    const cmdId = d.sourceCommandId !== undefined ? String(d.sourceCommandId) : undefined
    const fields: ExtractedField[] = []
    pushField(fields, 'summary', extractBlocksText(d.summary))
    return {
      rec: {
        seq,
        linkKind: 'compact-summary',
        compactionId: cid,
        sourceCommandId: cmdId,
        nodeKind: cmdId ? 'command' : 'compaction',
        nodeId: cmdId ?? cid,
        sourceKind: 'compaction',
        explicitTurn: turn,
        fields,
      },
    }
  }
  if (event.type === 'user/message') {
    if (!isAppendSurface(event)) return null
    const src = d.source as { kind?: unknown } | undefined
    const text = extractBlocksText(d.content)
    if (!text && src?.kind === 'retry') return null
    const fields: ExtractedField[] = []
    pushField(fields, 'text', text)
    if (fields.length === 0) return null
    const sourceKind = src?.kind === 'user' ? 'user' : 'context'
    return {
      rec: {
        seq,
        stableId: `user:${String(d.id ?? seq)}`,
        nodeKind: 'input-message',
        nodeId: String(d.id ?? seq),
        sourceKind,
        explicitTurn: turn,
        fields,
      },
    }
  }
  if (event.type === 'developer/message') {
    if (!isAppendSurface(event)) return null
    const msg = (d.message ?? {}) as { id?: unknown; content?: unknown }
    const fields: ExtractedField[] = []
    pushField(fields, 'text', extractBlocksText(msg.content))
    if (fields.length === 0) return null
    return {
      rec: {
        seq,
        stableId: `dev:${String(msg.id ?? seq)}`,
        nodeKind: 'developer-message',
        nodeId: String(msg.id ?? seq),
        sourceKind: 'context',
        explicitTurn: turn,
        fields,
      },
    }
  }
  if (event.type === 'assistant/message') {
    if (!isAppendSurface(event)) return null
    const msg = (d.message ?? {}) as { content?: unknown }
    const content = Array.isArray(msg.content) ? msg.content : []
    const fields: ExtractedField[] = []
    const fallbackTools: Array<{ callId: string; name: string; argsRaw: string }> = []
    content.forEach((b: unknown, idx: number) => {
      if (!b || typeof b !== 'object') return
      const block = b as { type?: unknown; text?: unknown; id?: unknown; name?: unknown; arguments?: unknown }
      if (block.type === 'reasoning') {
        pushField(fields, `reasoning:${idx}`, block.text, { groupPart: 'reasoning', sourceKind: 'reasoning' })
      } else if (block.type === 'text') {
        pushField(fields, `text:${idx}`, searchableReplyText(block, markdownExtractor), { groupPart: 'response', sourceKind: 'response' })
      } else if (block.type === 'tool-call' && block.id !== undefined) {
        fallbackTools.push({
          callId: String(block.id),
          name: typeof block.name === 'string' ? block.name : '',
          argsRaw: stringifyArgs(block.arguments),
        })
      }
    })
    return {
      rec: {
        seq,
        linkKind: 'assistant',
        stableId: `asst:${String(turn ?? '')}:${String(step ?? '')}`,
        nodeKind: 'assistant-step',
        nodeId: `${String(turn ?? '')}:${String(step ?? '')}`,
        sourceKind: 'response',
        explicitTurn: turn,
        explicitStep: step,
        fields,
        fallbackTools,
      },
    }
  }
  if (event.type === 'command/run' || event.type === 'command/done') {
    const cmdId = String(d.commandId ?? '')
    if (!cmdId) return null
    const fields: ExtractedField[] = []
    if (event.type === 'command/run') {
      if (typeof d.name === 'string' && d.name) {
        pushField(fields, 'cmd', d.args ? `${d.name} ${String(d.args)}` : d.name)
      }
    } else {
      pushField(fields, 'outcome', d.text)
    }
    return {
      rec: {
        seq,
        stableId: `${event.type}:${cmdId}:${seq}`,
        nodeKind: 'command',
        nodeId: cmdId,
        sourceKind: 'command',
        explicitTurn: turn,
        fields,
      },
    }
  }
  if (event.type === 'tool/call') {
    const cid = String(d.callId ?? '')
    if (!cid) return null
    const fields: ExtractedField[] = []
    pushField(fields, 'name', d.name)
    pushField(fields, 'args', stringifyArgs(d.arguments))
    return {
      rec: {
        seq,
        linkKind: 'tool-call',
        linkId: cid,
        stableId: `toolcall:${cid}`,
        nodeKind: 'tool-call',
        nodeId: cid,
        sourceKind: 'tool',
        explicitTurn: turn,
        explicitStep: step,
        fields,
      },
    }
  }
  if (event.type === 'tool/result') {
    if (!isAppendSurface(event)) return null
    const msg = d.message as { source?: { callId?: unknown }; content?: unknown } | undefined
    const cid = String(msg?.source?.callId ?? '')
    if (!cid) return null
    const fields: ExtractedField[] = []
    pushField(fields, 'result', extractBlocksText(msg?.content))
    pushField(fields, 'error', sanitizeFailure(d.error))
    return fields.length > 0
      ? { rec: { seq, stableId: `toolres:${cid}:${seq}`, nodeKind: 'tool-call', nodeId: cid, sourceKind: 'tool', explicitTurn: turn, fields } }
      : null
  }
  if (event.type === 'tool/ptc-dispatch-start' || event.type === 'tool/ptc-dispatch') {
    const subId = String(d.subCallId ?? '')
    const rootId = String(d.rootCallId ?? '')
    if (!subId || !rootId) return null
    return {
      rec: {
        seq,
        linkKind: event.type === 'tool/ptc-dispatch-start' ? 'ptc-start' : 'ptc-end',
        subCallId: subId,
        parentCallId: String(d.parentCallId ?? ''),
        rootCallId: rootId,
        nodeKind: 'tool-call',
        nodeId: rootId,
        sourceKind: 'tool',
        explicitTurn: turn,
        name: typeof d.name === 'string' ? d.name : '',
        argsRaw: stringifyArgs(d.arguments),
        resultText: extractBlocksText(d.content),
        errorText: sanitizeFailure(d.error),
      },
    }
  }
  if (event.type === 'todo/write' && Array.isArray(d.todos)) {
    const fields: ExtractedField[] = []
    d.todos.forEach((item: unknown, idx: number) => {
      const rec = item as { content?: unknown } | null
      pushField(fields, `todo:${idx}`, rec?.content)
    })
    return fields.length > 0
      ? { rec: { seq, stableId: `todo:${seq}`, nodeKind: null, nodeId: null, sourceKind: 'todo', explicitTurn: turn, fields } }
      : null
  }
  return null
}
export interface ExtractedPage {
  readonly minSeq: number | null
  readonly maxSeq: number | null
  readonly boundaries: BoundaryRecord[]
  readonly rawItems: RawEventRecord[]
  readonly byteSize: number
}
export function extractPageFromEvents(
  events: readonly Record<string, unknown>[],
  markdownExtractor?: ((markdown: string) => string) | undefined,
): ExtractedPage {
  const sorted = [...events]
    .filter(e => e && typeof e.seq === 'number' && Number.isSafeInteger(e.seq) && e.seq >= 0)
    .sort((a, b) => (a.seq as number) - (b.seq as number))
  const boundaries: BoundaryRecord[] = []
  const rawItems: RawEventRecord[] = []
  let minSeq = Infinity
  let maxSeq = -1
  let byteSize = 0
  for (const ev of sorted) {
    const seq = ev.seq as number
    if (seq < minSeq) minSeq = seq
    if (seq > maxSeq) maxSeq = seq
    const extracted = extractDurableEvent(ev, markdownExtractor)
    if (!extracted) continue
    if (extracted.boundary) boundaries.push(extracted.boundary)
    if (extracted.rec) {
      rawItems.push(extracted.rec)
      if (extracted.rec.fields) byteSize += eventBytes(extracted.rec.fields)
      if (extracted.rec.fallbackTools) {
        for (const ft of extracted.rec.fallbackTools) byteSize += (ft.name.length + ft.argsRaw.length) * 2
      }
      if (typeof extracted.rec.name === 'string') byteSize += extracted.rec.name.length * 2
      if (typeof extracted.rec.argsRaw === 'string') byteSize += extracted.rec.argsRaw.length * 2
      if (typeof extracted.rec.resultText === 'string') byteSize += extracted.rec.resultText.length * 2
      if (typeof extracted.rec.errorText === 'string') byteSize += extracted.rec.errorText.length * 2
    }
  }
  return {
    minSeq: minSeq === Infinity ? null : minSeq,
    maxSeq: maxSeq < 0 ? null : maxSeq,
    boundaries,
    rawItems,
    byteSize,
  }
}
interface TransientBlockState {
  readonly kind: string
  readonly text: string
  readonly seq: number
}
interface TransientStepState {
  readonly attemptId: unknown
  readonly turn: number | undefined
  readonly step: number | undefined
  seq: number
  readonly blocks: Map<number, TransientBlockState>
}
interface TransientToolState {
  readonly seq: number
  readonly turn: number | undefined
  readonly step: number | undefined
  readonly callId: string
  name: string
  argsRaw: string
}
export function reduceTransientChunks(transientEntries: readonly Record<string, unknown>[]) {
  const byStep = new Map<string, TransientStepState>()
  const byTool = new Map<string, TransientToolState>()
  for (const entry of transientEntries) {
    const ev = entry?.event as Record<string, unknown> | undefined
    if (entry?.type !== 'transient' || ev?.type !== 'assistant/live-chunk') continue
    const d = (ev.data ?? {}) as Record<string, unknown>
    const chunk = (d.chunk ?? {}) as Record<string, unknown>
    const seq = typeof ev.seq === 'number' ? ev.seq : 0
    const turn = typeof d.turn === 'number' ? d.turn : undefined
    const step = typeof d.step === 'number' ? d.step : undefined
    const stepKey = `${String(d.attemptId ?? '')}:${String(turn ?? '')}:${String(step ?? '')}`
    let stepState = byStep.get(stepKey)
    if (!stepState) {
      stepState = { attemptId: d.attemptId, turn, step, seq, blocks: new Map() }
      byStep.set(stepKey, stepState)
    }
    stepState.seq = seq
    const idx = typeof chunk.index === 'number' ? chunk.index : 0
    if (chunk.type === 'block-start') {
      if (!stepState.blocks.has(idx)) {
        stepState.blocks.set(idx, { kind: String(chunk.blockType ?? 'text'), text: '', seq })
      }
    } else if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      const kind = chunk.type === 'reasoning-delta' ? 'reasoning' : 'text'
      const prev = stepState.blocks.get(idx) ?? { kind, text: '', seq }
      stepState.blocks.set(idx, { kind, text: prev.text + String(chunk.text ?? ''), seq: prev.seq })
    } else if (chunk.type === 'block-end' && chunk.block && typeof chunk.block === 'object') {
      const b = chunk.block as { type?: unknown; text?: unknown; id?: unknown; name?: unknown; arguments?: unknown }
      if (b.type === 'text' || b.type === 'reasoning') {
        stepState.blocks.set(idx, { kind: b.type, text: String(b.text ?? ''), seq })
      } else if (b.type === 'tool-call' && b.id !== undefined) {
        const cid = String(b.id)
        byTool.set(cid, {
          seq,
          turn,
          step,
          callId: cid,
          name: typeof b.name === 'string' ? b.name : '',
          argsRaw: stringifyArgs(blockArgs(b.arguments)),
        })
      }
    } else if (chunk.type === 'tool-call-delta' && chunk.id !== undefined) {
      const cid = String(chunk.id)
      const prev = byTool.get(cid) ?? { seq, turn, step, callId: cid, name: '', argsRaw: '' }
      if (typeof chunk.name === 'string' && chunk.name) prev.name = chunk.name
      if (typeof chunk.argumentsDelta === 'string') prev.argsRaw += chunk.argumentsDelta
      byTool.set(cid, prev)
    }
  }
  return { byStep, byTool }
}
function blockArgs(value: unknown): unknown {
  return value
}
export interface BoundaryIndex {
  readonly turnStartSeqs: Map<number, number>
  readonly spans: readonly { seq: number; turn: number | undefined }[]
}
export function foldBoundaries(boundaries: readonly BoundaryRecord[]): BoundaryIndex {
  const sorted = [...boundaries].sort((a, b) => a.seq - b.seq)
  const turnStartSeqs = new Map<number, number>()
  const spans: Array<{ seq: number; turn: number | undefined }> = []
  let activeTurn: number | undefined
  for (const b of sorted) {
    if (b.kind === 'turn/start' && typeof b.turn === 'number' && Number.isSafeInteger(b.turn)) {
      if (!turnStartSeqs.has(b.turn)) turnStartSeqs.set(b.turn, b.seq)
      activeTurn = b.turn
      spans.push({ seq: b.seq, turn: activeTurn })
    } else if (b.kind === 'turn/end' && typeof b.turn === 'number' && Number.isSafeInteger(b.turn)) {
      if (activeTurn === b.turn) activeTurn = undefined
      spans.push({ seq: b.seq, turn: activeTurn })
    }
  }
  return { turnStartSeqs, spans }
}
export function resolveTurnAt(
  seq: number,
  explicitTurn: number | null | undefined,
  spans: readonly { seq: number; turn: number | undefined }[],
  turnStartSeqs: ReadonlyMap<number, number>,
): { turn: number | undefined; turnStartSeq: number | undefined; pendingTurn: boolean } {
  if (explicitTurn === null) return { turn: undefined, turnStartSeq: undefined, pendingTurn: false }
  if (typeof explicitTurn === 'number' && Number.isSafeInteger(explicitTurn) && explicitTurn >= 0) {
    const start = turnStartSeqs.get(explicitTurn)
    return { turn: explicitTurn, turnStartSeq: start, pendingTurn: start === undefined }
  }
  let lo = 0
  let hi = spans.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (spans[mid]!.seq <= seq) lo = mid + 1
    else hi = mid
  }
  const turn = lo > 0 ? spans[lo - 1]?.turn : undefined
  const start = turn !== undefined ? turnStartSeqs.get(turn) : undefined
  return { turn, turnStartSeq: start, pendingTurn: turn === undefined || start === undefined }
}
export interface SearchableItem {
  readonly seq: number
  readonly durable: boolean
  readonly stableKey: string
  readonly nodeKey: string | null
  readonly sourceKind: string
  readonly parentCallId?: string | undefined
  readonly subCallId?: string | undefined
  readonly turn?: number | undefined
  readonly turnStartSeq?: number | undefined
  readonly pendingTurn: boolean
  readonly fields: readonly ExtractedField[]
}
export function assembleSearchableItems(
  boundaries: readonly BoundaryRecord[],
  rawItems: readonly RawEventRecord[],
  transientEntries: readonly Record<string, unknown>[],
  index: BoundaryIndex = foldBoundaries(boundaries),
  markdownExtractor?: ((markdown: string) => string) | undefined,
): SearchableItem[] {
  const { turnStartSeqs, spans } = index
  const seenToolCalls = new Set<string>()
  const seenPtcCalls = new Set<string>()
  const compactionTexts = new Map<string, string>()
  const settledSteps = new Set<string>()
  for (const rec of rawItems) {
    if (rec.linkKind === 'tool-call' && rec.linkId) seenToolCalls.add(rec.linkId)
    if (rec.linkKind === 'assistant') settledSteps.add(`${String(rec.explicitTurn ?? '')}:${String(rec.explicitStep ?? '')}`)
    if (rec.linkKind === 'compact-summary' && rec.compactionId && rec.fields?.[0]?.text) {
      compactionTexts.set(rec.compactionId, rec.fields[0].text)
    }
  }
  const items: SearchableItem[] = []
  const sortedRaw = [...rawItems].sort((a, b) => a.seq - b.seq)
  for (const rec of sortedRaw) {
    const coord = resolveTurnAt(rec.seq, rec.explicitTurn, spans, turnStartSeqs)
    const nodeKey = rec.nodeKind && rec.nodeId ? conversationContextKey(rec.nodeKind, rec.nodeId) : null
    if ((rec.linkKind === 'ptc-start' || rec.linkKind === 'ptc-end') && rec.subCallId) {
      const fields: ExtractedField[] = []
      const already = seenPtcCalls.has(rec.subCallId)
      seenPtcCalls.add(rec.subCallId)
      if (!already) {
        pushField(fields, `ptc:${rec.subCallId}:name`, rec.name)
        pushField(fields, `ptc:${rec.subCallId}:args`, rec.argsRaw)
      }
      if (rec.linkKind === 'ptc-end') {
        pushField(fields, `ptc:${rec.subCallId}:res`, rec.resultText)
        pushField(fields, `ptc:${rec.subCallId}:err`, rec.errorText)
      }
      if (fields.length > 0) {
        items.push({
          seq: rec.seq,
          durable: true,
          stableKey: `ptc:${rec.subCallId}:${rec.seq}`,
          nodeKey,
          sourceKind: 'tool',
          parentCallId: rec.parentCallId,
          subCallId: rec.subCallId,
          ...coord,
          fields,
        })
      }
      continue
    }
    if (rec.linkKind === 'compact-checkpoint' && rec.compactionId) {
      const sumText = compactionTexts.get(rec.compactionId)
      const cpText = rec.fields?.[0]?.text
      if (!cpText || (sumText && (cpText === sumText || sumText.includes(cpText)))) continue
    }
    const fields = [...(rec.fields ?? [])]
    if (rec.linkKind === 'assistant' && rec.fallbackTools) {
      for (const ft of rec.fallbackTools) {
        if (!seenToolCalls.has(ft.callId)) {
          pushField(fields, `ftool:${ft.callId}:name`, ft.name, {
            sourceKind: 'tool',
            overrideNodeKey: conversationContextKey('tool-call', ft.callId),
          })
          pushField(fields, `ftool:${ft.callId}:args`, ft.argsRaw, {
            sourceKind: 'tool',
            overrideNodeKey: conversationContextKey('tool-call', ft.callId),
          })
        }
      }
    }
    if (fields.length > 0) {
      items.push({
        seq: rec.seq,
        durable: true,
        stableKey: rec.stableId ?? `${rec.linkKind ?? 'ev'}:${rec.compactionId ?? rec.nodeId ?? rec.seq}`,
        nodeKey,
        sourceKind: rec.sourceKind,
        ...coord,
        fields,
      })
    }
  }
  const { byStep, byTool } = reduceTransientChunks(transientEntries)
  for (const st of byStep.values()) {
    if (settledSteps.has(`${String(st.turn ?? '')}:${String(st.step ?? '')}`)) continue
    const fields: ExtractedField[] = []
    const indices = [...st.blocks.keys()].sort((a, b) => a - b)
    for (const idx of indices) {
      const b = st.blocks.get(idx)
      if (b && (b.kind === 'reasoning' || b.kind === 'text') && b.text) {
        const rendered = b.kind === 'text' ? searchableReplyText(b, markdownExtractor) : b.text
        pushField(fields, `${b.kind}:${idx}`, rendered, {
          groupPart: b.kind === 'reasoning' ? 'reasoning' : 'response',
          sourceKind: b.kind === 'reasoning' ? 'reasoning' : 'response',
        })
      }
    }
    if (fields.length > 0) {
      const tStart = st.turn !== undefined ? turnStartSeqs.get(st.turn) : undefined
      items.push({
        seq: st.seq,
        durable: false,
        stableKey: `asst:${String(st.turn ?? '')}:${String(st.step ?? '')}`,
        nodeKey: conversationContextKey('assistant-step', `${String(st.turn ?? '')}:${String(st.step ?? '')}`),
        sourceKind: 'response',
        turn: st.turn,
        turnStartSeq: tStart,
        pendingTurn: tStart === undefined,
        fields,
      })
    }
  }
  for (const tc of byTool.values()) {
    if (seenToolCalls.has(tc.callId)) continue
    const fields: ExtractedField[] = []
    pushField(fields, 'name', tc.name)
    pushField(fields, 'args', tc.argsRaw)
    if (fields.length > 0) {
      const tStart = tc.turn !== undefined ? turnStartSeqs.get(tc.turn) : undefined
      items.push({
        seq: tc.seq,
        durable: false,
        stableKey: `toolcall:${tc.callId}`,
        nodeKey: conversationContextKey('tool-call', tc.callId),
        sourceKind: 'tool',
        turn: tc.turn,
        turnStartSeq: tStart,
        pendingTurn: tStart === undefined,
        fields,
      })
    }
  }
  return items.sort((a, b) => a.seq - b.seq)
}
function escapeRegExp(str: string): string {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
export function compileLiteralRegex(query: string, caseSensitive: boolean): RegExp | null {
  if (typeof query !== 'string' || query.length === 0) return null
  return new RegExp(escapeRegExp(query), caseSensitive ? 'gu' : 'giu')
}
export function buildExcerpt(text: string, offset: number, length: number): HitExcerpt {
  const ctxChars = 48
  const start = Math.max(0, offset - ctxChars)
  const end = Math.min(text.length, offset + length + ctxChars)
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, offset),
    match: text.slice(offset, offset + length),
    after: text.slice(offset + length, end) + (end < text.length ? '…' : ''),
    leftContext: text.slice(Math.max(0, offset - 20), offset),
    rightContext: text.slice(offset + length, Math.min(text.length, offset + length + 20)),
    relStart: offset - start,
  }
}
export function matchItems(
  items: readonly SearchableItem[],
  query: string,
  caseSensitive: boolean,
  options: {
    readonly includeExcerpts?: boolean | undefined
    readonly keepText?: boolean | undefined
    readonly excerptKey?: string | undefined
    readonly sourceKinds?: ReadonlySet<string> | null | undefined
  } = {},
): SearchHit[] {
  const includeExcerpts = options.includeExcerpts ?? true
  const rx = compileLiteralRegex(query, caseSensitive)
  if (!rx) return []
  const hits: SearchHit[] = []
  const blockCounts = new Map<string, number>()
  for (const item of items) {
    const baseNodeKey = item.nodeKey
    for (let fi = 0; fi < item.fields.length; fi++) {
      const field = item.fields[fi]
      if (!field || !field.text) continue
      const srcKind = field.sourceKind ?? item.sourceKind ?? 'response'
      if (options.sourceKinds && !options.sourceKinds.has(srcKind)) continue
      const nodeKey = field.overrideNodeKey ?? baseNodeKey
      const groupPart = field.groupPart ?? null
      const blockSig = nodeKey ? `${nodeKey}|${groupPart ?? ''}` : null
      rx.lastIndex = 0
      let m: RegExpExecArray | null
      let fieldOrdinal = 0
      while ((m = rx.exec(field.text)) !== null) {
        if (m[0].length === 0) {
          rx.lastIndex++
          continue
        }
        const blockOrdinal = blockSig ? (blockCounts.get(blockSig) ?? 0) : 0
        if (blockSig) blockCounts.set(blockSig, blockOrdinal + 1)
        const hitKey = `${item.stableKey}|${field.fieldKey}|${fieldOrdinal}`
        hits.push({
          hitKey,
          seq: item.seq,
          durable: item.durable,
          turn: item.turn,
          turnStartSeq: item.turnStartSeq,
          pendingTurn: item.pendingTurn,
          nodeKey,
          groupPart,
          sourceKind: srcKind,
          subCallId: item.subCallId ?? null,
          parentCallId: item.parentCallId ?? null,
          fieldKey: field.fieldKey,
          fieldOrder: fi,
          offset: m.index,
          length: m[0].length,
          fieldOrdinal,
          blockOrdinal,
          matchText: m[0],
          fieldText: options.keepText ? field.text : undefined,
          excerpt: includeExcerpts || options.excerptKey === hitKey
            ? buildExcerpt(field.text, m.index, m[0].length)
            : null,
        })
        fieldOrdinal++
      }
    }
  }
  return hits
}
export interface CachedHistoryPage {
  readonly pageKey: string
  readonly reqThroughSeq: number | undefined
  readonly reqBeforeSeq: number | undefined
  readonly minSeq: number
  readonly maxSeq: number
  boundaries: BoundaryRecord[]
  extracted: ExtractedPage | null
  compactHits: SearchHit[]
  compactHitsValidForQuery: boolean
  evicted: boolean
  lruTick: number
}
export function createHistoryCache(maxBytes = MAX_HISTORY_CACHE_BYTES) {
  let tick = 0
  let compactEvaluator: ((page: CachedHistoryPage & { extracted: ExtractedPage }) => SearchHit[]) | null = null
  const pages = new Map<string, CachedHistoryPage>()
  const hitExcerpts = new Map<string, HitExcerpt>()
  const totalCachedBytes = (): number => {
    let sum = 0
    for (const p of pages.values()) {
      if (p.extracted) sum += p.extracted.byteSize
    }
    return sum
  }
  const evictIfNeeded = (): void => {
    let sum = totalCachedBytes()
    if (sum <= maxBytes) return
    const lru = [...pages.values()]
      .filter((p): p is CachedHistoryPage & { extracted: ExtractedPage } => p.extracted !== null)
      .sort((a, b) => a.lruTick - b.lruTick)
    for (const p of lru) {
      if (sum <= maxBytes) break
      if (!p.compactHitsValidForQuery && compactEvaluator) {
        p.compactHits = compactEvaluator(p).map(h => ({ ...h, pageKey: p.pageKey, excerpt: null }))
        p.compactHitsValidForQuery = true
      }
      sum -= p.extracted.byteSize
      // The filter narrowed extracted to non-null for the byte accounting
      // above; resetting it needs the un-narrowed record type.
      ;(p as CachedHistoryPage).extracted = null
      p.evicted = true
    }
  }
  const putPage = (entry: {
    minSeq: number
    maxSeq: number
    reqThroughSeq: number | undefined
    reqBeforeSeq: number | undefined
    extracted: ExtractedPage
    compactHits?: readonly SearchHit[] | undefined
    compactHitsValidForQuery?: boolean | undefined
  }): CachedHistoryPage => {
    tick++
    const pageKey = `${entry.minSeq}..${entry.maxSeq}`
    const rec: CachedHistoryPage = {
      pageKey,
      reqThroughSeq: entry.reqThroughSeq,
      reqBeforeSeq: entry.reqBeforeSeq,
      minSeq: entry.minSeq,
      maxSeq: entry.maxSeq,
      boundaries: entry.extracted.boundaries,
      extracted: entry.extracted,
      compactHits: (entry.compactHits ?? []).map(h => ({ ...h, pageKey, excerpt: null })),
      compactHitsValidForQuery: Boolean(entry.compactHitsValidForQuery),
      evicted: false,
      lruTick: tick,
    }
    pages.set(pageKey, rec)
    evictIfNeeded()
    return rec
  }
  return {
    get pages() {
      return pages
    },
    get hitExcerpts() {
      return hitExcerpts
    },
    totalCachedBytes,
    setCompactEvaluator(fn: (page: CachedHistoryPage & { extracted: ExtractedPage }) => SearchHit[]) {
      compactEvaluator = fn
    },
    putPage,
    touch(pageKey: string) {
      const p = pages.get(pageKey)
      if (p) p.lruTick = ++tick
    },
    setPageHits(pageKey: string, nextHits: readonly SearchHit[]) {
      const p = pages.get(pageKey)
      if (!p) return
      p.compactHits = nextHits.map(h => ({ ...h, pageKey, excerpt: null }))
      p.compactHitsValidForQuery = true
    },
    pruneExcerpts(keepKeys: ReadonlySet<string>) {
      for (const k of hitExcerpts.keys()) {
        if (!keepKeys.has(k)) hitExcerpts.delete(k)
      }
    },
    clear() {
      pages.clear()
      hitExcerpts.clear()
    },
  }
}
export function resolveSessionAddress(
  sessionsSvc: { subagentAddress?(id: string): Record<string, unknown> | undefined } | null | undefined,
  binding: { session?: { getSnapshot?(): { subagent?: { address?: Record<string, unknown> | undefined } | undefined } | undefined } | undefined } | null | undefined,
  sessionId: string | null,
): Record<string, unknown> {
  const snapSub = binding?.session?.getSnapshot?.()?.subagent?.address
  if (snapSub && typeof snapSub === 'object') return { ...snapSub, kind: 'subagent' }
  const catalogSub = sessionId && typeof sessionsSvc?.subagentAddress === 'function'
    ? sessionsSvc.subagentAddress(sessionId)
    : undefined
  if (catalogSub && typeof catalogSub === 'object') return { ...catalogSub, kind: 'subagent' }
  return { kind: 'session', sessionId }
}
export function durableSeqBounds(entries: readonly Record<string, unknown>[]) {
  let minSeq = Infinity
  let maxSeq = -1
  const events: Record<string, unknown>[] = []
  const transients: Record<string, unknown>[] = []
  for (const entry of entries) {
    if (!entry || !entry.event || typeof entry.event !== 'object') continue
    if (entry.type === 'transient') {
      transients.push(entry)
      continue
    }
    const ev = entry.event as Record<string, unknown>
    if (entry.type === 'event' && typeof ev.seq === 'number' && Number.isSafeInteger(ev.seq) && ev.seq >= 0) {
      events.push(ev)
      if (ev.seq < minSeq) minSeq = ev.seq
      if (ev.seq > maxSeq) maxSeq = ev.seq
    }
  }
  return {
    minSeq: minSeq === Infinity ? null : minSeq,
    maxSeq: maxSeq < 0 ? null : maxSeq,
    events,
    transients,
  }
}
export interface RemoteSessionServiceLike {
  events?(request: Record<string, unknown>, signal?: AbortSignal | undefined): Promise<unknown>
  page?(request: Record<string, unknown>, signal?: AbortSignal | undefined): Promise<unknown>
}
function callSessionPageRpc(remoteSession: RemoteSessionServiceLike | null, request: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  if (typeof remoteSession?.events === 'function') return remoteSession.events(request, signal)
  if (typeof remoteSession?.page === 'function') return remoteSession.page(request, signal)
  return Promise.reject(new Error('remote.session page method unavailable'))
}
export function validatePageResult(
  res: unknown,
  expectedThroughSeq: number | undefined,
  expectedBeforeSeq: number | undefined,
):
  | { ok: true; cursor: number; events: Record<string, unknown>[]; minSeq: number | null; maxSeq: number | null; hasMore: boolean }
  | { ok: false; reason: string; error?: string | undefined } {
  if (!res || typeof res !== 'object') return { ok: false, reason: 'invalid-response' }
  const env = res as { ok?: unknown; value?: unknown; error?: { message?: unknown } | undefined }
  if (env.ok !== true || !env.value || typeof env.value !== 'object') {
    const errMsg = typeof env.error?.message === 'string' ? env.error.message : undefined
    return { ok: false, reason: 'invalid-response', error: errMsg }
  }
  const val = env.value as { cursor?: unknown; records?: unknown; hasMore?: unknown }
  if (!Array.isArray(val.records) || typeof val.hasMore !== 'boolean') {
    return { ok: false, reason: 'invalid-response' }
  }
  const { cursor, records, hasMore } = val
  if (typeof cursor !== 'number' || !Number.isSafeInteger(cursor) || cursor < -1) {
    return { ok: false, reason: 'invalid-cursor' }
  }
  if (expectedThroughSeq !== undefined && cursor !== expectedThroughSeq) {
    return { ok: false, reason: 'cursor-mismatch' }
  }
  if (records.length === 0) {
    if (hasMore || (expectedBeforeSeq === undefined && cursor >= 0)) return { ok: false, reason: 'empty-page-gap' }
    if (expectedBeforeSeq !== undefined && expectedBeforeSeq > 0) return { ok: false, reason: 'gap-before-zero' }
    return { ok: true, cursor, events: [], minSeq: null, maxSeq: null, hasMore: false }
  }
  const events: Record<string, unknown>[] = []
  let prev = -1
  for (const rec of records) {
    const ev = (rec as { event?: Record<string, unknown> } | null)?.event
    const seq = ev?.seq
    if (!ev || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0 || seq > cursor) {
      return { ok: false, reason: 'invalid-seq' }
    }
    if (prev >= 0 && seq !== prev + 1) return { ok: false, reason: 'non-contiguous-page' }
    prev = seq
    events.push(ev)
  }
  const minSeq = events[0]!.seq as number
  const maxSeq = events[events.length - 1]!.seq as number
  if (expectedBeforeSeq !== undefined) {
    if (minSeq >= expectedBeforeSeq) return { ok: false, reason: 'no-progress' }
    if (maxSeq !== expectedBeforeSeq - 1) return { ok: false, reason: 'gap-at-upper-bound' }
  }
  if (expectedBeforeSeq === undefined && maxSeq !== cursor) return { ok: false, reason: 'gap-at-cut' }
  if (!hasMore && minSeq > 0) return { ok: false, reason: 'stopped-before-zero' }
  return { ok: true, cursor, events, minSeq, maxSeq, hasMore }
}
const yieldThread = () => new Promise<void>(resolve => setTimeout(resolve, 0))
export function computeCombinedMatches(
  cache: ReturnType<typeof createHistoryCache>,
  liveEntries: readonly Record<string, unknown>[],
  query: string,
  caseSensitive: boolean,
  sourceKinds: ReadonlySet<string> | null = null,
  markdownExtractor?: ((markdown: string) => string) | undefined,
) {
  if (!query) return { hits: [] as SearchHit[], evictedPending: false }
  const { minSeq: liveMin, events: liveEvents, transients } = durableSeqBounds(liveEntries)
  const allBoundaries: BoundaryRecord[] = []
  const liveExtracted = extractPageFromEvents(liveEvents, markdownExtractor)
  for (const b of liveExtracted.boundaries) allBoundaries.push(b)
  const activeRaw: RawEventRecord[] = []
  const evictedHits: SearchHit[] = []
  let evictedPending = false
  const sortedPages = [...cache.pages.values()].sort((a, b) => a.minSeq - b.minSeq)
  for (const p of sortedPages) {
    for (const b of p.boundaries) allBoundaries.push(b)
    if (liveMin !== null && p.minSeq >= liveMin) continue
    if (p.extracted) {
      for (const rec of p.extracted.rawItems) {
        if (liveMin === null || rec.seq < liveMin) activeRaw.push(rec)
      }
    } else if (p.evicted) {
      if (p.compactHitsValidForQuery) {
        for (const h of p.compactHits) {
          if (liveMin === null || h.seq < liveMin) evictedHits.push(h)
        }
      } else {
        evictedPending = true
      }
    }
  }
  for (const rec of liveExtracted.rawItems) activeRaw.push(rec)
  const index = foldBoundaries(allBoundaries)
  const items = assembleSearchableItems(allBoundaries, activeRaw, transients, index, markdownExtractor)
  const { turnStartSeqs, spans } = index
  const freshHits = matchItems(items, query, caseSensitive, { includeExcerpts: false, keepText: true, sourceKinds })
  for (const h of evictedHits) {
    const coord = resolveTurnAt(h.seq, h.turn, spans, turnStartSeqs)
    h.turn = coord.turn ?? h.turn
    h.turnStartSeq = coord.turnStartSeq ?? h.turnStartSeq
    h.pendingTurn = coord.pendingTurn
  }
  const merged = [...evictedHits, ...freshHits].sort(
    (a, b) => a.seq - b.seq || a.fieldOrder - b.fieldOrder || a.offset - b.offset,
  )
  return { hits: merged, evictedPending }
}
function isExcludedTextAncestor(node: Node, rootEl: Element, excludedGroupParts: ReadonlySet<string> | null = null): boolean {
  let cur = node.parentElement
  while (cur && cur !== rootEl) {
    const tag = cur.tagName
    if (
      tag === 'BUTTON' &&
      !cur.hasAttribute('data-ref-chip') &&
      !/(?:^|\s)_?(?:fileLink|fileMention)(?:_|\s|$)/.test(cur.className)
    ) {
      return true
    }
    if (tag === 'svg' || tag === 'SVG' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return true
    if (cur.hasAttribute('hidden') || cur.getAttribute('aria-hidden') === 'true') return true
    if (cur.hasAttribute('data-text-interaction-surface') || cur.hasAttribute('data-chat-node-key')) return true
    if (excludedGroupParts && excludedGroupParts.size > 0) {
      const gp = cur.getAttribute('data-chat-group-part')
      if (gp && excludedGroupParts.has(gp)) return true
    }
    cur = cur.parentElement
  }
  return false
}
export function collectBlockTextSegments(
  rootEl: Element | null,
  excludedGroupParts: ReadonlySet<string> | null = null,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
): { text: string; segments: Array<{ node: Text; start: number; end: number }> } {
  if (!rootEl || !doc || typeof doc.createTreeWalker !== 'function') {
    return { text: '', segments: [] }
  }
  if (excludedGroupParts && excludedGroupParts.size > 0) {
    const rootPart = rootEl.getAttribute('data-chat-group-part')
    if (rootPart && excludedGroupParts.has(rootPart)) return { text: '', segments: [] }
  }
  const walker = doc.createTreeWalker(rootEl, 4, {
    acceptNode: (n: Node) => (isExcludedTextAncestor(n, rootEl, excludedGroupParts) ? 2 : 1),
  })
  const segments: Array<{ node: Text; start: number; end: number }> = []
  let joined = ''
  let n: Node | null
  while ((n = walker.nextNode())) {
    const val = n.nodeValue ?? ''
    if (!val) continue
    const start = joined.length
    joined += val
    segments.push({ node: n as Text, start, end: joined.length })
  }
  return { text: joined, segments }
}
function rangeFromDomOffsets(
  segments: ReadonlyArray<{ node: Text; start: number; end: number }>,
  start: number,
  end: number,
  firstSegment: number,
  doc: Document | undefined,
): Range | null {
  if (segments.length === 0 || !doc || typeof doc.createRange !== 'function') return null
  let startNode: Text | null = null
  let startOff = 0
  let endNode: Text | null = null
  let endOff = 0
  for (let i = firstSegment; i < segments.length; i++) {
    const seg = segments[i]!
    if (!startNode && start >= seg.start && start < seg.end) {
      startNode = seg.node
      startOff = start - seg.start
    }
    if (end > seg.start && end <= seg.end) {
      endNode = seg.node
      endOff = end - seg.start
      break
    }
  }
  if (!startNode || !endNode) return null
  try {
    const range = doc.createRange()
    range.setStart(startNode, startOff)
    range.setEnd(endNode, endOff)
    return range
  } catch {
    return null
  }
}
export function matchRangesInBlock(
  rootEl: Element,
  query: string,
  caseSensitive: boolean,
  excludedGroupParts: ReadonlySet<string> | null = null,
  limit = Infinity,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
): Array<{ range: Range; domOffset: number; domLength: number; domText: string }> {
  const rx = compileLiteralRegex(query, caseSensitive)
  if (!rx) return []
  const { text, segments } = collectBlockTextSegments(rootEl, excludedGroupParts, doc)
  if (!text) return []
  const out: Array<{ range: Range; domOffset: number; domLength: number; domText: string }> = []
  let segmentIndex = 0
  let m: RegExpExecArray | null
  while (out.length < limit && (m = rx.exec(text)) !== null) {
    if (m[0].length === 0) {
      rx.lastIndex++
      continue
    }
    while (segmentIndex < segments.length && segments[segmentIndex]!.end <= m.index) segmentIndex++
    const range = rangeFromDomOffsets(segments, m.index, m.index + m[0].length, segmentIndex, doc)
    if (range && range.toString() === m[0]) {
      out.push({ range, domOffset: m.index, domLength: m[0].length, domText: text })
    }
  }
  return out
}
export function pickVerifiedHitRange(
  rootEl: Element,
  hit: Pick<SearchHit, 'blockOrdinal'> & { excerpt?: HitExcerpt | null | undefined },
  query: string,
  caseSensitive: boolean,
  blockHitTotal: number,
  excludedGroupParts: ReadonlySet<string> | null = null,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
): Range | null {
  const rx = compileLiteralRegex(query, caseSensitive)
  if (!rx) return null
  const { text, segments } = collectBlockTextSegments(rootEl, excludedGroupParts, doc)
  const left = (hit.excerpt?.leftContext ?? '').trim().slice(-8)
  const right = (hit.excerpt?.rightContext ?? '').trim().slice(0, 8)
  let count = 0
  let bestScore = -1
  let bestOffset = -1
  let ties = 0
  let ordinalScore = -1
  let ordinalOffset = -1
  for (const match of text.matchAll(rx)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    let score = 0
    if (left && text.slice(Math.max(0, start - 16), start).trim().endsWith(left)) score++
    if (right && text.slice(end, end + 16).trim().startsWith(right)) score++
    if (score > bestScore) {
      bestScore = score
      bestOffset = start
      ties = 1
    } else if (score === bestScore) {
      ties++
    }
    if (count === hit.blockOrdinal) {
      ordinalScore = score
      ordinalOffset = start
    }
    count++
  }
  let offset = -1
  if (count === blockHitTotal && ordinalScore === bestScore) offset = ordinalOffset
  else if (bestScore > 0 && ties === 1) offset = bestOffset
  if (offset < 0) return null
  rx.lastIndex = offset
  const matched = rx.exec(text)
  if (!matched || matched.index !== offset) return null
  const range = rangeFromDomOffsets(segments, offset, offset + matched[0].length, 0, doc)
  return range?.toString() === matched[0] ? range : null
}
export function resolveMainConversationRoot(doc: Document | undefined, sessionId: string | null): { root: HTMLElement; flow: HTMLElement } | null {
  if (!doc || !sessionId) return null
  const candidates = doc.querySelectorAll('[data-conversation-session]')
  for (const el of candidates) {
    const htmlEl = el as HTMLElement
    if (htmlEl.dataset?.conversationSession !== sessionId) continue
    if (/embeddedBody/i.test(String(htmlEl.className || ''))) continue
    if (htmlEl.closest('[inert], [role="dialog"], [aria-modal="true"], [data-rightbar-col], [data-global-panel], [aria-hidden="true"]')) continue
    if (htmlEl.parentElement?.closest('[data-conversation-session]')) continue
    const flow = htmlEl.querySelector('[data-chat-flow]') as HTMLElement | null
    if (!flow || flow.closest('[hidden]')) continue
    return { root: htmlEl, flow }
  }
  return null
}
function findTargetNodeElements(flow: HTMLElement | null, hit: Pick<SearchHit, 'nodeKey' | 'groupPart'>): HTMLElement[] {
  if (!flow || !hit.nodeKey) return []
  const all: HTMLElement[] = []
  for (const el of flow.querySelectorAll('[data-chat-node-key]')) {
    const htmlEl = el as HTMLElement
    if (htmlEl.dataset?.chatNodeKey === hit.nodeKey) all.push(htmlEl)
  }
  if (all.length > 0 && hit.groupPart) {
    const byPart: HTMLElement[] = []
    for (const el of all) {
      if (el.dataset?.chatGroupPart === hit.groupPart) byPart.push(el)
      else {
        for (const sub of el.querySelectorAll('[data-chat-group-part]')) {
          const subEl = sub as HTMLElement
          if (subEl.dataset?.chatGroupPart === hit.groupPart) byPart.push(subEl)
        }
      }
    }
    if (byPart.length > 0) return byPart
  }
  return all
}
function findTurnAnchor(flow: HTMLElement | null, turn: number | undefined): HTMLElement | null {
  if (!flow || typeof turn !== 'number' || !Number.isSafeInteger(turn)) return null
  for (const el of flow.querySelectorAll('[data-chat-turn]')) {
    const htmlEl = el as HTMLElement
    if (htmlEl.dataset?.chatTurn === String(turn) && !htmlEl.closest('[hidden]')) return htmlEl
  }
  return null
}
function waitDomCommit(
  observeRoot: Element | null,
  isStale: () => boolean,
  timeoutMs = 240,
  untilFn: (() => boolean) | null = null,
): Promise<boolean> {
  return new Promise(resolve => {
    if (isStale()) return resolve(false)
    if (untilFn && untilFn()) return resolve(true)
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let obs: MutationObserver | null = null
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      if (timer !== null) clearTimeout(timer)
      try { obs?.disconnect() } catch {}
      resolve(ok)
    }
    if (typeof MutationObserver === 'function' && observeRoot) {
      obs = new MutationObserver(() => {
        if (isStale()) return finish(false)
        if (untilFn && !untilFn()) return
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => finish(true))
        else finish(true)
      })
      try {
        obs.observe(observeRoot, { attributes: true, attributeFilter: ['hidden', 'aria-expanded'], childList: true, subtree: true })
      } catch {}
    }
    timer = setTimeout(() => finish(!isStale()), timeoutMs)
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (isStale()) finish(false)
        else if (untilFn && untilFn()) finish(true)
      })
    }
  })
}
async function revealHiddenAncestors(
  flow: HTMLElement,
  targetEl: HTMLElement,
  hit: SearchHit,
  query: string,
  caseSensitive: boolean,
  blockHitTotal: number,
  isStale: () => boolean,
  excludedGroupParts: ReadonlySet<string> | null,
  doc: Document | undefined,
): Promise<HTMLElement | null> {
  if (!targetEl.closest('[hidden]') && pickVerifiedHitRange(targetEl, hit, query, caseSensitive, blockHitTotal, excludedGroupParts, doc)) {
    return targetEl
  }
  const currentTarget = () => (flow.contains(targetEl) ? targetEl : findTargetNodeElements(flow, hit)[0] ?? null)
  const hiddenChain: HTMLElement[] = []
  let cur: HTMLElement | null = targetEl
  while (cur && cur !== flow) {
    if (cur.getAttribute('hidden') === 'until-found' || cur.hasAttribute('hidden')) hiddenChain.push(cur)
    cur = cur.parentElement
  }
  if (hiddenChain.length > 0) {
    hiddenChain.reverse()
    for (const anc of hiddenChain) {
      if (isStale()) return null
      try { anc.dispatchEvent(new Event('beforematch', { bubbles: false })) } catch {}
    }
    await waitDomCommit(flow, isStale, 900, () => hiddenChain.every(anc => !anc.hasAttribute('hidden')))
    if (isStale()) return null
  }
  let primary = currentTarget()
  const innerHidden = [...(primary?.querySelectorAll('[hidden="until-found"]') ?? [])]
  if (innerHidden.length > 0) {
    for (const h of innerHidden) {
      try { h.dispatchEvent(new Event('beforematch', { bubbles: false })) } catch {}
    }
    await waitDomCommit(primary, isStale, 600, () => innerHidden.every(h => !h.hasAttribute('hidden')))
    if (isStale()) return null
    primary = currentTarget() ?? primary
  }
  if (hit.nodeKey && primary && !pickVerifiedHitRange(primary, hit, query, caseSensitive, blockHitTotal, excludedGroupParts, doc)) {
    const toggles = [...primary.querySelectorAll('[aria-expanded="false"]')].filter((btn): btn is HTMLElement => {
      if (btn.closest('[data-chat-node-key]') !== primary) return false
      if (btn.hasAttribute('aria-haspopup')) return false
      return btn.matches('button, [role="button"], [data-expandable]')
    })
    for (const toggleBtn of toggles) {
      if (isStale()) return null
      try { toggleBtn.click() } catch {}
      await waitDomCommit(
        primary,
        isStale,
        450,
        () => !primary!.contains(toggleBtn) || toggleBtn.getAttribute('aria-expanded') !== 'false',
      )
      if (isStale()) return null
      primary = currentTarget() ?? primary
      if (primary && pickVerifiedHitRange(primary, hit, query, caseSensitive, blockHitTotal, excludedGroupParts, doc)) break
    }
  }
  return currentTarget()
}
function findMainScroller(root: HTMLElement | null, flow: HTMLElement | null): HTMLElement | null {
  if (!root || !flow) return null
  let cur = flow.parentElement
  while (cur && cur !== root.parentElement) {
    if (cur.scrollHeight > cur.clientHeight + 1) {
      const ov = typeof getComputedStyle === 'function' ? getComputedStyle(cur).overflowY : 'auto'
      if (ov === 'auto' || ov === 'scroll') return cur
    }
    cur = cur.parentElement
  }
  return (root.querySelector('[data-conversation-scroll]') as HTMLElement | null) ?? flow.parentElement
}
export function collectVisibleBlockRanges(
  flow: HTMLElement | null,
  scroller: HTMLElement | null,
  query: string,
  caseSensitive: boolean,
  allowedTargets: ReadonlySet<string> | null = null,
  excludedGroupParts: ReadonlySet<string> | null = null,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
): Range[] {
  if (!flow || !query) return []
  if (allowedTargets && allowedTargets.size === 0) return []
  const sRect = scroller?.getBoundingClientRect?.()
  const topBound = sRect ? sRect.top - 400 : -400
  const botBound = sRect ? sRect.bottom + 400 : 2000
  const ranges: Range[] = []
  for (const nodeEl of flow.querySelectorAll('[data-chat-node-key]')) {
    const htmlEl = nodeEl as HTMLElement
    if (htmlEl.closest('[hidden]')) continue
    if (allowedTargets) {
      const ownKey = htmlEl.dataset?.chatNodeKey ?? ''
      const ownPart = htmlEl.dataset?.chatGroupPart ?? ''
      if (ownPart) {
        if (!allowedTargets.has(`${ownKey}|${ownPart}`) && !allowedTargets.has(`${ownKey}|`)) continue
      } else if (!allowedTargets.has(ownKey)) {
        continue
      }
    }
    const r = htmlEl.getBoundingClientRect?.()
    if (sRect && r && (r.bottom < topBound || r.top > botBound)) continue
    for (const item of matchRangesInBlock(htmlEl, query, caseSensitive, excludedGroupParts, 250 - ranges.length, doc)) {
      ranges.push(item.range)
      if (ranges.length >= 250) return ranges
    }
  }
  return ranges
}
function collectHighlightRects(
  visibleRanges: readonly Range[],
  currentRange: Range | null | undefined,
  scroller: HTMLElement | null,
): HighlightBox[] {
  const clip = scroller?.getBoundingClientRect?.()
  const boxes: HighlightBox[] = []
  const pushRangeBoxes = (range: Range, current: boolean) => {
    const rawList = typeof range.getClientRects === 'function'
      ? Array.from(range.getClientRects())
      : (typeof range.getBoundingClientRect === 'function' ? [range.getBoundingClientRect()] : [])
    for (const rect of rawList) {
      if (!rect || rect.width <= 0 || rect.height <= 0) continue
      const left = clip && clip.width > 0 ? Math.max(rect.left, clip.left) : rect.left
      const right = clip && clip.width > 0 ? Math.min(rect.right, clip.right) : rect.right
      const top = clip && clip.height > 0 ? Math.max(rect.top, clip.top) : rect.top
      const bottom = clip && clip.height > 0 ? Math.min(rect.bottom, clip.bottom) : rect.bottom
      if (right - left <= 0.5 || bottom - top <= 0.5) continue
      boxes.push({
        left: Math.round(left * 10) / 10,
        top: Math.round(top * 10) / 10,
        width: Math.round((right - left) * 10) / 10,
        height: Math.round((bottom - top) * 10) / 10,
        current,
      })
    }
  }
  for (const r of visibleRanges) pushRangeBoxes(r, false)
  if (currentRange) pushRangeBoxes(currentRange, true)
  return boxes
}
function createHighlightManager() {
  let rects: HighlightBox[] = []
  const getCssRegistry = () =>
    (globalThis as unknown as {
      CSS?: { highlights?: Map<string, unknown> }
      Highlight?: new (...ranges: Range[]) => unknown
    })
  const clear = (): boolean => {
    const changed = rects.length > 0
    rects = []
    const { CSS: cssObj } = getCssRegistry()
    if (cssObj?.highlights) {
      try {
        cssObj.highlights.delete(HIGHLIGHT_ALL_NAME)
        cssObj.highlights.delete(HIGHLIGHT_CURRENT_NAME)
      } catch {}
    }
    return changed
  }
  const apply = (visibleRanges: readonly Range[], currentRange: Range | null | undefined, scroller: HTMLElement | null): boolean => {
    const { CSS: cssObj, Highlight: HighlightCtor } = getCssRegistry()
    if (cssObj?.highlights) {
      try {
        cssObj.highlights.delete(HIGHLIGHT_ALL_NAME)
        cssObj.highlights.delete(HIGHLIGHT_CURRENT_NAME)
        if (typeof HighlightCtor === 'function') {
          if (visibleRanges.length > 0) cssObj.highlights.set(HIGHLIGHT_ALL_NAME, new HighlightCtor(...visibleRanges))
          if (currentRange) cssObj.highlights.set(HIGHLIGHT_CURRENT_NAME, new HighlightCtor(currentRange))
        }
      } catch {}
    }
    const next = collectHighlightRects(visibleRanges, currentRange, scroller)
    const same = next.length === rects.length && next.every((b, idx) => {
      const prev = rects[idx]!
      return b.left === prev.left && b.top === prev.top && b.width === prev.width && b.height === prev.height && b.current === prev.current
    })
    rects = next
    return !same
  }
  return {
    clear,
    apply,
    getRects: (): readonly HighlightBox[] => rects,
  }
}
function effectiveRect(targetEl: HTMLElement | null, range: Range | null): DOMRect | null {
  const rr = range?.getBoundingClientRect?.()
  if (rr && (rr.width > 0 || rr.height > 0)) return rr
  return targetEl?.getBoundingClientRect?.() ?? null
}
function centerInScroller(scroller: HTMLElement | null, targetEl: HTMLElement | null, range: Range | null): void {
  if (!scroller || typeof scroller.getBoundingClientRect !== 'function') return
  const rect = effectiveRect(targetEl, range)
  const sRect = scroller.getBoundingClientRect()
  if (!rect || sRect.height <= 0) return
  const nextTop = scroller.scrollTop + (rect.top - sRect.top) - Math.max(24, (sRect.height - rect.height) * 0.4)
  scroller.scrollTop = Math.max(0, nextTop)
}
function scrollToMatchTarget(
  root: HTMLElement,
  flow: HTMLElement,
  targetEl: HTMLElement | null,
  range: Range | null,
  isStale: () => boolean,
): () => void {
  const innerBody = targetEl?.closest?.('[data-step-process-body]') as HTMLElement | null
  if (innerBody && innerBody.scrollHeight > innerBody.clientHeight + 1) {
    centerInScroller(innerBody, targetEl, range)
  }
  const scroller = findMainScroller(root, flow)
  if (!scroller) return () => {}
  centerInScroller(scroller, targetEl, range)
  let userMoved = false
  const cancelFollow = () => { userMoved = true }
  const evts = ['wheel', 'touchstart', 'pointerdown'] as const
  for (const ev of evts) scroller.addEventListener(ev, cancelFollow, { passive: true, once: true })
  const timer = setTimeout(() => {
    for (const ev of evts) scroller.removeEventListener(ev, cancelFollow)
    if (isStale() || userMoved) return
    const rect = effectiveRect(targetEl, range)
    const sRect = scroller.getBoundingClientRect?.()
    if (rect && sRect && (rect.top < sRect.top + 16 || rect.bottom > sRect.bottom - 16)) {
      centerInScroller(scroller, targetEl, range)
    }
  }, 190)
  return () => {
    clearTimeout(timer)
    for (const ev of evts) scroller.removeEventListener(ev, cancelFollow)
  }
}
export function clampOverlayPosition(
  pos: OverlayPosition | null | undefined,
  boxSize: { width?: number | undefined; height?: number | undefined } | null | undefined,
  viewportSize: { width?: number | undefined; height?: number | undefined } | null | undefined,
  margin = POS_EDGE_MARGIN,
): OverlayPosition | null {
  if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return null
  const vw = typeof viewportSize?.width === 'number' && Number.isFinite(viewportSize.width) && viewportSize.width > 0 ? viewportSize.width : 1280
  const vh = typeof viewportSize?.height === 'number' && Number.isFinite(viewportSize.height) && viewportSize.height > 0 ? viewportSize.height : 720
  const bw = typeof boxSize?.width === 'number' && Number.isFinite(boxSize.width) && boxSize.width > 0 ? boxSize.width : Math.min(420, Math.max(160, vw - 32))
  const bh = typeof boxSize?.height === 'number' && Number.isFinite(boxSize.height) && boxSize.height > 0 ? boxSize.height : 48
  const safeX = vw > bw + margin * 2 ? margin : Math.max(0, Math.floor((vw - bw) / 2))
  const maxLeft = Math.max(safeX, vw - bw - safeX)
  const safeY = vh > bh + margin * 2 ? margin : Math.max(0, Math.floor((vh - bh) / 2))
  const maxTop = Math.max(safeY, vh - bh - safeY)
  return {
    left: Math.round(Math.min(maxLeft, Math.max(safeX, pos.left))),
    top: Math.round(Math.min(maxTop, Math.max(safeY, pos.top))),
  }
}
export function readSavedOverlayPosition(storage?: Storage | undefined): OverlayPosition | null {
  try {
    const ls = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
    const raw = ls?.getItem?.(FIND_POS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { left?: unknown; top?: unknown }
    if (!parsed || typeof parsed.left !== 'number' || typeof parsed.top !== 'number' || !Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) {
      return null
    }
    return { left: parsed.left, top: parsed.top }
  } catch {
    return null
  }
}
export function writeSavedOverlayPosition(pos: OverlayPosition | null, storage?: Storage | undefined): void {
  try {
    const ls = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
    if (!ls) return
    if (!pos) ls.removeItem?.(FIND_POS_STORAGE_KEY)
    else ls.setItem?.(FIND_POS_STORAGE_KEY, JSON.stringify({ left: pos.left, top: pos.top }))
  } catch {}
}
export interface FindBindingLike {
  readonly sessionId?: string | undefined
  readonly session: {
    getSnapshot(): {
      readonly sessionId?: string | undefined
      readonly blank?: boolean | undefined
      readonly removed?: boolean | undefined
      readonly loadingOlder?: boolean | undefined
      readonly hasMore?: boolean | undefined
      readonly subagent?: { readonly address?: Record<string, unknown> | undefined } | undefined
    }
    subscribe(fn: () => void): () => void
    loadThrough?(seq: number): Promise<unknown>
    loadOlder?(): Promise<unknown>
  }
  readonly eventSource: {
    getSnapshot(): {
      readonly entries?: readonly Record<string, unknown>[] | undefined
      readonly hasMore?: boolean | undefined
      readonly revision?: number | undefined
      readonly change?: { readonly kind?: string | undefined; readonly entries?: readonly Record<string, unknown>[] | undefined } | undefined
    } | undefined
    subscribe(fn: () => void): () => void
  }
}
export interface FindSessionsServiceLike {
  readonly mainId?: string | undefined
  readonly list?: {
    getSnapshot(): {
      readonly byId?: Readonly<Record<string, { readonly id?: string | undefined; readonly retainedBy?: { readonly mainView?: number | undefined } | undefined }>> | undefined
    }
    subscribe(fn: () => void): () => void
  } | undefined
  binding(sessionId: string): FindBindingLike | null | undefined
  retainInfo?(sessionId: string): { subscribe(fn: () => void): () => void }
  subagentAddress?(sessionId: string): Record<string, unknown> | undefined
}
export interface FindControllerDeps {
  readonly sessions?: FindSessionsServiceLike | null | undefined
  readonly layout?: {
    readonly panelInfo?: {
      getSnapshot(): { readonly activePanelId?: string | null | undefined } | undefined
      subscribe(fn: () => void): () => void
    } | undefined
  } | null | undefined
  readonly locale?: {
    getSnapshot(): { readonly active?: string | undefined }
  } | null | undefined
  readonly remoteSession?: RemoteSessionServiceLike | null | undefined
  readonly doc?: Document | undefined
  readonly markdownExtractor?: ((markdown: string) => string) | undefined
}
export function createFindController(deps: FindControllerDeps) {
  const { sessions, layout, locale, doc = typeof document !== 'undefined' ? document : undefined, markdownExtractor } = deps
  let remoteSession: RemoteSessionServiceLike | null = deps.remoteSession ?? null
  const listeners = new Set<() => void>()
  const cache = createHistoryCache(MAX_HISTORY_CACHE_BYTES)
  const hl = createHighlightManager()
  let disposed = false
  let open = false
  let activeSessionId: string | null = null
  let activeBinding: FindBindingLike | null = null
  let lastRevision = -1
  let query = ''
  let caseSensitive = false
  let searchScope: SearchScope = { ...DEFAULT_SEARCH_SCOPE }
  let scopeMenuOpen = false
  let queryGen = 0
  const enabledKinds = () => resolveEnabledSourceKinds(searchScope)
  const excludedParts = () => resolveExcludedGroupParts(enabledKinds())
  cache.setCompactEvaluator(p =>
    query
      ? matchItems(assembleSearchableItems(p.boundaries, p.extracted.rawItems, [], undefined, markdownExtractor), query, caseSensitive, {
          includeExcerpts: false,
          sourceKinds: enabledKinds(),
        })
      : [],
  )
  let hits: SearchHit[] = []
  let navigated = false
  let selectedIndex = -1
  let selectedHitKey: string | null = null
  let scanState: ScanState = 'idle'
  let scanError: string | null = null
  let pinnedThroughSeq: number | undefined
  let nextBeforeSeq: number | undefined
  let remoteHasMore = false
  let hasEvictedPending = false
  let loadingTarget = false
  let fallbackNotice: string | null = null
  let scanAbort: AbortController | null = null
  let scanGen = 0
  let navGen = 0
  let navAbort: AbortController | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let cancelScrollTimer: () => void = () => {}
  let returnFocusEl: HTMLElement | null = null
  let runtime = 'web'
  let platform = 'windows'
  let unbindSession: () => void = () => {}
  let unbindMainRetain: () => void = () => {}
  let detachScrollFn: () => void = () => {}
  let scrollRaf: number | null = null
  let blockRenderCounts = new Map<string, number>()
  let allowedDomTargets = new Set<string>()
  let focusSeq = 0
  const t = (key: keyof typeof FIND_LOCALES.en, vars?: Record<string, string | number> | undefined): string => {
    const active = typeof locale?.getSnapshot === 'function' ? String(locale.getSnapshot()?.active ?? '') : 'en'
    const fam = active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    let msg: string = FIND_LOCALES[fam][key] ?? FIND_LOCALES.en[key] ?? key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) msg = msg.replaceAll(`{${k}}`, String(v))
    }
    return msg
  }
  const buildSnapshot = (): FindSnapshot => ({
    open,
    sessionId: activeSessionId,
    query,
    caseSensitive,
    scope: searchScope,
    hasCustomScope: isCustomScope(searchScope),
    scopeMenuOpen,
    hits,
    navigated,
    selectedIndex,
    selectedHitKey,
    scanState,
    scanError,
    remoteHasMore,
    hasEvictedPending,
    loadingTarget,
    fallbackNotice,
    hasRemote: Boolean(remoteSession && (typeof remoteSession.events === 'function' || typeof remoteSession.page === 'function')),
    canScanHistory: Boolean(query && (remoteHasMore || hasEvictedPending)),
    runtime,
    platform,
    activeHit: selectedIndex >= 0 && selectedIndex < hits.length ? hits[selectedIndex]! : null,
    focusSeq,
    highlightRects: hl.getRects(),
  })
  let snapshotCache: FindSnapshot = buildSnapshot()
  const emit = () => {
    snapshotCache = buildSnapshot()
    for (const fn of [...listeners]) fn()
  }
  const getSnapshot = (): FindSnapshot => snapshotCache
  const pruneAround = (centerIdx: number) => {
    const keep = new Set<string>()
    const lo = Math.max(0, (centerIdx < 0 ? hits.length - 1 : centerIdx) - 20)
    const hi = Math.min(hits.length - 1, (centerIdx < 0 ? hits.length - 1 : centerIdx) + 20)
    for (let i = lo; i <= hi; i++) {
      const h = hits[i]
      if (h) keep.add(h.hitKey)
    }
    cache.pruneExcerpts(keep)
  }
  const computeRemainingMore = (win: { hasMore?: boolean | undefined } | undefined): boolean => {
    if (nextBeforeSeq !== undefined) return nextBeforeSeq > 0 && remoteHasMore
    return Boolean(win?.hasMore)
  }
  const prepareExcerpt = (hit: SearchHit) => {
    if (!hit.excerpt) {
      hit.excerpt = hit.fieldText !== undefined
        ? buildExcerpt(hit.fieldText, hit.offset, hit.length)
        : (cache.hitExcerpts.get(hit.hitKey) ?? null)
    }
  }
  const refreshVisibleHighlights = (currentRange?: Range | null | undefined, emitIfChanged = false) => {
    if (!open || !query || !activeSessionId || !doc) {
      if (hl.clear() && emitIfChanged) emit()
      return
    }
    const mainRoot = resolveMainConversationRoot(doc, activeSessionId)
    if (!mainRoot) {
      if (hl.clear() && emitIfChanged) emit()
      return
    }
    const exclParts = excludedParts()
    let resolvedCurrent = currentRange
    if (resolvedCurrent === undefined && navigated && selectedIndex >= 0 && hits[selectedIndex]) {
      const active = hits[selectedIndex]!
      prepareExcerpt(active)
      const targets = findTargetNodeElements(mainRoot.flow, active)
      const sig = `${active.nodeKey ?? ''}|${active.groupPart ?? ''}`
      const blockTotal = blockRenderCounts.get(sig) ?? 1
      for (const el of targets) {
        if (el.closest('[hidden]')) continue
        const rng = pickVerifiedHitRange(el, active, query, caseSensitive, blockTotal, exclParts, doc)
        if (rng) {
          resolvedCurrent = rng
          break
        }
      }
    }
    const scroller = findMainScroller(mainRoot.root, mainRoot.flow)
    const visibleRanges = collectVisibleBlockRanges(mainRoot.flow, scroller, query, caseSensitive, allowedDomTargets, exclParts, doc)
    const changed = hl.apply(visibleRanges, resolvedCurrent, scroller)
    if (changed && emitIfChanged) emit()
  }
  const cancelRefresh = () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const recomputeLocal = () => {
    cancelRefresh()
    if (!open || !activeBinding || !query) {
      hits = []
      allowedDomTargets.clear()
      blockRenderCounts.clear()
      selectedIndex = -1
      navigated = false
      selectedHitKey = null
      hasEvictedPending = false
      hl.clear()
      emit()
      return
    }
    const win = activeBinding.eventSource.getSnapshot()
    remoteHasMore = computeRemainingMore(win)
    const res = computeCombinedMatches(cache, win?.entries ?? [], query, caseSensitive, enabledKinds(), markdownExtractor)
    hits = res.hits
    allowedDomTargets = buildAllowedDomTargets(hits)
    hasEvictedPending = res.evictedPending
    blockRenderCounts = new Map()
    for (const h of hits) {
      if (h.nodeKey) {
        const sig = `${h.nodeKey}|${h.groupPart ?? ''}`
        blockRenderCounts.set(sig, (blockRenderCounts.get(sig) ?? 0) + 1)
      }
    }
    if (navigated && selectedHitKey) {
      const foundIdx = hits.findIndex(h => h.hitKey === selectedHitKey)
      if (foundIdx >= 0) selectedIndex = foundIdx
      else {
        selectedIndex = -1
        navigated = false
      }
    } else {
      selectedIndex = -1
    }
    pruneAround(selectedIndex)
    refreshVisibleHighlights()
    emit()
  }
  const scheduleRefresh = () => {
    if (open && query && debounceTimer === null) {
      debounceTimer = setTimeout(recomputeLocal, FIND_DEBOUNCE_MS)
    }
  }
  const abortScanOnly = () => {
    scanGen++
    if (scanAbort) {
      try { scanAbort.abort() } catch {}
      scanAbort = null
    }
  }
  const abortNavigationOnly = () => {
    navGen++
    navAbort?.abort()
    navAbort = null
    loadingTarget = false
    cancelScrollTimer()
    cancelScrollTimer = () => {}
  }
  const resetScanCursor = () => {
    abortScanOnly()
    cache.clear()
    pinnedThroughSeq = undefined
    nextBeforeSeq = undefined
    hasEvictedPending = false
    scanError = null
    scanState = 'idle'
  }
  const invalidateCachedHits = () => {
    cache.hitExcerpts.clear()
    for (const p of cache.pages.values()) {
      p.compactHitsValidForQuery = false
      p.compactHits = []
    }
  }
  const onQueryChanged = (nextQuery: string, nextCase: boolean) => {
    query = nextQuery
    caseSensitive = nextCase
    queryGen++
    invalidateCachedHits()
    abortScanOnly()
    abortNavigationOnly()
    navigated = false
    selectedIndex = -1
    selectedHitKey = null
    fallbackNotice = null
    scanState = 'idle'
    scanError = null
    cancelRefresh()
    emit()
    if (!query) {
      recomputeLocal()
      return
    }
    scheduleRefresh()
  }
  const flushDebounce = () => {
    if (debounceTimer !== null) recomputeLocal()
  }
  const waitForLoadingOlderClear = (session: FindBindingLike['session'], signal: AbortSignal) =>
    new Promise<void>(resolve => {
      if (signal.aborted || !session.getSnapshot().loadingOlder) return resolve()
      const finish = () => {
        unsubscribe()
        signal.removeEventListener('abort', finish)
        resolve()
      }
      const unsubscribe = session.subscribe(() => {
        if (!session.getSnapshot().loadingOlder) finish()
      })
      signal.addEventListener('abort', finish, { once: true })
    })
  const fetchEvictedExcerpt = async (hit: SearchHit, myNav: number, signal: AbortSignal): Promise<SearchHit> => {
    if (!hit.pageKey || !remoteSession) return hit
    const page = cache.pages.get(hit.pageKey)
    if (!page) return hit
    cache.touch(hit.pageKey)
    if (page.extracted) {
      const items = assembleSearchableItems(page.boundaries, page.extracted.rawItems, [], undefined, markdownExtractor)
      const matched = matchItems(items, query, caseSensitive, {
        includeExcerpts: false,
        excerptKey: hit.hitKey,
        sourceKinds: enabledKinds(),
      }).find(m => m.hitKey === hit.hitKey)
      if (matched?.excerpt) {
        hit.excerpt = matched.excerpt
        cache.hitExcerpts.set(hit.hitKey, matched.excerpt)
      }
      return hit
    }
    const req = {
      address: resolveSessionAddress(sessions, activeBinding, activeSessionId),
      ...(page.reqThroughSeq === undefined ? {} : { throughSeq: page.reqThroughSeq }),
      ...(page.reqBeforeSeq === undefined ? {} : { beforeSeq: page.reqBeforeSeq }),
      ...DEFAULT_PAGE_OPTIONS,
    }
    const res = await callSessionPageRpc(remoteSession, req, signal).catch(() => null)
    if (disposed || navGen !== myNav) return hit
    const val = validatePageResult(res, page.reqThroughSeq, page.reqBeforeSeq)
    if (!val.ok) return hit
    const ext = extractPageFromEvents(val.events, markdownExtractor)
    const items = assembleSearchableItems(ext.boundaries, ext.rawItems, [], undefined, markdownExtractor)
    const pageHits = matchItems(items, query, caseSensitive, {
      includeExcerpts: false,
      excerptKey: hit.hitKey,
      sourceKinds: enabledKinds(),
    })
    cache.putPage({
      minSeq: val.minSeq ?? 0,
      maxSeq: val.maxSeq ?? -1,
      reqThroughSeq: page.reqThroughSeq,
      reqBeforeSeq: page.reqBeforeSeq,
      extracted: ext,
      compactHits: pageHits,
      compactHitsValidForQuery: true,
    })
    const matched = pageHits.find(m => m.hitKey === hit.hitKey)
    if (matched?.excerpt) {
      hit.excerpt = matched.excerpt
      cache.hitExcerpts.set(hit.hitKey, matched.excerpt)
    }
    return hit
  }
  const resolveMainId = (): string | null => {
    if (!sessions) return null
    if (typeof sessions.mainId === 'string' && sessions.mainId) return sessions.mainId
    const byId = sessions.list?.getSnapshot?.()?.byId
    if (byId && typeof byId === 'object') {
      for (const row of Object.values(byId)) {
        if ((row?.retainedBy?.mainView ?? 0) > 0 && row.id) return row.id
      }
    }
    return null
  }
  const isObstructed = (): boolean => {
    const activePanel = layout?.panelInfo?.getSnapshot?.()?.activePanelId
    if (activePanel !== null && activePanel !== undefined) return true
    if (!doc) return false
    if (doc.querySelector('[data-rightbar-fullscreen]')) return true
    if (doc.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return true
    return false
  }
  const isActiveMainReady = (requireDom = false): boolean => {
    if (!activeSessionId || !activeBinding || isObstructed()) return false
    const sess = activeBinding.session?.getSnapshot?.()
    if (!sess || sess.removed) return false
    if (sess.blank && !activeBinding.eventSource?.getSnapshot?.()?.entries?.length) return false
    if (requireDom && doc && doc.querySelectorAll('[data-conversation-session]').length > 0) {
      if (!resolveMainConversationRoot(doc, activeSessionId)) return false
    }
    return true
  }
  const detachScrollerListener = () => {
    detachScrollFn()
    detachScrollFn = () => {}
    if (scrollRaf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(scrollRaf)
    scrollRaf = null
  }
  const attachScrollerListener = () => {
    detachScrollerListener()
    if (!doc || !activeSessionId) return
    const mainRoot = resolveMainConversationRoot(doc, activeSessionId)
    const scroller = mainRoot ? findMainScroller(mainRoot.root, mainRoot.flow) : null
    if (!scroller) return
    const onScroll = () => {
      if (!open || !query || scrollRaf !== null) return
      if (typeof requestAnimationFrame === 'function') {
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = null
          refreshVisibleHighlights(undefined, true)
        })
      } else {
        refreshVisibleHighlights(undefined, true)
      }
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    detachScrollFn = () => scroller.removeEventListener('scroll', onScroll)
  }
  const startOrResumeScan = async (): Promise<void> => {
    flushDebounce()
    const myQuery = query
    const myCase = caseSensitive
    const myKinds = enabledKinds()
    const mySessionId = activeSessionId
    if (!myQuery || !activeBinding || !remoteSession || scanState === 'scanning') return
    abortScanOnly()
    const myScan = ++scanGen
    const myQueryGen = queryGen
    const isStale = () => disposed || scanGen !== myScan || queryGen !== myQueryGen || activeSessionId !== mySessionId
    scanState = 'scanning'
    scanError = null
    emit()
    try {
      const evictedToRescan = [...cache.pages.values()]
        .filter(p => p.evicted && !p.compactHitsValidForQuery)
        .sort((a, b) => a.minSeq - b.minSeq)
      for (const p of evictedToRescan) {
        if (isStale()) return
        scanAbort = new AbortController()
        const req = {
          address: resolveSessionAddress(sessions, activeBinding, mySessionId),
          ...(p.reqThroughSeq === undefined ? {} : { throughSeq: p.reqThroughSeq }),
          ...(p.reqBeforeSeq === undefined ? {} : { beforeSeq: p.reqBeforeSeq }),
          ...DEFAULT_PAGE_OPTIONS,
        }
        const res = await callSessionPageRpc(remoteSession, req, scanAbort.signal)
        if (isStale()) return
        const val = validatePageResult(res, p.reqThroughSeq, p.reqBeforeSeq)
        if (!val.ok) {
          scanState = 'error'
          scanError = val.error ?? t('statusError')
          scanAbort = null
          emit()
          return
        }
        const ext = extractPageFromEvents(val.events, markdownExtractor)
        p.boundaries = ext.boundaries
        cache.setPageHits(
          p.pageKey,
          matchItems(assembleSearchableItems(ext.boundaries, ext.rawItems, [], undefined, markdownExtractor), myQuery, myCase, {
            includeExcerpts: false,
            sourceKinds: myKinds,
          }),
        )
        scheduleRefresh()
        await yieldThread()
      }
      let winSnap = activeBinding.eventSource.getSnapshot()
      let liveBounds = durableSeqBounds(winSnap?.entries ?? [])
      if (pinnedThroughSeq === undefined) pinnedThroughSeq = liveBounds.maxSeq !== null ? liveBounds.maxSeq : undefined
      if (nextBeforeSeq === undefined && liveBounds.minSeq !== null) nextBeforeSeq = liveBounds.minSeq
      let canPullMore = nextBeforeSeq !== undefined
        ? nextBeforeSeq > 0 && (remoteHasMore || Boolean(winSnap?.hasMore))
        : Boolean(winSnap?.hasMore)
      while (canPullMore && !isStale()) {
        winSnap = activeBinding.eventSource.getSnapshot()
        liveBounds = durableSeqBounds(winSnap?.entries ?? [])
        if (liveBounds.minSeq !== null && nextBeforeSeq !== undefined && nextBeforeSeq > liveBounds.minSeq) {
          nextBeforeSeq = liveBounds.minSeq
        }
        if (nextBeforeSeq !== undefined && nextBeforeSeq <= 0) {
          remoteHasMore = false
          break
        }
        scanAbort = new AbortController()
        const req = {
          address: resolveSessionAddress(sessions, activeBinding, mySessionId),
          ...(pinnedThroughSeq === undefined ? {} : { throughSeq: pinnedThroughSeq }),
          ...(nextBeforeSeq === undefined ? {} : { beforeSeq: nextBeforeSeq }),
          ...DEFAULT_PAGE_OPTIONS,
        }
        const res = await callSessionPageRpc(remoteSession, req, scanAbort.signal)
        if (isStale()) return
        const val = validatePageResult(res, pinnedThroughSeq, nextBeforeSeq)
        if (!val.ok) {
          scanState = 'error'
          scanError = val.error ?? t('statusError')
          scanAbort = null
          emit()
          return
        }
        if (val.events.length > 0 && val.minSeq !== null && val.maxSeq !== null) {
          const ext = extractPageFromEvents(val.events, markdownExtractor)
          if (pinnedThroughSeq === undefined) pinnedThroughSeq = val.cursor
          cache.putPage({
            minSeq: val.minSeq,
            maxSeq: val.maxSeq,
            reqThroughSeq: pinnedThroughSeq ?? val.maxSeq,
            reqBeforeSeq: nextBeforeSeq,
            extracted: ext,
          })
          nextBeforeSeq = val.minSeq
        }
        remoteHasMore = Boolean(val.hasMore) && (nextBeforeSeq === undefined || nextBeforeSeq > 0)
        scheduleRefresh()
        canPullMore = remoteHasMore && (nextBeforeSeq === undefined || nextBeforeSeq > 0)
        if (canPullMore) await yieldThread()
      }
      if (!isStale()) {
        scanAbort = null
        recomputeLocal()
        scanState = remoteHasMore || hasEvictedPending ? 'paused' : 'done'
        emit()
      }
    } catch (err) {
      if (!isStale()) {
        scanState = 'error'
        scanError = err instanceof Error && err.message ? err.message : t('statusError')
        scanAbort = null
        emit()
      }
    }
  }
  const pauseScan = () => {
    if (scanState !== 'scanning') return
    abortScanOnly()
    flushDebounce()
    scanState = remoteHasMore || hasEvictedPending ? 'paused' : 'done'
    emit()
  }
  const jumpToHit = async (index: number): Promise<void> => {
    if (!activeBinding || index < 0 || index >= hits.length) return
    abortNavigationOnly()
    navAbort = new AbortController()
    const signal = navAbort.signal
    const myNav = navGen
    const myQueryGen = queryGen
    const isStale = () => disposed || navGen !== myNav || queryGen !== myQueryGen
    const hit = hits[index]!
    navigated = true
    selectedIndex = index
    selectedHitKey = hit.hitKey
    fallbackNotice = null
    pruneAround(index)
    emit()
    prepareExcerpt(hit)
    if (!hit.excerpt && hit.pageKey) {
      await fetchEvictedExcerpt(hit, myNav, signal)
      if (isStale()) return
    }
    const initialBounds = durableSeqBounds(activeBinding.eventSource.getSnapshot()?.entries ?? [])
    if (hit.durable !== false && (initialBounds.minSeq === null || hit.seq < initialBounds.minSeq)) {
      loadingTarget = true
      emit()
      const { session, eventSource } = activeBinding
      const targetSeq = hit.turnStartSeq ?? hit.seq
      let minSeq = initialBounds.minSeq
      try {
        await waitForLoadingOlderClear(session, signal)
        if (isStale()) return
        if (typeof session.loadThrough === 'function') {
          await session.loadThrough(targetSeq)
        } else if (typeof session.loadOlder === 'function') {
          let guard = 0
          while ((minSeq === null || minSeq > targetSeq) && session.getSnapshot().hasMore && guard < 120) {
            guard++
            await session.loadOlder()
            if (isStale()) return
            minSeq = durableSeqBounds(eventSource.getSnapshot()?.entries ?? []).minSeq
          }
        }
      } catch {
      } finally {
        if (!isStale()) loadingTarget = false
      }
      if (isStale()) return
      recomputeLocal()
    }
    if (!doc || !activeSessionId) {
      emit()
      return
    }
    const mainRoot = resolveMainConversationRoot(doc, activeSessionId)
    if (!mainRoot) {
      fallbackNotice = t('fallbackHidden')
      emit()
      return
    }
    const exclParts = excludedParts()
    const sig = `${hit.nodeKey ?? ''}|${hit.groupPart ?? ''}`
    const blockTotal = blockRenderCounts.get(sig) ?? 1
    let verifiedRange: Range | null = null
    let targetEl: HTMLElement | null = null
    for (const candidate of findTargetNodeElements(mainRoot.flow, hit)) {
      const revealed = await revealHiddenAncestors(mainRoot.flow, candidate, hit, query, caseSensitive, blockTotal, isStale, exclParts, doc)
      if (isStale()) return
      if (!revealed) continue
      targetEl = targetEl ?? revealed
      const rng = pickVerifiedHitRange(revealed, hit, query, caseSensitive, blockTotal, exclParts, doc)
      if (rng) {
        targetEl = revealed
        verifiedRange = rng
        break
      }
    }
    if (!targetEl) targetEl = findTurnAnchor(mainRoot.flow, hit.turn)
    if (targetEl || verifiedRange) {
      cancelScrollTimer = scrollToMatchTarget(mainRoot.root, mainRoot.flow, targetEl, verifiedRange, isStale)
    }
    fallbackNotice = verifiedRange ? null : (targetEl ? t('fallbackTurn') : t('fallbackHidden'))
    refreshVisibleHighlights(verifiedRange, false)
    emit()
  }
  const navigate = async (delta: 1 | -1): Promise<void> => {
    flushDebounce()
    if (hits.length === 0) return
    const nextIdx = !navigated || selectedIndex < 0
      ? (delta > 0 ? 0 : hits.length - 1)
      : (selectedIndex + delta + hits.length) % hits.length
    await jumpToHit(nextIdx)
  }
  const bindToSession = (nextId: string | null) => {
    const nextBinding = nextId && sessions ? (sessions.binding(nextId) ?? null) : null
    if (nextId === activeSessionId && nextBinding === activeBinding) return
    unbindSession()
    unbindSession = () => {}
    unbindMainRetain()
    unbindMainRetain = () => {}
    detachScrollerListener()
    abortNavigationOnly()
    resetScanCursor()
    activeSessionId = nextId
    activeBinding = nextBinding
    lastRevision = -1
    navigated = false
    selectedIndex = -1
    selectedHitKey = null
    fallbackNotice = null
    if (!nextId || !nextBinding) {
      if (open) {
        open = false
        scopeMenuOpen = false
      }
      recomputeLocal()
      return
    }
    const stopEv = nextBinding.eventSource.subscribe(() => {
      const win = nextBinding.eventSource.getSnapshot()
      const rev = win?.revision ?? -1
      if (rev === lastRevision) return
      lastRevision = rev
      if (win?.change?.kind === 'replace') resetScanCursor()
      if (open && query) scheduleRefresh()
    })
    const stopSess = nextBinding.session.subscribe(() => {
      const s = nextBinding.session.getSnapshot()
      if (s.removed && open) closeFind(false)
      else if (open) emit()
    })
    unbindSession = () => {
      stopEv()
      stopSess()
    }
    if (typeof sessions?.retainInfo === 'function') {
      unbindMainRetain = sessions.retainInfo(nextId).subscribe(() => syncMainSession())
    }
    if (open) {
      attachScrollerListener()
      recomputeLocal()
    } else {
      emit()
    }
  }
  const syncMainSession = () => {
    if (disposed) return
    bindToSession(resolveMainId())
  }
  const closeFind = (restoreFocus = false) => {
    const wasOpen = open
    open = false
    scopeMenuOpen = false
    abortScanOnly()
    abortNavigationOnly()
    cancelRefresh()
    detachScrollerListener()
    hl.clear()
    if (wasOpen) emit()
    const target = returnFocusEl
    returnFocusEl = null
    if (restoreFocus && target && target.isConnected && typeof target.focus === 'function') {
      try { target.focus({ preventScroll: true }) } catch {}
    }
  }
  const openFind = (triggerEl?: Element | null | undefined) => {
    if (disposed) return
    syncMainSession()
    if (!activeSessionId || !activeBinding) return
    if (!open) {
      const candidate = (triggerEl instanceof HTMLElement ? triggerEl : (doc?.activeElement instanceof HTMLElement ? doc.activeElement : null))
      if (candidate && !candidate.closest?.('[data-shortcuts-find-root="true"]')) {
        returnFocusEl = candidate
      }
    }
    open = true
    focusSeq++
    attachScrollerListener()
    recomputeLocal()
  }
  const applyScope = (nextScope: SearchScope) => {
    searchScope = normalizeSearchScope(nextScope)
    queryGen++
    invalidateCachedHits()
    abortScanOnly()
    abortNavigationOnly()
    fallbackNotice = null
    scanState = 'idle'
    scanError = null
    recomputeLocal()
  }
  const toggleScopeKey = (key: SearchScopeKey) => {
    applyScope({ ...searchScope, [key]: !searchScope[key] })
  }
  const resetScope = () => {
    applyScope(DEFAULT_SEARCH_SCOPE)
  }
  const selectAllScope = () => {
    applyScope({
      body: true,
      reasoning: true,
      tool: true,
      command: true,
      context: true,
      compaction: true,
      todo: true,
      error: true,
    })
  }
  const setScopeMenuOpen = (next: boolean) => {
    const val = Boolean(next)
    if (scopeMenuOpen === val) return
    scopeMenuOpen = val
    emit()
  }
  const setRuntimePlatform = (rt?: string | undefined, pf?: string | undefined) => {
    if (typeof rt === 'string' && rt) runtime = rt
    if (typeof pf === 'string' && pf) platform = pf
    emit()
  }
  const setRemoteSession = (rs: RemoteSessionServiceLike | null) => {
    remoteSession = rs
    emit()
  }
  const canOpenShortcut = (scCtx?: { modal?: unknown; region?: unknown; source?: unknown; target?: unknown } | null | undefined): boolean => {
    if (scCtx?.modal) return false
    syncMainSession()
    return isActiveMainReady(false)
  }
  const canOpenFromWebCapture = (target: EventTarget | null | undefined): boolean => {
    const el = target instanceof Element ? target : null
    if (open && el?.closest?.('[data-shortcuts-find-root="true"]')) return true
    if (el?.closest?.('[role="dialog"], [aria-modal="true"], [data-rightbar-col], [data-global-panel]')) return false
    if (el?.closest?.('input, textarea, select, [contenteditable="true"]') && !el.closest?.('[data-conversation-session]')) {
      return false
    }
    return isActiveMainReady(true)
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    closeFind(false)
    unbindSession()
    unbindSession = () => {}
    unbindMainRetain()
    unbindMainRetain = () => {}
    cache.clear()
    listeners.clear()
  }
  syncMainSession()
  return {
    _cache: cache,
    t,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot,
    setRuntimePlatform,
    setRemoteSession,
    syncMainSession,
    canOpenShortcut,
    canOpenFromWebCapture,
    openFind,
    closeFind,
    setQuery: (nextQuery: string) => {
      if (nextQuery !== query) onQueryChanged(nextQuery, caseSensitive)
    },
    toggleCaseSensitive: () => {
      onQueryChanged(query, !caseSensitive)
    },
    setScopeMenuOpen,
    toggleScopeKey,
    resetScope,
    selectAllScope,
    recomputeLocal,
    startOrResumeScan,
    pauseScan,
    jumpToHit,
    navigate,
    dispose,
  }
}
export type FindController = ReturnType<typeof createFindController>
