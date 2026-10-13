import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './contracts.ts'
const captured = vi.hoisted(() => ({ runtimes: [] as any[], operations: [] as any[], tools: [] as any[], rpc: [] as any[] }))
vi.mock('./runtime.ts', () => ({ GrokRuntime: class {
  run = vi.fn(async () => ({ state: 'completed', files: [] }))
  status = vi.fn(async () => ({ available: true }))
  dispose = vi.fn(async () => {})
  constructor(public settings: () => unknown) { captured.runtimes.push(this) }
} }))
vi.mock('./tools.ts', async importOriginal => {
  const actual = await importOriginal<any>()
  return { ...actual, GrokOperations: class {
    execute = vi.fn(async () => ({ state: 'completed', files: [] }))
    constructor(public host: unknown, public runtime: () => unknown, public jobs: any, public settings: () => unknown) { captured.operations.push(this) }
  }, registerTools: (host: unknown, operations: unknown, ready: Promise<unknown>, lifetime: AbortSignal) => captured.tools.push({ host, operations, ready, lifetime }) }
})
vi.mock('@klarkxy/dsh-plugin-kit/host-rpc', () => ({ registerHostRpc: (_host: unknown, channel: string, call: unknown) => { captured.rpc.push({ channel, call }); return () => {} } }))
import { apply } from './index.ts'
beforeEach(() => { for (const entries of Object.values(captured)) entries.length = 0 })
function domain() {
  const settings = new Map<string, unknown>(), jobs = new Map<string, unknown>(), close = vi.fn(async () => {})
  const put = vi.fn(async (map: Map<string, unknown>, key: string, value: unknown) => { map.set(key, structuredClone(value)) })
  const storage = { table(name: string) { const rows = name === 'jobs' ? jobs : settings; return { get: (key: string) => rows.get(key), put: (key: string, value: unknown) => put(rows, key, value), entries: () => rows.entries() } }, close }
  return { settings, jobs, close, put, storage }
}
function mount(data = domain()) {
  const cleanup: (() => void | Promise<void>)[] = [], open = vi.fn(async () => data.storage)
  const host = { storageDomain: { open }, effect(factory: () => () => void | Promise<void>) { cleanup.push(factory()) } }
  apply(host as any)
  return { ...data, host, open, tools: captured.tools.at(-1), operations: captured.operations.at(-1), runtime: captured.runtimes.at(-1), rpc: captured.rpc.at(-1).call, dispose: async () => { for (const fn of cleanup.reverse()) await fn() } }
}
function job() { return { id: randomUUID(), workspace: 'workspace', directory: 'workspace/job', capability: 'generate_image', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), state: 'uncertain', files: [] } }
const signal = () => new AbortController().signal
describe('Grok protected persistence and settings CAS', () => {
  it('opens its protected domain and keeps jobs through recreation and idle settings changes', async () => {
    const data = domain(), first = mount(data); await first.tools.ready
    const saved = job(); await first.operations.jobs.put(saved)
    expect(first.open.mock.calls[0][0]).toMatchObject({ name: 'dsh_grok_build', version: 1 })
    expect(await first.rpc('settings.update', { settings: { ...DEFAULT_SETTINGS, allowNativeMediaFiles: true }, expectedRevision: 0 }, signal())).toMatchObject({ ok: true, value: { revision: 1, settings: { allowNativeMediaFiles: true } } })
    expect(first.runtime.dispose).toHaveBeenCalledOnce(); expect(captured.runtimes.at(-1).settings().allowNativeMediaFiles).toBe(true)
    await first.dispose(); const second = mount(data); await second.tools.ready
    expect(await second.operations.jobs.get(saved.id)).toEqual(saved)
    expect(await second.operations.jobs.list('foreign')).toEqual([])
    expect(await second.rpc('settings', null, signal())).toMatchObject({ ok: true, value: { revision: 1, settings: { allowNativeMediaFiles: true } } })
    await second.dispose()
  })
  it('refuses unexpected protected record fields and stale revisions', async () => {
    const f = mount(); await f.tools.ready
    await expect(f.operations.jobs.put({ ...job(), secret: 'invalid' })).rejects.toThrow()
    expect(f.put).not.toHaveBeenCalled()
    expect(await f.rpc('settings.update', { settings: DEFAULT_SETTINGS, expectedRevision: 1 }, signal())).toMatchObject({ ok: false, error: { code: 'conflict' } })
    expect(f.put).not.toHaveBeenCalled(); await f.dispose()
  })
  it('defaults the new consent switch to false for previously saved settings', async () => {
    const data = domain(); data.settings.set('config', { settings: { executable: '', timeoutMs: 10000 }, revision: 2 })
    const f = mount(data); await f.tools.ready
    expect(await f.rpc('settings', null, signal())).toMatchObject({ ok: true, value: { settings: { allowNativeMediaFiles: false }, revision: 2 } })
    await f.dispose()
  })
  it('blocks settings while recovery runs and waits for its cancellation writes before closing storage', async () => {
    const f = mount(); await f.tools.ready
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve })
    let combined!: AbortSignal, wroteAfterAbort = false
    f.operations.execute.mockImplementation(async (_operation: string, _args: unknown, exec: any) => {
      combined = exec.signal; entered(); await new Promise(resolve => combined.addEventListener('abort', resolve, { once: true }))
      await f.operations.jobs.put(job()); wroteAfterAbort = true; expect(f.close).not.toHaveBeenCalled(); return { state: 'uncertain', files: [] }
    })
    const pending = f.tools.operations.execute('recover_media', {}, { signal: signal() }); await ready
    expect(await f.rpc('settings.update', { settings: DEFAULT_SETTINGS, expectedRevision: 0 }, signal())).toMatchObject({ ok: false, error: { code: 'busy' } })
    await f.dispose(); await pending
    expect(combined.aborted).toBe(true); expect(wroteAfterAbort).toBe(true); expect(f.close).toHaveBeenCalledOnce()
    await expect(f.tools.operations.execute('media_jobs', {}, { signal: signal() })).rejects.toThrow()
    expect(await f.rpc('status', null, signal())).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})
