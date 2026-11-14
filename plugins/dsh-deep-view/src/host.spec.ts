import { describe, expect, it } from 'vitest'
import { assertObjectJsonSchema, projectToolSchema, validateJsonSchemaValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createRpc, createShowViewTool, handoffPendingSession, resolveSessionId } from './index.ts'

function hostFixture(options: { flush?: () => Promise<boolean>; followup?: (message: unknown) => void } = {}) {
  const agent = { id: 'session-test', session: { id: 'session-test' }, followup(message: unknown) { messages.push(message); options.followup?.(message) } }
  const messages: unknown[] = []
  const host = {
    agents: { get: (id: string) => id === agent.id ? agent : undefined, roots: () => [agent] },
    sessionController: { resolveAgent: async (id: string) => ({ agent: id === agent.id ? agent : undefined }) },
    sessions: { flush: options.flush ?? (async () => true) },
    tools: { get: () => undefined, register: () => () => {} },
  }
  return { host: host as never, agent, messages }
}
const interactiveView = { type: 'options', id: 'pick', options: [{ label: 'One' }, { label: 'Two' }] }
describe('show_view Host boundary', () => {
  it('exports a valid model-facing schema through the real Host projection', () => {
    const { host } = hostFixture()
    const tool = createShowViewTool(host, new Map()) as unknown as ToolDefinition
    const { parameters } = JSON.parse(JSON.stringify(projectToolSchema(tool, true)))
    assertObjectJsonSchema(parameters)
    // Provider validation happens before execute(), even when no card is requested.
    expect(parameters.title).toBeUndefined()
    expect(parameters.properties?.title).toMatchObject({ type: 'string' })
    expect(parameters.required).toEqual(['view'])
    expect(validateJsonSchemaValue(parameters, { view: interactiveView })).toEqual([])
    expect(validateJsonSchemaValue(parameters, {
      title: 'Choose', view: interactiveView, await_reply: true,
    })).toEqual([])
    expect(validateJsonSchemaValue(parameters, {
      view: { type: 'stack', children: [{ type: 'metric', label: 'Total', value: 42 }] },
      await_reply: false,
    })).toEqual([])
    for (const invalid of [
      {}, { title: 'Missing view' }, { view: 'not an object' },
      { view: interactiveView, title: {} }, { view: interactiveView, await_reply: 'yes' },
    ]) {
      expect(validateJsonSchemaValue(parameters, invalid).length).toBeGreaterThan(0)
    }
  })
  it('returns replayable presentation facts and claims only a live root pending view', async () => {
    const { host } = hostFixture()
    const pending = new Map()
    const tool = createShowViewTool(host, pending, () => 'view-fixed') as { execute(args: unknown, exec: unknown): Promise<Record<string, unknown>>; output: { presentationMeta(args: unknown, value: unknown): unknown } }
    const exec = { agent: (host as never as { agents: { get(id: string): unknown } }).agents.get('session-test'), callId: 'call-one', concludeTurn() {} }
    const value = await tool.execute({ title: 'Choose', view: interactiveView }, exec)
    expect(value).toMatchObject({ owner: 'dsh-deep-view', viewId: 'view-fixed', status: 'pending', awaitReply: true })
    expect(tool.output.presentationMeta({ title: 'Choose', view: interactiveView }, value)).toMatchObject({ owner: 'dsh-deep-view', viewId: 'view-fixed', interactive: true, awaitReply: true })
    expect(pending.get('session-test')).toMatchObject({ id: 'view-fixed', callId: 'call-one' })
  })
  it('replaces an unanswered card instead of deleting the record', async () => {
    const { host } = hostFixture()
    const pending = new Map()
    const tool = createShowViewTool(host, pending, () => 'view-new') as { execute(args: unknown, exec: unknown): Promise<Record<string, unknown>> }
    const exec = { agent: (host as never as { agents: { get(id: string): unknown } }).agents.get('session-test'), callId: 'call-two', concludeTurn() {} }
    pending.set('session-test', { id: 'view-old', sessionId: 'session-test', title: '', view: interactiveView })
    await tool.execute({ title: 'Choose', view: interactiveView }, exec)
    expect(pending.get('session-test')).toMatchObject({ id: 'view-new', callId: 'call-two' })
  })
  it('rejects forged or duplicate answers and only admits a validated reply once', async () => {
    const { host, messages } = hostFixture()
    const pending = new Map([['session-test', { id: 'view-fixed', sessionId: 'session-test', title: '', view: interactiveView }]])
    const rpc = createRpc(host, pending)
    expect(await rpc('reply', { sessionId: 'session-test', viewId: 'view-fixed', action: 'pick', values: { selected: ['Forged'] } }, new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'invalid' } })
    const accepted = await rpc('reply', { sessionId: 'session-test', viewId: 'view-fixed', action: 'pick', values: { selected: ['One'] } }, new AbortController().signal)
    expect(accepted).toMatchObject({ ok: true })
    expect(messages).toHaveLength(1)
    expect(JSON.stringify(messages[0])).not.toContain('answer_to_pending_view')
    expect(messages[0]).toMatchObject({ content: [{ type: 'text', text: 'Deep View\nOne' }] })
    expect(JSON.stringify(messages[0])).toContain('"kind":"user"')
    expect(await rpc('reply', { sessionId: 'session-test', viewId: 'view-fixed', action: 'pick', values: { selected: ['One'] } }, new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'stale' } })
  })
  it('reopens the card when the reply is cancelled before appending', async () => {
    const { host, messages } = hostFixture()
    const record = { id: 'view-fixed', sessionId: 'session-test', title: '', view: interactiveView }
    const pending = new Map([['session-test', record]])
    const rpc = createRpc(host, pending)
    const controller = new AbortController()
    controller.abort()
    expect(await rpc('reply', { sessionId: 'session-test', viewId: 'view-fixed', action: 'pick', values: { selected: ['One'] } }, controller.signal)).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(messages).toHaveLength(0)
    expect(pending.get('session-test')).toBe(record)
  })
  it('reopens the card when the request is cancelled while resolving the agent', async () => {
    const controller = new AbortController()
    const { host, messages } = hostFixture()
    const sessionController = (host as never as { sessionController: { resolveAgent(id: string): Promise<{ agent?: { id: string } }> } }).sessionController
    const inner = sessionController.resolveAgent.bind(sessionController)
    // The session is not live yet, so the controller has to resume it.
    const agents = (host as never as { agents: { get(id: string): unknown } }).agents
    const liveGet = agents.get
    let resumed = false
    agents.get = (id: string) => resumed ? liveGet(id) : undefined
    sessionController.resolveAgent = async (id: string) => { controller.abort(); resumed = true; return inner(id) }
    const record = { id: 'view-fixed', sessionId: 'session-test', title: '', view: interactiveView }
    const pending = new Map([['session-test', record]])
    const rpc = createRpc(host, pending)
    expect(await rpc('reply', { sessionId: 'session-test', viewId: 'view-fixed', action: 'pick', values: { selected: ['One'] } }, controller.signal)).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(messages).toHaveLength(0)
    expect(pending.get('session-test')).toBe(record)
  })
  it('answers a live root directly, without the session controller', async () => {
    const { host, messages } = hostFixture()
    // The controller refuses plugin-owned roots such as subagent-origin chats.
    ;(host as never as { sessionController: { resolveAgent(): Promise<never> } }).sessionController.resolveAgent = async () => { throw new Error('subagent Sessions require their durable parent address') }
    const pending = new Map([['session-test', { id: 'view-fixed', sessionId: 'session-test', title: '', view: interactiveView }]])
    const rpc = createRpc(host, pending)
    expect(await rpc('reply', { sessionId: 'session-test', viewId: 'view-fixed', action: 'pick', values: { selected: ['One'] } }, new AbortController().signal)).toMatchObject({ ok: true })
    expect(messages).toHaveLength(1)
  })
  it('does not reopen after the answer is appended even when the checkpoint fails', async () => {
    const { host, messages } = hostFixture({ flush: async () => { throw new Error('disk full') } })
    const pending = new Map([['session-test', { id: 'view-fixed', sessionId: 'session-test', title: '', view: interactiveView }]])
    const rpc = createRpc(host, pending)
    expect(await rpc('reply', { sessionId: 'session-test', viewId: 'view-fixed', action: 'pick', values: { selected: ['One'] } }, new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(messages).toHaveLength(1)
    // A retry sees a stale card; the appended user message must never duplicate.
    expect(pending.has('session-test')).toBe(false)
  })
  it('reopens the card when appending the user message itself fails', async () => {
    const { host, messages } = hostFixture({ followup: () => { throw new Error('session closed') } })
    const record = { id: 'view-fixed', sessionId: 'session-test', title: '', view: interactiveView }
    const pending = new Map([['session-test', record]])
    const rpc = createRpc(host, pending)
    expect(await rpc('reply', { sessionId: 'session-test', viewId: 'view-fixed', action: 'pick', values: { selected: ['One'] } }, new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(pending.get('session-test')).toBe(record)
  })
})

describe('final-reply handoff', () => {
  it('keeps the turn running so the model can write the final answer', async () => {
    const { host, agent } = hostFixture()
    let concluded = false
    const tool = createShowViewTool(host, new Map()) as {
      execute(args: unknown, exec: unknown): Promise<Record<string, unknown>>
      output: { presentationMeta(args: unknown, value: unknown): unknown }
    }
    const args = { title: 'Choose', view: interactiveView }
    const value = await tool.execute(args, { agent, callId: 'c', concludeTurn() { concluded = true } })
    expect(concluded).toBe(false)
    expect(value.summary).toContain('Finish with a concise final answer')
    expect(value.summary).not.toContain('on screen')
    // The host snapshots presentationMeta as JSON on every result; undefined would fail the call.
    expect(tool.output.presentationMeta(args, { ...value, status: 'invalid' })).toBeNull()
  })
  it('sends only readable, validated field and input values', async () => {
    const { host, messages } = hostFixture()
    const view = { type: 'stack' as const, children: [
      { type: 'number' as const, id: 'price', label: '单价', value: 4 },
      { type: 'form' as const, id: 'order', fields: [{ id: 'name', label: '姓名' }] },
    ] }
    const pending = new Map([['session-test', { id: 'v', sessionId: 'session-test', title: '订单', view }]])
    const rpc = createRpc(host, pending)
    expect(await rpc('reply', { sessionId: 'session-test', viewId: 'v', action: 'order',
      values: { fields: { name: '张三' }, inputs: { price: 8 } } }, new AbortController().signal)).toMatchObject({ ok: true })
    expect(messages[0]).toMatchObject({ content: [{ text: '订单\n姓名: 张三\n单价=8' }] })
  })
  it('hands an unanswered card over across chained segment rollovers and routes stale or current session replies', async () => {
    const messages: unknown[] = []
    const nextAgent = { id: 'seg-3', session: { id: 'seg-3' }, followup(message: unknown) { messages.push(message) } }
    const host = {
      agents: { get: (id: string) => id === nextAgent.id ? nextAgent : undefined, roots: () => [nextAgent] },
      sessionController: { resolveAgent: async () => ({}) },
      sessions: { flush: async () => true },
      tools: { get: () => undefined, register: () => () => {} },
    }
    const pending = new Map([['seg-1', { id: 'view-1', sessionId: 'seg-1', callId: 'call-1', title: '确认方案', view: interactiveView }]])
    const redirects = new Map<string, string>()
    expect(handoffPendingSession(pending, redirects, 'seg-1', 'seg-2')).toBe(true)
    expect(handoffPendingSession(pending, redirects, 'seg-2', 'seg-3')).toBe(true)
    expect(resolveSessionId(redirects, 'seg-1')).toBe('seg-3')
    expect(pending.has('seg-1')).toBe(false)
    expect(pending.get('seg-3')).toMatchObject({ id: 'view-1', sessionId: 'seg-3', callId: 'call-1' })

    const rpc = createRpc(host as never, pending, redirects)
    expect(await rpc('pending', { sessionId: 'seg-3', callId: 'call-1' }, new AbortController().signal))
      .toMatchObject({ ok: true, value: { id: 'view-1', sessionId: 'seg-3' } })
    // Even an in-flight reply carrying the pre-rollover sessionId resolves cleanly to seg-3.
    expect(await rpc('reply', { sessionId: 'seg-1', viewId: 'view-1', action: 'pick', values: { selected: ['Two'] } }, new AbortController().signal))
      .toMatchObject({ ok: true, value: { answered: true } })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      content: [{ text: '确认方案\nTwo' }],
      source: { kind: 'user', deepView: { answer: { id: 'view-1', action: 'pick', values: { selected: ['Two'] } } } },
    })
    expect(pending.size).toBe(0)
  })
})
