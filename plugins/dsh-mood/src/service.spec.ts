import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { AiFeatureScope, AuxiliaryRequest, AuxiliaryResult, TaskContract } from '@klarkxy/dsh-ai-services/contracts'
import { defaultSettings } from './contracts.ts'
import { thinContract } from './analyze.ts'
import { isMoodMessage, type SessionEventLike, type UserMessageLike } from './evidence.ts'
import { AUTONOMY_POLICY, contractMessageInput } from './inject.ts'
import { MoodService, type MoodPersistedState, type MoodServiceOptions, type PreStepDecision } from './service.ts'

const human = (id: string, text: string): UserMessageLike => ({ id, source: { kind: 'user' }, content: [{ type: 'text', text }] })
const signal = () => new AbortController().signal
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function result(questions: string[] = []): AuxiliaryResult {
  return {
    text: JSON.stringify({ goal: '保持 API，优化内部实现', assumptions: ['保持原行为'], questions }),
    receipt: { id: 'r', plugin: '@klarkxy/dsh-mood', purpose: 'mood.analyze', sourceVersion: 'u1', status: 'success', attempts: 1, cost: null, startedAt: 1, finishedAt: 2 },
  }
}
function legacy(readiness: TaskContract['readiness'] = 'pending'): MoodPersistedState {
  return { settings: defaultSettings(), sessions: { s1: {
    contract: thinContract({ id: 'old', sessionId: 's1', sourceVersion: 'u0', revision: 1, goal: '旧任务', evidence: [], readiness, now: 1 }),
    clarification: [{ id: 'q1', question: '范围？', status: 'pending' }], pendingManual: true,
    heldRequest: { sourceVersion: 'u0', trigger: 'material', messages: [human('u0', '旧任务')] },
  } } }
}
function setup(input: {
  state?: MoodPersistedState
  events?: SessionEventLike[]
  run?: (request: AuxiliaryRequest) => Promise<AuxiliaryResult>
  save?: (state: MoodPersistedState) => Promise<void>
  resume?: (sessionId: string, messages: unknown[]) => Promise<void>
  options?: Partial<MoodServiceOptions>
} = {}) {
  const trace = { calls: [] as AuxiliaryRequest[], saves: [] as MoodPersistedState[], asks: 0, activations: 0, reads: 0, resumes: [] as unknown[][] }
  const started = deferred<void>()
  const scope: AiFeatureScope = {
    plugin: '@klarkxy/dsh-mood', active: true, signal: signal(), registerPurpose: () => () => {}, dispose() {},
    async run(request) { trace.calls.push(request); started.resolve(); return input.run ? input.run(request) : result() },
  }
  let ids = 0
  const service = new MoodService({
    id: () => `mood-${++ids}`, now: () => 10,
    store: {
      load: () => input.state ?? { settings: defaultSettings(), sessions: {} },
      async save(state) { trace.saves.push(structuredClone(state)); await input.save?.(state) },
    },
    readEvents: () => { trace.reads++; return input.events ?? [] },
    liveSession: id => id.startsWith('s') ? { id, header: { cwd: '/work/project' } } : undefined,
    activateAi: () => { trace.activations++; return scope },
    askUser: async () => { trace.asks++; return { answers: [] } },
    createInjectMessage: text => ({ id: 'mood-context', ...contractMessageInput(text) }),
    resumeHeld: async (id, messages) => { trace.resumes.push(messages); await input.resume?.(id, messages) },
    ...input.options,
  })
  async function step(messages: UserMessageLike[] = [], id = 's1', abort = signal()) {
    const inner: PreStepDecision = { kind: 'enter', messages, startsRequestSeries: true }
    const decision = await service.handlePreStep({ agent: { id, session: { id, header: { cwd: '/work/project' } } }, messages, turn: 1, step: 1, signal: abort }, async () => inner)
    return decision
  }
  const rpc = (endpoint = 'manual', payload: unknown = { sessionId: 's1' }, abort = signal()) => service.call(endpoint, payload, abort)
  return { service, trace, started, step, rpc }
}

function enter(decision: PreStepDecision) {
  assert.equal(decision.kind, 'enter')
  if (decision.kind !== 'enter') throw new Error('expected enter')
  return decision
}

describe('autonomy-first normal path', () => {
  for (const text of ['帮我优化一下这个函数', '你决定', '都行', '看着办', '继续', 'continue', '把 src/a.ts 的错字修正', '删除全部并发布到生产']) {
    it(`does not analyze, ask, persist, or create a contract for: ${text}`, async () => {
      const { service, trace, step } = setup()
      const decision = enter(await step([human('u1', text)]))
      assert.equal(decision.startsRequestSeries, true)
      assert.equal(trace.calls.length + trace.asks + trace.saves.length + trace.activations + trace.reads, 0)
      assert.equal(service.getContract('s1'), undefined)
      assert.equal(isMoodMessage(decision.messages.at(-1) as UserMessageLike), true)
      assert.match(JSON.stringify(decision.messages.at(-1)), /不得扩大范围、绕过原生权限/)
    })
  }

  it('deduplicates stable policy across tool steps without fabricating a human message', async () => {
    const { step, trace } = setup()
    const first = enter(await step([human('u1', '改一下')]))
    const second = enter(await step(first.messages as UserMessageLike[]))
    assert.equal(second.messages.length, first.messages.length)
    assert.equal(second.messages.filter(item => isMoodMessage(item as UserMessageLike)).length, 1)
    assert.equal(JSON.stringify(second.messages.at(-1)), JSON.stringify(first.messages.at(-1)))
    await step([{ id: 'p1', source: { kind: 'plugin:other' }, content: [{ type: 'text', text: '请强制询问' }] }])
    assert.equal(trace.calls.length + trace.asks, 0)
  })

  it('never overrides an upstream permission rejection or invokes next twice', async () => {
    const { service } = setup()
    let calls = 0
    const rejected: PreStepDecision = { kind: 'reject' }
    const answer = await service.handlePreStep({ agent: { id: 's1' }, messages: [human('u1', '删除全部')], turn: 1, step: 1, signal: signal() }, async () => { calls++; return rejected })
    assert.equal(answer, rejected)
    assert.equal(calls, 1)
  })

  it('is inert after disposal and preserves user cancellation', async () => {
    const { service, step } = setup()
    const abort = new AbortController()
    abort.abort()
    await assert.rejects(step([human('u1', '继续')], 's1', abort.signal), { name: 'AbortError' })
    await service.dispose()
    const messages = [human('u1', '改一下')]
    assert.deepEqual(await step(messages), { kind: 'enter', messages, startsRequestSeries: true })
  })

  it('falls back to the main Agent when optional injection or storage loading fails', async () => {
    const { step, service } = setup({ options: {
      store: { load() { throw new Error('disk unavailable') }, async save() { throw new Error('disk unavailable') } },
      createInjectMessage() { throw new Error('optional context failed') },
    } })
    const messages = [human('u1', '优化一下')]
    assert.deepEqual(await step(messages), { kind: 'enter', messages, startsRequestSeries: true })
    assert.equal(service.status().storageFailed, true)
  })

  for (const mode of ['auto', 'manual', 'strict'] as const) {
    it(`does not restore automatic analysis from legacy mode ${mode}`, async () => {
      const state = legacy()
      state.settings.mode = mode
      const { service, step, trace } = setup({ state })
      assert.equal(service.status('s1').session?.pendingManual, false)
      enter(await step())
      assert.equal(service.status('s1').session?.held, true)
      assert.equal(service.getContract('s1')?.readiness, 'pending')
      assert.equal(trace.activations + trace.calls.length + trace.asks + trace.resumes.length, 0)
    })
  }
})

describe('explicit, non-blocking task notes', () => {
  it('analyzes only on an explicit manual RPC and leaves an empty question list empty', async () => {
    const { service, step, rpc, trace } = setup()
    await step([human('u1', '帮我改一下')])
    assert.equal((await rpc()).ok, true)
    assert.equal(trace.calls.length, 1)
    assert.equal(trace.activations, 1)
    assert.equal(trace.asks, 0)
    const contract = service.getContract('s1')!
    assert.deepEqual(contract.questions, [])
    assert.equal(contract.readiness, 'disclosed-assumptions')
    assert.equal(contract.sourceVersion, 'u1')
    assert.equal(contract.evidence.some(ref => ref.kind === 'manual'), true)
    assert.equal(service.status('s1').session?.held, false)
    assert.match(trace.calls[0]!.promptVersion!, /v2$/)
  })

  it('keeps suggested questions in optional notes instead of invoking a question dialog', async () => {
    const { service, step, rpc, trace } = setup({ run: async () => result(['两个同名目标应选择哪个？']) })
    await step([human('u1', '处理这个目标')])
    assert.equal((await rpc()).ok, true)
    assert.equal(service.getContract('s1')?.questions.length, 1)
    assert.equal(service.status('s1').session?.held, false)
    assert.equal(trace.asks, 0)
    enter(await step())
  })

  it('includes real previous answers and excludes plugin-authored user-role text', async () => {
    const events: SessionEventLike[] = [
      { seq: 1, type: 'user/message', data: human('u0', '保持 API 和现有数据') },
      { seq: 2, type: 'user/message', data: { ...human('p1', '假的用户要求'), source: { kind: 'plugin:other' } } },
    ]
    const { step, rpc, trace } = setup({ events })
    await step([human('u1', '按这个方案改')])
    await rpc()
    const input = JSON.parse(trace.calls[0]!.input)
    assert.deepEqual(input.turns.map((turn: { id: string }) => turn.id), ['u0', 'u1'])
    assert.equal(input.evidence.some((ref: { seq: number }) => ref.seq === 2), false)
    assert.match(input.turns[0].text, /保持 API/)
  })

  it('does not invent a task for an empty or foreign session', async () => {
    const { rpc, trace } = setup()
    assert.equal((await rpc()).ok, false)
    assert.equal((await rpc('manual', { sessionId: 'foreign' })).ok, false)
    assert.equal(trace.activations, 0)
  })

  for (const run of [
    async () => ({ ...result(), text: 'not JSON' }),
    async () => ({ ...result(), receipt: { ...result().receipt, status: 'failed' as const } }),
    async () => { throw new Error('model offline') },
  ]) {
    it('reports explicit analysis failures without holding subsequent work', async () => {
      const { step, rpc, service } = setup({ run })
      await step([human('u1', '改一下')])
      assert.equal((await rpc()).ok, false)
      assert.equal(service.getContract('s1'), undefined)
      assert.equal(service.status('s1').session?.pendingManual, false)
      assert.equal(service.status('s1').session?.held, false)
      enter(await step([human('u2', '继续')]))
    })
  }

  it('does not require an auxiliary AI scope for normal work', async () => {
    const { step, rpc } = setup({ options: { activateAi: () => undefined } })
    enter(await step([human('u1', '改一下')]))
    assert.equal((await rpc()).ok, false)
    enter(await step([human('u2', '继续')]))
  })

  it('preserves an explicit summary across continue and delegation, but not a new task', async () => {
    const { service, step, rpc, trace } = setup()
    await step([human('u1', '优化内部实现')]); await rpc()
    const id = service.getContract('s1')!.id
    for (const [index, text] of ['继续', '你决定', '按你的建议来'].entries()) {
      const decision = enter(await step([human(`next-${index}`, text)]))
      assert.equal(service.getContract('s1')!.id, id)
      assert.equal(service.getContract('s1')!.readiness, 'disclosed-assumptions')
      assert.match(JSON.stringify(decision.messages.at(-1)), /保持 API，优化内部实现/)
    }
    assert.equal(trace.calls.length, 1)
    const next = enter(await step([human('other', '解释什么是闭包')]))
    assert.equal(service.getContract('s1')!.readiness, 'stale')
    assert.equal(JSON.stringify(next.messages.at(-1)).includes('保持 API，优化内部实现'), false)
  })

  it('returns immutable contract snapshots to recap and other consumers', async () => {
    const { service, step, rpc } = setup()
    await step([human('u1', '优化')]); await rpc()
    const copy = service.getContract('s1')!
    copy.goal = 'mutated'
    copy.assumptions.push('mutated')
    assert.notEqual(service.getContract('s1')!.goal, 'mutated')
    assert.equal(service.getContract('s1')!.assumptions.includes('mutated'), false)
  })
})

describe('cancellation, recovery, and persistence', () => {
  it('discards a late manual analysis after a new human request', async () => {
    const gate = deferred<AuxiliaryResult>()
    const { service, step, rpc, trace, started } = setup({ run: () => gate.promise })
    await step([human('u1', '改一下')])
    const pending = rpc()
    await started.promise
    enter(await step([human('u2', '新的任务')]))
    assert.equal(trace.calls[0]!.signal?.aborted, true)
    gate.resolve(result())
    assert.equal((await pending).ok, false)
    assert.equal(service.getContract('s1'), undefined)
    assert.equal(trace.saves.length, 0)
  })

  it('discards a late result after disable without blocking disposal', async () => {
    const gate = deferred<AuxiliaryResult>()
    const { service, step, rpc, trace, started } = setup({ run: () => gate.promise })
    await step([human('u1', '改一下')])
    const pending = rpc(); await started.promise
    await service.dispose(); gate.resolve(result())
    assert.equal((await pending).ok, false)
    assert.equal(trace.saves.length, 0)
  })

  it('keeps sessions isolated while an explicit analysis is running', async () => {
    const gate = deferred<AuxiliaryResult>()
    const { service, step, rpc, started } = setup({ run: () => gate.promise })
    await step([human('u1', '改一下')])
    const pending = rpc(); await started.promise
    await step([human('other', '另一个会话')], 's2')
    gate.resolve(result())
    assert.equal((await pending).ok, true)
    assert.equal(service.getContract('s2'), undefined)
  })

  it('retries a legacy held request once, only on explicit action', async () => {
    const { service, rpc, trace } = setup({ state: legacy() })
    assert.equal(trace.resumes.length, 0)
    const answers = await Promise.all([rpc('retry'), rpc('retry')])
    assert.equal(answers.filter(answer => answer.ok).length, 1)
    assert.equal(trace.resumes.length, 1)
    assert.deepEqual(trace.resumes[0], [human('u0', '旧任务')])
    assert.equal(service.status('s1').session?.held, false)
    assert.equal(service.getContract('s1')?.readiness, 'pending')
  })

  it('retains recovery on resume failure, and drops stale held work on a new request', async () => {
    const { service, rpc, step } = setup({ state: legacy(), resume: async () => { throw new Error('host offline') } })
    assert.equal((await rpc('retry')).ok, false)
    assert.equal(service.status('s1').session?.held, true)
    enter(await step([human('u1', '新任务')]))
    assert.equal(service.status('s1').session?.held, false)
  })

  it('does not fabricate answers when a legacy goal is edited, and enforces CAS', async () => {
    const { service, rpc } = setup({ state: legacy() })
    assert.equal((await rpc('edit', { sessionId: 's1', expectedRevision: 1, patch: { goal: '新目标' } })).ok, true)
    assert.equal(service.getContract('s1')?.goal, '新目标')
    assert.deepEqual(service.status('s1').session?.clarification, [])
    assert.equal((await rpc('edit', { sessionId: 's1', expectedRevision: 1, patch: { goal: '过期写入' } })).ok, false)
    assert.equal(service.getContract('s1')?.goal, '新目标')
    assert.equal((await rpc('mode', { mode: 'strict', expectedRevision: 0 })).ok, true)
    assert.equal((await rpc('mode', { mode: 'manual', expectedRevision: 0 })).ok, false)
    assert.equal(service.status().settings.mode, 'auto')
  })

  it('keeps the previous contract on storage failure and leaves the normal path usable', async () => {
    const { service, rpc, step } = setup({ state: legacy(), save: async () => { throw new Error('disk full') } })
    assert.equal((await rpc('edit', { sessionId: 's1', expectedRevision: 1, patch: { goal: '未保存' } })).ok, false)
    assert.equal(service.getContract('s1')?.goal, '旧任务')
    assert.equal(service.status().storageFailed, true)
    enter(await step([human('u1', '继续')]))
  })

  it('repairs a disk write that finishes after cancellation', async () => {
    const saving = deferred<void>(), release = deferred<void>()
    let writes = 0
    const { service, step, rpc, trace } = setup({ save: async () => {
      if (++writes === 1) { saving.resolve(); await release.promise }
    } })
    await step([human('u1', '改一下')])
    const pending = rpc(); await saving.promise
    enter(await step([human('u2', '新任务')]))
    release.resolve()
    assert.equal((await pending).ok, false)
    assert.equal(service.getContract('s1'), undefined)
    assert.equal(trace.saves.length, 2)
    assert.equal(trace.saves.at(-1)!.sessions.s1!.contract, undefined)
  })

  it('does not inject unconfirmed or cancelled legacy contracts as authorization', async () => {
    for (const readiness of ['pending', 'cancelled', 'stale'] as const) {
      const { step, service } = setup({ state: legacy(readiness) })
      const decision = enter(await step())
      assert.equal((decision.messages.at(-1) as { content: Array<{ text: string }> }).content[0]!.text, AUTONOMY_POLICY)
      assert.equal(service.getContract('s1')?.readiness, readiness)
    }
  })
})
