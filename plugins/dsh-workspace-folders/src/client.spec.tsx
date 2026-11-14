import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apply, FolderDialog, styles } from './client.tsx'
import { OFFICIAL_THEME_TOKEN_NAMES } from '@klarkxy/dsh-plugin-kit/official-ui'
let dom: JSDOM, root: Root, previous: Map<string, unknown>
const initial = { workspaceId: 'one', title: 'Project', primaryPath: '/primary', folders: ['/extra'], revision: 2, pickerKind: 'browse' }
let call: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>'); previous = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, (globalThis as any)[key]); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  root = createRoot(document.getElementById('root')!)
  close = vi.fn()
  call = vi.fn(async (endpoint, payload) => ({ ok: true, value: endpoint === 'get' ? initial : endpoint === 'validate' ? { path: payload.path } : { ...initial, folders: payload.folders } }))
})
afterEach(async () => {
  await act(async () => root.unmount()); dom.window.close()
  for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
})
const listDirectory = vi.fn(async (path = '/primary') => ({ path, home: '/', crumbs: [{ name: '/', path: '/', hidden: false }], entries: [{ name: 'new', path: '/new', hidden: false }], truncated: false }))
async function mount(id = 'one') { await act(async () => root.render(<FolderDialog key={id} workspaceId={id} locale="zh" call={call} onClose={close} listDirectory={listDirectory} />)) }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label)!
async function click(label: string) { await act(async () => button(label).click()) }

it('keeps primary fixed and cancellation discards removal', async () => {
  await mount()
  expect(document.body.textContent).toContain('主要')
  expect(button('移除 /primary')).toBeUndefined()
  await click('移除 /extra'); await click('取消')
  expect(close).toHaveBeenCalledOnce()
  expect(call.mock.calls.some(([endpoint]) => endpoint === 'save')).toBe(false)
})
it('browses host folders, validates a selection, and saves the reviewed list', async () => {
  await mount(); await click('添加文件夹'); await click('new'); await click('添加此文件夹'); await click('保存')
  expect(call).toHaveBeenCalledWith('validate', { workspaceId: 'one', path: '/new' }, expect.any(AbortSignal))
  expect(call).toHaveBeenCalledWith('save', { workspaceId: 'one', folders: ['/extra', '/new'], expectedRevision: 2 }, expect.any(AbortSignal))
  expect(close).toHaveBeenCalledOnce()
})
it('keeps the draft when save fails and localizes a revision conflict', async () => {
  await mount(); await click('移除 /extra')
  call.mockImplementation(async () => ({ ok: false, error: { code: 'stale', message: 'conflict' } }))
  await click('保存')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('其他窗口')
  expect(document.body.textContent).not.toContain('/extra')
  expect(close).not.toHaveBeenCalled()
})
it('does not save while the initial folder read is pending or failed', async () => {
  call.mockImplementation(async () => ({ ok: false, error: { code: 'not-found', message: 'gone' } }))
  await mount()
  expect(button('保存').disabled).toBe(true)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('工作区已被移除')
})
it('drops a late read when the dialog switches workspaces', async () => {
  let finish!: (value: unknown) => void
  call.mockImplementation((endpoint, payload) => payload.workspaceId === 'one' ? new Promise(done => { finish = done }) : Promise.resolve({ ok: true, value: { ...initial, workspaceId: 'two', title: 'Second', folders: [] } }))
  await mount('one'); await mount('two')
  await act(async () => finish({ ok: true, value: initial }))
  expect(document.body.textContent).toContain('Second')
  expect(document.body.textContent).not.toContain('/extra')
})
it('registers a workspace action and cleans up menu/overlay registrations', async () => {
  let active = 'en', render: any, contribution: any
  const offMenu = vi.fn(), offOverlay = vi.fn(), listeners = new Set<() => void>(), disposers: Array<() => void> = []
  const ctx = {
    effect(fn: () => () => void) { disposers.push(fn()) },
    locale: { getSnapshot: () => ({ active }), subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } } },
    contextMenus: { register(value: any) { contribution = value; return offMenu } },
    connection: { rpc: { call: (_channel: string, endpoint: string, payload: unknown, signal: AbortSignal) => call(endpoint, payload, signal) } },
    uiWorkspace: { listDirectory },
    slots: { inject(_name: string, fn: () => () => void) { return fn() }, register(spec: any, component: any) { expect(spec.name).toBe('shell.overlay'); render = component; return offOverlay } },
  }
  apply(ctx as never)
  expect(contribution.target).toBe('workspace')
  expect(contribution.resolve({ workspaceId: 'one' })[0].label).toBe('Folders…')
  const Overlay = render
  await act(async () => { root.render(<Overlay />); contribution.resolve({ workspaceId: 'one' })[0].run() })
  expect(document.body.textContent).toContain('Workspace folders')
  await act(async () => { active = 'zh'; for (const listener of listeners) listener() })
  expect(document.body.textContent).toContain('工作区文件夹')
  await act(async () => { for (const dispose of disposers.reverse()) dispose() })
  expect(offMenu).toHaveBeenCalledOnce(); expect(offOverlay).toHaveBeenCalledOnce()
})
it('supports native hosts through manual paths without calling browse', async () => {
  const browse = vi.fn()
  call.mockImplementation(async (endpoint, payload) => ({ ok: true, value: endpoint === 'get' ? { ...initial, pickerKind: 'native' } : { path: payload.path } }))
  await act(async () => root.render(<FolderDialog workspaceId="one" locale="zh" call={call} onClose={close} listDirectory={browse} pickDirectory={async () => '/native'} />))
  await click('添加文件夹'); await click('浏览…'); await click('添加此文件夹')
  expect(browse).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('/native')
})
it('uses only official theme tokens', () => {
  for (const [, token] of styles.matchAll(/var\((--dsw-[a-z0-9-]+)/g)) expect(OFFICIAL_THEME_TOKEN_NAMES.includes(token), token).toBe(true)
})
