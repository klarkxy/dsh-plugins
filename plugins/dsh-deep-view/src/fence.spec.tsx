import { act } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ComposerActions, InputSnapshot } from './draft.ts'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' })
vi.stubGlobal('window', dom.window)
vi.stubGlobal('document', dom.window.document)
vi.stubGlobal('navigator', dom.window.navigator)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let createRoot: typeof import('react-dom/client').createRoot
let DeepViewFence: typeof import('./fence.tsx').DeepViewFence
let streamTitle: typeof import('./fence.tsx').streamTitle
let fenceViewT: typeof import('./fence.tsx').fenceViewT
beforeAll(async () => {
  createRoot = (await import('react-dom/client')).createRoot
  // The official-ui test double imports react-dom. Load it after installing
  // the DOM so React does not latch canUseDOM=false and drop range events.
  ;({ DeepViewFence, streamTitle, fenceViewT } = await import('./fence.tsx'))
})
// The registration layer passes the locale t; specs use the identity function
// for keys they assert, and keep the plugin's real copy for a few.
const t = (key: string) => key
const useInput = (snapshot: InputSnapshot) => <T,>(selector: (value: InputSnapshot) => T): T => selector(snapshot)
const actions = (overrides: Partial<ComposerActions> = {}): ComposerActions => ({
  captureInsertion: () => ({ start: 0, end: 0 }),
  insertText: vi.fn(() => true),
  setDraft: vi.fn(),
  persistDraft: vi.fn(),
  ...overrides,
})
const card = JSON.stringify({ title: 'Report', view: { type: 'metric', label: 'Revenue', value: 42 } })
const ask = JSON.stringify({ title: 'Pick', view: { type: 'options' as const, id: 'pick', options: [{ label: 'One' }] } })
afterEach(() => { document.body.innerHTML = '<div id="root"></div>' })

describe('deepui fence layer', () => {
  it('keeps a quiet placeholder while partial JSON streams', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<DeepViewFence code='{"title":"Rep' streaming t={t} children={<pre data-raw />}/>))
    expect(document.querySelector('.dvui-fence-pending')).toBeTruthy()
    expect(document.querySelector('[data-raw]')).toBeNull()
    expect(document.body.textContent).not.toContain('Rep')
    await act(async () => root.render(<DeepViewFence code='{"title":"Report","view":{"type":"metric","label":"R","value":42}' streaming t={t} children={<pre data-raw />}/>))
    expect(document.querySelector('.dvui-fence-pending')).toBeTruthy()
    expect(document.body.textContent).toContain('Report')
    await act(async () => root.unmount())
  })
  it('mounts the live card as soon as the JSON is complete, even while streaming', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<DeepViewFence code='{"title":"Rep' streaming t={t} />))
    expect(document.querySelector('.dvui-view')).toBeNull()
    await act(async () => root.render(<DeepViewFence code={card} streaming t={t} />))
    expect(document.querySelector('.dvui-view')).toBeTruthy()
    expect(document.querySelector('.dvui-metric-value')!.textContent).toBe('42')
    await act(async () => root.unmount())
  })
  it('falls back to the raw code block on final invalid input', async () => {
    const root = createRoot(document.getElementById('root')!)
    const raw = <pre data-raw>broken</pre>
    await act(async () => root.render(<DeepViewFence code='{broken' streaming={false} t={t} children={raw}/>))
    expect(document.querySelector('.dvui-view')).toBeNull()
    expect(document.body.textContent).toContain('invalid')
    const details = document.querySelector('details')!
    expect(details.open).toBe(false)
    expect(document.querySelector('[data-raw]')).toBeTruthy()
    // A parsed-but-rejected view also falls back rather than white-screening.
    await act(async () => root.render(<DeepViewFence code='{"view":{"type":"unknown"}}' streaming={false} t={t} children={raw}/>))
    expect(document.querySelector('[data-raw]')).toBeTruthy()
    await act(async () => root.unmount())
  })
  it('fills the composer instead of submitting', async () => {
    const root = createRoot(document.getElementById('root')!)
    const composer = actions()
    await act(async () => root.render(<DeepViewFence code={ask} streaming={false} t={t} inputActions={composer} useInput={useInput({ draft: '', phase: 'plain' })}/>))
    expect(document.body.textContent).not.toContain('Submit')
    await act(async () => (document.querySelector('.dvui-option') as HTMLButtonElement).click())
    await act(async () => ([...document.querySelectorAll('button')].find(button => button.textContent === 'Fill composer') as HTMLButtonElement).click())
    expect(composer.setDraft).toHaveBeenCalledOnce()
    expect(composer.persistDraft).toHaveBeenCalledOnce()
    expect(String(vi.mocked(composer.setDraft).mock.calls[0][0])).toContain('One')
    expect(document.body.textContent).toContain('filled')
    await act(async () => root.unmount())
  })
  it('asks before overwriting a non-empty draft, and can append', async () => {
    const root = createRoot(document.getElementById('root')!)
    const composer = actions()
    await act(async () => root.render(<DeepViewFence code={ask} streaming={false} t={t} inputActions={composer} useInput={useInput({ draft: 'keep me', phase: 'plain' })}/>))
    await act(async () => (document.querySelector('.dvui-option') as HTMLButtonElement).click())
    await act(async () => ([...document.querySelectorAll('button')].find(button => button.textContent === 'Fill composer') as HTMLButtonElement).click())
    expect(composer.setDraft).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('draftConflict')
    await act(async () => ([...document.querySelectorAll('button')].find(button => button.textContent === 'appendDraft') as HTMLButtonElement).click())
    expect(composer.setDraft).not.toHaveBeenCalled()
    expect(composer.insertText).toHaveBeenCalledWith(expect.stringContaining('\n\n'), expect.anything())
    expect(document.body.textContent).toContain('filled')
    await act(async () => root.unmount())
  })
  it('replaces the draft only when the user chooses replace', async () => {
    const root = createRoot(document.getElementById('root')!)
    const composer = actions()
    await act(async () => root.render(<DeepViewFence code={ask} streaming={false} t={t} inputActions={composer} useInput={useInput({ draft: 'old', phase: 'plain' })}/>))
    await act(async () => (document.querySelector('.dvui-option') as HTMLButtonElement).click())
    await act(async () => ([...document.querySelectorAll('button')].find(button => button.textContent === 'Fill composer') as HTMLButtonElement).click())
    await act(async () => ([...document.querySelectorAll('button')].find(button => button.textContent === 'replaceDraft') as HTMLButtonElement).click())
    expect(composer.setDraft).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })
  it('reports fillFailed when the composer refuses the write', async () => {
    const root = createRoot(document.getElementById('root')!)
    const composer = actions({ setDraft: vi.fn() })
    await act(async () => root.render(<DeepViewFence code={ask} streaming={false} t={t} inputActions={composer} useInput={useInput({ draft: '', phase: 'sending' })}/>))
    await act(async () => (document.querySelector('.dvui-option') as HTMLButtonElement).click())
    await act(async () => ([...document.querySelectorAll('button')].find(button => button.textContent === 'Fill composer') as HTMLButtonElement).click())
    expect(composer.setDraft).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('fillFailed')
    await act(async () => root.unmount())
  })
  it('keeps local inputs live inside an inline card', async () => {
    const root = createRoot(document.getElementById('root')!)
    const code = JSON.stringify({ title: 'T', view: { type: 'stack' as const, children: [
      { type: 'slider' as const, id: 'count', label: 'Count', min: 0, max: 10, value: 2 },
      { type: 'metric' as const, label: 'Total', value: { '=': 'count * 3' } },
    ] } })
    await act(async () => root.render(<DeepViewFence code={code} streaming={false} t={t} inputActions={actions()} useInput={useInput({ draft: '', phase: 'plain' })}/>))
    expect(document.querySelector('.dvui-metric-value')!.textContent).toBe('6')
    const range = document.querySelector('input[type=range]')!
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(range, '5'); range.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    expect(document.querySelector('.dvui-metric-value')!.textContent).toBe('15')
    await act(async () => root.unmount())
  })
  it('shows a local-only note when no composer actions are wired', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<DeepViewFence code={ask} streaming={false} t={t} />))
    expect(document.body.textContent).toContain('Local preview only; this card does not send an answer.')
    expect(document.querySelector('button.dvui-option')).toBeNull()
    await act(async () => root.unmount())
  })
})
describe('streamTitle', () => {
  it('reads a complete title and stays silent otherwise', () => {
    expect(streamTitle('{"title":"Rep')).toBeUndefined()
    expect(streamTitle('{"title":"Report","view":{}')).toBe('Report')
    expect(streamTitle('{"view":{}')).toBeUndefined()
    expect(streamTitle('{"title":"A \\"quote\\"","view":{}')).toBe('A "quote"')
  })
  it('maps rich view copy onto the fence locale', () => {
    const zh: Record<string, string> = {
      nothingToExplore: '没有可探索的数据', nodeGraph: '节点关系图', selectNode: '请选择一个节点',
      map: '地图', zoomIn: '放大', selectedValues: '已选择 {n} 项：{values}',
      mapFailed: '地图加载失败。', explorePointHint: '点击数据点进行选择；双击清除',
    }
    const viewT = fenceViewT((key, params) => (zh[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`)))
    expect(viewT('Nothing to explore')).toBe('没有可探索的数据')
    expect(viewT('Node graph')).toBe('节点关系图')
    expect(viewT('Select a node')).toBe('请选择一个节点')
    expect(viewT('Map')).toBe('地图')
    expect(viewT('Zoom in')).toBe('放大')
    expect(viewT('Map failed to load.')).toBe('地图加载失败。')
    expect(viewT('Click points to select; double-click to clear')).toBe('点击数据点进行选择；双击清除')
    expect(viewT('{n} selected: {values}', { n: 2, values: 'A, B' })).toBe('已选择 2 项：A, B')
  })
})
