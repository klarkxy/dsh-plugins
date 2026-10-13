import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { registerModelSettings, type ModelSettingsEvents, type ModelSettingsDiscovery } from '@klarkxy/dsh-plugin-kit/model-settings'
import { createHubSettings } from './owners.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  const native = { describe: () => [{ ns: 'third-party', revision: 8, schema: { type: 'object', properties: {
    model: { type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' } } },
  } }, value: {} }], mutate: vi.fn(async () => {}) }
  return { ctx, native, hub: createHubSettings(ctx as unknown as ModelSettingsDiscovery, native), signal: new AbortController().signal }
}

describe('owner discovery with the real Cordis event bus', () => {
  it('acknowledges the commit without collecting or reading any owner afterwards', async () => {
    const { ctx, native, hub, signal } = harness()
    let committed = false, reads = 0
    registerModelSettings(ctx as unknown as ModelSettingsEvents, { ns: 'owner', title: 'Owner',
      read: () => { reads++; if (committed) throw new Error('post-save owner offline'); return { revision: 1, fields: [{ path: ['model'], label: 'Model' }] } },
      write: async () => { committed = true; signal.throwIfAborted() },
    })
    const entry = (await hub.list(signal)).find(entry => entry.ns === 'owner')!
    native.describe = () => { if (committed) throw new Error('aggregate refresh offline'); return [] }
    await expect(hub.set({ ns: 'owner', ownerId: entry.ownerId, path: ['model'], route: { provider: 'p', model: 'm' }, expectedRevision: 1 }, signal))
      .resolves.toEqual({ committed: true, ns: 'owner' })
    expect(reads).toBe(2)
    await expect(hub.list(signal)).rejects.toThrow('aggregate refresh offline')
  })

  it('does not convert post-commit cancellation into a rejected save acknowledgement', async () => {
    const { ctx, hub } = harness()
    const controller = new AbortController()
    registerModelSettings(ctx as unknown as ModelSettingsEvents, { ns: 'owner', title: 'Owner',
      read: () => ({ revision: 1, fields: [{ path: ['model'], label: 'Model' }] }),
      write: async () => { controller.abort() },
    })
    const entry = (await hub.list(controller.signal)).find(entry => entry.ns === 'owner')!
    await expect(hub.set({ ns: 'owner', ownerId: entry.ownerId, path: ['model'], route: {}, expectedRevision: 1 }, controller.signal))
      .resolves.toEqual({ committed: true, ns: 'owner' })
    await expect(hub.list(controller.signal)).rejects.toThrow()
  })
  it('keeps boot self-tests diagnostic for the actual loader entry id', async () => {
    const { ctx, native, signal } = harness()
    const describe = native.describe
    native.describe = () => describe().map(entry => ({ ...entry, ns: 'model-hub', schema: { type: 'object', properties: {
      selfTestMeta: entry.schema.properties.model, selfTestRole: entry.schema.properties.model,
    } } })) as ReturnType<typeof describe>
    const hub = createHubSettings(ctx as unknown as ModelSettingsDiscovery, native, 'model-hub')
    expect(await hub.list(signal)).toEqual([])
    await expect(hub.set({ ns: 'model-hub', path: ['selfTestMeta'], route: {}, expectedRevision: 8 }, signal)).rejects.toThrow('diagnostic')
  })
  it('combines native and owner fields, isolates read failures and delegates only detected writes', async () => {
    const { ctx, native, hub, signal } = harness()
    const write = vi.fn(async () => {})
    const off = registerModelSettings(ctx as unknown as ModelSettingsEvents, { ns: 'owner', title: 'Owner',
      read: () => ({ revision: 3, fields: [{ path: ['model'], label: 'Title', current: { provider: 'p', model: 'm' } }] }), write })
    registerModelSettings(ctx as unknown as ModelSettingsEvents, { ns: 'failed', title: 'Failed', read: () => { throw new Error('Storage unavailable') }, write })
    const entries = await hub.list(signal)
    expect(entries.map(entry => entry.ns)).toEqual(['failed', 'owner', 'third-party'])
    expect(entries[0]!.error).toBe('Storage unavailable')
    const owner = entries[1]!
    await hub.set({ ns: 'owner', ownerId: owner.ownerId, path: ['model'], route: { provider: 'new', model: 'm' }, expectedRevision: 3 }, signal)
    expect(write).toHaveBeenCalledWith(['model'], { provider: 'new', model: 'm' }, 3, signal)
    expect(native.mutate).not.toHaveBeenCalled()
    await expect(hub.set({ ns: 'owner', ownerId: owner.ownerId, path: ['prompt'], route: {}, expectedRevision: 3 }, signal)).rejects.toThrow('editable model')
    await expect(hub.set({ ns: 'owner', ownerId: owner.ownerId, path: ['model'], route: {}, expectedRevision: 2 }, signal)).rejects.toThrow('changed')
    await expect(hub.set({ ns: 'owner', ownerId: owner.ownerId, path: ['model'], route: { provider: 'partial' }, expectedRevision: 3 }, signal)).rejects.toThrow('Invalid model route')
    off()
    await expect(hub.set({ ns: 'owner', ownerId: owner.ownerId, path: ['model'], route: {}, expectedRevision: 3 }, signal)).rejects.toThrow('unloaded')
  })

  it('rejects stale pages after remount even when the saved revision matches', async () => {
    const { ctx, hub, signal } = harness()
    const write = vi.fn(async () => {})
    const provider = { ns: 'owner', title: 'Owner', read: () => ({ revision: 0, fields: [{ path: ['model'], label: 'Model' }] }), write }
    const off = registerModelSettings(ctx as unknown as ModelSettingsEvents, provider)
    const previous = (await hub.list(signal)).find(entry => entry.ns === 'owner')!
    off()
    registerModelSettings(ctx as unknown as ModelSettingsEvents, provider)
    await expect(hub.set({ ns: 'owner', ownerId: previous.ownerId, path: ['model'], route: {}, expectedRevision: 0 }, signal)).rejects.toThrow('owner changed')
    expect(write).not.toHaveBeenCalled()
  })

  it('owner fields supersede matching native namespace, reject duplicate owners and require client revisions', async () => {
    const { ctx, hub, signal } = harness()
    const provider = { ns: 'third-party', title: 'Owner', read: () => ({ revision: 0, fields: [{ path: ['preset'], label: 'Preset', allowFollow: false }] }), write: vi.fn(async () => {}) }
    registerModelSettings(ctx as unknown as ModelSettingsEvents, provider)
    const [entry] = await hub.list(signal)
    expect(entry!.fields.map(field => field.path)).toEqual([['preset']])
    await expect(hub.set({ ns: entry!.ns, path: ['preset'], route: {} }, signal)).rejects.toThrow('expected revision')
    await expect(hub.set({ ns: entry!.ns, ownerId: entry!.ownerId, path: ['preset'], route: {}, expectedRevision: 0 }, signal)).rejects.toThrow('concrete model')
    registerModelSettings(ctx as unknown as ModelSettingsEvents, provider)
    await expect(hub.list(signal)).rejects.toThrow()
  })
})
