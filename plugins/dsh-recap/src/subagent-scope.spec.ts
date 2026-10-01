import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as kit from '@klarkxy/dsh-plugin-kit'
import type { LlmTextRequest } from '@klarkxy/dsh-plugin-kit'
import { defaultSettings, type RecapLogEvent, type RecapPersistedState, type RecapStore } from './contracts.ts'
import { RecapService } from './service.ts'

const hostModel = { agentDefaultModel: { currentSelection: () => ({ provider: 'host', model: 'chat' }) } }
const unusedLlm = { prepareCall: async () => { throw new Error('unused') }, resolveCallConfig: async () => { throw new Error('unused') } }
beforeEach(() => { vi.restoreAllMocks() })

function stubModel(run: (request: LlmTextRequest) => Promise<{ text: string }>) {
  vi.spyOn(kit, 'callLlmText').mockImplementation(async (_llm, request) => {
    const answered = await run(request)
    return { text: answered.text, provider: 'host', model: 'chat' }
  })
}

function memoryStore(initial?: RecapPersistedState): RecapStore & { snapshot(): RecapPersistedState } {
  let state: RecapPersistedState = structuredClone(initial ?? { settings: defaultSettings(), cards: [], checkpoints: [] })
  return {
    load: () => structuredClone(state),
    save: async next => { state = structuredClone(next) },
    snapshot: () => structuredClone(state),
  }
}

/** One completed turn with real work, matching the shape recap.spec.ts builds for a long task. */
function completedTurn(): RecapLogEvent[] {
  return [
    { seq: 0, type: 'turn/start', time: 0, data: { turn: 1 } },
    { seq: 1, type: 'step/start', time: 0, data: { turn: 1, step: 1 } },
    { seq: 2, type: 'user/message', time: 1, data: { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '长任务' }] } },
    { seq: 3, type: 'step/start', time: 2, data: { turn: 1, step: 2 } },
    {
      seq: 4, type: 'tool/call', time: 3,
      data: { turn: 1, step: 2, callId: 'r1', name: 'read', arguments: '{}' },
    },
    {
      seq: 5, type: 'tool/result', time: 4,
      data: {
        turn: 1, step: 2,
        message: { role: 'user', source: { kind: 'tool', callId: 'r1' }, content: [{ type: 'text', text: 'ok' }] },
      },
    },
    { seq: 6, type: 'turn/end', time: 70_000, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

const turnEnd = (log: RecapLogEvent[]) => log.at(-1)!

function serviceFor(delegated: boolean, log = completedTurn()) {
  return new RecapService({
    store: memoryStore(),
    readEvents: () => log,
    id: () => 'card-1',
    llm: unusedLlm,
    host: hostModel,
    isSubagentSession: () => delegated,
  })
}

describe('recap skips delegated child threads', () => {
  it('creates no card for a subagent turn end', async () => {
    const log = completedTurn()
    const service = serviceFor(true, log)
    expect(await service.onSessionEvent('child-1', turnEnd(log))).toBeUndefined()
    expect(service.status('child-1').cards).toEqual([])
  })

  it('still creates a card for a top-level turn end', async () => {
    const log = completedTurn()
    const service = serviceFor(false, log)
    const card = await service.onSessionEvent('s1', turnEnd(log))
    expect(card?.id).toBe('card-1')
  })

  it('passes the pre-step decision through untouched for a subagent', async () => {
    const log = completedTurn()
    const service = serviceFor(true, log)
    let nextCalls = 0
    const decision = await service.handlePreStep({
      sessionId: 'child-1',
      messages: [{ source: { kind: 'user' } }],
      step: 1,
      signal: new AbortController().signal,
      next: async () => {
        nextCalls += 1
        return { kind: 'enter' as const, messages: [{ source: { kind: 'user' as const } }] }
      },
    })
    // The agent loop must run exactly once and receive its own decision back.
    expect(nextCalls).toBe(1)
    expect(decision.kind).toBe('enter')
    expect(decision.messages).toEqual([{ source: { kind: 'user' } }])
    expect(service.status('child-1').checkpoints).toEqual([])
  })

  it('calls no model for a subagent turn end even with cards enabled', async () => {
    const calls: LlmTextRequest[] = []
    stubModel(async request => { calls.push(request); return { text: 'recap' } })
    const log = completedTurn()
    const service = serviceFor(true, log)
    await service.onSessionEvent('child-1', turnEnd(log))
    expect(calls).toEqual([])
  })

  it('leaves an explicit manual recap of a child session available', async () => {
    // The gate is on automatic triggers, not on the user's own request.
    const log = completedTurn()
    const service = serviceFor(true, log)
    expect(await service.refresh('child-1')).toBeDefined()
  })
})
