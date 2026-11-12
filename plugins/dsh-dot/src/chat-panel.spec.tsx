import { act } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type ChatItem, type ChatSnapshot } from './contracts.ts'
import { ChatPanel, type ChatApi } from './chat-panel.tsx'
import { createDotCards } from './client.tsx'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' })
vi.stubGlobal('window', dom.window)
vi.stubGlobal('document', dom.window.document)
vi.stubGlobal('navigator', dom.window.navigator)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let createRoot: typeof import('react-dom/client').createRoot
beforeAll(async () => { createRoot = (await import('react-dom/client')).createRoot })
afterEach(() => { document.body.innerHTML = '<div id="root"></div>' })

const NOTICE_TEXT = [
  '[dot notice] Updates from other sessions:',
  '- approval · session-f922364c-9f84-4ca4-af18-38f650070997: ap-23 · approval from untracked session in H:\\Code\\dsh-plugins · "pwsh"',
  '  detail: reason: escalate sandbox to danger-full-access: 需要读取 npm 发布步骤的真实日志，核实匿名下载与完整性匹配。 arguments: {"description":"Read actual npm publication verification lines","command":"gh run view --job 130514884834 --log --step \'Publish changed packages and verify archives\'","justification":"需要读取 npm 发布步骤的真实日志，核实匿名下载与完整性匹配。","sandbox_permissions":"danger-full-access","workdir":"H:\\\\Code\\\\dsh-plugins"}',
  '  Decide it yourself with dot_answer: approve when the action fits the session\'s goal, stays inside its project, and can be undone.',
  'Report what matters to the human, handle waiting requests by your rules, and keep quiet about routine progress.',
].join('\n')

const ESCALATED_NOTICE_TEXT = [
  '[dot notice] Updates from other sessions:',
  '- approval · session-f922364c-9f84-4ca4-af18-38f650070997: ap-25 · approval from untracked session in H:\\Code\\dsh-plugins · "pwsh"',
  '  detail: reason: escalate sandbox to danger-full-access: 需要发布包到 npm 仓库。 arguments: {"description":"Publish changed packages","command":"pnpm publish -r --access public","justification":"需要发布包到 npm 仓库。","sandbox_permissions":"danger-full-access","workdir":"H:\\\\Code\\\\dsh-plugins"}',
  '  Decide it yourself with dot_answer: approve silently (no chat reply) when the action fits the session\'s goal, stays inside its project, and can be undone.',
  'Report what matters to the human, handle waiting requests by your rules, and stay silent about routine progress.',
].join('\n')

function makeApi(snapshot: ChatSnapshot): ChatApi {
  return {
    chat: async () => snapshot,
    wait: (_rev, _itemsRev, signal) => new Promise(resolve => { signal.addEventListener('abort', () => resolve(undefined), { once: true }) }),
    say: async () => {},
    stop: async () => {},
    board: async () => ({ tasks: [], pending: [], schedules: [] }),
    removeSchedule: async () => false,
    settings: async () => DEFAULT_SETTINGS,
    setSettings: async () => DEFAULT_SETTINGS,
    settingProposals: async () => [],
    decideSetting: async () => 'ok',
    newSegment: async () => 'dot-2',
    knowledge: async () => ({ agreements: { text: '', maxChars: 4000, canUndo: false }, cognition: { text: '', maxChars: 4000, history: [] } }),
    setAgreements: async () => ({ agreements: { text: '', maxChars: 4000, canUndo: false }, cognition: { text: '', maxChars: 4000, history: [] } }),
    undoAgreements: async () => ({ agreements: { text: '', maxChars: 4000, canUndo: false }, cognition: { text: '', maxChars: 4000, history: [] } }),
    setCognition: async () => ({ agreements: { text: '', maxChars: 4000, canUndo: false }, cognition: { text: '', maxChars: 4000, history: [] } }),
    restoreCognition: async () => ({ agreements: { text: '', maxChars: 4000, canUndo: false }, cognition: { text: '', maxChars: 4000, history: [] } }),
    context: async () => ({ live: true, compactions: 0 }),
    clearUsage: async () => ({ live: true, compactions: 0 }),
    trajectory: async () => ({ turns: [], earlier: 0 }),
    reflectionRuns: async () => [],
    reflectionTrajectory: async () => ({ turns: [], earlier: 0 }),
    models: async () => ({ models: [] }),
  }
}

describe('ChatPanel activity and notice cards', () => {
  it('keeps an expired numbered card answerable through dot RPC and hides duplicate prose', async () => {
    const view = { type: 'confirm', id: 'ok' }
    const presentation = { owner: 'dsh-deep-view', title: 'Deploy', view, viewId: 'dot-card-4', interactive: true, awaitReply: true, dotCard: { number: 4, expired: true } }
    const call = vi.fn(async (endpoint: string) => endpoint === 'card.pending'
      ? { id: 'dot-card-4', sessionId: 'old', callId: 'call4', title: 'Deploy', view } : true)
    const { Card } = createDotCards(call)
    const snapshot: ChatSnapshot = { sessionId: 'current', running: false, streaming: '', rev: 1, itemsRev: 1, items: [
      { kind: 'user', key: 'u', text: 'deploy', at: 1 },
      { kind: 'bot', key: 'b', text: 'duplicate prose', at: 2 },
      { kind: 'view', key: 'call4', presentation, at: 3 },
    ] }
    const root = createRoot(document.getElementById('root')!)
    await act(async () => { root.render(<ChatPanel locale="en" api={makeApi(snapshot)} Card={Card} onOpenSession={() => {}} />) })
    expect(document.body.textContent).toContain('#4 · Expired')
    expect(document.body.textContent).not.toContain('duplicate prose')
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('.dvui-root button')].find(button => button.textContent === 'Confirm')!
    expect(confirm).toBeDefined()
    expect(confirm.disabled).toBe(false)
    await act(async () => { confirm.click() })
    expect(call).toHaveBeenCalledWith('card.answer', expect.objectContaining({ viewId: 'dot-card-4', action: 'ok', values: { confirmed: true } }))
    await act(async () => { root.unmount() })
  })

  it('shows card preparation instead of streamed ordinary prose', async () => {
    const snapshot: ChatSnapshot = { sessionId: 'dot', running: true, streaming: 'hidden streamed prose', preparingCard: true, rev: 1, itemsRev: 1, items: [{ kind: 'user', key: 'u', text: 'hi', at: 1 }] }
    const root = createRoot(document.getElementById('root')!)
    await act(async () => { root.render(<ChatPanel locale="zh" api={makeApi(snapshot)} onOpenSession={() => {}} />) })
    expect(document.body.textContent).toContain('正在准备卡片…')
    expect(document.body.textContent).not.toContain('hidden streamed prose')
    await act(async () => { root.unmount() })
  })
  it('silences background/already-handled requests while showing structured cards for requests needing the human', async () => {
    const opened: string[] = []
    const snapshot: ChatSnapshot = {
      sessionId: 'dot-1',
      running: false,
      streaming: '',
      rev: 1,
      itemsRev: 1,
      items: [
        {
          kind: 'tool',
          key: 'c1',
          name: 'dot_answer',
          status: 'done',
          args: { id: 'ap-22', allow: true },
          detail: 'Error [dot/unknown-request]: no waiting request ap-22; it may have been answered in its own session',
          at: 1,
        },
        { kind: 'bot', key: 'b1', text: 'ap-22 已在原会话处理。', at: 2 },
        { kind: 'notice', key: 'n1', text: NOTICE_TEXT, at: 3 },
        {
          kind: 'tool',
          key: 'c2',
          name: 'dot_answer',
          status: 'done',
          args: { id: 'ap-23', allow: true },
          detail: 'Answered ap-23 for session-f922364c-9f84-4ca4-af18-38f650070997.',
          at: 4,
        },
        { kind: 'notice', key: 'n2', text: ESCALATED_NOTICE_TEXT, at: 5 },
        { kind: 'bot', key: 'b2', text: '这个操作会直接发布包到 npm，需要你确认是否放行？', at: 6 },
      ],
    }
    const root = createRoot(document.getElementById('root')!)
    await act(async () => { root.render(<ChatPanel locale="zh" api={makeApi(snapshot)} onOpenSession={id => opened.push(id)} />) })
    await act(async () => { await Promise.resolve() })

    // Already-handled (ap-22) and silent routine (ap-23) requests stay completely out of the chat.
    expect(document.body.textContent).not.toContain('ap-22')
    expect(document.body.textContent).not.toContain('已在原会话处理')
    expect(document.body.textContent).not.toContain('ap-23')
    expect(document.body.textContent).not.toContain('处理请求')

    // Escalated request (ap-25) that asks the human renders cleanly.
    expect(document.body.textContent).toContain('收到会话动态')
    expect(document.body.textContent).toContain('审批 · pwsh · dsh-plugins')
    expect(document.body.textContent).not.toContain('这个操作会直接发布包到 npm，需要你确认是否放行？')

    // Expand notice row: shows structured approval card, hides English routing prompt & raw JSON keys.
    const rowButtons = [...document.querySelectorAll<HTMLButtonElement>('.dsh-stub-disclosure__row')]
    expect(rowButtons).toHaveLength(1)
    await act(async () => { rowButtons[0]!.click() })
    const noticeBody = document.querySelector('.dsh-dot-notice-list')!
    expect(noticeBody.textContent).toContain('pwsh')
    expect(noticeBody.textContent).toContain('ap-25')
    expect(noticeBody.textContent).toContain('完全访问')
    expect(noticeBody.textContent).toContain('需要发布包到 npm 仓库。')
    expect(noticeBody.textContent).toContain('pnpm publish -r --access public')
    expect(noticeBody.textContent).not.toContain('Decide it yourself with dot_answer')
    expect(noticeBody.textContent).not.toContain('sandbox_permissions')
    expect(noticeBody.textContent).not.toContain('escalate sandbox to')

    // Clicking the session link jumps to that session.
    const jump = noticeBody.querySelector<HTMLButtonElement>('.dsh-dot-session-btn')!
    expect(jump.textContent).toContain('dsh-plugins')
    await act(async () => { jump.click() })
    expect(opened).toEqual(['session-f922364c-9f84-4ca4-af18-38f650070997'])

    await act(async () => { root.unmount() })
  })

  it('folds consecutive tools with step indicators and per-call targets', async () => {
    const snapshot: ChatSnapshot = {
      sessionId: 'dot-1',
      running: false,
      streaming: '',
      rev: 2,
      itemsRev: 2,
      items: [
        {
          kind: 'tool',
          key: 't0',
          name: 'list_sessions',
          status: 'error',
          args: { limit: 50 },
          detail: '{"status":"failed","code":"SESSION_QUERY_INVALID_LIMIT","message":"limit must be an integer from 1 to 20; omit it or pass null for the default"}',
          at: 0,
        },
        {
          kind: 'tool',
          key: 't1',
          name: 'list_sessions',
          status: 'done',
          args: { cwd: 'H:\\Code\\dsh-plugins' },
          detail: JSON.stringify({
            status: 'ok',
            items: [
              { sessionId: '25bcb077-203f-48af-bfb7-6d348cea2233', title: 'Research ZCode sandboxing', cwd: 'H:\\Code\\DeepSeek-Bot' },
              { sessionId: 'd30f3e77-bc9b-4e18-8b42-7565d5a22403', title: '整理 dsh-dot 界面', cwd: 'H:\\Code\\dsh-plugins' },
            ],
          }),
          at: 1,
        },
        { kind: 'tool', key: 't2', name: 'dot_answer', status: 'done', args: { id: 'ap-23', allow: true }, detail: 'Answered ap-23 for session-f922364c-9f84-4ca4-af18-38f650070997.', at: 2 },
      ],
    }
    const root = createRoot(document.getElementById('root')!)
    await act(async () => { root.render(<ChatPanel locale="zh" api={makeApi(snapshot)} onOpenSession={() => {}} />) })
    await act(async () => { await Promise.resolve() })

    expect(document.body.textContent).toContain('处理请求 · 3 个操作')
    expect(document.body.textContent).toContain('列出历史会话 → 处理请求')

    // Expanding the outer group reveals 3 collapsed one-line rows without dumping raw JSON or expanded bodies.
    const toggle = document.querySelector<HTMLButtonElement>('.dsh-stub-disclosure__row')!
    await act(async () => { toggle.click() })
    const group = document.querySelector('.dsh-dot-tool-group')!
    const childRows = [...group.querySelectorAll<HTMLButtonElement>('.dsh-stub-disclosure__row')]
    expect(childRows).toHaveLength(3)
    expect(group.querySelectorAll('.dsh-dot-tool-body')).toHaveLength(0)
    expect(group.textContent).toContain('列出历史会话')
    expect(group.textContent).toContain('limit must be an integer from 1 to 20')
    expect(group.textContent).toContain('dsh-plugins · 找到 2 个会话')
    expect(group.textContent).toContain('ap-23 · 批准')
    expect(group.textContent).not.toContain('SESSION_QUERY_INVALID_LIMIT')
    expect(group.textContent).not.toContain('"status":"ok"')

    // Clicking an individual tool row expands only that single tool's human-formatted detail.
    await act(async () => { childRows[1]!.click() })
    const openBodies = group.querySelectorAll('.dsh-dot-tool-body')
    expect(openBodies).toHaveLength(1)
    expect(openBodies[0]!.textContent).toContain('• Research ZCode sandboxing（DeepSeek-Bot）')
    expect(openBodies[0]!.textContent).toContain('• 整理 dsh-dot 界面（dsh-plugins）')
    expect(openBodies[0]!.textContent).not.toContain('25bcb077')

    await act(async () => { childRows[2]!.click() })
    expect(group.querySelectorAll('.dsh-dot-tool-body')).toHaveLength(2)
    expect(group.textContent).toContain('已处理 ap-23（#f92236）')

    await act(async () => { root.unmount() })
  })

  it('keeps the panel mounted when one tool call becomes two', async function () {
    const tool = function (key, at, status) {
      return { kind: 'tool', key: key, name: 'list_sessions', status: status, args: {}, at: at } as ChatItem
    }
    const first: ChatSnapshot = {
      sessionId: 'dot-1', running: true, streaming: '', rev: 1, itemsRev: 1,
      items: [tool('t1', 1, 'running')],
    }
    const second: ChatSnapshot = {
      sessionId: 'dot-1', running: true, streaming: '', rev: 2, itemsRev: 2,
      items: [tool('t1', 1, 'done'), tool('t2', 2, 'running')],
    }
    let pending = function (_value) {}
    let armed = false
    const api = makeApi(first)
    api.wait = function (_rev, _itemsRev, signal) {
      return new Promise(function (resolve) {
        signal.addEventListener('abort', function () { resolve(undefined) }, { once: true })
        if (armed === false) { armed = true; pending = resolve }
      })
    }
    const root = createRoot(document.getElementById('root') as HTMLElement)
    await act(async function () { root.render(<ChatPanel locale='en' api={api} onOpenSession={function () {}} />) })
    await act(async function () { await Promise.resolve(); await Promise.resolve() })
    expect(document.querySelector('.dsh-dot-chat')).not.toBeNull()
    expect(document.body.textContent).toContain('List sessions')
    expect(document.body.textContent).not.toContain('2 actions')
    await act(async function () { pending(second); await Promise.resolve(); await Promise.resolve() })
    expect(document.querySelector('.dsh-dot-chat')).not.toBeNull()
    expect(document.body.textContent).toContain('List sessions ' + String.fromCharCode(183) + ' 2 actions')
    await act(async function () { root.unmount() })
  })

  it('opens the settings drawer with proposal count badge, header status, tab switching, and close button', async () => {
    const snapshot: ChatSnapshot = { sessionId: 'dot-1', running: false, streaming: '', rev: 1, itemsRev: 1, items: [] }
    const base = makeApi(snapshot)
    const api: ChatApi = {
      ...base,
      settingProposals: async () => [{ id: 'p-1', field: 'scope', before: 'all', after: 'tracked', reason: 'test', createdAt: 1 }],
    }
    const root = createRoot(document.getElementById('root')!)
    await act(async () => { root.render(<ChatPanel locale="zh" api={api} onOpenSession={() => {}} />) })
    await act(async () => { await Promise.resolve() })

    const gear = document.querySelector<HTMLButtonElement>('button[aria-label="设置"]')!
    await act(async () => { gear.click() })
    await act(async () => { await Promise.resolve() })

    const drawer = document.querySelector('[role="dialog"]')!
    expect(drawer.querySelector('.dsh-dot-nav-badge')?.textContent).toBe('1')
    expect(drawer.querySelector('.dsh-dot-settings-title')?.textContent).toBe('设置')

    // Trigger a save and confirm the non-jumping header status appears.
    const trackedTab = [...drawer.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(node => node.textContent === '仅她跟进的任务')!
    await act(async () => { trackedTab.click() })
    await act(async () => { await Promise.resolve() })
    expect(drawer.querySelector('.dsh-dot-settings-status')?.textContent).toContain('已保存')

    // Switch across the other 3 pages and check header titles.
    const navButtons = [...drawer.querySelectorAll<HTMLButtonElement>('.dsh-dot-settings-nav button')]
    await act(async () => { navButtons[1]!.click() })
    expect(drawer.querySelector('.dsh-dot-settings-title')?.textContent).toBe('人设与约定')
    expect(drawer.querySelector('.dsh-dot-settings-status')).toBeNull()

    await act(async () => { navButtons[2]!.click() })
    expect(drawer.querySelector('.dsh-dot-settings-title')?.textContent).toBe('上下文用量')

    await act(async () => { navButtons[3]!.click() })
    expect(drawer.querySelector('.dsh-dot-settings-title')?.textContent).toBe('运行轨迹')

    const close = drawer.querySelector<HTMLButtonElement>('button[aria-label="关闭设置"]')!
    await act(async () => { close.click() })
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => { root.unmount() })
  })
})
