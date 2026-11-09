import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ReplyView, ToolCallStatus, replyCards } from './client.tsx'
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
function props(blocks: ToolViewBlock[], call: ReplyViewProps['call']): ReplyViewProps {
  return {
    sessionId: 'session', turn: { turn: 2, status: 'closed' }, t: key => key,
    useChat: selector => selector(snapshot(blocks)), call,
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
  it('never renders a card or JSON in the tool activity', () => {
    const markup = renderToStaticMarkup(<ToolCallStatus sessionId="session" callId="one" phase="result" block={card('one')} t={key => key} />)
    expect(markup).toContain('prepared')
    expect(markup).not.toContain('Choose')
    expect(markup).not.toContain('button')
    expect(markup).not.toContain('show_view')
  })
  it('waits for the final reply, remains visible with tools collapsed, and submits once', async () => {
    const one = card('one')
    const call = vi.fn(async (endpoint: string) => endpoint === 'pending'
      ? { ok: true, value: { id: 'one', sessionId: 'session', callId: 'one', title: 'Choose', view } }
      : { ok: true, value: { answered: true } })
    const p = props([one], call)
    const root = createRoot(document.getElementById('root')!)
    const render = (status: 'open' | 'closed') => <main>
      <details><summary>Tools</summary><ToolCallStatus sessionId="session" callId="one" phase="result" block={one} t={p.t} /></details>
      <p>Final answer</p>
      <ReplyView {...p} turn={{ turn: 2, status }} />
    </main>
    await act(async () => root.render(render('open')))
    expect(document.querySelector('[data-deep-view-reply]')).toBeNull()
    expect(call).not.toHaveBeenCalled()
    await act(async () => root.render(render('closed')))
    const reply = document.querySelector('[data-deep-view-reply]')!
    expect(reply).not.toBeNull()
    expect(reply.closest('details')).toBeNull()
    expect(document.querySelector('details')?.open).toBe(false)
    const button = reply.querySelector('.dvui-option') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(call.mock.calls.filter(([endpoint]) => endpoint === 'reply')).toHaveLength(1)
    expect(call).toHaveBeenCalledWith('reply', { sessionId: 'session', viewId: 'one', action: 'pick', values: { selected: ['One'] } })
    expect(reply.textContent).not.toContain('answer_to_pending_view')
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
