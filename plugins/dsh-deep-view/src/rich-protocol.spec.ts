import { describe, expect, it } from 'vitest'
import {
  checkShownView, inputDefault, mathDefaults, normalizeView, resolve, validateView,
  validateViewAnswer, viewBindings, viewScope,
} from './core/index.js'
import type { ViewNode } from './contracts.ts'

// Core-protocol coverage for the rich nodes (math/flow/explore/map): normalizeView
// provider-decoding, validateView payload rules, checkShownView wire checks,
// validateViewAnswer user-answer shapes, and the bindings formulas read. Component
// rendering lives in the sibling *.spec.tsx files; these specs never touch the DOM.

const asView = (node: unknown) => node as ViewNode

const mathNode = {
  type: 'math', id: 'graph',
  mathPoints: [{ id: 'p', label: 'P', x: 1, y: 2 }, { id: 'q', x: 0, y: 0 }],
  curves: [{ label: 'Sine', expression: 'sin(x)' }],
  domain: [-5, 5], range: [-3, 3],
}
const flowNode = {
  type: 'flow', id: 'net',
  nodes: [{ id: 'a', label: 'A', detail: 'start', x: 0, y: 0, tone: 'accent' }, { id: 'b', label: 'B', x: 120, y: 40 }],
  edges: [{ id: 'e', source: 'a', target: 'b', label: 'next' }],
}
const exploreRows = [{ watts: 60, hours: 10, model: 'A' }, { watts: 90, hours: 6, model: 'B' }]
const exploreNode = { type: 'explore', id: 'scatter', data: exploreRows, xKey: 'watts', yKey: 'hours', colorKey: 'model', select: 'point' }
const mapNode = {
  type: 'map', id: 'trip', center: [121.47, 31.23], zoom: 10,
  locations: [{ id: 'sh', label: 'Shanghai', detail: 'hub', coordinates: [121.47, 31.23] }, { id: 'hz', label: 'Hangzhou', coordinates: [120.16, 30.29] }],
  routes: [{ label: 'leg', coordinates: [[121.47, 31.23], [120.16, 30.29]] }],
}
const stack = (...children: unknown[]) => ({ type: 'stack', children })
const withSubmit = (node: unknown) => stack(node, { type: 'submit', id: 'send' })

describe('normalizeView', () => {
  it('unwraps provider { item: [...] } wrappers recursively and coerces numeric fields', () => {
    const sent = { type: 'stack', children: { item: { item: [{ type: 'progress', percent: '75' }] } } }
    const normalized = normalizeView(sent) as { children: { percent: number }[] }
    expect(normalized.children).toHaveLength(1)
    expect(normalized.children[0].percent).toBe(75)
    // A wrapped view passes the same validation as the plain blueprint.
    expect(validateView(normalized).ok).toBe(true)
    expect(normalizeView({ item: [1, 2] })).toEqual([1, 2])
  })
  it('coerces number-typed fields from strings but leaves other props untouched', () => {
    const out = normalizeView({ type: 'slider', id: 's', label: 'S', min: '0', max: '10', step: '0.5', value: '4', unit: 'px' }) as Record<string, unknown>
    expect(out).toMatchObject({ min: 0, max: 10, step: 0.5, value: 4, unit: 'px' })
  })
  it('keeps a formula inside series values and numeric-looking strings in form fields', () => {
    const chart = normalizeView({ type: 'chart', categories: ['A', 'B'], series: [{ values: ['3', { '=': '1 + 1' }] }] }) as { series: { values: unknown[] }[] }
    expect(chart.series[0].values).toEqual([3, { '=': '1 + 1' }])
    const form = normalizeView({ type: 'form', id: 'f', fields: [{ id: 'a', label: 'A', value: '42' }] }) as { fields: { value: unknown }[] }
    expect(form.fields[0].value).toBe('42')
  })
  it('normalizes model authoring shorthands: object table rows, tone aliases, auto-laid-out flow and confirm labels', () => {
    const shownTable = checkShownView('', {
      type: 'table', title: 'Comparison',
      columns: ['Option', 'Latency'],
      rows: [{ Option: 'Local', Latency: '12ms' }, ['Remote', '80ms']],
    })
    expect(shownTable).not.toHaveProperty('error')
    if ('view' in shownTable) {
      expect(shownTable.title).toBe('Comparison')
      expect(shownTable.view.rows).toEqual([['Local', '12ms'], ['Remote', '80ms']])
    }
    const shownFlow = checkShownView('', {
      type: 'flow',
      nodes: [{ id: 'api-gw', label: 'Gateway', tone: 'good' }, { id: 'db-main', label: 'Database', tone: 'danger' }],
      edges: [{ from: 'api-gw', to: 'db-main', label: 'SQL' }],
    })
    expect(shownFlow).not.toHaveProperty('error')
    if ('view' in shownFlow) {
      expect(shownFlow.view.nodes?.[0]).toMatchObject({ id: 'api_gw', tone: 'success', x: 0, y: 0 })
      expect(shownFlow.view.nodes?.[1]).toMatchObject({ id: 'db_main', tone: 'bad', x: 236, y: 0 })
      expect(shownFlow.view.edges?.[0]).toMatchObject({ source: 'api_gw', target: 'db_main', label: 'SQL' })
    }
    const shownConfirm = checkShownView('', { type: 'confirm', label: 'Proceed with deployment?' })
    expect(shownConfirm).not.toHaveProperty('error')
    if ('view' in shownConfirm) expect(shownConfirm.view.type).toBe('stack')
  })
  it('coerces math coordinates from strings without changing explore category fields', () => {
    const math = checkShownView('', { type: 'math', mathPoints: [{ id: 'p', x: '1', y: '2' }], domain: ['-5', '5'] })
    expect(math).not.toHaveProperty('error')
    if ('view' in math) expect(math.view.mathPoints?.[0]).toMatchObject({ x: 1, y: 2 })
    const explore = checkShownView('', { type: 'explore', data: [{ x: '1', y: '2', category: 'keep' }], xKey: 'x', yKey: 'y', colorKey: 'category' })
    expect(explore).not.toHaveProperty('error')
    if ('view' in explore) expect(explore.view.data?.[0]).toEqual({ x: 1, y: 2, category: 'keep' })
  })
  it('drops decorative display fields and supports metric units, singleton children and inferred table columns', () => {
    const metric = checkShownView('', { type: 'metric', label: 'Total', value: 42, unit: '元', icon: 'money', align: 'right' })
    expect(metric).not.toHaveProperty('error')
    if ('view' in metric) expect(metric.view).toEqual({ type: 'metric', label: 'Total', value: 42, unit: '元' })
    const layout = checkShownView('', { type: 'Stack', children: { type: 'slider', label: 'Count', min: '0', max: '10', value: '4' } })
    expect(layout).not.toHaveProperty('error')
    if ('view' in layout) expect(layout.view.children?.[0]).toMatchObject({ type: 'slider', id: 'slider_1', min: 0, max: 10, value: 4 })
    const table = checkShownView('', { type: 'table', rows: { Option: 'Local', Latency: '12ms' } })
    expect(table).not.toHaveProperty('error')
    if ('view' in table) expect(table.view).toMatchObject({ columns: [{ key: 'Option' }, { key: 'Latency' }], rows: [['Local', '12ms']] })
    const protectedTable = checkShownView('', JSON.parse('{"type":"table","rows":[{"name":"safe","__proto__":{"polluted":true}}]}'))
    expect(protectedTable).not.toHaveProperty('error')
    if ('view' in protectedTable) expect(protectedTable.view).toMatchObject({ columns: [{ key: 'name' }], rows: [['safe']] })
  })
  it('accepts scalar options and boolean strings without relaxing input properties', () => {
    const options = checkShownView('', { type: 'options', options: ['One', { title: 'Two', description: 'Second' }], multi: 'true' })
    expect(options).not.toHaveProperty('error')
    if ('view' in options) expect(options.view.options).toEqual([{ label: 'One' }, { label: 'Two', description: 'Second' }])
    expect(checkShownView('', { type: 'toggle', label: 'Enabled', value: 'true' })).not.toHaveProperty('error')
    expect(checkShownView('', { type: 'slider', id: 's', label: 'S', min: 0, max: 10, value: 4, default: 4 }).error).toContain('unknown property')
  })
  it('normalizes numeric map coordinates and zoom', () => {
    const shown = checkShownView('', { type: 'map', locations: { label: 'Shanghai', coordinates: ['121.47', '31.23'] }, center: ['121.47', '31.23'], zoom: '10', routes: { coordinates: [['121.47', '31.23'], ['120.16', '30.29']] } })
    expect(shown).not.toHaveProperty('error')
    if ('view' in shown) expect(shown.view).toMatchObject({ zoom: 10, center: [121.47, 31.23], locations: [{ id: 'loc_1', coordinates: [121.47, 31.23] }] })
  })
  it('keeps __proto__ as an own data property instead of mutating the prototype', () => {
    const out = normalizeView(JSON.parse('{"__proto__":{"polluted":true}}')) as Record<string, unknown>
    expect(Object.hasOwn(out, '__proto__')).toBe(true)
    expect(out.__proto__).toEqual({ polluted: true })
    // ...so the validator sees and rejects it as an unknown property.
    expect(validateView({ type: 'text', text: 'hi', ...JSON.parse('{"__proto__":{"x":1}}') }).error).toContain('__proto__')
  })
})

describe('validateView / checkShownView: math', () => {
  it('accepts a complete math node and marks it non-interactive', () => {
    const shown = checkShownView('Graph', stack(mathNode))
    expect(shown).toMatchObject({ title: 'Graph', interactive: false })
    if ('view' in shown) expect(shown.view).toEqual(stack(mathNode))
    expect(validateView(stack(mathNode))).toEqual({ ok: true, interactive: false })
  })
  it('rejects missing mathPoints, more than 4 points and unsafe point ids', () => {
    expect(validateView({ type: 'math', id: 'm' }).error).toContain('mathPoints: expected 1 to 4 points')
    expect(validateView({ type: 'math', id: 'm', mathPoints: [] }).error).toContain('mathPoints')
    expect(validateView({ type: 'math', id: 'm', mathPoints: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, x: 0, y: 0 })) }).error).toContain('1 to 4 points')
    expect(validateView({ type: 'math', id: 'm', mathPoints: [{ id: 'true', x: 0, y: 0 }] }).error).toContain('safe point id')
    expect(validateView({ type: 'math', id: 'm', mathPoints: [{ id: 'p', x: 0, y: 0 }, { id: 'p', x: 1, y: 1 }] }).error).toContain('unique safe point id')
    expect(validateView({ type: 'math', id: 'm', mathPoints: [{ id: 'p', x: 0, y: 0, hidden: 1 }] }).error).toContain('unknown point property')
    expect(validateView({ type: 'math', id: 'm', mathPoints: [{ id: 'p', x: 0, y: 0, constrain: 'diagonal' }] }).error).toContain('constrain')
  })
  it('rejects out-of-range coordinates and degenerate domain/range', () => {
    expect(validateView({ type: 'math', id: 'm', mathPoints: [{ id: 'p', x: 1e6 + 1, y: 0 }] }).error).toContain('±1000000')
    expect(validateView({ ...mathNode, domain: [0, 0] }).error).toContain('domain: expected two distinct finite numbers')
    expect(validateView({ ...mathNode, range: ['-3', 3] }).error).toContain('range')
    // Empty optional collections may be omitted; domain/range stay optional.
    expect(validateView({ type: 'math', id: 'm', mathPoints: [{ id: 'p', x: 0, y: 0 }], curves: [] }).ok).toBe(true)
    expect(validateView({ type: 'math', id: 'm', mathPoints: [{ id: 'p', x: 0, y: 0 }] }).ok).toBe(true)
  })
  it('allows curve expressions to read inputs in any order, outermost let bindings and PI', () => {
    const speed = { type: 'number', id: 'speed', label: 'S', value: 2 }
    const after = stack(speed, { type: 'math', id: 'm', mathPoints: [{ id: 'p', x: 0, y: 0 }], curves: [{ expression: 'speed * x' }] })
    expect(validateView(after).ok).toBe(true)
    const before = { type: 'stack', let: { scaled: 'speed * 0.5' }, children: [
      { type: 'math', id: 'm', mathPoints: [{ id: 'p', x: 0, y: 0 }], curves: [{ expression: 'scaled * x^2 + sin(PI * x)' }] },
      speed,
    ] }
    expect(validateView(before).ok).toBe(true)
    // 'x' is the curve's free variable, but undeclared names are still rejected.
    expect(validateView({ type: 'math', id: 'm', mathPoints: [{ id: 'p', x: 0, y: 0 }], curves: [{ expression: 'mystery * x' }] }).error).toContain('unknown name')
    expect(validateView({ type: 'math', id: 'm', mathPoints: [{ id: 'p', x: 0, y: 0 }], curves: [{ expression: 'x +' }] }).error).toContain('expression')
    expect(validateView({ type: 'math', id: 'm', mathPoints: [{ id: 'p', x: 0, y: 0 }], curves: [{ expression: `x * ${'a'.repeat(300)}` }] }).error).toContain('bounded formula')
  })
})

describe('validateView: flow / explore / map', () => {
  it('accepts well-formed flow, explore and map payloads', () => {
    expect(validateView(stack(flowNode))).toEqual({ ok: true, interactive: false })
    expect(validateView(stack(exploreNode))).toEqual({ ok: true, interactive: false })
    expect(validateView(stack(mapNode))).toEqual({ ok: true, interactive: false })
  })
  it('rejects malformed flow nodes and edges', () => {
    expect(validateView({ type: 'flow', id: 'f', nodes: [], edges: [] }).error).toContain('1 to 40 nodes')
    expect(validateView({ type: 'flow', id: 'f', nodes: [{ id: 'a', label: '', x: 0, y: 0 }], edges: [] }).error).toContain('label')
    expect(validateView({ type: 'flow', id: 'f', nodes: [{ id: 'a', label: 'A', x: 0 }], edges: [] }).error).toContain('finite x/y')
    expect(validateView({ type: 'flow', id: 'f', nodes: [{ id: 'a', label: 'A', x: 0, y: 0, tone: 'hot' }], edges: [] }).error).toContain('tone')
    // Empty edges may be omitted; source/target must be distinct declared ids.
    expect(validateView({ type: 'flow', id: 'f', nodes: [{ id: 'a', label: 'A', x: 0, y: 0 }] }).ok).toBe(true)
    expect(validateView({ type: 'flow', id: 'f', nodes: [{ id: 'a', label: 'A', x: 0, y: 0 }], edges: [{ id: 'e', source: 'a', target: 'a' }] }).error).toContain('distinct declared nodes')
    expect(validateView({ type: 'flow', id: 'f', nodes: [{ id: 'a', label: 'A', x: 0, y: 0 }], edges: [{ id: 'e', source: 'a', target: 'ghost' }] }).error).toContain('distinct declared nodes')
  })
  it('rejects malformed explore payloads', () => {
    expect(validateView({ type: 'explore', id: 'e', xKey: 'w', yKey: 'h' }).error).toContain('data: expected 1 to 200 inline records')
    expect(validateView({ type: 'explore', id: 'e', data: [{ w: 1 }], xKey: 'w', yKey: 'h' }).error).toContain('.h: expected a finite number')
    expect(validateView({ type: 'explore', id: 'e', data: [{ w: 'x', h: 1 }], xKey: 'w', yKey: 'h' }).error).toContain('.w: expected a finite number')
    expect(validateView({ type: 'explore', id: 'e', data: [{ w: 1, h: 2, 'bad-key': 1 }], xKey: 'w', yKey: 'h' }).error).toContain('bounded flat record')
    expect(validateView({ type: 'explore', id: 'e', data: [{ w: 1, h: 2, m: { nested: true } }], xKey: 'w', yKey: 'h' }).error).toContain('bounded scalars')
    expect(validateView({ type: 'explore', id: 'e', data: [{ w: 1, h: 2 }], xKey: 'w', yKey: 'h', select: 'lasso' }).error).toContain('point or interval')
    expect(validateView({ type: 'explore', id: 'e', data: [{ w: 1, h: 2 }], xKey: 'has space', yKey: 'h' }).error).toContain('xKey')
  })
  it('rejects malformed map payloads', () => {
    expect(validateView({ type: 'map', id: 'm', locations: [] }).error).toContain('locations: expected 1 to 60')
    expect(validateView({ type: 'map', id: 'm', locations: [{ id: 'a', label: 'A', coordinates: [200, 0] }], routes: [] }).error).toContain('[longitude, latitude]')
    expect(validateView({ type: 'map', id: 'm', locations: [{ id: 'a', label: 'A', coordinates: [0, 91] }], routes: [] }).error).toContain('[longitude, latitude]')
    expect(validateView({ ...mapNode, zoom: 23 }).error).toContain('zoom: expected a number from 0 to 22')
    expect(validateView({ ...mapNode, center: [181, 0] }).error).toContain('center')
    // Empty routes may be omitted; a route needs 2..200 in-range points.
    expect(validateView({ type: 'map', id: 'm', locations: [{ id: 'a', label: 'A', coordinates: [0, 0] }] }).ok).toBe(true)
    expect(validateView({ type: 'map', id: 'm', locations: [{ id: 'a', label: 'A', coordinates: [0, 0] }], routes: [{ coordinates: [[0, 0]] }] }).error).toContain('2 to 200 coordinates')
    expect(validateView({ type: 'map', id: 'm', locations: [{ id: 'a', label: 'A', coordinates: [0, 0] }], routes: [{ coordinates: [[0, 0], [0, 95]] }] }).error).toContain('invalid coordinates')
  })
  it('rejects ids that formulas cannot read and duplicate ids across rich nodes', () => {
    expect(validateView({ type: 'flow', id: 'has-dash', nodes: [{ id: 'a', label: 'A', x: 0, y: 0 }], edges: [] }).error).toContain('id')
    expect(validateView(stack(flowNode, { ...mapNode, id: 'net' })).error).toContain('duplicate id')
  })
})

describe('checkShownView deep nesting', () => {
  const nestedArray = (layers: number) => {
    let value: unknown = 0
    for (let layer = 0; layer < layers; layer += 1) value = [value]
    return value
  }
  const utf8Length = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

  it('returns a validation error for a 1600-layer nested array inside the byte limit', () => {
    const sent = nestedArray(1600)
    expect(utf8Length(sent)).toBe(3201)
    expect(utf8Length(sent)).toBeLessThan(8192)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(checkShownView('', sent)).toEqual({ error: 'view: expected a component object' })
    }
  })

  it('still rejects a nested array deeper than the old stack overflow, without throwing', () => {
    const sent = nestedArray(4000)
    expect(utf8Length(sent)).toBe(8001)
    expect(utf8Length(sent)).toBeLessThan(8192)
    expect(checkShownView('', sent)).toEqual({ error: 'view: expected a component object' })
  })

  it('rejects a deeply nested table cell as too long instead of throwing', () => {
    const sent = {
      type: 'table',
      columns: [{ key: 'a', label: 'A' }],
      rows: [[nestedArray(1600)]],
    }
    expect(utf8Length(sent)).toBeLessThan(8192)
    const shown = checkShownView('', sent) as { error?: string }
    expect(shown.error).toContain('characters exceeds the limit')
  })
})

describe('checkShownView wire checks', () => {
  it('trims the title, enforces the byte limit before normalize, and rejects a non-string title', () => {
    const shown = checkShownView('  Title  ', stack(flowNode))
    expect(shown).toMatchObject({ title: 'Title', interactive: false })
    expect(checkShownView(undefined, stack(flowNode))).toMatchObject({ title: '' })
    expect((checkShownView(3, stack(flowNode)) as { error: string }).error).toBe('title: expected a string')
    const tooBig = { type: 'text', text: 'x'.repeat(9000) }
    const over = checkShownView('', tooBig) as { error: string }
    expect(over.error).toContain('bytes; the limit is 8192')
  })
  it('returns the normalized view so provider-encoded numbers pass', () => {
    const shown = checkShownView('', stack({ type: 'slider', id: 's', label: 'S', min: '0', max: '10', value: '3' }))
    expect(shown).not.toHaveProperty('error')
    if ('view' in shown) {
      const slider = (shown.view.children ?? [])[0]
      expect(slider.min).toBe(0)
      expect(slider.value).toBe(3)
    }
  })
})

describe('validateViewAnswer: rich inputs', () => {
  it('merges inputs into a submit answer and fills defaults for unsent inputs', () => {
    const view = withSubmit(flowNode)
    // Only the flow answer is sent; the math node uses mathDefaults().
    const full = validateViewAnswer(withSubmit(mathNode), 'send', { inputs: { graph: { p: [5, 5], q: [1, 1] } } })
    expect(full).toEqual({ inputs: { graph: { p: [5, 5], q: [1, 1] } } })
    const partial = validateViewAnswer(view, 'send', {})
    expect(partial).toEqual({ inputs: { net: '' } })
    expect(validateViewAnswer(view, 'send', { inputs: { net: 'b' } })).toEqual({ inputs: { net: 'b' } })
    expect(validateViewAnswer(asView({ type: 'submit', id: 'send' }), 'send', { inputs: { net: 'b' } }).error).toContain('this view has no inputs')
    expect(validateViewAnswer(view, 'send', { inputs: { ghost: 1 } }).error).toContain('unknown input')
  })
  it('requires every declared math point to come back as an in-range pair', () => {
    const view = withSubmit(mathNode)
    const at = 'values.inputs.graph'
    expect(validateViewAnswer(view, 'send', { inputs: { graph: 'not-a-record' } }).error).toContain('expected point coordinates')
    expect(validateViewAnswer(view, 'send', { inputs: { graph: { p: [0, 0], q: [0, 0], r: [0, 0] } } }).error).toContain('unknown point')
    // A missing declared point reads undefined and fails its own pair check.
    expect(validateViewAnswer(view, 'send', { inputs: { graph: { p: [0, 0] } } }).error).toContain(`${at}.q`)
    expect(validateViewAnswer(view, 'send', { inputs: { graph: { p: [0, 0, 0], q: [0, 0] } } }).error).toContain(`${at}.p`)
    expect(validateViewAnswer(view, 'send', { inputs: { graph: { p: [1e6 + 1, 0], q: [0, 0] } } }).error).toContain('±1000000')
    expect(validateViewAnswer(view, 'send', { inputs: { graph: { p: [1e6, -1e6], q: [0.5, -0.5] } } })).toEqual({ inputs: { graph: { p: [1e6, -1e6], q: [0.5, -0.5] } } })
  })
  it('accepts only a declared flow/map id or the empty selection', () => {
    expect(validateViewAnswer(withSubmit(flowNode), 'send', { inputs: { net: 'a' } })).toEqual({ inputs: { net: 'a' } })
    expect(validateViewAnswer(withSubmit(flowNode), 'send', { inputs: { net: '' } })).toEqual({ inputs: { net: '' } })
    expect(validateViewAnswer(withSubmit(flowNode), 'send', { inputs: { net: 'ghost' } }).error).toContain('declared node id')
    expect(validateViewAnswer(withSubmit(mapNode), 'send', { inputs: { trip: 'hz' } })).toEqual({ inputs: { trip: 'hz' } })
    expect(validateViewAnswer(withSubmit(mapNode), 'send', { inputs: { trip: 'ghost' } }).error).toContain('declared location id')
    expect(validateViewAnswer(withSubmit(mapNode), 'send', { inputs: { trip: 1 } }).error).toContain('declared location id')
  })
  it('validates explore point selections against declared category values', () => {
    const view = withSubmit(exploreNode)
    expect(validateViewAnswer(view, 'send', { inputs: { scatter: ['A', 'B'] } })).toEqual({ inputs: { scatter: ['A', 'B'] } })
    expect(validateViewAnswer(view, 'send', { inputs: { scatter: [] } })).toEqual({ inputs: { scatter: [] } })
    expect(validateViewAnswer(view, 'send', { inputs: { scatter: ['Z'] } }).error).toContain('declared category values')
    expect(validateViewAnswer(view, 'send', { inputs: { scatter: ['A', 'A'] } }).error).toContain('duplicate selection')
    // A selection longer than the data fails the category check before dedup runs.
    expect(validateViewAnswer(view, 'send', { inputs: { scatter: ['A', 'B', 'A'] } }).error).toContain('declared category values')
    // Without colorKey the client still selects on xKey (exploreMeta), so only
    // declared xKey values answer — not arbitrary scalars, not yKey values.
    const plain = withSubmit({ type: 'explore', id: 'e', data: exploreRows, xKey: 'watts', yKey: 'hours', select: 'point' })
    expect(validateViewAnswer(plain, 'send', { inputs: { e: [60, 90] } })).toEqual({ inputs: { e: [60, 90] } })
    expect(validateViewAnswer(plain, 'send', { inputs: { e: [10] } }).error).toContain('declared category values')
    expect(validateViewAnswer(plain, 'send', { inputs: { e: ['x'] } }).error).toContain('declared category values')
    expect(validateViewAnswer(plain, 'send', { inputs: { e: [1, 2, 3] } }).error).toContain('declared category values')
    expect(validateViewAnswer(plain, 'send', { inputs: { e: [{}] } }).error).toContain('declared category values')
  })
  it('validates explore interval selections as ordered ranges on declared keys', () => {
    const view = withSubmit({ type: 'explore', id: 'e', data: exploreRows, xKey: 'watts', yKey: 'hours', select: 'interval' })
    expect(validateViewAnswer(view, 'send', { inputs: { e: { watts: [50, 100] } } })).toEqual({ inputs: { e: { watts: [50, 100] } } })
    expect(validateViewAnswer(view, 'send', { inputs: { e: { watts: [50, 100], hours: [0, 12] } } })).toEqual({ inputs: { e: { watts: [50, 100], hours: [0, 12] } } })
    expect(validateViewAnswer(view, 'send', { inputs: { e: {} } })).toEqual({ inputs: { e: {} } })
    expect(validateViewAnswer(view, 'send', { inputs: { e: { zork: [0, 1] } } }).error).toContain('bounded interval')
    // The literal names 'xKey'/'yKey' are not fields; only the declared keys are.
    expect(validateViewAnswer(view, 'send', { inputs: { e: { xKey: [0, 1] } } }).error).toContain('bounded interval')
    expect(validateViewAnswer(view, 'send', { inputs: { e: { yKey: [0, 1] } } }).error).toContain('bounded interval')
    expect(validateViewAnswer(view, 'send', { inputs: { e: { watts: [100, 50] } } }).error).toContain('ordered numeric range')
    expect(validateViewAnswer(view, 'send', { inputs: { e: { watts: [50] } } }).error).toContain('ordered numeric range')
    expect(validateViewAnswer(view, 'send', { inputs: { e: { watts: '50-100' } } }).error).toContain('ordered numeric range')
  })
  it('treats an omitted select as point: arrays answer, records do not', () => {
    // explore.tsx/skill default select to 'point'; the Host must not read the
    // missing flag as interval and refuse a legal point array.
    const plain = withSubmit({ type: 'explore', id: 'e', data: exploreRows, xKey: 'watts', yKey: 'hours', colorKey: 'model' })
    expect(validateViewAnswer(plain, 'send', { inputs: { e: ['A'] } })).toEqual({ inputs: { e: ['A'] } })
    expect(validateViewAnswer(plain, 'send', { inputs: { e: [] } })).toEqual({ inputs: { e: [] } })
    expect(validateViewAnswer(plain, 'send', { inputs: { e: { watts: [50, 100] } } }).error).toContain('declared category values')
    expect(validateViewAnswer(plain, 'send', { inputs: { e: 'A' } }).error).toContain('declared category values')
    expect(validateViewAnswer(plain, 'send', {})).toEqual({ inputs: { e: [] } })
  })
})

describe('viewBindings / mathDefaults / formula linkage', () => {
  it('exposes each math point as <id>X/<id>Y before the node binding', () => {
    const bindings = viewBindings(asView(stack(mathNode, flowNode, exploreNode, mapNode)))
    expect(bindings.map(b => [b.id, b.kind])).toEqual([
      ['pX', 'math'], ['pY', 'math'], ['qX', 'math'], ['qY', 'math'], ['graph', 'math'],
      ['net', 'flow'], ['scatter', 'explore'], ['trip', 'map'],
    ])
    expect(bindings.every(b => b.value === undefined && b.node !== undefined)).toBe(true)
  })
  it('mathDefaults returns id → [x, y] and matches inputDefault', () => {
    expect(mathDefaults(asView(mathNode))).toEqual({ p: [1, 2], q: [0, 0] })
    expect(inputDefault(asView(mathNode))).toEqual({ p: [1, 2], q: [0, 0] })
    expect(inputDefault(asView(flowNode))).toBe('')
    expect(inputDefault(asView(exploreNode))).toEqual([])
    // An omitted select defaults to point (exploreMeta), which answers an array.
    expect(inputDefault(asView({ type: 'explore', id: 'e', data: exploreRows, xKey: 'watts', yKey: 'hours' }))).toEqual([])
    expect(inputDefault(asView(mapNode))).toBe('')
  })
  it('viewScope resolves sent point coordinates and falls back per point', () => {
    const scope = viewScope(asView(stack(mathNode)), { graph: { p: [9, 8] } })
    expect(scope('pX')).toBe(9)
    expect(scope('pY')).toBe(8)
    expect(scope('qX')).toBe(0) // q keeps its declared default
    expect(scope('graph')).toEqual({ p: [9, 8] })
    const defaults = viewScope(asView(stack(mathNode)))
    expect([defaults('pX'), defaults('pY')]).toEqual([1, 2])
  })
  it('lets formulas read math coordinates, input ids and let names end-to-end', () => {
    const view = {
      type: 'stack', let: { dist: 'sqrt(pow(pX, 2) + pow(pY, 2))' }, children: [
        mathNode,
        { type: 'metric', label: 'Radius', value: { '=': 'fixed(dist, 1)' } },
        { type: 'text', text: { '=': 'pX > 0 ? "right" : "left"' } },
      ],
    }
    expect(validateView(view).ok).toBe(true)
    const scope = viewScope(asView(view), { graph: { p: [3, 4], q: [0, 0] } })
    expect(scope('dist')).toBe(5)
    expect(resolve(view.children[1].value, scope)).toBe('5.0')
    expect(resolve(view.children[2].text, scope)).toBe('right')
  })
  it('rejects formulas that read undeclared names or evaluation failures at validation time', () => {
    expect(validateView(stack({ type: 'metric', label: 'M', value: { '=': 'pX * 2' } }, mathNode)).ok).toBe(true)
    // 'x' is only a free variable inside curve expressions, not a binding.
    expect(validateView(stack(mathNode, { type: 'metric', label: 'M', value: { '=': 'x + 1' } })).error).toContain('unknown name "x"')
    // A let name colliding with an input id is refused.
    expect(validateView({ type: 'stack', let: { net: '1' }, children: [flowNode] }).error).toContain('already an input id')
    // A formula over a flow selection ('') fails evaluation: "" is not a number.
    expect(validateView(stack(flowNode, { type: 'metric', label: 'M', value: { '=': 'net * 2' } })).error).toContain('is not a number')
  })
  it('rejects math <pointId>X/Y binding collisions whatever order nodes come in', () => {
    const math = { type: 'math', id: 'm', mathPoints: [{ id: 'a', x: 0, y: 0 }] }
    // A plain input id taking the derived aX binding failed before the math
    // node already; after the math node it silently overwrote the binding —
    // now both orders are refused by checkShownView.
    expect(checkShownView('', stack(math, { type: 'number', id: 'aX', label: 'N', value: 1 })).error).toContain('aX')
    expect(checkShownView('', stack({ type: 'number', id: 'aX', label: 'N', value: 1 }, math)).error).toContain('aX')
    // The math node's own id counts as a binding name as well.
    expect(checkShownView('', { type: 'math', id: 'aX', mathPoints: [{ id: 'a', x: 0, y: 0 }] }).error).toContain('aX')
    // A second math point id that reads as another point's binding is refused.
    const other = { type: 'math', id: 'g', mathPoints: [{ id: 'b', x: 0, y: 0 }] }
    expect(validateView(stack(math, other)).ok).toBe(true)
    expect(validateView(stack(math, { type: 'math', id: 'g', mathPoints: [{ id: 'p', x: 0, y: 0 }] })).ok).toBe(true)
    // A rich input (flow) may not take a derived binding name either.
    expect(validateView(stack(math, { type: 'flow', id: 'aX', nodes: [{ id: 'n', label: 'N', x: 0, y: 0 }] })).error).toContain('aX')
    // Layout/display ids are not bindings: a text node named 'aX' stays legal
    // in both orders, so the guard never mistakes a layout id for a variable.
    const text = { type: 'text', id: 'aX', text: 'note' }
    expect(validateView(stack(text, math)).ok).toBe(true)
    expect(validateView(stack(math, text)).ok).toBe(true)
  })
})
