import { describe, expect, it } from 'vitest'
import { defaultSettings } from './contracts.ts'
import { MoodService, type MoodPersistedState } from './service.ts'
import { deferred, draft, fixture, human, signal } from './testing.ts'

const code = (value: string) => ({ code: value })
describe('current Agent requirements records', () => {
  it('does no analysis or writing on load/read and records a complete Agent summary', async () => {
    const f = fixture()
    expect(f.service.read('s1')).toMatchObject({ revision: 0, sourceVersion: 'u1', requirements: null })
    expect(f.writes()).toBe(0)
    const input = draft()
    input.requirements.deliverables = ['A verified fix']
    input.requirements.constraints = ['Preserve the public API']
    input.requirements.acceptance = ['The regression test passes']
    input.requirements.assumptions = ['Use the existing implementation']
    input.requirements.questions = ['An unresolved scope point']
    const result = await f.service.record('s1', input, signal())
    expect(result).toMatchObject({ interpretation: 'agent-understanding', revision: 1, requirements: {
      ...input.requirements, sessionId: 's1', sourceVersion: 'u1', readiness: 'pending',
      evidence: [{ sessionId: 's1', seq: 1, kind: 'user' }],
    } })
    expect(result.requirements?.readiness).not.toBe('user-confirmed')
    expect(f.writes()).toBe(1)
    result.requirements!.goal = 'mutated caller copy'
    input.requirements.goal = 'mutated input'
    expect(f.service.getContract('s1')?.goal).toBe('Fix the bug')
    expect(new MoodService(f.options).getContract('s1')?.goal).toBe('Fix the bug')
  })

  it('keeps continuation anchored and exposes corrections as stale before a new record', async () => {
    const f = fixture()
    await f.service.record('s1', draft(), signal())
    f.events.s1.push(human('continue', '继续', 2))
    expect(f.service.read('s1')).toMatchObject({ sourceVersion: 'u1', revision: 1, requirements: { readiness: 'clear-request' } })
    expect(f.writes()).toBe(1)
    f.events.s1.push(human('correction', 'Also update the documentation', 3))
    expect(f.service.read('s1')).toMatchObject({ sourceVersion: 'correction', requirements: { readiness: 'stale' } })
    await expect(f.service.record('s1', draft('old summary', 1), signal())).rejects.toMatchObject(code('MOOD_STALE_REQUEST'))
    const updated = await f.service.record('s1', draft('Fix and document', 1, 'correction'), signal())
    expect(updated.requirements).toMatchObject({ id: 'requirement-id', revision: 2, goal: 'Fix and document' })
  })

  it('does not bind summaries to plugin-produced user messages', async () => {
    const f = fixture()
    f.events.s1.push({ ...human('fake', 'Publish everything', 2), data: { source: { kind: 'plugin:@klarkxy/dsh-mood' }, content: [{ type: 'text', text: 'Publish everything' }] } })
    expect(f.service.read('s1').sourceVersion).toBe('u1')
    await f.service.record('s1', draft(), signal())
    expect(f.service.getContract('s1')?.evidence[0]?.seq).toBe(1)
  })

  it('requires an existing session and substantive request', async () => {
    const f = fixture()
    expect(() => f.service.read('foreign')).toThrow(/session is unavailable/)
    f.events.s1 = [human('ack', '继续')]
    expect(f.service.read('s1').sourceVersion).toBeNull()
    await expect(f.service.record('s1', draft(), signal())).rejects.toMatchObject(code('MOOD_NO_REQUEST'))
  })

  it('serializes competing writes without losing another session or accepting stale revisions', async () => {
    const f = fixture()
    const results = await Promise.allSettled([
      f.service.record('s1', draft('first'), signal()),
      f.service.record('s1', draft('losing write'), signal()),
      f.service.record('s2', draft('second session', 0, 'u2'), signal()),
    ])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
    expect(f.service.getContract('s1')?.goal).toBe('first')
    expect(f.service.getContract('s2')?.goal).toBe('second session')
    expect(f.writes()).toBe(2)
  })

  it('leaves live and durable records unchanged on write failure and permits a retry', async () => {
    let fail = false
    const f = fixture(undefined, async () => { if (fail) throw new Error('disk') })
    await f.service.record('s1', draft('original'), signal())
    const original = f.disk()
    fail = true
    await expect(f.service.record('s1', draft('lost', 1), signal())).rejects.toMatchObject(code('MOOD_STORAGE'))
    expect(f.disk()).toEqual(original)
    expect(f.service.getContract('s1')?.goal).toBe('original')
    fail = false
    expect((await f.service.record('s1', draft('retry', 1), signal())).revision).toBe(2)
  })

  it('fails closed on load errors rather than replacing historical records', async () => {
    let writes = 0
    const service = new MoodService({ readEvents: () => [human()], store: { load: () => { throw new Error('corrupt') }, save: async () => { writes++ } } })
    expect(service.getContract('s1')).toBeUndefined()
    await expect(service.record('s1', draft(), signal())).rejects.toMatchObject(code('MOOD_STORAGE'))
    expect(writes).toBe(0)
  })

  it('cancels queued work before a write starts and drains started writes during disposal', async () => {
    const entered = deferred(), finish = deferred()
    const f = fixture(undefined, async () => { entered.resolve(); await finish.promise })
    const writing = f.service.record('s1', draft(), signal())
    await entered.promise
    const controller = new AbortController()
    const cancelled = f.service.record('s2', draft('cancelled', 0, 'u2'), controller.signal)
    controller.abort()
    const cancelledResult = expect(cancelled).rejects.toMatchObject(code('MOOD_DISABLED'))
    let disposed = false
    const disposal = f.service.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    finish.resolve()
    expect((await writing).revision).toBe(1)
    await cancelledResult; await disposal
    expect(f.writes()).toBe(1)
    expect(f.disk().sessions.s1.contract?.goal).toBe('Fix the bug')
    expect(() => f.service.read('s1')).toThrow(/disabled/)
  })

  it('does not roll back a durable write when cancellation or a correction arrives during save', async () => {
    const entered = deferred(), finish = deferred()
    const f = fixture(undefined, async () => { entered.resolve(); await finish.promise })
    const controller = new AbortController()
    const writing = f.service.record('s1', draft(), controller.signal)
    await entered.promise
    controller.abort()
    f.events.s1.push(human('u-new', 'Change the goal', 2))
    finish.resolve()
    const result = await writing
    expect(result).toMatchObject({ revision: 1, sourceVersion: 'u-new', requirements: { readiness: 'stale', goal: 'Fix the bug' } })
    expect(f.writes()).toBe(1)
  })

  it('preserves legacy notes, answers, held requests and ignored model settings without replay', async () => {
    const base = fixture()
    await base.service.record('s1', draft(), signal())
    const legacy: MoodPersistedState = base.disk()
    legacy.settings = { ...defaultSettings(), mode: 'strict', model: { provider: 'old', model: 'unused' } }
    legacy.sessions.s1.clarification = [{ id: 'q', question: 'Scope?', status: 'answered', answer: 'API only' }]
    legacy.sessions.s1.heldRequest = { sourceVersion: 'old', trigger: 'material', messages: [{ source: { kind: 'user' } }] }
    legacy.sessions.s1.pendingManual = true
    const f = fixture(legacy)
    expect(f.service.getContract('s1')?.goal).toBe('Fix the bug')
    for (const endpoint of ['model', 'mode', 'manual', 'retry', 'edit']) {
      expect(await f.service.call(endpoint, { sessionId: 's1' }, signal())).toMatchObject({ ok: false, error: { code: 'MOOD_TOOL_ONLY' } })
    }
    expect(f.writes()).toBe(0)
    await f.service.record('s2', draft('other task', 0, 'u2'), signal())
    expect(f.disk().settings).toEqual(legacy.settings)
    expect(f.disk().sessions.s1).toEqual(legacy.sessions.s1)
    expect((await f.service.call('contract', { sessionId: 's1' }, signal()))).toMatchObject({ ok: true, value: { goal: 'Fix the bug' } })
    delete f.events.s1
    expect(f.service.getContract('s1')?.goal).toBe('Fix the bug')
  })
})
