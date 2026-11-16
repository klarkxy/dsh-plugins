import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ReplyView, ToolCallStatus, ToolCallView, ActivityDock, replyCards } from './client.tsx'
import { createViewStateStore } from './client-state.ts'
import type { ReplySnapshot, ReplyViewProps, ToolViewBlock } from './runtime.ts'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' })
vi.stubGlobal('window', dom.window)
vi.stubGlobal('document', dom.window.document)
vi.stubGlobal('navigator', dom.window.navigator)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let createRoot: typeof import('react-dom/client').createRoot
beforeAll(async () => { createRoot = (await import('react-dom/client')).createRoot })
afterEach(() => { document.body.innerHTML = '<div id="root"></div>' })

const view = { type: 'options', id: 'pick', options: [{ label: 'One' }, { label: 'Two' }] }
const card = (id: string): ToolViewBlock => ({
  kind: 'tool-result', callId: id, name: 'show_view',
  meta: { owner: 'dsh-deep-view', viewId: id, title: 'Choose', view, awaitReply: true },
})
function snapshot(blocks: ToolViewBlock[]): ReplySnapshot {
  return {
    order: blocks.map((_, i) => String(i)),
    locations: { getTurn: turn => turn === 2 ? blocks.map((_, i) => String(i)) : [] },
    nodes: { get: key => ({ kind: 'tool-call', data: { root: blocks[Number(key)] } }) },
  }
}
function props(blocks: ToolViewBlock[], call: ReplyViewProps['call']) {
  return {
    sessionId: 'session', turn: { turn: 2, status: 'closed' as const }, t: key => key,
    useChat: <T,>(selector: (snapshot: ReplySnapshot) => T) => selector(snapshot(blocks)), call,
    store: createViewStateStore(),
    useInput: <T,>(selector: (snapshot: { draft: string; phase: 'plain' }) => T) => selector({ draft: '', phase: 'plain' }),
    useSession: <T,>(selector: (snapshot: { running: boolean }) => T) => selector({ running: true }),
    inputActions: { setDraft: () => {}, persistDraft: () => {}, captureInsertion: () => ({}), insertText: () => true },
  }
}
describe('cards in the final reply', () => {
  it('uses only successful cards in this turn, including nested PTC results', () => {
    const one = card('one'), two = card('two')
    const data = snapshot([
      one, { callId: 'parent', subCalls: [two, one] },
      { ...card('bad'), isError: true },
      { ...card('foreign'), meta: { owner: 'other' } },
      { ...card('invalid'), meta: { owner: 'dsh-deep-view', view: { type: 'html' } } },
    ])
    expect(replyCards(data, 2)).toEqual([one, two])
    expect(replyCards(data, 1)).toEqual([])
  })
  it('shows a real card while running and only status when settled', () => {
    const store = createViewStateStore()
    const markup = renderToStaticMarkup(<ToolCallStatus sessionId="session" callId="one" phase="start" block={card('one')} t={key => key}
      store={store} call={async () => ({ ok: true, value: null })} useSession={selector => selector({ running: true })} />)
    expect(markup).toContain('Choose')
    expect(markup).not.toContain('show_view')
    const settled = renderToStaticMarkup(<ToolCallStatus sessionId="session" callId="one" phase="result" block={card('one')} t={key => key}
      store={store} call={async () => ({ ok: true, value: null })} useSession={selector => selector({ running: false })} />)
    expect(settled).toContain('prepared')
    expect(settled).not.toContain('Choose')
  })
  it('moves the only editable answer card into the dock and submits once', async () => {
    const one = card('one')
    const call = vi.fn(async (endpoint: string) => endpoint === 'pending'
      ? { ok: true, value: { id: 'one', sessionId: 'session', callId: 'one', title: 'Choose', view } }
      : { ok: true, value: { answered: true } })
    const p = props([one], call)
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<main>
      <ToolCallStatus sessionId="session" callId="one" phase="result" block={one} t={p.t} store={p.store} call={call} useSession={p.useSession} />
      <ActivityDock sessionId="session" callId="one" phase="result" block={one} t={p.t} store={p.store} call={call} useSession={p.useSession} useInput={p.useInput} inputActions={p.inputActions} />
    </main>))
    const dock = document.querySelector('.dvui-dock')!
    const button = dock.querySelector('button.dvui-option') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(document.querySelectorAll('.dvui-view:not(.dvui-settled)')).toHaveLength(1)
    await act(async () => button.click())
    await act(async () => (dock.querySelector('button.dvui-submit') as HTMLButtonElement).click())
    expect(call.mock.calls.filter(([endpoint]) => endpoint === 'reply')).toHaveLength(1)
    expect(call).toHaveBeenCalledWith('reply', { sessionId: 'session', viewId: 'one', action: 'pick', values: { selected: ['One'] } })
    expect(document.querySelector('.dvui-dock')).toBeNull()
    await act(async () => root.unmount())
  })
  it('retires a stale answer instead of offering endless retries', async () => {
    const one = card('one')
    const call = vi.fn(async (endpoint: string) => endpoint === 'pending'
      ? { ok: true, value: { id: 'one', sessionId: 'session', callId: 'one', title: 'Choose', view } }
      : { ok: false, error: { code: 'stale', message: 'stale' } })
    const p = props([one], call)
    p.store.setPending({ id: 'one', sessionId: 'session', callId: 'one', title: 'Choose', view })
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<ActivityDock sessionId="session" callId="one" phase="result" block={one} t={p.t} store={p.store} call={call} useSession={p.useSession} useInput={p.useInput} inputActions={p.inputActions} />))
    await act(async () => (document.querySelector('.dvui-dock button.dvui-option') as HTMLButtonElement).click())
    await act(async () => (document.querySelector('.dvui-dock button.dvui-submit') as HTMLButtonElement).click())
    expect(document.querySelector('.dvui-dock')).toBeNull()
    await act(async () => root.unmount())
  })
  it('fills the native composer without sending or losing the draft', async () => {
    const one = card('one')
    const call = vi.fn(async (endpoint: string) => endpoint === 'pending'
      ? { ok: true, value: { id: 'one', sessionId: 'session', callId: 'one', title: 'Choose', view } }
      : { ok: true, value: { answered: true } })
    const p = props([one], call)
    const setDraft = vi.fn(), persistDraft = vi.fn()
    p.inputActions = { ...p.inputActions, setDraft, persistDraft }
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<main>
      <ToolCallStatus sessionId="session" callId="one" phase="result" block={one} t={p.t} store={p.store} call={call} useSession={p.useSession} />
      <ActivityDock sessionId="session" callId="one" phase="result" block={one} t={p.t} store={p.store} call={call} useSession={p.useSession} useInput={p.useInput} inputActions={p.inputActions} />
    </main>))
    await act(async () => (document.querySelector('.dvui-dock button.dvui-option') as HTMLButtonElement).click())
    await act(async () => [...document.querySelectorAll('.dvui-dock button')].find(button => button.textContent === 'fillDraft')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    expect(setDraft).toHaveBeenCalledWith('Choose\nOne')
    expect(persistDraft).toHaveBeenCalledOnce()
    expect(call.mock.calls.filter(([endpoint]) => endpoint === 'reply')).toHaveLength(0)
    expect(document.querySelector('.dvui-dock')).toBeNull()
    await act(async () => root.unmount())
  })
  it('translates retained status with the current language', async () => {
    const p = props([], vi.fn(async () => ({ ok: true, value: null })))
    const listeners = new Set<() => void>()
    let locale = { active: 'en' }
    const store = createViewStateStore({ getSnapshot: () => locale, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } } })
    store.setPending({ id: 'one', sessionId: 'session', callId: 'one', title: 'Choose', view })
    store.setStatus('one', { state: 'filled', text: 'Added to the composer. Review and send when ready.', copyKey: 'filled' })
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<ToolCallView sessionId="session" callId="one" phase="result" block={card('one')} t={key => key} store={store} call={p.call} surface="inline" />))
    expect(document.body.textContent).toContain('Added to the composer')
    await act(async () => { locale = { active: 'zh' }; for (const listener of listeners) listener() })
    expect(document.body.textContent).toContain('已填入输入框，请检查后发送')
    expect(document.body.textContent).not.toContain('Added to the composer')
    await act(async () => root.unmount())
  })
  it('replaces activity progress instead of accumulating cards', async () => {
    const steps = { type: 'steps', items: [{ label: 'Working', status: 'active' }] }
    const block = { callId: 'progress', kind: 'tool-result' as const, meta: { owner: 'dsh-deep-view', title: 'Progress', view: steps, interactive: false, awaitReply: false } }
    const p = props([], vi.fn(async () => ({ ok: true, value: null })))
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<main>
      <ToolCallStatus sessionId="session" callId="progress" phase="result" block={block} t={p.t} store={p.store} call={p.call} useSession={p.useSession} />
      <ActivityDock sessionId="session" callId="progress" phase="result" block={block} t={p.t} store={p.store} call={p.call} useSession={p.useSession} useInput={p.useInput} inputActions={p.inputActions} />
    </main>))
    expect(document.querySelectorAll('.dvui-dock .dvui-steps')).toHaveLength(1)
    expect(document.body.textContent).toContain('Working')
    const next = { callId: 'form', kind: 'tool-result' as const, meta: { owner: 'dsh-deep-view', title: 'Next', view, interactive: true, awaitReply: true } }
    await act(async () => root.render(<main>
      <ToolCallStatus sessionId="session" callId="form" phase="result" block={next} t={p.t} store={p.store} call={p.call} useSession={p.useSession} />
      <ActivityDock sessionId="session" callId="form" phase="result" block={next} t={p.t} store={p.store} call={p.call} useSession={p.useSession} useInput={p.useInput} inputActions={p.inputActions} />
    </main>))
    expect(document.querySelector('.dvui-dock')).toBeNull()
    await act(async () => root.render(<ActivityDock sessionId="session" callId="progress" phase="result" block={block} t={p.t} store={p.store} call={p.call}
      useSession={selector => selector({ running: false })} useInput={p.useInput} inputActions={p.inputActions} />))
    expect(document.querySelector('.dvui-dock')).toBeNull()
    await act(async () => root.unmount())
  })
  it('replays persisted cards without arguments, with expired answers disabled', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<ReplyView {...props([card('old')], async () => ({ ok: true, value: null }))} />))
    expect(document.body.textContent).toContain('Choose')
    expect(document.querySelector('button.dvui-option')).toBeNull()
    expect(document.body.textContent).toContain('local')
    await act(async () => root.unmount())
  })
  it('restores submitted inputs, formulas and selected options after remount', async () => {
    const submittedView = { type: 'stack', children: [
      { type: 'number', id: 'price', label: 'Price', value: 4 },
      { type: 'metric', label: 'Total', value: { '=': 'price * 2' } },
      view,
    ] }
    const block = { ...card('saved'), meta: {
      owner: 'dsh-deep-view', viewId: 'saved', title: 'Choose', view: submittedView, awaitReply: true,
    } }
    const answer = { id: 'saved', action: 'pick', values: { selected: ['Two'], inputs: { price: 6 } } }
    const data: ReplySnapshot = {
      order: ['tool', 'answer'], locations: { getTurn: () => ['tool'] },
      nodes: { get: key => key === 'tool' ? { kind: 'tool-call', data: { root: block } }
        : { kind: 'user', data: { source: { kind: 'user', deepView: { owner: 'dsh-deep-view', version: 1, answer } } } } },
    }
    const call = vi.fn()
    const p = { ...props([block], call), useChat: <T,>(selector: (snapshot: ReplySnapshot) => T) => selector(data) }
    for (let reload = 0; reload < 2; reload += 1) {
      const root = createRoot(document.getElementById('root')!)
      await act(async () => root.render(<ReplyView {...p} />))
      expect((document.querySelector('input[type=number]') as HTMLInputElement).value).toBe('6')
      expect(document.querySelector('.dvui-metric-value')?.textContent).toBe('12')
      expect(document.querySelector('[aria-label=selected]')?.closest('.dvui-option')?.textContent).toBe('Two')
      expect(document.querySelector('button.dvui-option')).toBeNull()
      expect(document.body.textContent).not.toContain('local')
      await act(async () => root.unmount())
    }
    expect(call).not.toHaveBeenCalled()
  })
})
