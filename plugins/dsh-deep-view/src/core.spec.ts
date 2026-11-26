import { describe, expect, it } from 'vitest'
import { checkShownView, compileFormula, createScope, evaluate, inputsSummary, validateViewAnswer, viewScope, resolve } from './core/index.js'

describe('bounded views and formulas', () => {
  it('accepts all supported display components and local input types', () => {
    const view = { type: 'stack', children: [
      { type: 'text', text: 'Text' }, { type: 'metric', label: 'M', value: 3, tone: 'accent' },
      { type: 'table', columns: [{ key: 'x', label: 'X' }], rows: [[1]], caption: 'Summary' },
      { type: 'chart', kind: 'bar', categories: ['A'], series: [{ values: [1] }] },
      { type: 'progress', percent: 25 }, { type: 'callout', text: 'Note' },
      { type: 'sources', items: [{ label: 'Source', url: 'https://example.com' }] },
      { type: 'slider', id: 's', label: 'S', min: 0, max: 10, value: 4 },
      { type: 'number', id: 'n', label: 'N', value: 3 },
      { type: 'choice', id: 'c', label: 'C', options: [{ label: 'One', value: 1 }] },
      { type: 'choice', id: 'mc', label: 'MC', multi: true, allowCustom: true, customPlaceholder: 'Other', options: [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }], value: ['a'] },
      { type: 'toggle', id: 't', label: 'T', value: true },
    ] }
    expect(checkShownView('', view)).not.toHaveProperty('error')
  })
  it('rejects html and malformed formulas without executing source text', () => {
    expect(checkShownView('', { type: 'html', html: '', summary: 'x' }).error).toContain('unknown component')
    expect(checkShownView('', { type: 'text', text: { '=': 'globalThis.process' } }).error).toBeDefined()
    expect(compileFormula('(() => process.exit())()').error).toBeDefined()
  })
  it('calculates bounded expressions, exponentiation, math constants and linked inputs without eval', () => {
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
    const emptyScope = createScope(new Map(), new Map())
    expect(evaluate(compileFormula('min(max(2, 4), 3)').tree!, emptyScope).value).toBe(3)
    expect(evaluate(compileFormula('2 ** 3 ** 2').tree!, emptyScope).value).toBe(512)
    expect(evaluate(compileFormula('-2^2 + 10').tree!, emptyScope).value).toBe(6)
    expect(evaluate(compileFormula('round(sin(PI / 2) + log2(8), 2)').tree!, emptyScope).value).toBe(4)
  })
  it('supports multi-select choice arrays in count, join and contains formulas and validates allowCustom', () => {
    const shown = checkShownView('Spec', {
      type: 'stack',
      children: [
        { type: 'choice', id: 'mods', label: 'Modules', multi: true, allowCustom: true, options: [{ label: 'Cache', value: 'cache' }, { label: 'Audit', value: 'audit' }], value: ['cache'] },
        { type: 'choice', id: 'env', label: 'Env', allowCustom: true, options: [{ label: 'Staging', value: 'stg' }, { label: 'Prod', value: 'prod' }] },
        { type: 'metric', label: 'Selected', value: { '=': 'count(mods)' } },
        { type: 'text', text: { '=': 'contains(mods, "audit") ? join(mods, " + ") : "basic"' } },
        { type: 'options', id: 'pick', multi: true, allowCustom: true, options: [{ label: 'Approve' }, { label: 'Review' }] },
      ],
    })
    if ('error' in shown) throw new Error(shown.error)
    const scope = viewScope(shown.view, { mods: ['cache', 'audit', 'Tracing'] })
    expect(resolve({ '=': 'count(mods)' }, scope)).toBe(3)
    expect(resolve({ '=': 'contains(mods, "audit") ? join(mods, " + ") : "basic"' }, scope)).toBe('cache + audit + Tracing')
    expect(inputsSummary(shown.view, { mods: ['cache', 'Tracing'], env: 'eu-west-1' })).toBe('Modules=Cache, Tracing; Env=eu-west-1')

    expect(validateViewAnswer(shown.view, 'pick', {
      selected: ['Approve', '  Need benchmark  '],
      inputs: { mods: ['cache', '  Tracing  '], env: '  eu-west-1  ' },
    })).toEqual({
      selected: ['Approve', 'Need benchmark'],
      inputs: { mods: ['cache', 'Tracing'], env: 'eu-west-1' },
    })
    expect(validateViewAnswer(shown.view, 'pick', {
      selected: ['Custom A', 'Custom B'],
    }).error).toContain('at most one custom')
    expect(validateViewAnswer(shown.view, 'pick', {
      selected: ['Approve'],
      inputs: { mods: ['cache', 'Custom 1', 'Custom 2'] },
    }).error).toContain('at most one custom')
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
