import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobStore, MediaJob } from './jobs.ts'
import { DEFAULT_SETTINGS } from './contracts.ts'

const captured = vi.hoisted(() => ({ instances: [] as any[], rpc: [] as any[], tools: [] as any[] }))
vi.mock('./runtime.ts', () => ({ MiniMaxRuntime: class {
  execute = vi.fn(async () => ({ status: 'complete', answer: 'ok', files: [] }))
  status = vi.fn(async () => ({ available: true }))
  dispose = vi.fn(async () => {})
  constructor(public host: unknown, public settings: () => unknown, public jobs: JobStore) { captured.instances.push(this) }
} }))
vi.mock('./tools.ts', () => ({ registerTools: (host: any, runtime: any, ready: Promise<unknown>, lifetime: AbortSignal) => captured.tools.push({ host, runtime, ready, lifetime }) }))
vi.mock('@klarkxy/dsh-plugin-kit/host-rpc', () => ({ registerHostRpc: (_host: any, channel: string, call: any) => { captured.rpc.push({ channel, call }); return () => {} } }))
import { apply } from './index.ts'

beforeEach(() => { captured.instances.length = 0; captured.rpc.length = 0; captured.tools.length = 0 })
function domain() {
  const settings = new Map<string, unknown>(), jobs = new Map<string, unknown>()
  const put = vi.fn(async (table: Map<string, unknown>, key: string, value: unknown) => { table.set(key, structuredClone(value)) })
  const close = vi.fn(async () => {})
  const storage = {
    table(name: string) {
      const rows = name === 'jobs' ? jobs : settings
      return { get: (key: string) => rows.get(key), put: (key: string, value: unknown) => put(rows, key, value), entries: () => rows.entries() }
    }, close,
  }
  return { settings, jobs, put, close, storage }
}
function mount(data = domain()) {
  const cleanup: (() => Promise<void> | void)[] = []
  const open = vi.fn(async () => data.storage)
  const host = { storageDomain: { open }, effect(factory: () => () => Promise<void> | void) { cleanup.push(factory()) } }
  apply(host as any)
  return { ...data, host, open, dispose: async () => { for (const fn of cleanup.reverse()) await fn() }, runtime: captured.instances.at(-1), tools: captured.tools.at(-1), rpc: captured.rpc.at(-1).call }
}
function job(workspace = 'workspace'): MediaJob {
  return { version: 1, id: randomUUID(), workspace, operation: 'generate_video', createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', status: 'pending', model: 'MiniMax-H3', taskId: 'paid-task', assets: [], failures: [] }
}
const signal = () => new AbortController().signal

describe('protected host-domain job persistence', () => {
  it('opens the plugin domain and recovers a saved task from it after plugin recreation', async () => {
    const data = domain(), first = mount(data); await first.tools.ready
    const receipt = job()
    await first.runtime.jobs.put(receipt)
    expect(first.open.mock.calls[0][0]).toMatchObject({ name: 'dsh_minimax_code', version: 1 })
    await first.dispose()
    const second = mount(data); await second.tools.ready
    await expect(second.runtime.jobs.get(receipt.id)).resolves.toEqual(receipt)
    await expect(second.runtime.jobs.list('workspace')).resolves.toEqual([receipt])
    await expect(second.runtime.jobs.list('foreign-workspace')).resolves.toEqual([])
    await second.dispose()
  })
  it('refuses schema-invalid records on both save and read without accepting untrusted extra fields', async () => {
    const f = mount(); await f.tools.ready
    const receipt = job()
    await expect(f.runtime.jobs.put({ ...receipt, accessToken: 'untrusted' })).rejects.toThrow()
    expect(f.put).not.toHaveBeenCalled()
    f.jobs.set(receipt.id, { ...receipt, taskId: 'x'.repeat(201) })
    await expect(f.runtime.jobs.get(receipt.id)).rejects.toThrow()
    await f.dispose()
  })
  it('keeps generated jobs through settings updates while replacing only the idle runtime', async () => {
    const f = mount(); await f.tools.ready
    const receipt = job(); await f.runtime.jobs.put(receipt)
    const next = { ...DEFAULT_SETTINGS, region: 'cn' }
    expect(await f.rpc('settings.update', { settings: next, expectedRevision: 0 }, signal())).toEqual({ ok: true, value: { settings: next, revision: 1 } })
    expect(f.runtime.dispose).toHaveBeenCalledOnce()
    const replacement = captured.instances.at(-1)
    expect(replacement).not.toBe(f.runtime)
    await expect(replacement.jobs.get(receipt.id)).resolves.toEqual(receipt)
    expect(replacement.settings()).toEqual(next)
    await f.dispose()
  })
})

describe('settings concurrency and unload', () => {
  it('rejects stale settings revisions without overwriting the saved configuration', async () => {
    const data = domain(); data.settings.set('config', { settings: { ...DEFAULT_SETTINGS, region: 'cn' }, revision: 3 })
    const f = mount(data); await f.tools.ready
    expect(await f.rpc('settings.update', { settings: DEFAULT_SETTINGS, expectedRevision: 2 }, signal())).toMatchObject({ ok: false, error: { code: 'conflict' } })
    expect(f.put).not.toHaveBeenCalled()
    expect(await f.rpc('settings', null, signal())).toEqual({ ok: true, value: { settings: { ...DEFAULT_SETTINGS, region: 'cn' }, revision: 3 } })
    await f.dispose()
  })
  it('blocks settings changes during an active tool call and lets unload abort that call before closing storage', async () => {
    const f = mount(); await f.tools.ready
    let entered!: () => void; const active = new Promise<void>(resolve => { entered = resolve })
    let combined!: AbortSignal
    f.runtime.execute.mockImplementation(async (_operation: string, _args: unknown, exec: any) => {
      combined = exec.signal; entered()
      await new Promise<void>(resolve => exec.signal.addEventListener('abort', resolve, { once: true }))
      return { status: 'complete', answer: 'cancelled', files: [] }
    })
    const pending = f.tools.runtime.execute('generate_video', {}, { signal: signal() }); await active
    expect(await f.rpc('settings.update', { settings: DEFAULT_SETTINGS, expectedRevision: 0 }, signal())).toMatchObject({ ok: false, error: { code: 'busy' } })
    expect(f.put).not.toHaveBeenCalled()
    await f.dispose(); await pending
    expect(combined.aborted).toBe(true); expect(f.close).toHaveBeenCalledOnce()
    expect(await f.rpc('status', null, signal())).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    await expect(f.tools.runtime.execute('list_voices', {}, { signal: signal() })).rejects.toThrow()
  })
})
