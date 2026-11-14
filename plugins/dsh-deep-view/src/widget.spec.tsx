import { act } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { WidgetCard } from './widget.tsx'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' })
vi.stubGlobal('window', dom.window)
vi.stubGlobal('document', dom.window.document)
vi.stubGlobal('navigator', dom.window.navigator)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
// react-dom latches isInputEventSupported while the module loads. A static
// import runs before these globals exist, canUseDOM stays false, and a range
// `input` event takes the IE polyfill path that never calls onChange.
let createRoot: typeof import('react-dom/client').createRoot
let createCards: typeof import('./client.tsx').createCards
beforeAll(async () => {
  createRoot = (await import('react-dom/client')).createRoot
  createCards = (await import('./client.tsx')).createCards
})
const t = (key: string) => key
const labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }
const chartNode = { type: 'chart' as const, kind: 'line' as const, categories: ['A', 'B'], series: [{ name: 'One', values: [1, 2] }] }
afterEach(() => { document.body.innerHTML = '<div id="root"></div>' })

describe('widget interactions without a browser', () => {
  it('keeps local formulas editable in a display card exposed to plugin chats', async () => {
    const root = createRoot(document.getElementById('root')!)
    const Card = createCards(vi.fn(), undefined).Card
    const view = { type: 'stack' as const, children: [
      { type: 'number' as const, id: 'price', label: 'Price', value: 2 },
      { type: 'number' as const, id: 'count', label: 'Count', value: 5 },
      { type: 'metric' as const, label: 'Total', value: { '=': 'price * count' } },
    ] }
    await act(async () => root.render(<Card sessionId="s" callId="c" presentation={{ owner: 'dsh-deep-view', title: 'Budget', view, interactive: false, awaitReply: false }} />))
    const input = document.querySelector('input[type=number]')!
    expect(input.disabled).toBe(false)
    expect(document.querySelector('.dvui-metric-value')!.textContent).toBe('10')
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input, '3'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    expect(document.querySelector('.dvui-metric-value')!.textContent).toBe('15')
    await act(async () => root.unmount())
  })
  it('updates formula-backed metrics from local inputs', async () => {
    const root = createRoot(document.getElementById('root')!)
    const view = { type: 'stack' as const, children: [
      { type: 'slider' as const, id: 'count', label: 'Count', min: 0, max: 10, value: 2 },
      { type: 'metric' as const, label: 'Total', value: { '=': 'count * 3' } },
      { type: 'options' as const, id: 'pick', options: [{ label: 'One' }] },
    ] }
    await act(async () => root.render(<WidgetCard view={view} t={t} labels={labels} localOnly />))
    expect(document.body.textContent).toContain('6')
    const range = document.querySelector('input[type=range]')!
    // React intercepts the native setter's change tracker; direct assignment
    // alone is ignored, so go through the prototype setter before dispatching.
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(range, '4'); range.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    expect(document.body.textContent).toContain('12')
    expect(document.querySelector('input[type=range]')!.disabled).toBe(false)
    expect(document.querySelector('.dvui-option')!.disabled).toBe(true)
    expect(document.body.textContent).toContain('Local preview only; this card does not send an answer.')
    await act(async () => root.unmount())
  })
  it('disables answer controls and gives honest local-only feedback without onSubmit', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<WidgetCard view={{ type: 'confirm', id: 'answer' }} localOnly t={t} labels={labels} />))
    expect(document.body.textContent).toContain('Local preview only; this card does not send an answer.')
    expect([...document.querySelectorAll('button')].every(button => button.disabled)).toBe(true)
    await act(async () => root.unmount())
  })
  it('switches a chart to a table and back through its chart options', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<WidgetCard view={chartNode} t={t} labels={labels} />))
    await act(async () => (document.querySelector('.dvui-more') as HTMLButtonElement).click())
    await act(async () => [...document.querySelectorAll('[role=menuitem]')].find(button => button.textContent === 'View as table')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    expect(document.querySelector('.dvui-table')).toBeTruthy()
    await act(async () => (document.querySelector('.dvui-more') as HTMLButtonElement).click())
    await act(async () => [...document.querySelectorAll('[role=menuitem]')].find(button => button.textContent === 'View as chart')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    expect(document.querySelector('svg')).toBeTruthy()
    await act(async () => root.unmount())
  })
})
