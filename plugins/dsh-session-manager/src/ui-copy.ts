/** Failure identity stored by the UI. The sentence is derived from the active locale. */

export type CopyLocale = 'zh' | 'en'

export function copyLocale(active: string | undefined): CopyLocale {
  return active?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

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
    retryPending: '重发尚未完成。再次发送会继续同一次操作，不会新建另一份聊天。',
    retryUncertain: '上次创建聊天的结果无法确认，已停止再次创建。请先检查会话列表中是否已有新聊天。',
  },
  en: {
    modified: 'Later operations may have made changes. Retry is unavailable.',
    unknown: "This action's result could not be confirmed.",
    pending: 'This message is still pending.',
    stale: 'This chat has changed. Try again.',
    running: 'This chat is still running. Wait for the current work to finish, then try again.',
    cleanup: 'Cleanup did not finish.',
    unsupported: 'This runtime cannot complete that action.',
    retryPending: 'Resend is incomplete. Send again to continue the same operation without creating another chat.',
    retryUncertain: 'The previous chat creation could not be confirmed. Another chat will not be created; check the session list for an existing new chat.',
  },
} as const

export type FailureReason = keyof typeof reasons.zh

const text = {
  zh: {
    tempWorkspace: '临时工作区',
    createFailed: '无法创建临时工作区',
    retryList: '重试',
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
    editBranchWarning: '对话将从这条消息继续，之前的版本会移入归档。已执行的文件、命令和外部修改不会撤销，模型可能再次执行相关操作。',
    editConfirm: '确认重发',
    editAddAttachment: '添加附件',
    editRemoveAttachment: '删除附件',
    editImage: '图片',
    editPreviewFailed: '预览不可用',
    draft: '消息文本',
    continueDefault: '继续',
    welcomeBack: '欢迎回来',
    recapSummary: '在聊什么',
    recapProgress: '目前进展',
    recapNextStep: '建议下一步',
    cacheNotice: '离开时间较久，模型的提示缓存可能已失效，下一次发送会重新处理完整上下文。可以压缩上下文，或在新会话中继续；也可以忽略提示直接发送。',
    compactNow: '压缩上下文',
    compacting: '正在压缩',
    compactCommandSent: '已调用宿主压缩命令，结果请查看对话中的压缩记录。',
    continueNew: '在新会话中继续',
    creatingContinuation: '正在创建新会话',
    continueNewHint: '在来源会话的工作区新建会话，将摘要和原会话 ID 填入草稿，不自动发送。',
    compactNothing: '没有值得压缩的内容。',
    settingsTitle: '会话管理',
    settingsGroupTitle: '会话行为',
    settingsGroupHint: '继续灰影、自动继续、交接与会话摘要',
    settingsMode: '继续灰影',
    modeFixed: '固定文本',
    modeAuto: '模型生成',
    settingsModeHint: '输入框为空时显示建议；按 Tab 填入，点击直接发送。',
    continueSourceLabel: '内容来源',
    continueTextLabel: '固定文本内容',
    continueTextPlaceholder: '留空使用默认「继续」',
    ghostModelLabel: '生成模型',
    ghostModelHint: '每轮结束后生成一次并缓存；不选择时使用默认辅助模型。',
    judgeModelLabel: '判定模型',
    judgeModelHint: '判断回复是否提前结束；不选择时使用默认辅助模型。',
    handoffGroup: '交接摘要',
    handoffModelLabel: '交接模型',
    handoffModelHint: '工具请求会话交接摘要时使用；不选择时使用默认辅助模型。',
    welcomeBackGroup: '回到会话时',
    recapEnabledLabel: '显示会话摘要',
    recapEnabledHint: '在对话中回顾上次进展。',
    recapMinutesLabel: '离开多久后显示摘要',
    compactEnabledLabel: '建议压缩上下文',
    compactEnabledHint: '长时间离开后，建议先压缩上下文。',
    compactMinutesLabel: '离开多久后显示建议',
    autoContinue: '自动继续',
    autoContinueOff: '关闭',
    autoContinueCautious: '谨慎',
    autoContinueBold: '奔放',
    autoContinueTooltip: '回复提前结束时自动发送继续。谨慎：有明确依据才继续；奔放：没完成就继续，低风险的选择按推荐方案走。会话开始后锁定。',
    autoContinueLocked: '请在会话开始前选择自动继续',
    autoContinueStale: '状态已在别处更改，已刷新',
    autoContinueFailed: '切换失败',
    autoContinueGroup: '自动继续',
    autoContinueDefaultLabel: '新会话默认形态',
    autoContinueDefaultHint: '只影响之后新建的会话；发送第一条消息前可在输入框上方单独选择，会话开始后保持锁定。',
    autoContinueMaxLabel: '续跑次数上限',
    autoContinueMaxHint: '你每发一条消息之后，最多自动继续的次数（1–10）。',
    autoContinueMaxInvalid: '请填写 1–10 的整数。',
    minutesUnit: '分钟',
    modelLabel: '摘要模型',
    modelFollowOption: '默认辅助模型',
    modelGroupHint: '只用于欢迎回来摘要；留空使用默认辅助模型。',
    saveSettings: '保存',
    settingsSaving: '正在保存',
    settingsSaved: '已保存',
    settingsLoading: '正在加载',
    settingsUnavailable: '当前宿主不支持在线修改配置',
    minutesInvalid: '请填写大于等于 1 的整数分钟。',
    externalChange: '配置已在别处修改。草稿已保留，请刷新页面后再保存。',
  },
  en: {
    tempWorkspace: 'Temporary Workspace',
    createFailed: 'Could not create the temporary workspace',
    retryList: 'Retry',
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
    editBranchWarning: 'The conversation continues from this message; the previous version moves to the archive. File, command, and external changes already made are not undone — the model may perform those actions again.',
    editConfirm: 'Confirm resend',
    editAddAttachment: 'Add attachments',
    editRemoveAttachment: 'Remove attachment',
    editImage: 'Image',
    editPreviewFailed: 'Preview unavailable',
    draft: 'Message text',
    continueDefault: 'Continue',
    welcomeBack: 'Welcome back',
    recapSummary: 'What you were discussing',
    recapProgress: 'Where things stand',
    recapNextStep: 'Suggested next step',
    cacheNotice: 'The model prompt cache may have expired, so the next message reprocesses the full context. Compact the context, continue in a new session, or ignore this notice and send normally.',
    compactNow: 'Compact context',
    compacting: 'Compacting',
    compactCommandSent: 'Host compaction command invoked. See the compaction entry in the conversation for its result.',
    continueNew: 'Continue in a new session',
    creatingContinuation: 'Creating new session',
    continueNewHint: "Create a session in the source session's workspace and fill its draft with the recap and source session ID, without sending.",
    compactNothing: 'There is nothing useful to compact.',
    settingsTitle: 'Session Management',
    settingsGroupTitle: 'Session behavior',
    settingsGroupHint: 'Continue ghost, auto-continue, handoff and session recap',
    settingsMode: 'Continue ghost',
    modeFixed: 'Fixed text',
    modeAuto: 'Model-generated',
    settingsModeHint: 'Show a suggestion when the composer is empty. Press Tab to fill it, or click to send.',
    continueSourceLabel: 'Source',
    continueTextLabel: 'Fixed text',
    continueTextPlaceholder: 'Empty uses the default "Continue"',
    ghostModelLabel: 'Generation model',
    ghostModelHint: 'Generated once after each turn and cached. The default follows the shared auxiliary model.',
    judgeModelLabel: 'Judge model',
    judgeModelHint: 'Decides whether a reply stopped early. The default follows the shared auxiliary model.',
    handoffGroup: 'Session handoff',
    handoffModelLabel: 'Handoff model',
    handoffModelHint: 'Used when an agent asks for a session handoff summary. The default follows the shared auxiliary model.',
    welcomeBackGroup: 'When you return',
    recapEnabledLabel: 'Show session recap',
    recapEnabledHint: 'Review your previous progress in the conversation.',
    recapMinutesLabel: 'Show recap after',
    compactEnabledLabel: 'Suggest context compaction',
    compactEnabledHint: 'Suggest compacting the context after a long time away.',
    compactMinutesLabel: 'Show suggestion after',
    autoContinue: 'Auto-continue',
    autoContinueOff: 'Off',
    autoContinueCautious: 'Cautious',
    autoContinueBold: 'Bold',
    autoContinueTooltip: 'Sends a follow-up when a reply stops early. Cautious: continues only on clear evidence. Bold: continues unless done, taking the recommended option on low-risk choices. Locked once the session starts.',
    autoContinueLocked: 'Choose Auto-continue before the session starts',
    autoContinueStale: 'State changed elsewhere; refreshed',
    autoContinueFailed: 'Could not change Auto-continue',
    autoContinueGroup: 'Auto-continue',
    autoContinueDefaultLabel: 'Default for new sessions',
    autoContinueDefaultHint: 'Only affects sessions created later. Choose above the composer before sending the first message; the choice stays locked once the session starts.',
    autoContinueMaxLabel: 'Maximum continuations',
    autoContinueMaxHint: 'How many times it may continue automatically after each message you send (1–10).',
    autoContinueMaxInvalid: 'Enter a whole number from 1 to 10.',
    minutesUnit: 'minutes',
    modelLabel: 'Recap model',
    modelFollowOption: 'Default auxiliary model',
    modelGroupHint: 'Used only for the welcome-back recap; empty follows the default auxiliary model.',
    saveSettings: 'Save',
    settingsSaving: 'Saving',
    settingsSaved: 'Saved',
    settingsLoading: 'Loading',
    settingsUnavailable: 'This runtime cannot edit the plugin configuration',
    minutesInvalid: 'Enter a whole number of minutes of at least 1.',
    externalChange: 'Settings changed elsewhere. The draft was kept; reload this page before saving.',
  },
} as const

export type UiTextKey = keyof typeof text.zh

export function uiText(locale: CopyLocale, key: UiTextKey): string {
  return text[locale][key]
}

export function failureReason(failure: OperationFailure): FailureReason {
  if (failure.code === 'session/retry-pending') return 'retryPending'
  if (failure.code === 'session/retry-uncertain') return 'retryUncertain'
  if (failure.code === 'session/lifecycle-unavailable' || failure.code === 'session/retry-media-unavailable'
    || failure.code === 'session-manager/unavailable') return 'unsupported'
  if (failure.code === 'session-manager/busy') return 'running'
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

/** Idle duration sentence on the welcome-back card. */
export function idleText(locale: CopyLocale, minutes: number): string {
  return locale === 'zh' ? `距离上次响应已约 ${minutes} 分钟。` : `About ${minutes} minutes have passed since the last response.`
}

/** Compaction outcome line; a null token count means the host did not report one. */
export function compactedText(locale: CopyLocale, tokens: number | null): string {
  if (locale === 'zh') return tokens === null ? '上下文已压缩。' : `上下文已压缩，约 ${tokens} tokens 的历史被折叠。`
  return tokens === null ? 'Context compacted.' : `Context compacted; about ${tokens} tokens of history were folded.`
}
