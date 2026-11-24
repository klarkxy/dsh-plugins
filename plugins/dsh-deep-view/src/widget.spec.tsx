import { act } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { WidgetCard, WidgetView } from './widget.tsx'
import { viewStyles } from './styles.ts'

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
    const input = document.querySelector('input[type=number]')! as HTMLInputElement
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
    const range = document.querySelector('input[type=range]')! as HTMLInputElement
    // React intercepts the native setter's change tracker; direct assignment
    // alone is ignored, so go through the prototype setter before dispatching.
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(range, '4'); range.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    expect(document.body.textContent).toContain('12')
    expect((document.querySelector('input[type=range]')! as HTMLInputElement).disabled).toBe(false)
    expect(document.querySelector('button.dvui-option')).toBeNull()
    expect(document.querySelector('.dvui-option')!.getAttribute('role')).not.toBe('button')
    expect(document.body.textContent).toContain('Local preview only; this card does not send an answer.')
    await act(async () => root.unmount())
  })
  it('disables answer controls and gives honest local-only feedback without onSubmit', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<WidgetCard view={{ type: 'confirm', id: 'answer' }} localOnly t={t} labels={labels} />))
    expect(document.body.textContent).toContain('Local preview only; this card does not send an answer.')
    expect([...document.querySelectorAll('button')].every(button => (button as HTMLButtonElement).disabled)).toBe(true)
    await act(async () => root.unmount())
  })
  it('shows only the real fill action in fill-only mode', async () => {
    const root = createRoot(document.getElementById('root')!)
    const fillDraft = vi.fn()
    const onSubmit = vi.fn()
    const view = { type: 'stack' as const, children: [
      { type: 'form' as const, id: 'ask', fields: [{ id: 'name', label: 'Name' }], cancelLabel: 'Skip' },
      { type: 'confirm' as const, id: 'go' },
      { type: 'options' as const, id: 'pick', options: [{ label: 'One' }] },
    ] }
    await act(async () => root.render(<WidgetCard view={view} t={t} labels={labels} onFillDraft={fillDraft} onSubmit={undefined} />))
    const labels_ = [...document.querySelectorAll('button')].map(button => button.textContent)
    expect(labels_).toContain('Fill composer')
    expect(labels_).not.toContain('Submit')
    expect(labels_).not.toContain('Confirm')
    expect(labels_).not.toContain('Cancel')
    expect(labels_).not.toContain('Skip')
    // The form's primary action is the fill itself; it must not call onSubmit.
    await act(async () => (document.querySelector('form') as HTMLFormElement).dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
    expect(fillDraft).toHaveBeenCalledWith('ask', { fields: { name: '' } })
    expect(onSubmit).not.toHaveBeenCalled()
    // Picking an option enables its fill path without a fake Submit button.
    await act(async () => (document.querySelector('.dvui-option') as HTMLButtonElement).click())
    const fills = [...document.querySelectorAll('.dvui-actions button')].filter(button => button.textContent === 'Fill composer')
    await act(async () => (fills.at(-1) as HTMLButtonElement).click())
    expect(fillDraft).toHaveBeenCalledWith('pick', { selected: ['One'] })
    await act(async () => root.unmount())
  })
  it('uses the task-specific label for a fill-only submit node', async () => {
    const root = createRoot(document.getElementById('root')!)
    const onFillDraft = vi.fn()
    await act(async () => root.render(<WidgetCard view={{ type: 'submit', id: 'plan', label: 'Use these assumptions' }} t={t} labels={labels} onFillDraft={onFillDraft} />))
    const button = [...document.querySelectorAll('button')].find(button => button.textContent === 'Use these assumptions')! as HTMLButtonElement
    await act(async () => button.click())
    expect(onFillDraft).toHaveBeenCalledWith('plan', {})
    await act(async () => root.unmount())
  })
  it('keeps direct submit when only onSubmit is given', async () => {
    const root = createRoot(document.getElementById('root')!)
    const onSubmit = vi.fn()
    await act(async () => root.render(<WidgetCard view={{ type: 'confirm', id: 'go' }} t={t} labels={labels} onSubmit={onSubmit} />))
    const confirm = [...document.querySelectorAll('button')].find(button => button.textContent === 'Confirm')! as HTMLButtonElement
    await act(async () => confirm.click())
    expect(onSubmit).toHaveBeenCalledWith('go', { confirmed: true })
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
  it('renders a closed confirm read-only with no action row and one local note', async () => {
    const root = createRoot(document.getElementById('root')!)
    const onSubmit = vi.fn()
    await act(async () => root.render(<WidgetCard view={{ type: 'confirm', id: 'go', confirmLabel: 'Confirm', cancelLabel: 'Cancel' }} t={t} labels={labels} onSubmit={onSubmit} closed localNote="This card expired." />))
    expect(document.querySelectorAll('button').length).toBe(0)
    expect(document.querySelector('.dvui-view.dvui-closed')).toBeTruthy()
    expect(document.body.textContent!.split('This card expired.').length - 1).toBe(1)
    expect(onSubmit).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
  it('keeps the recorded answer badge on a closed confirm', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<WidgetCard view={{ type: 'confirm', id: 'go', confirmLabel: 'Confirm' }} t={t} labels={labels} closed answer={{ id: 'go', action: 'go', values: { confirmed: true } }} />))
    expect(document.querySelector('.dvui-badge')!.textContent).toBe('Confirm')
    expect(document.querySelectorAll('button').length).toBe(0)
    await act(async () => root.unmount())
  })
  it('renders no action row for a closed submit node', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<WidgetCard view={{ type: 'submit', id: 'plan', label: 'Send' }} t={t} labels={labels} onSubmit={vi.fn()} closed />))
    expect(document.querySelector('.dvui-actions')).toBeNull()
    await act(async () => root.unmount())
  })
  it('marks an embedded card and exports the embedded shell rule', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<WidgetCard view={{ type: 'confirm', id: 'go' }} t={t} labels={labels} embedded />))
    expect(document.querySelector('.dvui-view.dvui-embedded')).toBeTruthy()
    expect(viewStyles).toContain('.dvui-view.dvui-embedded')
    await act(async () => root.unmount())
  })
  it('enforces closed on a directly rendered WidgetView confirm', async () => {
    const root = createRoot(document.getElementById('root')!)
    const onSubmit = vi.fn()
    const onFillDraft = vi.fn()
    await act(async () => root.render(<WidgetView view={{ type: 'confirm', id: 'go' }} t={t} labels={labels} onSubmit={onSubmit} onFillDraft={onFillDraft} closed registerChart={() => {}} refreshCharts={() => {}} />))
    expect(document.querySelectorAll('button').length).toBe(0)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onFillDraft).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
  it('enforces closed on directly rendered WidgetView options', async () => {
    const root = createRoot(document.getElementById('root')!)
    const onSubmit = vi.fn()
    const onFillDraft = vi.fn()
    const view = { type: 'options' as const, id: 'pick', options: [{ label: 'One' }, { label: 'Two' }] }
    await act(async () => root.render(<WidgetView view={view} t={t} labels={labels} onSubmit={onSubmit} onFillDraft={onFillDraft} closed registerChart={() => {}} refreshCharts={() => {}} />))
    expect(document.querySelectorAll('.dvui-actions button').length).toBe(0)
    for (const option of document.querySelectorAll<HTMLElement>('.dvui-option')) {
      await act(async () => option.click())
    }
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onFillDraft).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
  it('restores the answer inputs on a closed card', async () => {
    const root = createRoot(document.getElementById('root')!)
    const view = { type: 'stack' as const, children: [
      { type: 'number' as const, id: 'price', label: 'Price', value: 2 },
      { type: 'metric' as const, label: 'Total', value: { '=': 'price * 5' } },
      { type: 'confirm' as const, id: 'go', confirmLabel: 'Confirm' },
    ] }
    const answer = { id: 'v', action: 'go', values: { confirmed: true, inputs: { price: 3 } } }
    await act(async () => root.render(<WidgetCard view={view} t={t} labels={labels} closed answer={answer} />))
    expect(document.querySelector('.dvui-metric-value')!.textContent).toBe('15')
    expect((document.querySelector('input[type=number]') as HTMLInputElement).value).toBe('3')
    expect(document.querySelector('.dvui-badge')!.textContent).toBe('Confirm')
    expect(document.querySelectorAll('button').length).toBe(0)
    await act(async () => root.unmount())
  })
  it('keeps default inputs on the same view without closed or settled', async () => {
    const root = createRoot(document.getElementById('root')!)
    const view = { type: 'stack' as const, children: [
      { type: 'number' as const, id: 'price', label: 'Price', value: 2 },
      { type: 'metric' as const, label: 'Total', value: { '=': 'price * 5' } },
      { type: 'confirm' as const, id: 'go', confirmLabel: 'Confirm' },
    ] }
    const answer = { id: 'v', action: 'go', values: { confirmed: true, inputs: { price: 3 } } }
    await act(async () => root.render(<WidgetCard view={view} t={t} labels={labels} answer={answer} />))
    expect(document.querySelector('.dvui-metric-value')!.textContent).toBe('10')
    expect((document.querySelector('input[type=number]') as HTMLInputElement).value).toBe('2')
    await act(async () => root.unmount())
  })
  it('enforces closed on a directly rendered WidgetView form', async () => {
    const root = createRoot(document.getElementById('root')!)
    const onSubmit = vi.fn()
    const onFillDraft = vi.fn()
    const view = { type: 'form' as const, id: 'ask', fields: [{ id: 'name', label: 'Name' }] }
    await act(async () => root.render(<WidgetView view={view} t={t} labels={labels} onSubmit={onSubmit} onFillDraft={onFillDraft} closed registerChart={() => {}} refreshCharts={() => {}} />))
    expect(document.querySelectorAll('.dvui-actions button').length).toBe(0)
    for (const field of document.querySelectorAll<HTMLElement>('.dvui-field')) {
      await act(async () => field.click())
    }
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onFillDraft).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
  it('supports multi-select choice checkboxes with custom input and collapses settled cards by default', async () => {
    const root = createRoot(document.getElementById('root')!)
    const onSubmit = vi.fn()
    const view = { type: 'stack' as const, children: [
      { type: 'choice' as const, id: 'mods', label: 'Modules', multi: true, allowCustom: true, customPlaceholder: 'Other module', options: [{ label: 'Cache', value: 'cache' }, { label: 'Audit', value: 'audit' }], value: ['cache'] },
      { type: 'metric' as const, label: 'Count', value: { '=': 'count(mods)' } },
      { type: 'submit' as const, id: 'go', label: 'Apply' },
    ] }
    await act(async () => root.render(<WidgetCard title="Setup" view={view} t={t} labels={labels} onSubmit={onSubmit} />))
    expect(document.querySelector('.dvui-metric-value')!.textContent).toBe('1')
    const checkboxes = [...document.querySelectorAll('button[role=checkbox]')] as HTMLButtonElement[]
    await act(async () => checkboxes[1]!.click())
    expect(document.querySelector('.dvui-metric-value')!.textContent).toBe('2')
    const customInput = document.querySelector('input.dvui-custom-input') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(customInput, 'Tracing'); customInput.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    expect(document.querySelector('.dvui-metric-value')!.textContent).toBe('3')
    await act(async () => (document.querySelector('button.dvui-submit') as HTMLButtonElement).click())
    expect(onSubmit).toHaveBeenCalledWith('go', { inputs: { mods: ['cache', 'audit', 'Tracing'] } })

    const answer = { id: 'v1', action: 'go', values: { inputs: { mods: ['cache', 'Tracing'] } } }
    await act(async () => root.render(<WidgetCard title="Setup" view={view} t={t} labels={labels} settled answer={answer} />))
    const bar = document.querySelector('button.dvui-settled-bar') as HTMLButtonElement
    expect(bar).toBeTruthy()
    expect(bar.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.dvui-view.dvui-collapsed')).toBeTruthy()
    expect(bar.textContent).toContain('Setup')
    expect(bar.textContent).toContain('Cache, Tracing')
    await act(async () => bar.click())
    expect(bar.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.dvui-view.dvui-collapsed')).toBeNull()
    await act(async () => root.unmount())
  })
})
