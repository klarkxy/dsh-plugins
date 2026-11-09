import { describe, expect, it } from 'vitest'
import { checkShownView, compileFormula, createScope, evaluate, validateViewAnswer, viewScope, resolve } from './core/index.js'

describe('bounded views and formulas', () => {
  it('accepts all supported display components and local input types', () => {
    const view = { type: 'stack', children: [
      { type: 'text', text: 'Text' }, { type: 'metric', label: 'M', value: 3 },
      { type: 'table', columns: [{ key: 'x', label: 'X' }], rows: [[1]] },
      { type: 'chart', kind: 'bar', categories: ['A'], series: [{ values: [1] }] },
      { type: 'progress', percent: 25 }, { type: 'callout', text: 'Note' },
      { type: 'sources', items: [{ label: 'Source', url: 'https://example.com' }] },
      { type: 'slider', id: 's', label: 'S', min: 0, max: 10, value: 4 },
      { type: 'number', id: 'n', label: 'N', value: 3 },
      { type: 'choice', id: 'c', label: 'C', options: [{ label: 'One', value: 1 }] },
      { type: 'toggle', id: 't', label: 'T', value: true },
    ] }
    expect(checkShownView('', view)).not.toHaveProperty('error')
  })
  it('rejects html and malformed formulas without executing source text', () => {
    expect(checkShownView('', { type: 'html', html: '', summary: 'x' }).error).toContain('unknown component')
    expect(checkShownView('', { type: 'text', text: { '=': 'globalThis.process' } }).error).toBeDefined()
    expect(compileFormula('(() => process.exit())()').error).toBeDefined()
  })
  it('calculates bounded expressions and linked inputs without eval', () => {
    const view = { type: 'stack', let: { total: 'price * count' }, children: [
      { type: 'number', id: 'price', label: 'Price', value: 4 },
      { type: 'slider', id: 'count', label: 'Count', min: 0, max: 10, value: 2 },
      { type: 'metric', label: 'Total', value: { '=': 'format(total, 2)' } },
    ] }
    const scope = viewScope(view, { count: 3 })
    // let formulas compile inside viewScope; the scope itself answers 12.
    expect(scope('total')).toBe(12)
    expect(resolve(view.let.total, scope)).toBe('price * count')
    expect(resolve(view.children[2].value, scope)).toBe('12.00')
    const compiled = compileFormula('min(max(2, 4), 3)')
    expect(evaluate(compiled.tree, createScope(new Map(), new Map())).value).toBe(3)
  })
  it('validates answer values on the Host side', () => {
    const view = { type: 'stack', children: [
      { type: 'toggle', id: 'enabled', label: 'Enabled', value: true },
      { type: 'options', id: 'pick', options: [{ label: 'One' }, { label: 'Two' }] },
    ] }
    expect(validateViewAnswer(view, 'pick', { selected: ['One'], inputs: { enabled: false } })).toEqual({ selected: ['One'], inputs: { enabled: false } })
    expect(validateViewAnswer(view, 'pick', { selected: ['Forged'] }).error).toContain('select at least one')
    expect(validateViewAnswer(view, 'missing', {}).error).toContain('no interactive component')
  })
})
