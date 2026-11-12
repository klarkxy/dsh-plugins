import { describe, expect, it } from 'vitest'
import { extractJsonFields, formatToolDetail, parseNotice, summarizeNotice, summarizeToolCall, type TaskLookup } from './chat-format.ts'

const SCREENSHOT_NOTICE = [
  '[dot notice] Updates from other sessions:',
  '- approval · session-f922364c-9f84-4ca4-af18-38f650070997: ap-23 · approval from untracked session in H:\\Code\\dsh-plugins · "pwsh"',
  '  detail: reason: escalate sandbox to danger-full-access: 需要读取 npm 发布步骤的真实日志，核实匿名下载与完整性匹配。 arguments: {"description":"Read actual npm publication verification lines","command":"gh run view --job 130514884834 --log --step \'Publish changed packages and verify archives\'","justification":"需要读取 npm 发布步骤的真实日志，核实匿名下载与完整性匹配。","sandbox_permissions":"danger-full-access","workdir":"H:\\\\Code\\\\dsh-plugins"}',
  '  Decide it yourself with dot_answer: approve when the action fits the session\'s goal, stays inside its project, and can be undone. Ask the human first (a show_view confirm card) when it deletes data outside the project, publishes or pushes anything, spends money, touches credentials, or you cannot tell what it does; then relay their decision with dot_answer.',
  '  The human\'s own rules, which take precedence over the defaults above:',
  '  > Never delete anything outside the repo.',
  'Report what matters to the human, handle waiting requests by your rules, and keep quiet about routine progress.',
].join('\n')

const EMPTY_TASKS: TaskLookup = new Map()

describe('chat-format', () => {
  it('parses an approval notice without leaking model instructions or duplicate fields', () => {
    const parsed = parseNotice(SCREENSHOT_NOTICE)
    expect(parsed.isReminder).toBe(false)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]).toEqual({
      kind: 'approval',
      sessionId: 'session-f922364c-9f84-4ca4-af18-38f650070997',
      requestId: 'ap-23',
      subject: 'pwsh',
      cwd: 'H:\\Code\\dsh-plugins',
      permission: 'danger-full-access',
      reason: '需要读取 npm 发布步骤的真实日志，核实匿名下载与完整性匹配。',
      description: 'Read actual npm publication verification lines',
      command: "gh run view --job 130514884834 --log --step 'Publish changed packages and verify archives'",
    })
    expect(summarizeNotice(parsed, 'zh', EMPTY_TASKS)).toBe('审批 · pwsh · dsh-plugins')
  })

  it('salvages top-level fields when approval arguments JSON was clipped', () => {
    const fields = extractJsonFields('{"description":"Check CI","command":"gh run view --job 999 --step \\"Build…')
    expect(fields).toEqual({
      description: 'Check CI',
      command: 'gh run view --job 999 --step "Build…',
    })
  })

  it('parses reminders and question notices cleanly', () => {
    const reminder = parseNotice([
      '[dot reminder] Reminders you set for yourself are due:',
      '- sch-12ab34 "检查发布" (once; due 2026-11-11 21:30; now removed): 看看流水线结果',
      'Do what each one asks now. The human reads your reply in the chat, so tell them what is worth their attention and nothing about the reminder itself.',
    ].join('\n'))
    expect(reminder.isReminder).toBe(true)
    expect(reminder.entries[0]).toEqual({
      kind: 'reminder',
      id: 'sch-12ab34',
      title: '检查发布',
      prompt: '看看流水线结果',
      due: '21:30',
      once: true,
    })

    const question = parseNotice([
      '[dot notice] Updates from other sessions:',
      '- question · session-q1: q-2 · question from task "配置整理" · "保留旧字段吗？"',
      '  [legacy] 保留旧字段吗？ options: 保留 | 删除 (multi)',
      '  Ask the human in this chat (a show_view card or plain text), then relay their exact decision with dot_answer. Never decide it yourself.',
    ].join('\n'))
    expect(question.entries[0]).toMatchObject({
      kind: 'question',
      requestId: 'q-2',
      taskTitle: '配置整理',
      questions: [{ id: 'legacy', question: '保留旧字段吗？', options: ['保留', '删除'], multiSelect: true }],
    })
  })

  it('formats dot_answer race outcomes and settled calls into concise human text', () => {
    const raceItem = {
      kind: 'tool' as const,
      key: 't1',
      name: 'dot_answer',
      status: 'done' as const,
      args: { id: 'ap-22', allow: true },
      detail: 'Error [dot/unknown-request]: no waiting request ap-22; it may have been answered in its own session',
      at: 1,
    }
    expect(summarizeToolCall(raceItem, 'zh', EMPTY_TASKS)).toEqual({ summary: 'ap-22 · 已在原会话处理', tone: 'muted' })
    expect(formatToolDetail(raceItem, 'zh', EMPTY_TASKS)).toEqual({
      tone: 'muted',
      text: '该请求已在原会话中处理，无需重复操作。',
    })

    const tasks: TaskLookup = new Map([['session-f922364c-9f84-4ca4-af18-38f650070997', { title: '插件发布检查' }]])
    const okItem = {
      kind: 'tool' as const,
      key: 't2',
      name: 'dot_answer',
      status: 'done' as const,
      args: { id: 'ap-23', allow: true },
      detail: 'Answered ap-23 for session-f922364c-9f84-4ca4-af18-38f650070997.',
      at: 2,
    }
    expect(summarizeToolCall(okItem, 'zh', tasks)).toEqual({ summary: 'ap-23 · 批准' })
    expect(formatToolDetail(okItem, 'zh', tasks)).toMatchObject({
      tone: 'normal',
      text: '已处理 ap-23（插件发布检查）',
      session: { sessionId: 'session-f922364c-9f84-4ca4-af18-38f650070997', label: '插件发布检查' },
    })
  })

  it('turns list_sessions and dot_read machine outputs into human summaries and clean details', () => {
    const failedList = {
      kind: 'tool' as const,
      key: 'l1',
      name: 'list_sessions',
      status: 'error' as const,
      args: { limit: 50 },
      detail: '{"status":"failed","code":"SESSION_QUERY_INVALID_LIMIT","message":"limit must be an integer from 1 to 20; omit it or pass null for the default"}',
      at: 1,
    }
    expect(summarizeToolCall(failedList, 'zh', EMPTY_TASKS)).toEqual({
      summary: 'limit must be an integer from 1 to 20',
      tone: 'error',
    })
    expect(formatToolDetail(failedList, 'zh', EMPTY_TASKS)).toEqual({
      tone: 'error',
      text: 'limit must be an integer from 1 to 20',
    })

    const clippedList = {
      kind: 'tool' as const,
      key: 'l2',
      name: 'list_sessions',
      status: 'done' as const,
      args: {},
      detail: '{"status":"ok","items":[{"sessionId":"25bcb077-203f-48af-bfb7-6d348cea2233","title":"Research how \\"ZCode\\" handles sandboxing","cwd":"H:\\\\Code\\\\DeepSeek-Bot","createdAt":1794237767203,"parentSession":"session-5f169ade-8dff…',
      at: 2,
    }
    expect(summarizeToolCall(clippedList, 'zh', EMPTY_TASKS)).toEqual({
      summary: '找到 1+ 个会话',
    })
    expect(formatToolDetail(clippedList, 'zh', EMPTY_TASKS)).toEqual({
      tone: 'normal',
      text: '• Research how "ZCode" handles sandboxing（DeepSeek-Bot）',
    })

    const readNoReply = {
      kind: 'tool' as const,
      key: 'r1',
      name: 'dot_read',
      status: 'done' as const,
      args: { session_id: 'session-274a6400-1111-2222-3333-444444444444' },
      detail: 'untracked session\n--- latest reply ---\n(no reply yet)',
      at: 3,
    }
    expect(summarizeToolCall(readNoReply, 'zh', EMPTY_TASKS)).toEqual({
      summary: '#274a64 · 暂无回复',
      tone: 'muted',
      sessionId: 'session-274a6400-1111-2222-3333-444444444444',
    })
    expect(formatToolDetail(readNoReply, 'zh', EMPTY_TASKS)).toMatchObject({
      tone: 'muted',
      text: '暂无回复',
      session: { label: '#274a64' },
    })

    const readToolDump = {
      kind: 'tool' as const,
      key: 'r2',
      name: 'dot_read',
      status: 'done' as const,
      args: { session_id: 'session-3f732800-1111-2222-3333-444444444444' },
      detail: 'untracked session\n--- latest reply ---\nupdate_goal\n{"action":"resume","goal_id":"goal-05b8c0c5-0bbc-4272-b559-b0159fa89768","revision":2}',
      at: 4,
    }
    expect(summarizeToolCall(readToolDump, 'zh', EMPTY_TASKS)).toEqual({
      summary: '#3f7328',
      sessionId: 'session-3f732800-1111-2222-3333-444444444444',
    })
    expect(formatToolDetail(readToolDump, 'zh', EMPTY_TASKS)).toMatchObject({
      tone: 'normal',
      text: 'update_goal（action: resume, revision: 2）',
      session: { label: '#3f7328' },
    })
  })
})
