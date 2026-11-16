import { act } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { checkShownView, normalizeView, validateView, validateViewAnswer, viewSummary } from './core/index.js'
import { answerText, legacyAnswer } from './answer-text.ts'
import { WidgetCard } from './widget.tsx'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' })
vi.stubGlobal('window', dom.window)
vi.stubGlobal('document', dom.window.document)
vi.stubGlobal('navigator', dom.window.navigator)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let createRoot: typeof import('react-dom/client').createRoot
beforeAll(async () => { createRoot = (await import('react-dom/client')).createRoot })
afterEach(() => { document.body.innerHTML = '<div id="root"></div>' })
const t = (key: string) => key
const labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

describe('steps node protocol', () => {
  it('accepts 1-8 items with label, detail and status, including formulas', () => {
    const view = { type: 'stack', children: [
      { type: 'toggle', id: 'fast', label: 'Fast', value: true },
      { type: 'steps', items: [
        { label: 'Scope', detail: 'Goals and acceptance', status: 'done' },
        { label: 'Build', detail: { '=': 'fast ? "parallel" : "serial"' }, status: 'active' },
        { label: 'Verify', status: { '=': 'fast ? "pending" : "blocked"' } },
      ] },
    ] }
    const shown = checkShownView('Plan', view)
    expect(shown).not.toHaveProperty('error')
    expect(validateView(view)).toEqual({ ok: true, interactive: false })
    expect(viewSummary(shown.view)).toContain('steps: Scope/Build/Verify')
  })
  it('rejects empty items, too many steps, missing labels and bad statuses', () => {
    expect(validateView({ type: 'steps', items: [] }).error).toContain('items')
    expect(validateView({ type: 'steps', items: Array.from({ length: 9 }, (_, i) => ({ label: `S${i}` })) }).error).toContain('exceeds the limit')
    expect(validateView({ type: 'steps', items: [{ detail: 'x' }] }).error).toContain('label')
    expect(validateView({ type: 'steps', items: [{ label: 'A', status: 'maybe' }] }).error).toContain('status')
    expect(validateView({ type: 'steps', items: [{ label: 'A', url: 'https://x' }] }).error).toContain('unknown property')
    expect(validateView({ type: 'steps', items: [{ label: 'A', status: { '=': '1' } }] }).error).toBeDefined()
  })
})

describe('form field extensions', () => {
  it('accepts value, multiline, readOnly and cancelLabel, and keeps a numeric-looking initial value as text', () => {
    const sent = { type: 'form', id: 'f', cancelLabel: '放弃', fields: [
      { id: 'name', label: 'Name', value: '42', readOnly: true },
      { id: 'note', label: 'Note', value: 'line1\nline2', multiline: true },
    ] }
    const shown = checkShownView('', sent)
    expect(shown).not.toHaveProperty('error')
    expect(shown.view.fields[0].value).toBe('42')
    // Outside form fields a numeric string still normalizes to a number.
    const normalized = normalizeView({ type: 'number', id: 'n', label: 'N', value: '42' })
    expect(normalized.value).toBe(42)
    expect(normalizeView(sent).fields[0].value).toBe('42')
  })
  it('rejects wrong field types', () => {
    const base = { type: 'form', id: 'f', fields: [{ id: 'a', label: 'A' }] }
    expect(validateView({ ...base, fields: [{ id: 'a', label: 'A', value: 42 }] }).error).toContain('value')
    expect(validateView({ ...base, fields: [{ id: 'a', label: 'A', multiline: 'yes' }] }).error).toContain('multiline')
    expect(validateView({ ...base, fields: [{ id: 'a', label: 'A', readOnly: 1 }] }).error).toContain('readOnly')
    expect(validateView({ ...base, cancelLabel: 3 }).error).toContain('cancelLabel')
  })
  it('validates canceled answers and snaps readOnly fields to declared values', () => {
    const view = { type: 'form', id: 'f', fields: [
      { id: 'name', label: 'Name', value: 'seed', readOnly: true },
      { id: 'note', label: 'Note' },
    ] }
    expect(validateViewAnswer(view, 'f', { canceled: true })).toEqual({ canceled: true })
    expect(validateViewAnswer(view, 'f', { fields: { name: 'forged', note: 'typed' } }))
      .toEqual({ fields: { name: 'seed', note: 'typed' } })
    // Cancel is a form answer only; other controls still take their own shape.
    const confirm = { type: 'confirm', id: 'c' }
    expect(validateViewAnswer(confirm, 'c', { canceled: true }).error).toContain('confirmed')
  })
})

describe('answer text and legacy restore for cancels', () => {
  const card = { id: 'v', title: '订单', view: { type: 'form', id: 'f', cancelLabel: '放弃', fields: [{ id: 'name', label: 'Name' }] } }
  it('renders and restores a canceled form answer', () => {
    const values = { canceled: true }
    const text = answerText(card, 'f', values)
    expect(text).toBe('订单\n放弃')
    expect(legacyAnswer(card, text)).toEqual({ id: 'v', action: 'f', values })
  })
  it('keeps the ordinary field-lines restore intact', () => {
    const values = { fields: { name: 'Ada' } }
    const text = answerText(card, 'f', values)
    expect(text).toBe('订单\nName: Ada')
    expect(legacyAnswer(card, text)).toEqual({ id: 'v', action: 'f', values })
    expect(legacyAnswer(card, '订单\nCancel')).toBeNull()
  })
})

describe('widget rendering for steps and forms', () => {
  it('renders steps with dots, a rail and aria-current on the active step', async () => {
    const root = createRoot(document.getElementById('root')!)
    const view = { type: 'steps' as const, items: [
      { label: 'Scope', detail: 'Goals', status: 'done' },
      { label: 'Build', status: 'active' },
      { label: 'Verify', status: 'pending' },
      { label: 'Blocked gate', status: 'blocked' },
    ] }
    await act(async () => root.render(<WidgetCard title="Plan" view={view} t={t} labels={labels} />))
    const list = document.querySelector('ol.dvui-steps')!
    expect(list.getAttribute('aria-label')).toBe('Steps')
    const items = list.querySelectorAll('li.dvui-step')
    expect(items).toHaveLength(4)
    expect(items[1].getAttribute('aria-current')).toBe('step')
    expect(items[0].getAttribute('data-status')).toBe('done')
    expect(items[3].getAttribute('data-status')).toBe('blocked')
    expect(list.textContent).toContain('Goals')
    // Every item but the last draws a rail segment.
    expect(items[0].querySelectorAll('span[aria-hidden] > span')).toHaveLength(2)
    expect(items[3].querySelectorAll('span[aria-hidden] > span')).toHaveLength(1)
    await act(async () => root.unmount())
  })
  it('fills initial values, renders multiline and readOnly fields, and cancels', async () => {
    const root = createRoot(document.getElementById('root')!)
    const onSubmit = vi.fn()
    const view = { type: 'form' as const, id: 'f', cancelLabel: '放弃', fields: [
      { id: 'name', label: 'Name', value: 'seed', readOnly: true },
      { id: 'note', label: 'Note', value: 'l1\nl2', multiline: true },
      { id: 'city', label: 'City', placeholder: 'Where' },
    ] }
    await act(async () => root.render(<WidgetCard view={view} onSubmit={onSubmit} t={t} labels={labels} />))
    const inputs = [...document.querySelectorAll('input.dvui-input')] as HTMLInputElement[]
    const area = document.querySelector('textarea.dvui-input') as HTMLTextAreaElement
    expect(area.value).toBe('l1\nl2')
    const name = inputs.find(input => input.getAttribute('aria-label') === 'Name')!
    const city = inputs.find(input => input.getAttribute('aria-label') === 'City')!
    expect(name.value).toBe('seed')
    expect(name.readOnly).toBe(true)
    // Type into the editable field and submit: readOnly keeps its declared value.
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(city, 'Shanghai'); city.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    await act(async () => (document.querySelector('button.dvui-submit') as HTMLButtonElement).click())
    expect(onSubmit).toHaveBeenCalledWith('f', { fields: { name: 'seed', note: 'l1\nl2', city: 'Shanghai' } })
    // Cancel sends its own value shape.
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === '放弃')!.click())
    expect(onSubmit).toHaveBeenLastCalledWith('f', { canceled: true })
    await act(async () => root.unmount())
  })
  it('shows a compact receipt once a form is settled', async () => {
    const root = createRoot(document.getElementById('root')!)
    const view = { type: 'form' as const, id: 'f', cancelLabel: '放弃', submitLabel: '发送', fields: [{ id: 'name', label: 'Name', value: 'seed' }] }
    const answer = { id: 'v', action: 'f', values: { fields: { name: 'seed' } } }
    await act(async () => root.render(<WidgetCard view={view} settled answer={answer} t={t} labels={labels} />))
    expect(document.querySelector('input')).toBeNull()
    expect(document.body.textContent).toContain('发送')
    await act(async () => root.unmount())
    const root2 = createRoot(document.getElementById('root')!)
    await act(async () => root2.render(<WidgetCard view={view} settled answer={{ ...answer, values: { canceled: true } }} t={t} labels={labels} />))
    expect(document.body.textContent).toContain('放弃')
    await act(async () => root2.unmount())
  })
  it('offers a fill-composer action separate from submit', async () => {
    const root = createRoot(document.getElementById('root')!)
    const onSubmit = vi.fn(), onFillDraft = vi.fn()
    const view = { type: 'stack' as const, children: [
      { type: 'options' as const, id: 'pick', options: [{ label: 'One' }, { label: 'Two' }] },
      { type: 'confirm' as const, id: 'ok', confirmLabel: 'Go', cancelLabel: 'Stop' },
      { type: 'form' as const, id: 'f', fields: [{ id: 'a', label: 'A' }] },
      { type: 'submit' as const, id: 'send', label: 'Send' },
    ] }
    await act(async () => root.render(<WidgetCard view={view} onSubmit={onSubmit} onFillDraft={onFillDraft} t={t} labels={labels} />))
    const fills = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Fill composer')
    expect(fills.length).toBe(4)
    // Options become pick-then-act when filling is possible.
    await act(async () => (document.querySelector('button.dvui-option') as HTMLButtonElement).click())
    expect(onSubmit).not.toHaveBeenCalled()
    await act(async () => fills[0].click())
    expect(onFillDraft).toHaveBeenCalledWith('pick', { selected: ['One'] })
    await act(async () => fills[1].click())
    expect(onFillDraft).toHaveBeenCalledWith('ok', { confirmed: true })
    await act(async () => fills[2].click())
    expect(onFillDraft).toHaveBeenCalledWith('f', { fields: { a: '' } })
    await act(async () => fills[3].click())
    expect(onFillDraft).toHaveBeenCalledWith('send', {})
    await act(async () => root.unmount())
  })
})
