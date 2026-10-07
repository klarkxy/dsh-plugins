import { copyLocale, type CopyLocale } from './copy-action.ts'

export type { CopyLocale }
export { copyLocale }

/** Failure identity stored by the UI. The sentence is derived from the active locale. */
export interface OperationFailure {
  readonly code: string
  readonly reason?: string
}

const reasons = {
  zh: {
    modified: '后续操作可能涉及修改，暂时不能重试。',
    unknown: '无法确认这个操作的结果。',
    pending: '这条消息还在等待处理。',
    stale: '这个聊天已经更新，请再试一次。',
    running: '这个聊天仍在运行。请等待当前工作结束后再试。',
    cleanup: '清理没有完成。',
    unsupported: '当前版本不能完成这个操作。',
  },
  en: {
    modified: 'Later operations may have made changes. Retry is unavailable.',
    unknown: "This action's result could not be confirmed.",
    pending: 'This message is still pending.',
    stale: 'This chat has changed. Try again.',
    running: 'This chat is still running. Wait for the current work to finish, then try again.',
    cleanup: 'Cleanup did not finish.',
    unsupported: 'This runtime cannot complete that action.',
  },
} as const

export type FailureReason = keyof typeof reasons.zh

const text = {
  zh: {
    panel: '自由聊天',
    newChat: '新建聊天',
    empty: '还没有自由聊天。',
    loading: '正在读取聊天',
    noMatch: '没有匹配的聊天。',
    listError: '聊天列表没有读出来。',
    retryList: '重试',
    search: '搜索聊天',
    running: '运行中',
    idle: '空闲',
    menu: '聊天操作',
    fork: '分叉',
    deleteChat: '删除聊天',
    deleting: '正在删除',
    deleteFree: '将删除这个聊天及其拥有的文件。',
    deleteOrdinary: '将删除这个聊天。项目文件会保留。',
    cancel: '取消',
    close: '关闭',
    retry: '重试',
    edit: '编辑并重发',
    send: '发送',
    editTitle: '编辑并重发',
    draft: '消息文本',
  },
  en: {
    panel: 'Free chat',
    newChat: 'New chat',
    empty: 'No free chats yet.',
    loading: 'Reading chats',
    noMatch: 'No matching chats.',
    listError: 'The chat list could not be read.',
    retryList: 'Retry',
    search: 'Search chats',
    running: 'Running',
    idle: 'Idle',
    menu: 'Chat actions',
    fork: 'Fork',
    deleteChat: 'Delete chat',
    deleting: 'Deleting',
    deleteFree: 'This deletes this chat and its owned files.',
    deleteOrdinary: 'This deletes this chat. Project files remain.',
    cancel: 'Cancel',
    close: 'Close',
    retry: 'Retry',
    edit: 'Edit and resend',
    send: 'Send',
    editTitle: 'Edit and resend',
    draft: 'Message text',
  },
} as const

export type UiTextKey = keyof typeof text.zh

export function uiText(locale: CopyLocale, key: UiTextKey): string {
  return text[locale][key]
}

export function failureReason(failure: OperationFailure): FailureReason {
  if (failure.code === 'session/lifecycle-unavailable') return 'unsupported'
  if (
    failure.code === 'session/retry-revision'
    || failure.code === 'session/branch-moved'
    || failure.code === 'session/retry-input'
    || failure.code === 'session/retry-conflict'
  ) return 'stale'
  if (failure.code === 'session/delete-pending') return 'cleanup'
  if (failure.code === 'session/agent-busy' && failure.reason === 'free-session-work-active') return 'running'
  if (failure.reason === 'modified' || failure.reason === 'pending' || failure.reason === 'running' || failure.reason === 'stale') {
    return failure.reason
  }
  if (failure.reason === 'stop-failed' || failure.reason === 'not-quiet') return 'running'
  if (failure.reason === 'not-human-prompt' || failure.reason === 'missing-evidence') return 'unknown'
  return 'unknown'
}

export function failureText(locale: CopyLocale, failure: OperationFailure): string {
  return reasons[locale][failureReason(failure)]
}

export function deleteBody(locale: CopyLocale, classification: 'free' | 'ordinary'): string {
  return classification === 'free' ? text[locale].deleteFree : text[locale].deleteOrdinary
}
