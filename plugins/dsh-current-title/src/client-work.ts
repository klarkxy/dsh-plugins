import type { RpcResult, TitleCadence, TitleModelRoute, TitleStatus } from './contracts.ts'

export const titleCopy = {
  zh: {
    label: '自动标题',
    session: '当前会话',
    noSession: '没有打开的会话。打开一个会话后，可以在这里查看并重新生成标题。',
    pinned: '已手动命名',
    generating: '正在生成标题…',
    regenerate: '重新生成',
    locale: '类型标签语言',
    auto: '自动',
    prompt: '标题提示词',
    promptHint: '留空用内置说明，仍返回类型和摘要；离开输入框即保存。',
    loading: '正在读取标题设置…',
    model: '标题模型',
    modelDefault: '跟随会话模型',
    cadence: '更新节奏',
    cadenceAll: '跟随当前任务（每条消息）',
    cadenceFirst: '仅首条消息',
    saved: '已保存。',
    failed: '无法读取标题设置。',
    inactive: '标题服务未接管，新消息暂时不会自动更新。',
    retry: '重试',
    externalChange: '设置已在别处修改。提示词草稿已保留，请重新加载后确认。',
    syncUnavailable: '自动刷新不可用，请手动重新加载设置。',
    reload: '重新加载（丢弃草稿）',
    defaults: '默认设置',
  },
  en: {
    label: 'Auto Title',
    session: 'Current session',
    noSession: 'No session is open. Open one to see its title and regenerate it here.',
    pinned: 'Renamed manually',
    generating: 'Generating title…',
    regenerate: 'Regenerate',
    locale: 'Type-label language',
    auto: 'Auto',
    prompt: 'Title prompt',
    promptHint: 'Empty uses the built-in instruction; a type and summary are still returned. Saves on blur.',
    loading: 'Loading title settings…',
    model: 'Title model',
    modelDefault: 'Use the session model',
    cadence: 'Update cadence',
    cadenceAll: 'Track the current task (every message)',
    cadenceFirst: 'First message only',
    saved: 'Saved.',
    failed: 'Could not read title settings.',
    inactive: 'Title generation is not active, so new messages will not rename this session.',
    retry: 'Retry',
    externalChange: 'Settings changed elsewhere. Prompt draft preserved; reload and review.',
    syncUnavailable: 'Automatic refresh unavailable; reload settings manually.',
    reload: 'Reload (discard draft)',
    defaults: 'Default settings',
  },
} as const

/** Only plugin-owned defaults are translated; model output and remote diagnostics stay intact. */
const titleMessages = [
  ['标题设置无效。', 'Invalid title settings.'],
  ['设置已更新，请刷新后重试。', 'Settings changed. Refresh and try again.'],
  ['无法保存标题设置。', 'Could not save title settings.'],
  ['缺少会话。', 'A session is required.'],
  ['找不到该会话。', 'Session not found.'],
  ['标题服务未就绪。', 'Title service is not ready.'],
  ['已取消。', 'Cancelled.'],
  ['标题生成失败。', 'Title generation failed.'],
  ['未知操作。', 'Unknown operation.'],
  ['缺少所需的宿主服务。', 'required host services are missing'],
  ['原生标题服务位置已被占用。', 'native title provider slot is occupied'],
  ['其他标题服务已接管；先前的服务未恢复。', 'another title provider owns the slot; previous owner was not restored'],
  [titleCopy.zh.saved, titleCopy.en.saved],
  [titleCopy.zh.failed, titleCopy.en.failed],
] as const

export function titleMessage(message: string, locale: 'zh' | 'en'): string {
  const pair = titleMessages.find(pair => (pair as readonly string[]).includes(message))
  return pair?.[locale === 'zh' ? 0 : 1] ?? message
}

/** `undefined` draft = not edited; an empty string is a real edit (use built-in instruction). */
export function promptFieldValue(draft: string | undefined, saved: string): string {
  return draft ?? saved
}

/** The prompt to persist on blur, or `undefined` when nothing changed. */
export function promptToSave(draft: string | undefined, saved: string): string | undefined {
  if (draft === undefined) return undefined
  const next = draft.trim()
  return next === saved ? undefined : next
}

export function shouldSkipTitleRefresh(input: { busy: boolean }): boolean {
  return input.busy
}

export function createTitleClientWork() {
  let generation = 0
  let request = 0
  let disposed = false
  return {
    get disposed() { return disposed },
    beginLoad() {
      generation += 1
      request += 1
      return generation
    },
    captureLoad() {
      return generation
    },
    beginRequest() {
      request += 1
      return { generation, request }
    },
    isLoad(generationToken: number) {
      return !disposed && generation === generationToken
    },
    isRequest(token: { generation: number; request: number }) {
      return !disposed && generation === token.generation && request === token.request
    },
    dispose() {
      disposed = true
      generation += 1
      request += 1
    },
  }
}

export type TitleClientWork = ReturnType<typeof createTitleClientWork>
export type TitleClientCall = (endpoint: string, payload?: unknown) => Promise<unknown>

function unwrap<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

async function invoke<T>(call: TitleClientCall, endpoint: string, payload?: unknown): Promise<T> {
  return unwrap(await call(endpoint, payload) as RpcResult<T>)
}

export async function runTitleStatusLoad(input: {
  call: TitleClientCall
  sessionId?: string
  isCurrent: () => boolean
  failedMessage: string
  onStatus: (status: TitleStatus) => void
  onError: (message: string) => void
  onMarker: (status: TitleStatus | undefined) => void
}): Promise<void> {
  try {
    const status = await invoke<TitleStatus>(
      input.call,
      'status',
      input.sessionId ? { sessionId: input.sessionId } : {},
    )
    if (!input.isCurrent()) return
    input.onStatus(status)
    input.onMarker(status)
  } catch {
    if (!input.isCurrent()) return
    input.onMarker(undefined)
    input.onError(input.failedMessage)
  }
}

export async function runTitleRegenerateFlow(input: {
  call: TitleClientCall
  sessionId: string
  isCurrent: () => boolean
  failedMessage: string
  onBusy: (busy: boolean) => void
  onStatus: (status: TitleStatus) => void
  onError: (message: string) => void
  onMarker: (status: TitleStatus | undefined) => void
}): Promise<void> {
  if (!input.sessionId || !input.isCurrent()) return
  input.onBusy(true)
  try {
    await invoke(input.call, 'regenerate', { sessionId: input.sessionId })
    if (!input.isCurrent()) return
    const status = await invoke<TitleStatus>(input.call, 'status', { sessionId: input.sessionId })
    if (!input.isCurrent()) return
    input.onStatus(status)
    input.onMarker(status)
  } catch (cause) {
    if (!input.isCurrent()) return
    input.onError(cause instanceof Error ? cause.message : input.failedMessage)
  } finally {
    if (!input.isCurrent()) return
    input.onBusy(false)
  }
}

export async function runTitleSettingsSave(input: {
  call: TitleClientCall
  prompt?: string
  model?: TitleModelRoute
  cadence?: TitleCadence
  expectedRevision: number
  isCurrent: () => boolean
  savedMessage: string
  failedMessage: string
  onBusy: (busy: boolean) => void
  onSettings: (settings: TitleStatus['settings']) => void
  onNote: (note: string) => void
  onError: (message: string) => void
}): Promise<void> {
  input.onBusy(true)
  try {
    const settings = await invoke<TitleStatus['settings']>(input.call, 'settings', {
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.cadence !== undefined ? { cadence: input.cadence } : {}),
      expectedRevision: input.expectedRevision,
    })
    if (!input.isCurrent()) return
    input.onSettings(settings)
    input.onNote(input.savedMessage)
  } catch (cause) {
    if (!input.isCurrent()) return
    input.onError(cause instanceof Error ? cause.message : input.failedMessage)
  } finally {
    if (!input.isCurrent()) return
    input.onBusy(false)
  }
}
