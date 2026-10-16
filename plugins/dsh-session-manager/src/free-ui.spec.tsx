import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { DeleteChatDialog } from './free-panel.tsx'
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

describe('delete chat dialog', () => {
  it('confirms a delete through the host, keeps a cleanup-pending failure, and follows the locale', async () => {
    await useDom(async dom => {
      const deleteSession = vi.fn(async () => ({ phase: 'cleanup-pending' as const }))
      const host: SessionHost = {
        list: {
          getSnapshot: () => listed([session('project', { classification: 'ordinary', displayTitle: 'Project' })]),
          subscribe: () => () => {},
        },
        capabilities: async () => ({ retry: false, freeSession: false, deleteSession: true }),
        deleteSession,
      }
      const model = createFreeChatModel(host)
      await model.reloadCapabilities()
      let root: Root | undefined
      const render = (locale: 'en' | 'zh') => {
        root!.render(<DeleteChatDialog model={model} locale={locale} />)
      }
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          render('en')
        })
        const text = () => dom.window.document.body.textContent ?? ''
        expect(text()).not.toContain('Project files remain')
        await act(async () => { model.requestDelete('project') })
        expect(text()).toContain('Project files remain')
        const focused = [...dom.window.document.querySelectorAll<HTMLElement>('[data-modal-autofocus]')]
        expect(focused.map(item => item.textContent)).toEqual(['Cancel'])
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
        expect(draft?.hasAttribute('data-modal-autofocus')).toBe(true)
        expect(dom.window.document.querySelector('button[data-modal-autofocus]')?.textContent).not.toBe('Send')
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
