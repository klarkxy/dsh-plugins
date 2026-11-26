import { describe, expect, it } from 'vitest'
import { assertObjectJsonSchema, projectToolSchema, validateJsonSchemaValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createAskViewTool, createRpc, createShowViewTool, handoffPendingSession, resolveSessionId, apply, type PendingWaiter } from './index.ts'
import { DEEP_VIEW_SKILL, DEEP_VIEW_SKILL_DESCRIPTION } from './skill.ts'

function hostFixture(options: { flush?: () => Promise<boolean>; followup?: (message: unknown) => void } = {}) {
  const agent = { id: 'session-test', session: { id: 'session-test', header: {} as Record<string, unknown> }, followup(message: unknown) { messages.push(message); options.followup?.(message) } }
  const messages: unknown[] = []
  const host = {
    agents: { get: (id: string) => id === agent.id ? agent : undefined, roots: () => [agent] },
    sessionController: { resolveAgent: async (id: string) => ({ agent: id === agent.id ? agent : undefined }) },
    sessions: { flush: options.flush ?? (async () => true) },
    tools: { get: () => undefined, register: () => () => {} },
    systemPrompt: { context: () => () => {} },
  }
  return { host: host as never, agent, messages }
}
const interactiveView = { type: 'options', id: 'pick', options: [{ label: 'One' }, { label: 'Two' }] }
describe('Deep View skill', () => {
  it('registers the advanced reference without embedding its instructions in the tool schema', async () => {
    const registrations: Record<string, unknown>[] = []
    const disposers: Array<() => void> = []
    const { host } = hostFixture()
    const ctx = host as never as {
      effect(setup: () => () => void): void
      provide(): void
      on(): void
    }
    ctx.effect = setup => { disposers.push(setup()) }
    ctx.provide = () => {}
    ctx.on = () => () => {}
    ;(host as never as { skills: { register(skill: Record<string, unknown>): () => void } }).skills = {
      register(skill) { registrations.push(skill); return () => {} },
    }
    ;(host as never as { webServer: { register(): () => void } }).webServer = { register: () => () => {} }
    await apply(ctx as never)
    expect(registrations).toHaveLength(1)
    expect(registrations[0]).toMatchObject({
      name: 'deep-view', description: DEEP_VIEW_SKILL_DESCRIPTION, content: DEEP_VIEW_SKILL,
      source: 'runtime', invocation: { modelInvocable: true, userInvocable: true },
    })
    expect(DEEP_VIEW_SKILL).toContain('Render specialized rich canvases')
    expect(registrations[0]!.description).not.toContain('ViewNode')
    const tool = createShowViewTool(host, new Map())
    expect(JSON.stringify(tool)).not.toContain('For a workflow')
    for (const dispose of disposers) dispose()
  })
})
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
  it('updates complete immutable snapshots, rejects stale revisions and accepts the current answer', async () => {
    const { host, agent, messages } = hostFixture()
    const pending = new Map()
    const latest = new Map()
    const tool = createShowViewTool(host, pending, () => 'revisions', undefined, latest) as { execute(args: unknown, exec: unknown): Promise<Record<string, unknown>>; output: { presentationMeta(args: unknown, value: unknown): unknown } }
    const exec = { agent, callId: 'r1', concludeTurn() {} }
    const first = await tool.execute({ title: 'Choose', view: interactiveView }, exec)
    expect(first).toMatchObject({ revision: 1, status: 'pending' })
    const stale = await tool.execute({ view_id: 'revisions', view: interactiveView, base_revision: 0 }, { ...exec, callId: 'stale' })
    expect(stale.status).toBe('stale')
    expect(pending.get('session-test')).toMatchObject({ revision: 1, callId: 'r1' })
    const secondView = { ...interactiveView, options: [{ label: 'Two' }] }
    const second = await tool.execute({ view_id: 'revisions', view: secondView, base_revision: 1 }, { ...exec, callId: 'r2' })
    expect(second).toMatchObject({ revision: 2, status: 'pending' })
    expect(first).not.toBe(second)
    expect(tool.output.presentationMeta({}, first)).toMatchObject({ revision: 1, view: interactiveView })
    expect(tool.output.presentationMeta({}, second)).toMatchObject({ revision: 2, view: secondView })
    const rpc = createRpc(host, pending)
    expect(await rpc('reply', { sessionId: 'session-test', viewId: 'revisions', action: 'pick', values: { selected: ['Two'] }, revision: 1 }, new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'stale' } })
    expect(await rpc('reply', { sessionId: 'session-test', viewId: 'revisions', action: 'pick', values: { selected: ['Two'] }, revision: 2 }, new AbortController().signal)).toMatchObject({ ok: true })
    expect((messages[0] as { source: { deepView: { answer: unknown } } }).source.deepView.answer).toMatchObject({ revision: 2 })
    expect(await tool.execute({ view_id: 'revisions', view: secondView, base_revision: 2 }, { ...exec, callId: 'r3' })).toMatchObject({ status: 'stale' })
  })
  it('rejects changing answer controls during a revision', async () => {
    const { host, agent } = hostFixture()
    const pending = new Map()
    const tool = createShowViewTool(host, pending, () => 'fixed') as { execute(args: unknown, exec: unknown): Promise<Record<string, unknown>> }
    const exec = { agent, callId: 'r1', concludeTurn() {} }
    await tool.execute({ title: 'Choose', view: interactiveView }, exec)
    expect(await tool.execute({ view_id: 'fixed', base_revision: 1, view: { type: 'text', text: 'Done' } }, exec)).toMatchObject({ status: 'invalid' })
    expect(pending.get('session-test')).toMatchObject({ revision: 1 })
  })
  it('uses persisted root metadata when rc.3 only exposes agents.list()', async () => {
    const { host, agent, messages } = hostFixture()
    const agents = (host as never as { agents: { roots?: () => unknown[]; list?: () => unknown[] } }).agents
    delete agents.roots
    agents.list = () => [agent]
    const pending = new Map()
    const tool = createShowViewTool(host, pending, () => 'view-list') as { execute(args: unknown, exec: unknown): Promise<Record<string, unknown>> }
    const value = await tool.execute({ title: 'Choose', view: interactiveView }, { agent, callId: 'call-list' })
    expect(value).toMatchObject({ status: 'pending', viewId: 'view-list' })
    const rpc = createRpc(host, pending)
    expect(await rpc('reply', { sessionId: 'session-test', viewId: 'view-list', action: 'pick', values: { selected: ['One'] } }, new AbortController().signal)).toMatchObject({ ok: true })
    expect(messages).toHaveLength(1)
  })
  it.each([
    { origin: 'subagent', parentSession: 'lead', delegationDepth: 1 },
    { origin: 'subagent' },
    { parentSession: 'lead', delegationDepth: 1 },
  ])('rejects delegated agents listed alongside roots: %j', async header => {
    const { host, agent, messages } = hostFixture()
    agent.session.header = header
    const agents = (host as never as { agents: { roots?: () => unknown[]; list?: () => unknown[] } }).agents
    delete agents.roots
    agents.list = () => [agent]
    const pending = new Map()
    const tool = createShowViewTool(host, pending, () => 'child-view') as { execute(args: unknown, exec: unknown): Promise<Record<string, unknown>> }
    expect(await tool.execute({ view: interactiveView }, { agent })).toMatchObject({ status: 'invalid' })
    expect(pending.size).toBe(0)
    // A previously saved pending record cannot bypass the same reply boundary.
    pending.set(agent.id, { id: 'child-view', sessionId: agent.id, title: '', view: interactiveView })
    expect(await createRpc(host, pending)('reply', {
      sessionId: agent.id, viewId: 'child-view', action: 'pick', values: { selected: ['One'] },
    }, new AbortController().signal)).toMatchObject({ ok: false })
    expect(messages).toHaveLength(0)
  })
  it('admits a human fork and refuses missing metadata without a roots API', async () => {
    const { host, agent } = hostFixture()
    delete (host as never as { agents: { roots?: () => unknown[] } }).agents.roots
    const tool = createShowViewTool(host, new Map()) as { execute(args: unknown, exec: unknown): Promise<Record<string, unknown>> }
    agent.session.header = { parentSession: 'previous', isSeeded: true, classification: 'ordinary' }
    expect(await tool.execute({ view: interactiveView }, { agent })).toMatchObject({ status: 'pending' })
    delete (agent.session as { header?: unknown }).header
    expect(await tool.execute({ view: interactiveView }, { agent })).toMatchObject({ status: 'invalid' })
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
    const { host } = hostFixture({ followup: () => { throw new Error('session closed') } })
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
    expect(handoffPendingSession(pending as never, redirects, 'seg-1', 'seg-2')).toBe(true)
    expect(handoffPendingSession(pending as never, redirects, 'seg-2', 'seg-3')).toBe(true)
    expect(resolveSessionId(redirects, 'seg-1')).toBe('seg-3')
    expect(pending.has('seg-1')).toBe(false)
    expect(pending.get('seg-3')).toMatchObject({ id: 'view-1', sessionId: 'seg-3', callId: 'call-1' })

    const rpc = createRpc(host as never, pending as never, redirects)
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

describe('ask_view synchronous & deferrable Host boundary', () => {
  it('exports a valid model-facing schema and rejects display-only or non-root calls', async () => {
    const { host, agent } = hostFixture()
    const tool = createAskViewTool(host, new Map()) as unknown as ToolDefinition & { execute(args: unknown, exec: unknown): Promise<Record<string, unknown>> }
    const { parameters } = JSON.parse(JSON.stringify(projectToolSchema(tool, true)))
    assertObjectJsonSchema(parameters)
    expect(parameters.required).toEqual(['view'])
    expect(await tool.execute({ view: { type: 'metric', label: 'M', value: 1 } }, { agent, concludeTurn() {} })).toMatchObject({ status: 'invalid', awaitReply: false })
    expect(await tool.execute({ view: interactiveView }, { agent: undefined, concludeTurn() {} })).toMatchObject({ status: 'invalid', awaitReply: false })
  })

  it('suspends until reply RPC and resolves in-turn without followup messages, persisting meta.answer', async () => {
    const { host, agent, messages } = hostFixture()
    const pending = new Map()
    const waiters = new Map<string, PendingWaiter>()
    const latest = new Map()
    const tool = createAskViewTool(host, pending, waiters, () => 'ask-sync', undefined, latest) as {
      execute(args: unknown, exec: unknown): Promise<Record<string, unknown>>
      output: { presentationMeta(args: unknown, value: unknown): unknown }
    }
    const rpc = createRpc(host, pending, new Map(), undefined, waiters, latest)
    const execution = tool.execute({ title: '确认模块', view: interactiveView }, { agent, callId: 'call-ask', concludeTurn() {} })
    expect(pending.get('session-test')).toMatchObject({ id: 'ask-sync', blocking: true })
    expect(waiters.has('ask-sync')).toBe(true)

    const replyRes = await rpc('reply', {
      sessionId: 'session-test', viewId: 'ask-sync', revision: 1, action: 'pick', values: { selected: ['Two'] },
    }, new AbortController().signal)
    expect(replyRes).toMatchObject({ ok: true, value: { answered: true, resumed: true } })
    expect(messages).toHaveLength(0)

    const result = await execution
    expect(result).toMatchObject({
      owner: 'dsh-deep-view',
      status: 'answered',
      viewId: 'ask-sync',
      awaitReply: true,
      action: 'pick',
      values: { selected: ['Two'] },
      answer: '确认模块\nTwo',
    })
    expect(tool.output.presentationMeta({}, result)).toMatchObject({
      owner: 'dsh-deep-view',
      viewId: 'ask-sync',
      awaitReply: true,
      answer: { id: 'ask-sync', action: 'pick', values: { selected: ['Two'] }, revision: 1 },
    })
  })

  it('downgrades blocking ask_view to async pending on defer RPC and later delivers followup on reply', async () => {
    const { host, agent, messages } = hostFixture()
    const pending = new Map()
    const waiters = new Map<string, PendingWaiter>()
    const latest = new Map()
    const tool = createAskViewTool(host, pending, waiters, () => 'ask-defer', undefined, latest) as { execute(args: unknown, exec: unknown): Promise<Record<string, unknown>> }
    const rpc = createRpc(host, pending, new Map(), undefined, waiters, latest)
    const execution = tool.execute({ title: '稍后决定', view: interactiveView }, { agent, callId: 'call-defer', concludeTurn() {} })

    const deferRes = await rpc('defer', { sessionId: 'session-test', viewId: 'ask-defer' }, new AbortController().signal)
    expect(deferRes).toMatchObject({ ok: true, value: { deferred: true } })
    const resolved = await execution
    expect(resolved).toMatchObject({ status: 'pending', viewId: 'ask-defer', awaitReply: true })
    expect(pending.get('session-test')).toMatchObject({ id: 'ask-defer', blocking: false })

    expect(await rpc('reply', {
      sessionId: 'session-test', viewId: 'ask-defer', revision: 1, action: 'pick', values: { selected: ['One'] },
    }, new AbortController().signal)).toMatchObject({ ok: true, value: { answered: true } })
    expect(messages).toHaveLength(1)
  })

  it('cleans up waiters on dismiss, abort signal and optional replaceNativeAskUser config', async () => {
    const { host, agent } = hostFixture()
    const pending = new Map()
    const waiters = new Map<string, PendingWaiter>()
    const tool = createAskViewTool(host, pending, waiters, () => 'ask-cancel') as { execute(args: unknown, exec: unknown): Promise<Record<string, unknown>> }
    const controller = new AbortController()
    const abortedRun = tool.execute({ view: interactiveView }, { agent, signal: controller.signal, concludeTurn() {} })
    controller.abort()
    expect(await abortedRun).toMatchObject({ status: 'cancelled', awaitReply: false })
    expect(waiters.size).toBe(0)
    expect(pending.size).toBe(0)

    const restricted: unknown[] = []
    const disposers: Array<() => void> = []
    const ctx = host as never as Record<string, unknown>
    ctx.effect = (setup: () => () => void) => { disposers.push(setup()) }
    ctx.provide = () => {}
    ctx.on = () => () => {}
    ;(host as never as { skills: { register(): () => void } }).skills = { register: () => () => {} }
    ;(host as never as { webServer: { register(): () => void } }).webServer = { register: () => () => {} }
    ;(host as never as { tools: { restrict(rule: unknown): () => void } }).tools.restrict = rule => { restricted.push(rule); return () => {} }
    await apply(ctx as never, { replaceNativeAskUser: true })
    expect(restricted).toEqual([{ deny: ['ask_user_question'] }])
    for (const d of disposers) d()
  })
})
