import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, TOOL } from './contracts.ts'
import type { RawEvent } from './chat.ts'
import type { DotHost } from './host.ts'
import { ReflectionRunner, REFLECTION_FAILURE_COOLDOWN_MS, REFLECTION_INTERVAL_MS, REFLECTION_PRESET_ID, REFLECTION_SUBMIT_TOOL, apply as applyReflection, buildReflectionInstruction, reflectionDue } from './reflection.ts'
import { DotStore } from './store.ts'

describe('reflectionDue', () => {
  const base = {
    now: 100 * REFLECTION_INTERVAL_MS,
    enabled: true,
    lastReflectedAt: 0,
    lastConversationAt: 1,
    dotIdle: true,
  }

  it('requires the switch, an idle dot, a full day and new conversation', () => {
    expect(reflectionDue(base)).toBe(true)
    expect(reflectionDue({ ...base, enabled: false })).toBe(false)
    expect(reflectionDue({ ...base, dotIdle: false })).toBe(false)
    expect(reflectionDue({ ...base, lastReflectedAt: base.now - REFLECTION_INTERVAL_MS + 1 })).toBe(false)
    expect(reflectionDue({ ...base, lastConversationAt: 0 })).toBe(false)
    // Nothing has been said since the last successful pass: conversation time equals it.
    expect(reflectionDue({ ...base, lastReflectedAt: base.now - REFLECTION_INTERVAL_MS, lastConversationAt: base.now - REFLECTION_INTERVAL_MS })).toBe(false)
  })

  it('holds a failed attempt for the failure cooldown, then allows a retry', () => {
    const lastReflectedAt = base.now - 2 * REFLECTION_INTERVAL_MS
    const lastReflectionAttemptAt = base.now - REFLECTION_FAILURE_COOLDOWN_MS + 1
    const failed = { ...base, lastReflectedAt, lastReflectionAttemptAt, reflectionAttemptFailed: true, lastConversationAt: lastReflectedAt + 1 }
    expect(reflectionDue(failed)).toBe(false)
    expect(reflectionDue({ ...failed, now: lastReflectionAttemptAt + REFLECTION_FAILURE_COOLDOWN_MS })).toBe(true)
    // The flag is what matters: a stale attempt timestamp never blocks a run
    // whose last attempt actually succeeded.
    expect(reflectionDue({ ...failed, reflectionAttemptFailed: false })).toBe(true)
  })
})

describe('DotStore reflection bookkeeping', () => {
  it('marks an attempt failed even when it shares its millisecond with the last success', async () => {
    const store = new DotStore(undefined)
    await store.markReflected(1000)
    expect(store.reflectionAttemptFailed).toBe(false)
    await store.beginReflectionAttempt(1000)
    // Same millisecond, but the boolean still says the latest attempt failed.
    expect(store.lastReflectedAt).toBe(1000)
    expect(store.lastReflectionAttemptAt).toBe(1000)
    expect(store.reflectionAttemptFailed).toBe(true)
  })

  it('keeps the agreement note until it is cleared and remembers reflection runs', async () => {
    const store = new DotStore(undefined)
    await store.setAgreementNotes('these two agreements disagree')
    expect(store.agreementNotes).toBe('these two agreements disagree')
    // An empty note must not wipe a pending one.
    await store.setAgreementNotes('')
    expect(store.agreementNotes).toBe('these two agreements disagree')
    await store.clearAgreementNotes()
    expect(store.agreementNotes).toBe('')

    await store.addReflectionRun({ sessionId: 'ref-1', startedAt: 10, ok: false })
    await store.finishReflectionRun('ref-1', 20, true)
    expect(store.reflections).toEqual([{ sessionId: 'ref-1', startedAt: 10, endedAt: 20, ok: true }])
  })
})

/** Minimal host for the runner: lets a test control exactly when the pass goes idle. */
function reflectionHost() {
  let promptResolve!: (sessionId: string) => void
  let idleResolve!: () => void
  let releaseResolve!: () => void
  const prompted = new Promise<string>(resolve => { promptResolve = resolve })
  const idle = new Promise<void>(resolve => { idleResolve = resolve })
  const released = new Promise<void>(resolve => { releaseResolve = resolve })
  const calls: string[] = []
  let events: RawEvent[] = []
  const host = {
    async createInternal(_cwd: string, preset: string) { calls.push(`create ${preset}`); return 'ref-1' },
    async promptInternal(sessionId: string) { calls.push(`prompt ${sessionId}`); promptResolve(sessionId) },
    async waitIdle() { await idle; return true },
    async releaseInternal(sessionId: string) { calls.push(`release ${sessionId}`); releaseResolve() },
    async stop(sessionId: string) { calls.push(`stop ${sessionId}`); idleResolve() },
    async readEvents() { return events },
    setEvents(next: RawEvent[]) { events = next },
  }
  return { host: host as unknown as DotHost, calls, prompted, released, finishIdle: () => idleResolve() }
}

function makeRunner(store: DotStore, host: DotHost, at: () => number) {
  return new ReflectionRunner({
    host,
    store,
    homeDir: '/dot',
    now: at,
    applyCognition: async text => { await store.setCognition(text) },
    isDotIdle: () => true,
    timeoutMs: 60_000,
  })
}

describe('ReflectionRunner', () => {
  it('runs a pass, writes cognition and agreement notes, and archives the session', async () => {
    const store = new DotStore(undefined)
    await store.setSettings({ ...DEFAULT_SETTINGS, reflection: true })
    await store.setDot({ lastConversationAt: 5_000 })
    const fake = reflectionHost()
    let now = REFLECTION_INTERVAL_MS + 10_000
    const runner = makeRunner(store, fake.host, () => now)
    expect(await runner.tick()).toBe(true)
    const sessionId = await fake.prompted
    expect(sessionId).toBe('ref-1')
    expect(fake.calls).toContain(`create ${REFLECTION_PRESET_ID}`)
    expect(store.reflections[0]).toMatchObject({ sessionId: 'ref-1', ok: false })
    await runner.submit('the human prefers terse answers', 'two agreements conflict', sessionId)
    fake.finishIdle()
    await fake.released
    expect(store.cognition).toBe('the human prefers terse answers')
    expect(store.agreementNotes).toBe('two agreements conflict')
    expect(store.lastReflectedAt).toBe(now)
    expect(store.reflectionAttemptFailed).toBe(false)
    expect(store.reflections[0]).toMatchObject({ sessionId: 'ref-1', ok: true })
    expect(fake.calls).toContain('release ref-1')
  })

  it('rejects a submission that did not come from the running pass', async () => {
    const store = new DotStore(undefined)
    await store.setSettings({ ...DEFAULT_SETTINGS, reflection: true })
    await store.setDot({ lastConversationAt: 5_000 })
    const fake = reflectionHost()
    const runner = makeRunner(store, fake.host, () => REFLECTION_INTERVAL_MS + 10_000)
    await runner.tick()
    const sessionId = await fake.prompted
    await expect(runner.submit('rogue write', undefined, 'other-session')).rejects.toThrow(/did not come from the running reflection pass/)
    await expect(runner.submit('rogue write', undefined, '')).rejects.toThrow(/did not come/)
    expect(store.cognition).toBe('')
    // The legitimate pass still works.
    await runner.submit('real text', undefined, sessionId)
    fake.finishIdle()
    await fake.released
    expect(store.cognition).toBe('real text')
  })

  it('records a failure when the pass ends without submitting', async () => {    const store = new DotStore(undefined)
    await store.setSettings({ ...DEFAULT_SETTINGS, reflection: true })
    await store.setDot({ lastConversationAt: 5_000 })
    const fake = reflectionHost()
    const runner = makeRunner(store, fake.host, () => REFLECTION_INTERVAL_MS + 10_000)
    await runner.tick()
    await fake.prompted
    fake.finishIdle()
    await fake.released
    expect(store.lastReflectedAt).toBeUndefined()
    expect(store.reflectionAttemptFailed).toBe(true)
    expect(store.reflections[0]).toMatchObject({ sessionId: 'ref-1', ok: false })
    expect(store.cognition).toBe('')
  })

  it('does not count a submission as successful when a bookkeeping write fails', async () => {
    const store = new DotStore(undefined)
    await store.setSettings({ ...DEFAULT_SETTINGS, reflection: true })
    await store.setDot({ lastConversationAt: 5_000 })
    const fake = reflectionHost()
    const startedAt = REFLECTION_INTERVAL_MS + 10_000
    const runner = makeRunner(store, fake.host, () => startedAt)
    await runner.tick()
    const sessionId = await fake.prompted
    const realFinish = store.finishReflectionRun.bind(store)
    store.finishReflectionRun = async () => { throw new Error('disk full') }
    await expect(runner.submit('new text', undefined, sessionId)).rejects.toThrow('disk full')
    store.finishReflectionRun = realFinish
    fake.finishIdle()
    await fake.released
    // The failed pass must not satisfy the 24h success gate: no success time,
    // and the attempt stays failed so the next try waits the 2h cooldown.
    expect(store.lastReflectedAt).toBeUndefined()
    expect(store.reflectionAttemptFailed).toBe(true)
    expect(reflectionDue({
      now: startedAt + 3_600_000,
      enabled: true,
      dotIdle: true,
      lastReflectedAt: store.lastReflectedAt,
      lastReflectionAttemptAt: store.lastReflectionAttemptAt,
      reflectionAttemptFailed: store.reflectionAttemptFailed,
      lastConversationAt: 5_000,
    })).toBe(false)
  })

  it('undoes a success time when the final success write fails', async () => {
    const store = new DotStore(undefined)
    await store.setSettings({ ...DEFAULT_SETTINGS, reflection: true })
    await store.setDot({ lastConversationAt: 5_000 })
    const fake = reflectionHost()
    const startedAt = REFLECTION_INTERVAL_MS + 10_000
    const runner = makeRunner(store, fake.host, () => startedAt)
    await runner.tick()
    const sessionId = await fake.prompted
    const realMark = store.markReflected.bind(store)
    // Simulate a write that mutates memory and then fails: the runner must roll
    // the success time back so the failed pass is not mistaken for a success.
    store.markReflected = async (at: number) => { await realMark(at); throw new Error('disk full') }
    await expect(runner.submit('new text', undefined, sessionId)).rejects.toThrow('disk full')
    store.markReflected = realMark
    fake.finishIdle()
    await fake.released
    expect(store.lastReflectedAt).toBeUndefined()
    expect(store.reflectionAttemptFailed).toBe(true)
    expect(store.reflections[0]).toMatchObject({ sessionId, ok: false })
  })

  it('cancels a pass in flight on dispose and releases its session', async () => {
    const store = new DotStore(undefined)
    await store.setSettings({ ...DEFAULT_SETTINGS, reflection: true })
    await store.setDot({ lastConversationAt: 5_000 })
    const fake = reflectionHost()
    const runner = makeRunner(store, fake.host, () => REFLECTION_INTERVAL_MS + 10_000)
    await runner.tick()
    await fake.prompted
    expect(runner.running).toBe(true)
    await runner.dispose()
    expect(fake.calls).toContain('stop ref-1')
    expect(fake.calls).toContain('release ref-1')
    expect(runner.running).toBe(false)
    // A disposed runner never starts another pass.
    expect(await runner.tick()).toBe(false)
  })

  it('folds a stored reflection session into a trajectory', async () => {
    const store = new DotStore(undefined)
    const fake = reflectionHost()
    fake.host.readEvents = async () => [
      { type: 'turn/start', seq: 0, time: 10, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 11, data: { step: 1 } },
      { type: 'assistant/message', seq: 2, time: 12, data: { message: { content: [{ type: 'text', text: 'reviewed' }] } } },
      { type: 'turn/end', seq: 3, time: 13, data: { reason: { kind: 'completed' } } },
    ] as RawEvent[]
    const runner = makeRunner(store, fake.host, () => 0)
    const view = await runner.trajectory('ref-1')
    expect(view.sessionId).toBe('ref-1')
    expect(view.turns).toHaveLength(1)
    expect(view.turns[0]!.steps[0]!.records.some(record => record.kind === 'text' && record.text === 'reviewed')).toBe(true)
  })
})

describe('buildReflectionInstruction', () => {
  it('includes the current knowledge and names the submission tool', () => {
    const text = buildReflectionInstruction({ agreements: '- be brief\n', cognition: 'she likes terse answers', now: 0 })
    expect(text).toContain('- be brief')
    expect(text).toContain('she likes terse answers')
    expect(text).toContain('dot_reflection_submit')
    expect(text).toContain('never change')
  })
})

describe('reflection preset tool row', () => {
  it('registers only the three internal tools and hides inherited global tools', () => {
    const registered: Array<Record<string, unknown>> = []
    const denied: string[] = []
    const ctx = {
      tools: {
        schemas: () => [{ name: 'bash' }, { name: 'fs_read' }],
        restrict: (filter: { deny?: readonly string[] }) => { denied.push(...filter.deny ?? []); return () => {} },
        register: (definition: Record<string, unknown>) => { registered.push(definition); return () => {} },
      },
      dot: {},
      on: () => () => {},
      effect: (fn: () => unknown) => { fn(); return () => {} },
    }
    applyReflection(ctx as never)
    expect(registered.map(tool => tool.name).sort()).toEqual([TOOL.searchHistory, TOOL.readHistory, REFLECTION_SUBMIT_TOOL].sort())
    // The helper denies the inherited tools so the reflection session sees only its own three.
    expect(denied).toContain('bash')
    expect(denied).toContain('fs_read')
  })
})
