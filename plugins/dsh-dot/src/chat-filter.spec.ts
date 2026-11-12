import { describe, expect, it } from 'vitest'
import type { ChatItem } from './contracts.ts'
import { filterVisibleChat } from './chat-filter.ts'

const APPROVAL_NOTICE = (id: string, cmd = 'gh run view --log') => [
  '[dot notice] Updates from other sessions:',
  `- approval · session-f922364c-9f84-4ca4-af18-38f650070997: ${id} · approval from untracked session in H:\\Code\\dsh-plugins · "pwsh"`,
  `  detail: arguments: {"command":"${cmd}"}`,
  '  Decide it yourself with dot_answer: approve silently (no chat reply) when the action fits the session\'s goal, stays inside its project, and can be undone.',
  'Report what matters to the human, handle waiting requests by your rules, and stay silent about routine progress.',
].join('\n')

describe('filterVisibleChat', () => {
  it('hides requests already answered in their own session and routine silent settlements', () => {
    const items: ChatItem[] = [
      {
        kind: 'tool',
        key: 't1',
        name: 'dot_answer',
        status: 'done',
        args: { id: 'ap-22', allow: true },
        detail: 'Error [dot/unknown-request]: no waiting request ap-22; it may have been answered in its own session',
        at: 1,
      },
      { kind: 'bot', key: 'b1', text: '`ap-22` 已在原会话处理。', at: 2 },
      { kind: 'notice', key: 'n1', text: APPROVAL_NOTICE('ap-23'), at: 3 },
      {
        kind: 'tool',
        key: 't2',
        name: 'dot_answer',
        status: 'done',
        args: { id: 'ap-23', allow: true },
        detail: 'Error [dot/unknown-request]: no waiting request ap-23; it may have been answered in its own session',
        at: 4,
      },
      { kind: 'bot', key: 'b2', text: '`ap-23` 已在原会话处理。', at: 5 },
      { kind: 'notice', key: 'n2', text: APPROVAL_NOTICE('ap-24'), at: 6 },
      { kind: 'tool', key: 't3', name: 'dot_read', status: 'done', args: { session_id: 'session-f922364c-9f84-4ca4-af18-38f650070997' }, detail: 'untracked session\n--- latest reply ---\n(no reply yet)', at: 7 },
      { kind: 'tool', key: 't4', name: 'dot_answer', status: 'done', args: { id: 'ap-24', allow: true }, detail: 'Answered ap-24 for session-f922364c-9f84-4ca4-af18-38f650070997.', at: 8 },
    ]
    const res = filterVisibleChat(items)
    expect(res.items).toEqual([])
    expect(res.silentTail).toBe(true)
  })

  it('keeps silentTail while an active background request turn has not spoken, and reveals it once streaming or asking', () => {
    const inFlight: ChatItem[] = [
      { kind: 'notice', key: 'n1', text: APPROVAL_NOTICE('ap-25', 'git push origin main'), at: 1 },
      { kind: 'tool', key: 't1', name: 'dot_read', status: 'running', args: { session_id: 'session-f922364c-9f84-4ca4-af18-38f650070997' }, at: 2 },
    ]
    expect(filterVisibleChat(inFlight, { streaming: false })).toMatchObject({ items: [], silentTail: true })
    expect(filterVisibleChat(inFlight, { streaming: true }).items.map(item => item.key)).toEqual(['n1', 't1'])
    expect(filterVisibleChat(inFlight, { streaming: true }).silentTail).toBe(false)

    const withCard: ChatItem[] = [
      ...inFlight,
      { kind: 'bot', key: 'b1', text: '这条命令会推送代码到远端，请确认是否放行：', at: 3 },
      { kind: 'view', key: 'v1', title: '确认推送', view: { type: 'confirm', id: 'ok' }, presentation: { viewId: 'view-1' }, at: 4 },
    ]
    expect(filterVisibleChat(withCard).items.map(item => item.key)).toEqual(['n1', 't1', 'b1', 'v1'])
  })

  it('preserves rejections explained to the human and strips silent requests from mixed task-update notices', () => {
    const rejected: ChatItem[] = [
      { kind: 'notice', key: 'n1', text: APPROVAL_NOTICE('ap-26', 'rm -rf /tmp/shared'), at: 1 },
      { kind: 'tool', key: 't1', name: 'dot_answer', status: 'done', args: { id: 'ap-26', allow: false }, detail: 'Answered ap-26 for session-f922364c-9f84-4ca4-af18-38f650070997.', at: 2 },
      { kind: 'bot', key: 'b1', text: '已拦截该会话删除目录外的命令。', at: 3 },
    ]
    expect(filterVisibleChat(rejected).items.map(item => item.key)).toEqual(['n1', 't1', 'b1'])

    const mixedNotice = [
      '[dot notice] Updates from other sessions:',
      '- turn-end · session-task-1: "修复链接" finished a turn: 修好了 3 处失效链接',
      '- approval · session-f922364c-9f84-4ca4-af18-38f650070997: ap-27 · approval from untracked session in H:\\Code\\dsh-plugins · "pwsh"',
      'Report what matters to the human, handle waiting requests by your rules, and stay silent about routine progress.',
    ].join('\n')
    const mixed: ChatItem[] = [
      { kind: 'notice', key: 'nm', text: mixedNotice, at: 10 },
      { kind: 'tool', key: 'tm', name: 'dot_answer', status: 'done', args: { id: 'ap-27', allow: true }, detail: 'Answered ap-27 for session-f922364c-9f84-4ca4-af18-38f650070997.', at: 11 },
      { kind: 'bot', key: 'bm', text: '「修复链接」跑完了，共修好 3 处失效链接。', at: 12 },
    ]
    const res = filterVisibleChat(mixed)
    expect(res.items.map(item => item.key)).toEqual(['nm', 'bm'])
    expect(res.hiddenRequestIds.has('ap-27')).toBe(true)
  })
})
