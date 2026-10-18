import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  status: vi.fn(), dispose: vi.fn(async () => {}),
  call: undefined as undefined | ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<any>),
}))
vi.mock('./runtime.ts', () => ({ CodexRuntime: class { status = mocks.status; dispose = mocks.dispose } }))
vi.mock('@klarkxy/dsh-plugin-kit/host-rpc', () => ({ registerHostRpc: (_ctx: unknown, _channel: string, call: typeof mocks.call) => { mocks.call = call; return () => {} } }))
import { apply } from './index.ts'

it('removes the model catalog while reading legacy settings without a runtime call or startup write', async () => {
  mocks.status.mockClear()
  const legacy = { revision: 6, settings: { executable: 'custom-codex', model: 'saved', effort: 'low', timeoutMs: 100_000 } }
  let row: unknown = legacy
  const put = vi.fn(async (_key: string, value: unknown) => { row = value })
  const on = vi.fn(() => () => {})
  const ctx = new Context()
  Object.assign(ctx, {
    storageDomain: { open: async () => ({ table: () => ({ get: () => row, put }), close: async () => {} }) },
    tools: { register() {} },
    parallel: vi.fn(async () => {}),
  })
  const nativeOn = ctx.on.bind(ctx)
  ctx.on = ((...args: Parameters<Context['on']>) => { on(...args); return nativeOn(...args) }) as Context['on']
  apply(ctx as any)
  const call = (endpoint: string, payload: unknown = {}) => mocks.call!(endpoint, payload, new AbortController().signal)
  try {
    const settings = { executable: 'custom-codex', timeoutMs: 100_000 }
    expect(await call('settings')).toEqual({ ok: true, value: { settings, revision: 6 } })
    expect(on.mock.calls.some(args => (args as unknown[])[0] === 'model-settings/collect')).toBe(false)
    expect(mocks.status).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(row).toBe(legacy)
    expect(await call('settings.update', { settings: legacy.settings, expectedRevision: 6 })).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await call('settings.update', { settings, expectedRevision: 6 })).toMatchObject({ ok: true })
    expect(row).toEqual({ settings, revision: 7 })
  } finally {
    await ctx.fiber.dispose()
  }
})
