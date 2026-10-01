import { describe, expect, it } from 'vitest'
import { SETTINGS_KEY, type SelfImprovementSettings } from './contracts.ts'
import { SelfImprovementEngine } from './engine.ts'
import { lesson, MemoryFake, TableFake, tables } from './fakes.ts'

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>(next => { resolve = next })
  return { promise, resolve }
}

async function settle(predicate: () => boolean) {
  for (let i = 0; i < 80 && !predicate(); i += 1) await Promise.resolve()
  expect(predicate()).toBe(true)
}

function setup() {
  const memory = new MemoryFake()
  const store = tables()
  const settings = new TableFake<SelfImprovementSettings>()
  const impl = new SelfImprovementEngine({
    memory: () => memory,
    sessionOf: () => undefined,
    ...store,
    settings,
    now: () => 50,
  })
  const call = (endpoint: string, payload: unknown) => impl.call(endpoint, payload, new AbortController().signal)
  return { impl, memory, store, settings, call }
}

async function preview(context: ReturnType<typeof setup>) {
  const source = lesson({ id: 'lesson', title: 'relative paths', content: 'Keep paths relative.', status: 'active', scope: { kind: 'global' } })
  context.memory.records.set(source.id, source)
  const result = await context.impl.previewSkill([source.id])
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('preview failed')
  return result.value
}

describe('settings save serialization', () => {
  it('allows only one concurrent save at revision zero and detaches the requested model', async () => {
    const { impl, settings } = setup()
    const hold = deferred()
    settings.beforePut = () => hold.promise
    const model = { provider: 'first', model: 'chat' }
    const first = impl.updateSettings(model, 0)
    model.provider = 'changed'
    const second = impl.updateSettings({ provider: 'second', model: 'chat' }, 0)
    const outcomes = Promise.allSettled([first, second])
    await settle(() => settings.puts === 1)
    hold.resolve()
    const [saved, stale] = await outcomes
    expect(saved).toMatchObject({ status: 'fulfilled', value: { revision: 1, model: { provider: 'first' } } })
    expect(stale).toMatchObject({ status: 'rejected', reason: new Error('SELF_IMPROVEMENT_STALE') })
    expect(settings.puts).toBe(1)
    expect(impl.getSettings()).toEqual(settings.get(SETTINGS_KEY))
  })

  it('keeps the successful state and lets the next queued save run after a failed save', async () => {
    const { impl, settings } = setup()
    settings.beforePut = () => {
      if (settings.puts === 1) throw new Error('disk failed')
    }
    const [failed, saved] = await Promise.allSettled([
      impl.updateSettings({ provider: 'failed', model: 'chat' }, 0),
      impl.updateSettings({ provider: 'saved', model: 'chat' }, 0),
    ])
    expect(failed).toMatchObject({ status: 'rejected', reason: new Error('disk failed') })
    expect(saved).toMatchObject({ status: 'fulfilled', value: { revision: 1, model: { provider: 'saved' } } })
    expect(settings.puts).toBe(2)
    expect(impl.getSettings()).toEqual(settings.get(SETTINGS_KEY))
  })

  it('does not start queued or new writes after disposal, or report an in-flight save as success', async () => {
    const { impl, settings } = setup()
    const hold = deferred()
    settings.beforePut = () => hold.promise
    const first = impl.updateSettings({ provider: 'first', model: 'chat' }, 0)
    const queued = impl.updateSettings({ provider: 'queued', model: 'chat' }, 1)
    const outcomes = Promise.allSettled([first, queued])
    await settle(() => settings.puts === 1)
    impl.dispose()
    hold.resolve()
    const results = await outcomes
    for (const result of results) {
      expect(result).toMatchObject({ status: 'rejected', reason: new Error('SELF_IMPROVEMENT_DISABLED') })
    }
    await expect(impl.updateSettings({ provider: 'late', model: 'chat' }, 1)).rejects.toThrow('SELF_IMPROVEMENT_DISABLED')
    expect(settings.puts).toBe(1)
    expect(impl.getSettings()).toEqual(settings.get(SETTINGS_KEY))
  })
})

describe('skill mutation serialization', () => {
  it.each([
    ['skill.reject', 'rejected'],
    ['skill.revoke', 'revoked'],
    ['skill.exported', 'export'],
    ['skill.unexport', 'unexport'],
  ])('keeps one winning write when %s races another action at the same revision', async (endpoint, action) => {
    const context = setup()
    const draft = await preview(context)
    const hold = deferred()
    context.store.skills.beforePut = () => hold.promise
    const baseline = context.store.skills.puts
    const first = context.call(endpoint, { id: draft.id, expectedRevision: 0, filename: 'skill.md' })
    const second = context.call(endpoint === 'skill.reject' ? 'skill.revoke' : 'skill.reject', { id: draft.id, expectedRevision: 0 })
    await settle(() => context.store.skills.puts === baseline + 1)
    hold.resolve()
    const [winner, stale] = await Promise.all([first, second])
    expect(winner).toMatchObject({ ok: true, value: { revision: 1, audit: [...draft.audit, { at: 50, action, ...(action === 'export' ? { detail: 'skill.md' } : action === 'unexport' ? { detail: 'in-app record only' } : {}) }] } })
    expect(stale).toMatchObject({ ok: false, error: { code: 'STALE' } })
    expect(context.store.skills.puts).toBe(baseline + 1)
    if (!winner.ok) throw new Error('winning operation failed')
    expect(context.store.skills.get(draft.id)).toEqual(winner.value)
  })

  it('holds source validation and acceptance in the same queue operation', async () => {
    const context = setup()
    const draft = await preview(context)
    const hold = deferred()
    let reading = false
    context.memory.beforeRead = () => { reading = true; return hold.promise }
    const first = context.impl.acceptSkill(draft.id, 0)
    await settle(() => reading)
    const second = context.call('skill.reject', { id: draft.id, expectedRevision: 0 })
    expect(context.store.skills.puts).toBe(1)
    hold.resolve()
    const [accepted, stale] = await Promise.all([first, second])
    expect(accepted).toMatchObject({ ok: true, value: { revision: 1, status: 'accepted' } })
    expect(stale).toMatchObject({ ok: false, error: { code: 'STALE' } })
    expect(context.store.skills.puts).toBe(2)
  })

  it('validates live sources after earlier queued writes finish', async () => {
    const context = setup()
    const draft = await preview(context)
    const hold = deferred()
    context.store.skills.beforePut = () => hold.promise
    const first = context.call('skill.exported', { id: draft.id, expectedRevision: 0, filename: 'skill.md' })
    await settle(() => context.store.skills.puts === 2)
    const queued = context.impl.acceptSkill(draft.id, 1)
    await context.memory.update('lesson', { status: 'revoked' }, 1)
    hold.resolve()
    expect(await first).toMatchObject({ ok: true })
    expect(await queued).toMatchObject({ ok: false, error: { code: 'STALE' } })
    expect(context.store.skills.puts).toBe(2)
    expect(context.store.skills.get(draft.id)?.status).toBe('preview')
  })

  it('recovers the queue after a failed write without advancing the revision', async () => {
    const context = setup()
    const draft = await preview(context)
    context.store.skills.beforePut = () => {
      if (context.store.skills.puts === 2) throw new Error('disk failed')
    }
    const [failed, saved] = await Promise.all([
      context.call('skill.reject', { id: draft.id, expectedRevision: 0 }),
      context.call('skill.revoke', { id: draft.id, expectedRevision: 0 }),
    ])
    expect(failed).toMatchObject({ ok: false, error: { code: 'STORAGE_FAILED' } })
    expect(saved).toMatchObject({ ok: true, value: { revision: 1, status: 'revoked', audit: [...draft.audit, { at: 50, action: 'revoked' }] } })
    expect(context.store.skills.puts).toBe(3)
    expect(await context.impl.snapshot()).toMatchObject({ ok: true, value: { storageFailed: false } })
  })

  it('does not start a queued skill write after disposal', async () => {
    const context = setup()
    const draft = await preview(context)
    const hold = deferred()
    context.store.skills.beforePut = () => hold.promise
    const first = context.call('skill.reject', { id: draft.id, expectedRevision: 0 })
    const queued = context.call('skill.revoke', { id: draft.id, expectedRevision: 1 })
    await settle(() => context.store.skills.puts === 2)
    context.impl.dispose()
    hold.resolve()
    const results = await Promise.all([first, queued])
    for (const result of results) expect(result).toMatchObject({ ok: false, error: { code: 'DISABLED' } })
    expect(context.store.skills.puts).toBe(2)
    expect(context.store.skills.get(draft.id)).toMatchObject({ revision: 1, status: 'rejected' })
  })
})
