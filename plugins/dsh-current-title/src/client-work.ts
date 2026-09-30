import type { RpcResult, TitleCadence, TitleModelRoute, TitleStatus } from './contracts.ts'

export const titleCopy = {
  zh: {
    label: '自动标题',
    pinned: '已手动命名',
    generating: '正在生成标题…',
    regenerate: '重新生成',
    locale: '类型标签语言',
    auto: '自动',
    prompt: '标题提示词',
    promptHint: '留空使用内置说明。仍会要求模型返回类型和摘要。离开输入框时自动保存。',
    loading: '正在读取标题设置…',
    model: '标题模型',
    modelDefault: '跟随会话模型',
    effort: '思考强度',
    effortDefault: '默认',
    cadence: '更新节奏',
    cadenceAll: '跟随当前任务（每条消息）',
    cadenceFirst: '仅首条消息',
    saved: '已保存。',
    failed: '无法读取标题设置。',
    inactive: '标题服务未接管，新消息暂时不会自动更新。',
  },
  en: {
    label: 'Auto Title',
    pinned: 'Renamed manually',
    generating: 'Generating title…',
    regenerate: 'Regenerate',
    locale: 'Type-label language',
    auto: 'Auto',
    prompt: 'Title prompt',
    promptHint: 'Leave empty to use the built-in instruction. The model still returns a type and summary. Saves when you leave the field.',
    loading: 'Loading title settings…',
    model: 'Title model',
    modelDefault: 'Use the session model',
    effort: 'Reasoning effort',
    effortDefault: 'Default',
    cadence: 'Update cadence',
    cadenceAll: 'Track the current task (every message)',
    cadenceFirst: 'First message only',
    saved: 'Saved.',
    failed: 'Could not read title settings.',
    inactive: 'Title generation is not active, so new messages will not rename this session.',
  },
} as const

export function settingsCopy(locale: 'zh' | 'en') {
  return titleCopy[locale] ?? titleCopy.zh
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
