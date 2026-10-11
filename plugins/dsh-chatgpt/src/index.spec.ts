import { describe, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  call: undefined as undefined | ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<any>),
  run: vi.fn(), status: vi.fn(async () => ({ signedIn: true, models: [] })),
  login: vi.fn(async () => ({ id: 'owned', kind: 'browser', url: 'https://auth.openai.com/authorize' })),
  cancel: vi.fn(async () => {}), dispose: vi.fn(async () => {}),
}))
vi.mock('./runtime.ts', () => ({ CodexRuntime: class {
  run = mocks.run; status = mocks.status; login = mocks.login; cancelLogin = mocks.cancel; dispose = mocks.dispose
} }))
vi.mock('@klarkxy/dsh-plugin-kit/host-rpc', () => ({ registerHostRpc: (_ctx: unknown, _channel: string, call: typeof mocks.call) => { mocks.call = call; return () => {} } }))
import { apply } from './index.ts'
import { DEFAULT_SETTINGS } from './contracts.ts'

function mount(write?: (value: unknown) => Promise<void>) {
  let row: unknown
  const tools: any[] = [], off: (() => unknown)[] = []
  const put = vi.fn(async (_key, value) => { await write?.(value); row = value })
  const close = vi.fn(async () => {})
  const ctx = {
    storageDomain: { open: async () => ({ table: () => ({ get: () => row, put }), close }) },
    tools: { register: (tool: unknown) => { tools.push(tool) } },
    sandboxPolicy: { resolve: () => ({ workspaceRoot: process.cwd(), mode: 'workspace-write' }) },
    attachments: {},
    effect: (run: () => () => unknown) => { off.push(run()) },
  }
  apply(ctx as any)
  const call = (endpoint: string, payload: unknown = {}) => mocks.call!(endpoint, payload, new AbortController().signal)
  return { tools, put, call, close, off }
}

describe('ChatGPT host integration', () => {
  it('registers all model tools and does not infer merely from opening settings', async () => {
    mocks.run.mockClear(); mocks.login.mockClear()
    const app = mount()
    expect(app.tools).toHaveLength(5)
    expect((await app.call('settings')).value).toEqual({ settings: DEFAULT_SETTINGS, revision: 0 })
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.login).not.toHaveBeenCalled()
    await app.off.at(-1)!()
  })
  it('rejects raw API/token login variants before they reach Codex', async () => {
    mocks.login.mockClear()
    const app = mount()
    expect(await app.call('login.start', { kind: 'apiKey', token: 'do-not-forward' })).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(mocks.login).not.toHaveBeenCalled()
    expect(await app.call('login.start', { kind: 'device' })).toMatchObject({ ok: true })
    expect(mocks.login.mock.calls[0][0]).toBe('device')
    await app.off.at(-1)!()
  })
  it('persists settings once and refuses stale revisions and malformed updates', async () => {
    const app = mount()
    const settings = { ...DEFAULT_SETTINGS, model: 'chosen-model' }
    expect(await app.call('settings.update', { settings, expectedRevision: 0 })).toMatchObject({ ok: true, value: { settings, revision: 1 } })
    expect(await app.call('settings.update', { settings, expectedRevision: 0 })).toMatchObject({ ok: false, error: { code: 'conflict' } })
    expect(await app.call('settings.update', { settings: { ...settings, timeoutMs: 1 }, expectedRevision: 1 })).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(app.put).toHaveBeenCalledTimes(1)
    await app.off.at(-1)!()
    expect(app.close).toHaveBeenCalled()
    expect(await app.call('status')).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
  it('refuses new runtime work while a settings write is pending', async () => {
    let finish!: () => void, entered!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const writing = new Promise<void>(resolve => { entered = resolve })
    const app = mount(async () => { entered(); await pending })
    mocks.status.mockClear()
    const save = app.call('settings.update', { settings: DEFAULT_SETTINGS, expectedRevision: 0 })
    await writing
    expect(await app.call('status')).toMatchObject({ ok: false, error: { code: 'busy' } })
    expect(mocks.status).not.toHaveBeenCalled()
    finish(); expect(await save).toMatchObject({ ok: true })
    await app.off.at(-1)!()
  })
})
