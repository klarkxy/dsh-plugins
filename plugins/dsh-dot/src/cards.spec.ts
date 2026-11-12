import { describe, expect, it } from 'vitest'
import { cardPresentation, cardText, validateViewAnswer } from './cards.ts'

const view = (body: Record<string, unknown>) => body
const card = (body: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ owner: 'dsh-deep-view', title: 'Report', interactive: false, awaitReply: false, view: view(body), ...extra })

describe('cardText', () => {
  it('reads display nodes as title plus a readable summary', () => {
    expect(cardText(card({ type: 'text', text: 'All done' }))).toBe('Report — text: All done')
    expect(cardText(card({ type: 'metric', label: 'CPU', value: 42 }))).toBe('Report — metric: CPU=42')
    expect(cardText(card({ type: 'callout', text: 'Heads up' }))).toBe('Report — callout: Heads up')
  })

  it('keeps the columns and every row of a table', () => {
    expect(cardText(card({ type: 'table', columns: [{ key: 'name', label: 'Name' }, { key: 'state', label: 'State' }], rows: [['build', 'ok'], ['test', 'fail']] })))
      .toBe('Report — table: Name/State; rows: build/ok; test/fail')
    const text = cardText(card({ type: 'table', columns: [{ key: 'name', label: 'Name' }, { key: 'state', label: 'State' }], rows: [['build', 'ok'], ['test', 'fail']] }))!
    expect(text).toContain('build')
    expect(text).toContain('fail')
  })

  it('keeps every series and point of a chart', () => {
    expect(cardText(card({ type: 'chart', kind: 'bar', categories: ['Mon', 'Tue'], series: [{ name: 'sales', values: [1, 2] }, { name: 'cost', values: [3, 4] }], unit: 'k' })))
      .toBe('Report — chart: sales: Mon=1 k, Tue=2 k; cost: Mon=3 k, Tue=4 k')
  })

  it('keeps input values and resolves formulas through the view scope', () => {
    const inputs = card({
      type: 'stack',
      children: [
        { type: 'slider', id: 'volume', label: 'Volume', min: 0, max: 100, step: 1, value: 30, unit: '%' },
        { type: 'toggle', id: 'dark', label: 'Dark', value: true },
        { type: 'choice', id: 'mode', label: 'Mode', options: [{ label: 'Fast' }, { label: 'Safe' }] },
      ],
    })
    expect(cardText(inputs)).toContain('slider: Volume=30 %')
    expect(cardText(inputs)).toContain('toggle: Dark=on')
    expect(cardText(inputs)).toContain('choice: Mode=Fast')

    const formula = card({
      type: 'stack',
      let: { total: 'price * qty' },
      children: [
        { type: 'number', id: 'price', label: 'Price', value: 10 },
        { type: 'number', id: 'qty', label: 'Qty', value: 2 },
        { type: 'metric', label: 'Total', value: { '=': 'total' } },
      ],
    })
    expect(cardText(formula)).toContain('metric: Total=20')
  })

  it('keeps option descriptions, form placeholders and source URLs', () => {
    expect(cardText(card({ type: 'options', id: 'o', options: [{ label: 'A', description: 'fast' }, { label: 'B' }] })))
      .toBe('Report — options: A (fast)/B')
    expect(cardText(card({ type: 'form', id: 'f', fields: [{ id: 'email', label: 'Email', placeholder: 'you@example.com' }, { id: 'name', label: 'Name' }] })))
      .toBe('Report — form: Email (you@example.com)/Name')
    expect(cardText(card({ type: 'sources', items: [{ label: 'Docs', url: 'https://example.test/a' }] })))
      .toBe('Report — sources: Docs=https://example.test/a')
  })

  it('walks past the eighth node and never clips long text', () => {
    const many = card({ type: 'stack', children: Array.from({ length: 9 }, (_, index) => ({ type: 'text', text: `n${index + 1}` })) })
    const text = cardText(many)!
    expect(text).toContain('text: n1')
    expect(text).toContain('text: n9')
    const long = 'x'.repeat(200)
    expect(cardText(card({ type: 'text', text: long }))).toContain(long)
  })

  it('prefixes an interactive card with its persistent #N', () => {
    expect(cardText(card({ type: 'options', id: 'o', options: [{ label: 'A' }, { label: 'B' }] }, { title: 'Pick target', interactive: true, awaitReply: true, dotCard: { number: 4 } })))
      .toBe('[#4] Pick target — options: A/B')
    expect(cardText(card({ type: 'form', id: 'f', fields: [{ id: 'email', label: 'Email' }, { id: 'name', label: 'Name' }] }, { title: 'Sign up', interactive: true, awaitReply: true, dotCard: { number: 1 } })))
      .toBe('[#1] Sign up — form: Email/Name')
  })

  it('falls back to a plain heading when the title or number is missing', () => {
    expect(cardText(card({ type: 'callout', text: 'Heads up' }, { title: '' }))).toBe('Card — callout: Heads up')
    expect(cardText(card({ type: 'confirm', id: 'go' }, { title: 'Choose', interactive: true, awaitReply: true }))).toBe('Choose — confirm')
  })

  it('ignores anything that is not a valid show_view card', () => {
    expect(cardText(undefined)).toBeUndefined()
    expect(cardText(null)).toBeUndefined()
    expect(cardText('shown')).toBeUndefined()
    // Another owner's result is not a dot card.
    expect(cardText({ owner: 'someone-else', title: 'T', view: view({ type: 'text', text: 'x' }) })).toBeUndefined()
    // A failed card leaves no presentation meta.
    expect(cardText({ owner: 'dsh-deep-view', status: 'invalid', summary: 'bad view' })).toBeUndefined()
    // A malformed view fails the same check deep-view applies.
    expect(cardText({ owner: 'dsh-deep-view', title: 'T', view: view({ text: 'missing type' }) })).toBeUndefined()
    expect(cardText({ owner: 'dsh-deep-view', title: 'T', view: view({ type: 'nope', text: 'x' }) })).toBeUndefined()
  })
})

describe('cardPresentation', () => {
  const presentation = { owner: 'dsh-deep-view', title: 'Report', view: { type: 'text', text: 'x' }, interactive: false, awaitReply: false }

  it('takes the persisted meta out of a canonical result', () => {
    expect(cardPresentation({ status: 'shown', summary: 'shown', presentation })).toEqual(presentation)
  })

  it('yields nothing when no card was produced', () => {
    expect(cardPresentation({ status: 'invalid', summary: 'bad view' })).toBeUndefined()
    expect(cardPresentation({ status: 'shown', presentation: { owner: 'someone-else' } })).toBeUndefined()
    expect(cardPresentation(undefined)).toBeUndefined()
  })
})

describe('validateViewAnswer re-export', () => {
  it('settles a card answer the same way deep-view does', () => {
    expect(validateViewAnswer({ type: 'confirm', id: 'go' }, 'go', { confirmed: true })).toEqual({ confirmed: true })
  })
})
