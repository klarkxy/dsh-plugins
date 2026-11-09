import { describe, expect, it } from 'vitest'
import { chartCsv, chartData, niceTicks } from './chart.tsx'
import { viewScope } from './core/index.js'

const lookup = viewScope({ type: 'stack', children: [] })
describe('chart data', () => {
  it('handles all five chart kinds and linked values', () => {
    for (const kind of ['bar', 'hbar', 'line', 'area', 'donut']) {
      const data = chartData({ type: 'chart', kind: kind as 'bar', categories: ['A', 'B'], series: [{ name: 'One', values: [1, 2] }] }, lookup)
      expect(data.kind).toBe(kind)
      expect(data.series[0].values).toEqual([1, 2])
    }
  })
  it('escapes CSV and names an unnamed series', () => {
    const data = chartData({ type: 'chart', categories: ['A,"quoted"', 'B'], series: [{ values: [1, 2] }] }, lookup)
    expect(chartCsv(data)).toBe(',Value\n"A,""quoted""",1\nB,2')
  })
  it('produces readable bounded ticks', () => {
    expect(niceTicks(0, 10)).toEqual([0, 2.5, 5, 7.5, 10])
    expect(niceTicks(2, 2)).toEqual([0, 0.5, 1, 1.5, 2])
  })
})
