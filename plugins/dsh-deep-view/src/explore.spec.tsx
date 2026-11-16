import { act } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { compile } from 'vega-lite'
import type { ExploreDatum, ViewNode } from './contracts.ts'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' })
vi.stubGlobal('window', dom.window)
vi.stubGlobal('document', dom.window.document)
vi.stubGlobal('navigator', dom.window.navigator)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const embedMock = vi.hoisted(() => vi.fn())
vi.mock('vega-embed', () => ({ default: embedMock }))

let createRoot: typeof import('react-dom/client').createRoot
let explore: typeof import('./explore.tsx')
beforeAll(async () => {
  createRoot = (await import('react-dom/client')).createRoot
  explore = await import('./explore.tsx')
})
afterEach(() => { embedMock.mockReset(); document.body.innerHTML = '<div id="root"></div>' })

const t = (key: string, params?: Record<string, unknown>) =>
  key.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))

const node = (extra: Partial<ViewNode> = {}): ViewNode => ({
  type: 'explore',
  id: 'pick_one',
  label: 'Explore',
  xKey: 'watts',
  yKey: 'hours',
  ...extra,
})

const rows: ExploreDatum[] = [
  { watts: 60, hours: 10, model: 'A' },
  { watts: 90, hours: 6, model: 'B' },
]

function fakeEmbed() {
  const state: { listeners: Record<string, (name: string, value: unknown) => void>; finalized: boolean } = { listeners: {}, finalized: false }
  embedMock.mockImplementation(async () => ({
    view: {
      addSignalListener: (name: string, handler: (name: string, value: unknown) => void) => { state.listeners[name] = handler },
      signal: () => ({}),
      finalize: () => { state.finalized = true },
    },
    finalize: () => { state.finalized = true },
  }))
  const fire = (name: string, value: unknown) => {
    act(() => { state.listeners[name]?.(name, value) })
  }
  return { state, fire }
}

describe('exploreSpec', () => {
  it('builds a closed spec: inline data, declared encodings, no URL/transform/patch', () => {
    const spec = explore.exploreSpec(node({ data: rows, colorKey: 'model', select: 'interval' }))!
    expect(spec).not.toBeNull()
    const text = JSON.stringify(spec)
    expect(text).not.toContain('"url"')
    expect(text).not.toContain('"transform"')
    expect(text).not.toContain('"expr"')
    expect(text).not.toContain('"signal"')
    expect(spec.data).toEqual({ values: rows })
    const encoding = (spec as unknown as { encoding: Record<string, unknown> }).encoding
    expect(encoding.x).toMatchObject({ field: 'watts', type: 'quantitative' })
    expect(encoding.y).toMatchObject({ field: 'hours', type: 'quantitative' })
    expect(encoding.color).toMatchObject({ field: 'model', type: 'nominal' })
    const params = spec.params as { name: string; select: { type: string } }[]
    expect(params).toHaveLength(1)
    expect(params[0].name).toBe(explore.BRUSH_SIGNAL)
    expect(params[0].select.type).toBe('interval')
  })
  it('declares a point selection on the color key and falls back to the x key', () => {
    const colored = explore.exploreSpec(node({ data: rows, colorKey: 'model', select: 'point' }))!
    const plain = explore.exploreSpec(node({ data: rows, select: 'point' }))!
    expect((colored.params as { select: { fields: string[] } }[])[0].select.fields).toEqual(['model'])
    expect((plain.params as { select: { fields: string[] } }[])[0].select.fields).toEqual(['watts'])
  })
  it('compiles under vega-lite 6.5 without warnings on the structure', () => {
    const spec = explore.exploreSpec(node({ data: rows, colorKey: 'model', select: 'point' }))!
    const out = compile(spec).spec
    const signals = (out.signals ?? []).map(item => item.name)
    expect(signals).toContain(explore.PICK_SIGNAL)
    const store = (out.data ?? []).find(item => item.name === `${explore.PICK_SIGNAL}_store`)
    expect(store).toBeDefined()
  })
  it('returns null when data is empty or keys are missing', () => {
    expect(explore.exploreSpec(node({ data: [] }))).toBeNull()
    expect(explore.exploreSpec(node({ data: rows }))).not.toBeNull()
    expect(explore.exploreSpec({ ...node({ data: rows }), xKey: undefined })).toBeNull()
    expect(explore.exploreSpec(node())).toBeNull()
  })
  it('drops non-scalar cells from rows', () => {
    const clean = explore.exploreRows(node({ data: [{ a: 1, b: { x: 2 }, c: [3], d: 'ok' }] as unknown as ExploreDatum[] }))
    expect(clean).toEqual([{ a: 1, d: 'ok' }])
  })
})

describe('selection normalization', () => {
  it('maps a resolved point signal to deduplicated category values', () => {
    const raw = { model: ['A', 'B'], vlPoint: { or: [{ model: 'A' }, { model: 'B' }, { model: 'A' }] } }
    expect(explore.pointSelection(raw, 'model')).toEqual(['A', 'B'])
    expect(explore.pointSelection({}, 'model')).toEqual([])
    expect(explore.pointSelection(null, 'model')).toEqual([])
  })
  it('maps a resolved interval signal to numeric field ranges', () => {
    expect(explore.intervalSelection({ watts: [40, 95], hours: [2, 11] }, 'watts', 'hours'))
      .toEqual({ watts: [40, 95], hours: [2, 11] })
    expect(explore.intervalSelection({ watts: ['x'] }, 'watts', 'hours')).toEqual({})
    expect(explore.intervalSelection({}, 'watts', 'hours')).toEqual({})
  })
})

describe('ExploreView', () => {
  it('embeds with bounded options, forwards selections to setInput and finalizes', async () => {
    const { state, fire } = fakeEmbed()
    const setInput = vi.fn()
    const rootEl = document.getElementById('root')!
    const root = createRoot(rootEl)
    const current = node({ data: rows, colorKey: 'model', select: 'point' })
    await act(async () => { root.render(<explore.ExploreView node={current} lookup={() => undefined} setInput={setInput} t={t} />) })
    expect(embedMock).toHaveBeenCalledTimes(1)
    const [, spec, options] = embedMock.mock.calls[0] as [unknown, Record<string, unknown>, Record<string, unknown>]
    expect(options).toMatchObject({ actions: false, ast: true, renderer: 'svg' })
    expect((spec.params as { name: string }[])[0].name).toBe(explore.PICK_SIGNAL)
    expect(state.listeners[explore.PICK_SIGNAL]).toBeDefined()
    fire(explore.PICK_SIGNAL, { model: ['B'], vlPoint: { or: [{ model: 'B' }] } })
    expect(setInput).toHaveBeenCalledWith('pick_one', ['B'])
    expect(rootEl.textContent).toContain('1 selected: B')
    fire(explore.PICK_SIGNAL, {})
    expect(setInput).toHaveBeenCalledWith('pick_one', [])
    expect(state.finalized).toBe(false)
    await act(async () => { root.unmount() })
    expect(state.finalized).toBe(true)
  })
  it('writes an interval brush as a bounded object', async () => {
    const { fire } = fakeEmbed()
    const setInput = vi.fn()
    const rootEl = document.getElementById('root')!
    const root = createRoot(rootEl)
    await act(async () => {
      root.render(<explore.ExploreView node={node({ data: rows, select: 'interval' })} lookup={() => undefined} setInput={setInput} t={t} />)
    })
    fire(explore.BRUSH_SIGNAL, { watts: [40, 95], hours: [2, 11], junk: 'x' })
    expect(setInput).toHaveBeenCalledWith('pick_one', { watts: [40, 95], hours: [2, 11] })
    fire(explore.BRUSH_SIGNAL, null)
    expect(setInput).toHaveBeenCalledWith('pick_one', {})
    await act(async () => { root.unmount() })
  })
  it('stops writing back after unmount even if the signal still fires', async () => {
    const { state, fire } = fakeEmbed()
    const setInput = vi.fn()
    const root = createRoot(document.getElementById('root')!)
    await act(async () => {
      root.render(<explore.ExploreView node={node({ data: rows, select: 'point' })} lookup={() => undefined} setInput={setInput} t={t} />)
    })
    await act(async () => { root.unmount() })
    expect(state.finalized).toBe(true)
    fire(explore.PICK_SIGNAL, { watts: [1], vlPoint: { or: [{ watts: 1 }] } })
    expect(setInput).not.toHaveBeenCalled()
  })
  it('rebuilds from an external selection and ignores the value it just published', async () => {
    const { fire } = fakeEmbed()
    let value: unknown = []
    const setInput = vi.fn((_id: string, next: unknown) => { value = next })
    const root = createRoot(document.getElementById('root')!)
    const current = node({ data: rows, colorKey: 'model', select: 'point' })
    const draw = () => root.render(<explore.ExploreView node={current} lookup={() => value} setInput={setInput} t={t} />)
    await act(async () => { draw() })
    expect(embedMock).toHaveBeenCalledTimes(1)
    fire(explore.PICK_SIGNAL, { model: ['B'], vlPoint: { or: [{ model: 'B' }] } })
    await act(async () => { draw() })
    expect(embedMock).toHaveBeenCalledTimes(1)
    expect(setInput).toHaveBeenCalledWith('pick_one', ['B'])
    embedMock.mockClear()
    value = ['A']
    await act(async () => { draw() })
    expect(embedMock).toHaveBeenCalledTimes(1)
    const spec = embedMock.mock.calls[0][1] as { params: { value?: unknown; select: { on?: string } }[] }
    expect(spec.params[0].value).toEqual([{ model: 'A' }])
    // Returning to an earlier user choice is still a new external restore.
    value = ['B']
    await act(async () => { draw() })
    expect((embedMock.mock.calls.at(-1)![1] as { params: { value: unknown }[] }).params[0].value).toEqual([{ model: 'B' }])
    value = ['A']
    await act(async () => { draw() })
    await act(async () => { root.render(<explore.ExploreView node={current} lookup={() => value} setInput={setInput} t={t} editable={false} />) })
    const locked = embedMock.mock.calls.at(-1)![1] as { params: { value?: unknown; select: { on?: string } }[] }
    expect(locked.params[0].value).toEqual([{ model: 'A' }])
    expect(locked.params[0].select.on).toBe('view:click[false]')
    const calls = setInput.mock.calls.length
    fire(explore.PICK_SIGNAL, { model: ['B'], vlPoint: { or: [{ model: 'B' }] } })
    expect(setInput).toHaveBeenCalledTimes(calls)
    await act(async () => { root.unmount() })
  })
})

describe('vega selection runtime', () => {
  it('compiles a saved point and interval into the store, with no input events when locked', () => {
    const point = explore.exploreSpec(node({ data: rows, colorKey: 'model', select: 'point' }), false, ['B'])!
    const pointVg = compile(point).spec
    const pointStore = (pointVg.data ?? []).find(item => item.name === `${explore.PICK_SIGNAL}_store`)
    expect(pointStore?.values).toEqual([{ unit: '', fields: [{ type: 'E', field: 'model' }], values: ['B'] }])
    const pointEvents = JSON.stringify((pointVg.signals ?? []).find(item => item.name === `${explore.PICK_SIGNAL}_tuple`)?.on)
    expect(pointEvents).toContain('"false"')
    const interval = explore.exploreSpec(node({ data: rows, select: 'interval' }), false, { watts: [40, 95], hours: [2, 11] })!
    const intervalVg = compile(interval).spec
    const intervalStore = (intervalVg.data ?? []).find(item => item.name === `${explore.BRUSH_SIGNAL}_store`)
    expect(intervalStore?.values).toEqual([{
      unit: '',
      fields: [{ field: 'watts', channel: 'x', type: 'R' }, { field: 'hours', channel: 'y', type: 'R' }],
      values: [[40, 95], [2, 11]],
    }])
    expect((intervalVg.signals ?? []).some(item => item.name === `${explore.BRUSH_SIGNAL}_x` && item.init)).toBe(true)
    expect(JSON.stringify((intervalVg.signals ?? []).find(item => item.name === `${explore.BRUSH_SIGNAL}_x`)?.on)).toContain('"false"')
  })
})
