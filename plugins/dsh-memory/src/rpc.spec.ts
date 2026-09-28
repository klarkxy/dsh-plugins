import { describe, expect, it } from 'vitest'
import { handleMemoryRpc } from './rpc.ts'
import { MemoryRuntime } from './service.ts'
import { createMemoryStore } from './store.ts'

function sessions(cwd?: string) {
  return (id: string) => id === 'live' ? { meta: { cwd } } : undefined
}

describe('host rpc scope', () => {
  it('cannot bypass stale-candidate acceptance or reactivate rejected records through generic editing', async () => {
    let n = 0
    const runtime = new MemoryRuntime({ store: createMemoryStore(), now: () => 1, id: () => `id-${++n}` })
    const source = await runtime.createManualRecord({ sessionId: 'live', projectId: '/real/work', title: 'source', content: 'original', kind: 'preference' })
    const candidate = await runtime.create({
      scope: source.scope, kind: 'preference', status: 'candidate', title: 'derived', content: 'stale conclusion',
      source: 'user', tags: [], exceptions: [], evidence: [], basis: [{ id: source.id, revision: source.revision }],
    })
    await runtime.update(source.id, { content: 'corrected' }, source.revision)
    const signal = new AbortController().signal
    expect(await handleMemoryRpc('records.accept', {
      sessionId: 'live', id: candidate.id, expectedRevision: candidate.revision,
    }, signal, runtime, sessions('/real/work'))).toMatchObject({ ok: false, error: { code: 'MEMORY_STALE' } })
    const activate = (id: string, expectedRevision: number) => handleMemoryRpc('records.update', {
      sessionId: 'live', id, expectedRevision, status: 'active',
    }, signal, runtime, sessions('/real/work'))
    expect(await activate(candidate.id, candidate.revision)).toMatchObject({ ok: false, error: { code: 'MEMORY_INVALID' } })
    const rejected = await runtime.reject(candidate.id, candidate.revision)
    expect(await activate(rejected.id, rejected.revision)).toMatchObject({ ok: false, error: { code: 'MEMORY_INVALID' } })
    expect(runtime.status().records.find(record => record.id === candidate.id)?.status).toBe('rejected')
    expect(await handleMemoryRpc('records.update', {
      sessionId: 'live', id: source.id, expectedRevision: source.revision + 1, title: 'edited normally',
    }, signal, runtime, sessions('/real/work'))).toMatchObject({ ok: true, value: { title: 'edited normally', status: 'active' } })
    await runtime.dispose()
  })

  it('derives project scope from the live session, not a client path', async () => {
    let n = 0
    const runtime = new MemoryRuntime({
      store: createMemoryStore(),
      now: () => 1,
      id: () => `id-${++n}`,
    })
    const created = await handleMemoryRpc('records.create', {
      sessionId: 'live',
      title: '项目事实',
      content: '主角住在海边',
      kind: 'project-fact',
    }, new AbortController().signal, runtime, sessions('/real/work'))
    expect(created).toMatchObject({ ok: true })
    if (created.ok) {
      const record = created.value as { scope: { kind: string; projectId?: string } }
      expect(record.scope).toEqual({ kind: 'project', projectId: '/real/work' })
    }
  })

  it('rejects silent global create when the session has no cwd', async () => {
    const runtime = new MemoryRuntime({ store: createMemoryStore(), id: () => 'id-1' })
    const result = await handleMemoryRpc('records.create', {
      sessionId: 'live', title: 'x', content: 'y', kind: 'preference',
    }, new AbortController().signal, runtime, sessions(undefined))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('MEMORY_SCOPE')
  })

  it('rejects a client-supplied project path field', async () => {
    const runtime = new MemoryRuntime({ store: createMemoryStore(), id: () => 'id-1' })
    const result = await handleMemoryRpc('records.create', {
      sessionId: 'live', title: 'x', content: 'y', kind: 'project-fact', projectId: '/forged/path',
    }, new AbortController().signal, runtime, sessions('/real/work'))
    expect(result.ok).toBe(false)
  })

  it('writes global only when the client sets the explicit flag', async () => {
    const runtime = new MemoryRuntime({ store: createMemoryStore(), id: () => 'id-1' })
    const result = await handleMemoryRpc('records.create', {
      sessionId: 'live', title: '跨项目', content: '夜深再写', kind: 'preference', global: true,
    }, new AbortController().signal, runtime, sessions(undefined))
    expect(result).toMatchObject({ ok: true, value: { scope: { kind: 'global' } } })
  })

  it('mints a UUID and rejects a client-supplied record id', async () => {
    const runtime = new MemoryRuntime({ store: createMemoryStore(), now: () => 1 })
    const created = await handleMemoryRpc('records.create', {
      sessionId: 'live', title: '语气', content: '克制', kind: 'preference',
    }, new AbortController().signal, runtime, sessions('/work/novel'))
    expect(created).toMatchObject({ ok: true })
    if (created.ok) expect((created.value as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/i)
    const forged = await handleMemoryRpc('records.create', {
      sessionId: 'live', id: 'forged', title: '语气', content: '克制', kind: 'preference',
    }, new AbortController().signal, runtime, sessions('/work/novel'))
    expect(forged).toEqual({ ok: false, error: { code: 'MEMORY_INVALID', message: '新增条目格式无效。' } })
  })
})
