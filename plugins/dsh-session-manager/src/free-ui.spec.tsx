import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { COPY_THREAD_FAILED } from './copy-action.ts'
import { DeleteChatDialog, FreeChatPanel } from './free-panel.tsx'
import { createFreeChatModel, createRetryModel, type SessionHost } from './session-actions.ts'
import { UserMessageActions } from './user-actions.tsx'
import { failureText } from './ui-copy.ts'
import type { ListedSession } from './free-list.ts'

function listed(rows: ListedSession[]) {
  return {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, row])),
    phase: 'ready' as const,
  }
}

function session(id: string, patch: Partial<ListedSession> = {}): ListedSession {
  return { id, displayTitle: id, running: false, updatedAt: Date.parse('2026-10-07T01:00:00Z'), classification: 'free', ...patch }
}

async function useDom(run: (dom: JSDOM) => Promise<void>): Promise<void> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const previous = new Map<string, unknown>()
  const assign = (key: string, value: unknown) => {
    previous.set(key, (globalThis as Record<string, unknown>)[key])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  assign('window', dom.window)
  assign('document', dom.window.document)
  assign('HTMLElement', dom.window.HTMLElement)
  assign('KeyboardEvent', dom.window.KeyboardEvent)
  assign('MouseEvent', dom.window.MouseEvent)
  assign('Node', dom.window.Node)
  assign('IS_REACT_ACT_ENVIRONMENT', true)
  try {
    await run(dom)
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key]
      else Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    dom.window.close()
  }
}

describe('free chat panel', () => {
  it('lists only free rows, creates through the host, and follows the locale of a delete failure', async () => {
    await useDom(async dom => {
      const create = vi.fn(async () => 'made')
      const openSession = vi.fn()
      const deleteSession = vi.fn(async () => ({ phase: 'cleanup-pending' as const, releasedSelection: false }))
      const host: SessionHost = {
        list: {
          getSnapshot: () => listed([
            session('alpha', { displayTitle: 'Alpha' }),
            session('project', { classification: 'ordinary', displayTitle: 'Project' }),
            session('child', { origin: 'subagent', displayTitle: 'Child' }),
          ]),
          subscribe: () => () => {},
        },
        capabilities: async () => ({ retry: false, freeSession: true, deleteSession: true }),
        create,
        openSession,
        deleteSession,
      }
      const model = createFreeChatModel(host)
      await model.reloadCapabilities()
      let root: Root | undefined
      const render = (locale: 'en' | 'zh') => {
        root!.render(<><FreeChatPanel model={model} locale={locale} /><DeleteChatDialog model={model} locale={locale} /></>)
      }
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          render('en')
        })
        const text = () => dom.window.document.body.textContent ?? ''
        expect(text()).toContain('Alpha')
        expect(text()).not.toContain('Project')
        expect(text()).not.toContain('Child')
        const createButton = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'New chat')
        await act(async () => { createButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(create.mock.calls[0]?.[0]).toEqual({ kind: 'free' })
        expect(openSession).toHaveBeenCalledWith('made')
        await act(async () => { model.requestDelete('project') })
        expect(text()).toContain('Project files remain')
        await act(async () => { model.confirmDelete() })
        expect(text()).toContain(failureText('en', { code: 'session/delete-pending' }))
        await act(async () => { render('zh') })
        expect(text()).toContain(failureText('zh', { code: 'session/delete-pending' }))
        expect(text()).not.toContain(failureText('en', { code: 'session/delete-pending' }))
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })
})

describe('user message actions', () => {
  it('retries without text, edits plain text, and renders the failure in the current locale', async () => {
    await useDom(async dom => {
      const previewRetry = vi.fn(async () => ({ branchRevision: 4, eligible: false, reason: 'running' }))
      const retry = vi.fn(async (body: { text?: string }) => body)
      const host: SessionHost = {
        list: { getSnapshot: () => listed([]), subscribe: () => () => {} },
        capabilities: async () => ({ retry: true, freeSession: false, deleteSession: false }),
        previewRetry,
        retry,
      }
      const model = createRetryModel(host)
      await model.load()
      let root: Root | undefined
      const render = (locale: 'zh' | 'en') => {
        root!.render(
          <UserMessageActions messageId="m" text="original plain" sessionId="s" locale={locale} model={model} />,
        )
      }
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          render('zh')
        })
        const button = (label: string) => [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === label)
        const retryButton = button('重试')
        expect(retryButton).toBeTruthy()
        await act(async () => {
          retryButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
          await previewRetry.mock.results[0]?.value
        })
        expect(retry).not.toHaveBeenCalled()
        expect(dom.window.document.body.textContent).toContain(failureText('zh', { code: 'session/retry-blocked', reason: 'running' }))
        await act(async () => { render('en') })
        expect(dom.window.document.body.textContent).toContain(failureText('en', { code: 'session/retry-blocked', reason: 'running' }))
        expect(dom.window.document.body.textContent).not.toContain('仍在运行')
        previewRetry.mockResolvedValue({ branchRevision: 4, eligible: true, inputRevision: 'input-4' })
        await act(async () => { button('Edit and resend')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        const draft = dom.window.document.querySelector('textarea')
        expect(draft?.value).toBe('original plain')
        await act(async () => { button('Send')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(retry.mock.calls[0]?.[0]).toMatchObject({ text: 'original plain', expectedRevision: 4, expectedInputRevision: 'input-4' })
        expect(Object.hasOwn(retry.mock.calls[0]?.[0] as object, 'text')).toBe(true)
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('renders a native input revision conflict as a stale retry', async () => {
    await useDom(async dom => {
      const previewRetry = vi.fn(async () => ({ branchRevision: 1, eligible: true, inputRevision: 'tok' }))
      const retry = vi.fn(async () => {
        throw Object.assign(new Error('input moved'), { code: 'session/retry-input' })
      })
      const host: SessionHost = {
        list: { getSnapshot: () => listed([]), subscribe: () => () => {} },
        capabilities: async () => ({ retry: true, freeSession: false, deleteSession: false }),
        previewRetry,
        retry,
      }
      const model = createRetryModel(host)
      await model.load()
      let root: Root | undefined
      const render = (locale: 'zh' | 'en') => {
        root!.render(
          <UserMessageActions messageId="m" text="original plain" sessionId="s" locale={locale} model={model} />,
        )
      }
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          render('zh')
        })
        const retryButton = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === '重试')
        await act(async () => {
          retryButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
          await previewRetry.mock.results[0]?.value
          await retry.mock.results[0]?.value.catch(() => undefined)
        })
        const stale = failureText('zh', { code: 'session/retry-input' })
        expect(dom.window.document.body.textContent).toContain(stale)
        expect(dom.window.document.body.textContent).not.toContain('无法确认这个操作的结果')
        await act(async () => { render('en') })
        expect(dom.window.document.body.textContent).toContain(failureText('en', { code: 'session/retry-input' }))
        expect(dom.window.document.body.textContent).not.toContain(stale)
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('retires an edit when session A unmounts and does not send it from session B', async () => {
    await useDom(async dom => {
      const previewRetry = vi.fn(async () => ({ branchRevision: 1, eligible: true, inputRevision: 'tok' }))
      const retry = vi.fn()
      const host: SessionHost = {
        list: { getSnapshot: () => listed([]), subscribe: () => () => {} },
        capabilities: async () => ({ retry: true, freeSession: true, deleteSession: false }),
        previewRetry,
        retry,
      }
      const model = createRetryModel(host)
      await model.load()
      let root: Root | undefined
      const mount = (sessionId: string) => {
        root = createRoot(dom.window.document.getElementById('root')!)
        root.render(
          <UserMessageActions messageId="m" text="draft A" sessionId={sessionId} locale="en" model={model} />,
        )
      }
      try {
        await act(async () => { mount('A') })
        const edit = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === 'Edit and resend')
        await act(async () => { edit!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(dom.window.document.querySelector('textarea')?.value).toBe('draft A')
        await act(async () => { root?.unmount() })
        expect(model.getSnapshot().editing).toBe(false)
        await act(async () => { mount('B') })
        expect(dom.window.document.querySelector('textarea')).toBeNull()
        await model.sendEdit('B', 'm', new AbortController().signal)
        expect(retry).not.toHaveBeenCalled()
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })
})

describe('free chat panel failures', () => {
  it('explains a busy free-chat fork in both locales and retries through the existing action', async () => {
    await useDom(async dom => {
      const forkSession = vi.fn(async (): Promise<string> => {
        throw Object.assign(new Error('fork refused'), {
          name: 'SessionForkError',
          rpcError: { code: 'session/agent-busy', details: { reason: 'free-session-work-active' } },
        })
      })
      const openSession = vi.fn()
      const model = createFreeChatModel({
        list: { getSnapshot: () => listed([session('chat')]), subscribe: () => () => {} },
        capabilities: async () => ({ retry: false, freeSession: true, deleteSession: false }),
        forkSession,
        openSession,
      })
      await model.reloadCapabilities()
      let root: Root | undefined
      const chooseFork = async (menuLabel: string, forkLabel: string) => {
        await act(async () => {
          dom.window.document.querySelector(`[aria-label="${menuLabel}"]`)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        })
        const fork = [...dom.window.document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === forkLabel)
        await act(async () => { fork!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
      }
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<FreeChatPanel model={model} locale="en" />)
        })
        await chooseFork('Chat actions', 'Fork')
        expect(forkSession).toHaveBeenCalledWith('chat')
        expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toBe(
          'This chat is still running. Wait for the current work to finish, then try again.',
        )
        expect(openSession).not.toHaveBeenCalled()
        await act(async () => { root!.render(<FreeChatPanel model={model} locale="zh" />) })
        expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toBe(
          '这个聊天仍在运行。请等待当前工作结束后再试。',
        )
        forkSession.mockResolvedValueOnce('forked')
        await chooseFork('聊天操作', '分叉')
        expect(forkSession).toHaveBeenCalledTimes(2)
        expect(openSession).toHaveBeenCalledWith('forked')
        expect(dom.window.document.querySelector('[role="alert"]')).toBeNull()
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('shows a host list error instead of an empty catalog', async () => {
    await useDom(async dom => {
      const model = createFreeChatModel({
        list: {
          getSnapshot: () => ({ ids: [], byId: {}, phase: 'error' as const, error: { code: 'session/catalog', message: 'catalog down' } }),
          subscribe: () => () => {},
        },
      })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<FreeChatPanel model={model} locale="en" />)
        })
        expect(dom.window.document.body.textContent).toContain('catalog down')
        expect(dom.window.document.body.textContent).not.toContain('No free chats yet.')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('keeps the copy failure visible when the clipboard rejects', async () => {
    await useDom(async dom => {
      const model = createFreeChatModel({
        list: {
          getSnapshot: () => listed([session('chat')]),
          subscribe: () => () => {},
        },
      })
      const previousNavigator = globalThis.navigator
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        writable: true,
        value: { clipboard: { writeText: async () => { throw new Error('denied') } } },
      })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<FreeChatPanel model={model} locale="en" />)
        })
        const menu = dom.window.document.querySelector('[aria-label="Chat actions"]')
        await act(async () => { menu!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        const copy = [...dom.window.document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Copy thread ID')
        await act(async () => { copy!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(dom.window.document.querySelector('[role="menu"]')).not.toBeNull()
        expect(dom.window.document.body.textContent).toContain(COPY_THREAD_FAILED.en)
      } finally {
        Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: previousNavigator })
        await act(async () => { root?.unmount() })
      }
    })
  })
})
