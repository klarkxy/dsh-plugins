import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { ContinueGhost, WelcomeBackCard } from './presence-panel.tsx'
import { createContinueModel, createWelcomeBackModel, type PresenceHost } from './presence-model.ts'
import { WELCOME_BACK_COMPACT_ENDPOINT, WELCOME_BACK_PREPARE_ENDPOINT } from './contracts.ts'

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
  assign('HTMLTextAreaElement', dom.window.HTMLTextAreaElement)
  assign('KeyboardEvent', dom.window.KeyboardEvent)
  assign('MouseEvent', dom.window.MouseEvent)
  assign('Node', dom.window.Node)
  assign('MutationObserver', dom.window.MutationObserver)
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

function input(draft: string, phase = 'plain', attachments = 0) {
  return {
    useInput: <T,>(selector: (state: { draft: string; phase: string; attachmentIds: unknown[] }) => T) =>
      selector({ draft, phase, attachmentIds: Array.from({ length: attachments }) }),
    useSession: <T,>(selector: (state: { blank: boolean }) => T) => selector({ blank: false }),
  }
}

function host(patch: Partial<PresenceHost> = {}): PresenceHost {
  return {
    rpc: { call: vi.fn(async () => ({ ok: true, value: { text: null } })) },
    ...patch,
  }
}



describe('continue ghost', () => {
  it('replaces the shipped placeholder text on an empty composer and fills the draft on Tab', async () => {
    await useDom(async dom => {
      const setDraft = vi.fn()
      const suggest = vi.fn(async () => ({ ok: true, value: { text: null, seq: 4, fallback: true } }))
      const model = createContinueModel(host({ rpc: { call: suggest } }))
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(
            <div data-composer-card="true">
              <textarea data-composer-input="true" data-placeholder="发消息或创建任务" />
              <div data-composer-placeholder="true">发消息或创建任务</div>
              <ContinueGhost sessionId="s" {...input('')} inputActions={{ setDraft }} model={model} locale="zh" />
            </div>,
          )
        })
        // The anchor renders inside the same container in tests; the card lookup
        // falls back to the document-level composer card.
        const placeholder = dom.window.document.querySelector('[data-composer-placeholder]')!
        expect(suggest).toHaveBeenCalledOnce()
        expect(placeholder.textContent).toBe('继续')
        // Tab on the composer editor (a text-entry element) fills the draft.
        const editor = dom.window.document.querySelector('[data-composer-input]')!
        await act(async () => {
          editor.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
        })
        expect(setDraft).toHaveBeenCalledWith('继续')
        // Tab on a non-editable control never fills the draft.
        setDraft.mockClear()
        await act(async () => {
          placeholder.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
        })
        expect(setDraft).not.toHaveBeenCalled()
        // Tab in some other text field on the page is not stolen either.
        const foreign = dom.window.document.createElement('textarea')
        dom.window.document.body.appendChild(foreign)
        await act(async () => {
          foreign.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
        })
        expect(setDraft).not.toHaveBeenCalled()
        // An in-progress IME composition on the composer keeps Tab.
        await act(async () => {
          editor.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, isComposing: true }))
        })
        await act(async () => {
          editor.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, keyCode: 229 }))
        })
        expect(setDraft).not.toHaveBeenCalled()
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('waits until the session stops running, then generates once for the ended turn', async () => {
    await useDom(async dom => {
      const suggest = vi.fn(async (_channel: string, _endpoint: string, payload: { knownSeq?: number }) => ({
        ok: true,
        value: payload.knownSeq === undefined ? { text: '继续处理重启验证', seq: 4 } : { text: '继续处理重启验证', seq: payload.knownSeq },
      }))
      const model = createContinueModel(host({ rpc: { call: suggest } }))
      let running = true
      let root: Root | undefined
      const render = () => {
        root!.render(
          <div data-composer-card="true">
            <textarea data-composer-input="true" data-placeholder="发消息或创建任务" />
            <div data-composer-placeholder="true">发消息或创建任务</div>
            <ContinueGhost sessionId="s" {...input('')}
              useSessionStatus={<T,>(selector: (state: ReadonlyMap<string, { running?: boolean }>) => T) =>
                selector(new Map([['s', { running }]]))}
              inputActions={{ setDraft: vi.fn() }} model={model} locale="zh" />
          </div>,
        )
      }
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          render()
        })
        expect(suggest).not.toHaveBeenCalled()
        running = false
        await act(async () => { render() })
        expect(suggest).toHaveBeenCalledOnce()
        expect(dom.window.document.querySelector('[data-composer-placeholder]')!.textContent).toBe('继续处理重启验证')
        await act(async () => { render() })
        expect(suggest).toHaveBeenCalledOnce()
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('keeps the shipped placeholder while the latest turn is still open', async () => {
    await useDom(async dom => {
      const setDraft = vi.fn()
      const model = createContinueModel(host({
        rpc: { call: vi.fn(async () => ({ ok: true, value: { text: null, pending: true } })) },
      }))
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(
            <div data-composer-card="true">
              <textarea data-composer-input="true" data-placeholder="发消息或创建任务" />
              <div data-composer-placeholder="true">发消息或创建任务</div>
              <ContinueGhost sessionId="s" {...input('')} inputActions={{ setDraft }} model={model} locale="zh" />
            </div>,
          )
        })
        const placeholder = dom.window.document.querySelector('[data-composer-placeholder]')!
        expect(placeholder.textContent).toBe('发消息或创建任务')
        await act(async () => {
          placeholder.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
        })
        expect(setDraft).not.toHaveBeenCalled()
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('shows the model suggestion when the host resolves one', async () => {
    await useDom(async dom => {
      const model = createContinueModel(host({
        rpc: { call: vi.fn(async () => ({ ok: true, value: { text: '继续处理重启验证', seq: 4 } })) },
      }))
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(
            <div data-composer-card="true">
              <textarea data-composer-input="true" data-placeholder="发消息或创建任务" />
              <div data-composer-placeholder="true">发消息或创建任务</div>
              <ContinueGhost sessionId="s" {...input('')} inputActions={{ setDraft: vi.fn() }} model={model} locale="zh" />
            </div>,
          )
        })
        const placeholder = dom.window.document.querySelector('[data-composer-placeholder]')!
        expect(placeholder.textContent).toBe('继续处理重启验证')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('restores the original placeholder when the draft gains text, and re-applies after a host re-render', async () => {
    await useDom(async dom => {
      const model = createContinueModel(host({
        rpc: { call: vi.fn(async () => ({ ok: true, value: { text: null, seq: 4, fallback: true } })) },
      }))
      let root: Root | undefined
      const render = (draft: string) => {
        root!.render(
          <div data-composer-card="true">
            <textarea data-composer-input="true" data-placeholder="发消息或创建任务" />
            <div data-composer-placeholder="true">发消息或创建任务</div>
            <ContinueGhost sessionId="s" {...input(draft)} inputActions={{ setDraft: vi.fn() }} model={model} locale="zh" />
          </div>,
        )
      }
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          render('')
        })
        const placeholder = dom.window.document.querySelector('[data-composer-placeholder]')!
        expect(placeholder.textContent).toBe('继续')
        // A host re-render that resets the text is re-applied by the observer.
        await act(async () => {
          placeholder.textContent = '发消息或创建任务'
          await Promise.resolve()
        })
        expect(placeholder.textContent).toBe('继续')
        await act(async () => { render('typing') })
        expect(placeholder.textContent).toBe('发消息或创建任务')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('never touches the placeholder for typed drafts, blank sessions, attachments, or inside dialogs', async () => {
    await useDom(async dom => {
      const setDraft = vi.fn()
      const model = createContinueModel(host())
      let root: Root | undefined
      const render = (draft: string, blank: boolean, attachments = 0) => {
        root!.render(
          <div data-composer-card="true">
            <textarea data-composer-input="true" data-placeholder="发消息或创建任务" />
            <div data-composer-placeholder="true">发消息或创建任务</div>
            <ContinueGhost sessionId="s"
              useInput={<T,>(selector: (state: { draft: string; phase: string; attachmentIds: unknown[] }) => T) =>
                selector({ draft, phase: 'plain', attachmentIds: Array.from({ length: attachments }) })}
              useSession={<T,>(selector: (state: { blank: boolean }) => T) => selector({ blank })}
              inputActions={{ setDraft }} model={model} locale="en" />
          </div>,
        )
      }
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          render('typed', false)
        })
        const placeholder = dom.window.document.querySelector('[data-composer-placeholder]')!
        expect(placeholder.textContent).toBe('发消息或创建任务')
        await act(async () => { render('', true) })
        expect(placeholder.textContent).toBe('发消息或创建任务')
        await act(async () => { render('', false, 1) })
        expect(placeholder.textContent).toBe('发消息或创建任务')
        // Tab inside an open dialog is never stolen.
        await act(async () => { render('', false) })
        const dialog = dom.window.document.createElement('div')
        dialog.setAttribute('role', 'dialog')
        const modalEditor = dom.window.document.createElement('textarea')
        dialog.appendChild(modalEditor)
        dom.window.document.body.appendChild(dialog)
        await act(async () => {
          modalEditor.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
        })
        expect(setDraft).not.toHaveBeenCalled()
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })
})

describe('welcome-back card', () => {
  /** The card gates on the slot's turn props: latest loaded turn, no newer response. */
  function turnProps(turn: number, lastTurn = turn, respondedAt = 1000) {
    return {
      turn: { turn, end: { time: respondedAt } },
      useChat: <T,>(selector: (state: { timeline: { turnOrder: readonly number[] } }) => T) =>
        selector({ timeline: { turnOrder: Array.from({ length: lastTurn }, (_, index) => index + 1) } }),
    }
  }

  function prepareHost(prepare: unknown, compact?: unknown) {
    const calls: { endpoint: string; payload: unknown }[] = []
    const rpc: PresenceHost['rpc'] = {
      call: vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
        calls.push({ endpoint, payload })
        if (endpoint === WELCOME_BACK_PREPARE_ENDPOINT) return { ok: true, value: prepare }
        if (endpoint === WELCOME_BACK_COMPACT_ENDPOINT) return { ok: true, value: compact ?? { compacted: true, shadowedTokens: 1234 } }
        return { ok: false, error: { code: 'session-manager/failed', message: 'unknown endpoint' } }
      }),
    }
    return { host: { rpc }, calls }
  }

  it('shows recap and compaction after the idle thresholds, then settles dismissal per activity', async () => {
    await useDom(async dom => {
      const { host: presence, calls } = prepareHost({
        show: true,
        sessionId: 's',
        lastResponseAt: 1000,
        idleMinutes: 90,
        recap: { summary: '修复菜单', progress: '已改完', nextStep: '重启验证' },
        compactSuggested: true,
        compactAvailable: true,
      })
      const model = createWelcomeBackModel(presence, () => 'compact-request-1')
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<WelcomeBackCard sessionId="s" {...turnProps(3)} model={model} locale="zh" />)
        })
        await act(async () => { await model.check('s') })
        const text = () => dom.window.document.body.textContent ?? ''
        expect(text()).toContain('欢迎回来')
        expect(text()).toContain('修复菜单')
        expect(text()).toContain('重启验证')
        expect(text()).toContain('缓存可能已失效')
        const compact = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === '压缩上下文')!
        await act(async () => {
          compact.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        })
        expect(calls.find(call => call.endpoint === WELCOME_BACK_COMPACT_ENDPOINT)?.payload)
          .toEqual({ sessionId: 's', requestId: 'compact-request-1' })
        expect(text()).toContain('上下文已压缩')
        expect(text()).toContain('1234')
        await act(async () => {
          const close = dom.window.document.querySelector<HTMLButtonElement>('.dsh-welcome-card-close')!
          expect(close.className).toContain('dsh-stub-button--ghost')
          expect(close.className).toContain('dsh-stub-button--sm')
          expect(close.querySelector('[data-icon="close-fill"]')).toBeTruthy()
          close.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        })
        expect(text()).not.toContain('欢迎回来')
        // A repeated return for the same activity mark does not reshow the card.
        await act(async () => { await model.check('s') })
        expect(text()).not.toContain('欢迎回来')
        expect(calls.filter(call => call.endpoint === WELCOME_BACK_PREPARE_ENDPOINT).length).toBe(1)
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('offers both choices without a root compaction capability and only continues on click', async () => {
    await useDom(async dom => {
      const { host, calls } = prepareHost({
        show: true, sessionId: 's', lastResponseAt: 1000, idleMinutes: 90,
        recap: { summary: '修复菜单', progress: '已完成', nextStep: '验证' },
        compactSuggested: true, compactAvailable: false, compactMinutes: 60,
      })
      let finish!: () => void
      const continueInNewSession = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
      const compactContext = vi.fn(async () => {})
      const model = createWelcomeBackModel({ ...host, continueInNewSession, compactContext })
      const root = createRoot(dom.window.document.getElementById('root')!)
      try {
        await act(async () => {
          root.render(<WelcomeBackCard sessionId="s" {...turnProps(3)} model={model} locale="zh" />)
          await model.check('s')
        })
        const buttons = () => [...dom.window.document.querySelectorAll<HTMLButtonElement>('.dsh-welcome-card-actions button')]
        expect(buttons().map(button => button.textContent)).toEqual(['压缩上下文', '在新会话中继续'])
        expect(continueInNewSession).not.toHaveBeenCalled()
        expect(compactContext).not.toHaveBeenCalled()
        await act(async () => { buttons()[1]!.click() })
        expect(continueInNewSession).toHaveBeenCalledWith('s', expect.objectContaining({ summary: '修复菜单' }), 'zh', expect.any(AbortSignal))
        expect(buttons().every(button => button.disabled)).toBe(true)
        await model.compact('s')
        expect(compactContext).not.toHaveBeenCalled()
        await act(async () => { finish(); await Promise.resolve() })
        expect(dom.window.document.querySelector('.dsh-welcome-card')).toBeNull()
        expect(calls.filter(call => call.endpoint !== WELCOME_BACK_PREPARE_ENDPOINT)).toEqual([])
      } finally { await act(async () => { root.unmount() }) }
    })
  })

  it('cancels pending new-session navigation when the user dismisses or sends directly', async () => {
    const { host } = prepareHost({ show: true, sessionId: 's', lastResponseAt: 1000,
      recap: null, compactSuggested: true, compactAvailable: false })
    let signal!: AbortSignal
    const continueInNewSession = vi.fn((_id: string, _recap: unknown, _locale: unknown, received: AbortSignal) => {
      signal = received
      return new Promise<void>((_resolve, reject) => received.addEventListener('abort', () => reject(received.reason), { once: true }))
    })
    const model = createWelcomeBackModel({ ...host, continueInNewSession })
    await model.check('s')
    const action = model.continueInNewSession('s', 'zh')
    expect(signal.aborted).toBe(false)
    model.dismiss('s')
    expect(signal.aborted).toBe(true)
    await action
    expect(model.getSnapshot('s').card).toBeUndefined()
  })

  it('reports native command admission without claiming successful compaction and allows retries', async () => {
    await useDom(async dom => {
      const { host } = prepareHost({ show: true, sessionId: 's', lastResponseAt: 1000,
        recap: null, compactSuggested: true, compactAvailable: false })
      const compactContext = vi.fn().mockRejectedValueOnce({ code: 'session-manager/unavailable' }).mockResolvedValue(undefined)
      const model = createWelcomeBackModel({ ...host, compactContext })
      const root = createRoot(dom.window.document.getElementById('root')!)
      try {
        await act(async () => {
          root.render(<WelcomeBackCard sessionId="s" {...turnProps(3)} model={model} locale="zh" />)
          await model.check('s')
          await model.compact('s')
        })
        expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain('不')
        await act(async () => { await model.compact('s') })
        const text = dom.window.document.body.textContent ?? ''
        expect(text).toContain('已调用宿主压缩命令')
        expect(text).not.toContain('上下文已压缩')
        expect(compactContext).toHaveBeenCalledTimes(2)
        expect(dom.window.document.querySelector('[role="alert"]')).toBeNull()
      } finally { await act(async () => { root.unmount() }) }
    })
  })

  it('renders recap-only content and hides when the host says not to show', async () => {
    await useDom(async dom => {
      const { host: presence } = prepareHost({
        show: true,
        sessionId: 's',
        lastResponseAt: 2000,
        idleMinutes: 20,
        recap: { summary: 'Fix the menu', progress: '', nextStep: '' },
        compactSuggested: false,
        compactAvailable: false,
      })
      const model = createWelcomeBackModel(presence)
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<WelcomeBackCard sessionId="s" {...turnProps(3)} model={model} locale="en" />)
        })
        await act(async () => { await model.check('s') })
        const text = () => dom.window.document.body.textContent ?? ''
        expect(text()).toContain('Welcome back')
        expect(text()).toContain('Fix the menu')
        expect(text()).not.toContain('Compact context')
        await act(async () => { model.dismiss('s') })
        expect(text()).not.toContain('Welcome back')
        // show:false answers never open the card.
        const quiet = prepareHost({ show: false })
        const silent = createWelcomeBackModel(quiet.host)
        await silent.check('s')
        expect(silent.getSnapshot('s').card).toBeUndefined()
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('stays hidden at older turns and once a newer response has landed', async () => {
    await useDom(async dom => {
      const { host: presence } = prepareHost({
        show: true,
        sessionId: 's',
        lastResponseAt: 1000,
        idleMinutes: 20,
        recap: { summary: '旧对话摘要', progress: '', nextStep: '' },
        compactSuggested: false,
        compactAvailable: false,
      })
      const model = createWelcomeBackModel(presence)
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          // The slot dispatches at every completed turn; an older tail never shows it.
          root.render(<WelcomeBackCard sessionId="s" {...turnProps(2, 3)} model={model} locale="zh" />)
        })
        await act(async () => { await model.check('s') })
        const text = () => dom.window.document.body.textContent ?? ''
        expect(text()).not.toContain('欢迎回来')
        // A turn whose response is newer than the prepared mark means the user
        // already continued; the stale recap never reappears at the new tail.
        await act(async () => {
          root!.render(<WelcomeBackCard sessionId="s" {...turnProps(4, 4, 5000)} model={model} locale="zh" />)
        })
        expect(text()).not.toContain('欢迎回来')
        // The latest turn with a matching response mark shows the card.
        await act(async () => {
          root!.render(<WelcomeBackCard sessionId="s" {...turnProps(3, 3)} model={model} locale="zh" />)
        })
        expect(text()).toContain('欢迎回来')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('recomputes the idle clock live and offers compaction once the threshold is crossed', async () => {
    await useDom(async dom => {
      vi.useFakeTimers()
      try {
        const start = Date.now()
        const { host: presence } = prepareHost({
          show: true,
          sessionId: 's',
          // Prepared just under the compact threshold; the live clock crosses it.
          lastResponseAt: start - 59 * 60_000,
          idleMinutes: 59,
          recap: { summary: '修复菜单', progress: '', nextStep: '' },
          compactSuggested: false,
          compactAvailable: true,
          compactMinutes: 60,
        })
        const model = createWelcomeBackModel(presence)
        let root: Root | undefined
        try {
          await act(async () => {
            root = createRoot(dom.window.document.getElementById('root')!)
            root.render(<WelcomeBackCard sessionId="s" {...turnProps(3)} model={model} locale="zh" />)
          })
          await act(async () => { await model.check('s') })
          const text = () => dom.window.document.body.textContent ?? ''
          expect(text()).toContain('59 分钟')
          expect(text()).not.toContain('缓存可能已失效')
          expect(text()).not.toContain('压缩上下文')
          await act(async () => { vi.advanceTimersByTime(2 * 60_000) })
          expect(text()).toContain('61 分钟')
          expect(text()).toContain('缓存可能已失效')
          expect(text()).toContain('压缩上下文')
        } finally {
          await act(async () => { root?.unmount() })
        }
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('dismisses the card when the composer leaves the plain phase', async () => {
    await useDom(async dom => {
      const { host: presence } = prepareHost({
        show: true,
        sessionId: 's',
        lastResponseAt: 1000,
        idleMinutes: 20,
        recap: { summary: '修复菜单', progress: '', nextStep: '' },
        compactSuggested: false,
        compactAvailable: false,
        compactMinutes: 0,
      })
      const model = createWelcomeBackModel(presence)
      let phase = 'plain'
      const useInput = <T,>(selector: (state: { draft: string; phase: string; attachmentIds: unknown[] }) => T) =>
        selector({ draft: '', phase, attachmentIds: [] })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<WelcomeBackCard sessionId="s" {...turnProps(3)} useInput={useInput} model={model} locale="zh" />)
        })
        await act(async () => { await model.check('s') })
        const text = () => dom.window.document.body.textContent ?? ''
        expect(text()).toContain('欢迎回来')
        phase = 'sending'
        await act(async () => {
          root!.render(<WelcomeBackCard sessionId="s" {...turnProps(3)} useInput={useInput} model={model} locale="zh" />)
        })
        expect(text()).not.toContain('欢迎回来')
        // Direct send only dismisses; it never triggers either context action.
        expect((presence.rpc!.call as ReturnType<typeof vi.fn>).mock.calls.every(call => call[1] === WELCOME_BACK_PREPARE_ENDPOINT)).toBe(true)
        // The dismiss marks the current activity answered; a re-check stays quiet.
        await act(async () => { await model.check('s') })
        expect(text()).not.toContain('欢迎回来')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('ignores composer phase changes without useInput or when already busy', async () => {
    await useDom(async dom => {
      const { host: presence } = prepareHost({
        show: true,
        sessionId: 's',
        lastResponseAt: 1000,
        idleMinutes: 20,
        recap: { summary: '修复菜单', progress: '', nextStep: '' },
        compactSuggested: false,
        compactAvailable: false,
        compactMinutes: 0,
      })
      const model = createWelcomeBackModel(presence)
      // An already-active composer phase at mount must not auto-dismiss.
      const useInput = <T,>(selector: (state: { draft: string; phase: string; attachmentIds: unknown[] }) => T) =>
        selector({ draft: '', phase: 'sending', attachmentIds: [] })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<WelcomeBackCard sessionId="s" {...turnProps(3)} useInput={useInput} model={model} locale="zh" />)
        })
        await act(async () => { await model.check('s') })
        expect(dom.window.document.body.textContent ?? '').toContain('欢迎回来')
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })
})
