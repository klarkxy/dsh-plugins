import { resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Query from '@deepseek-ai/dsh-session-query'
import Tools, { projectToolSchema } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline, executeToolBatch } from '@deepseek-ai/dsh-tools/pipeline'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig, type Config } from './contracts.ts'
import { createCursorKey } from './cursor.ts'
import { registerSessionTools } from './tools.ts'

// Only prompt assembly is stubbed. Registration, schema validation, dispatch,
// sessions, observations and queries use the official host implementations.
class PromptStub extends Service {
  constructor(ctx: Context) { super(ctx, 'systemPrompt') }
  tools() { return () => {} }
}
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function fixture(config: Config = {}, services?: Record<string, unknown>) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(PromptStub)
  await ctx.plugin(Tools)
  await ctx.plugin(Sessions)
  await ctx.plugin(Query)
  if (services !== undefined) {
    const base = ctx.get.bind(ctx)
    ctx.get = ((name: string) => services[name] ?? base(name)) as typeof ctx.get
  }
  // The registry only dispatches to a mounted executor now. Install the same
  // executor the native deployment composes — the official batch scheduler
  // over the shared pipeline, built from the public dsh-tools/pipeline entry
  // so no extra dependency is needed.
  const pipeline = new ToolExecutionPipeline(ctx)
  ctx.effect(() => ctx.tools.setExecutor({
    describe: definitions => ({ schemas: definitions.map(definition => projectToolSchema(definition, false)) }),
    execute: input => executeToolBatch(input, pipeline, () => 10),
  }))
  let unregisterTools: (() => void) | undefined
  ctx.effect(() => unregisterTools = registerSessionTools(ctx, resolveConfig({ pageChars: 1_000, ...config }), createCursorKey()))
  const root = ctx.sessions.create(SessionId('root'), { meta: { cwd: resolve('a') } })
  const child = ctx.sessions.create(SessionId('child'), { meta: { cwd: resolve('b'), parentSession: root.id } })
  for (const session of [root, child]) {
    session.append('turn/start', { turn: 1 })
    session.append('user/message', { id: 'u', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'alpha '.repeat(500) }] }, { surfaceOp: 'append' })
    session.append('tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c', content: [{ type: 'text', text: 'x'.repeat(180) }] } }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ;(session.append as (type: string, data: unknown) => void)('session/title', { title: 'alpha', messageSeqs: [], source: { kind: 'user' } })
  }
  let calls = 0
  const execute = async (name: string, args: Record<string, unknown>, agent?: unknown) => {
    const batch = await ctx.tools.execute({
      calls: [{ type: 'tool-call', id: `call-${++calls}` as ToolCallId, name, arguments: JSON.stringify(args) }],
      signal: new AbortController().signal,
      ...agent === undefined ? {} : { agent: agent as never },
    })
    const outcome = batch.results[0]
    if (outcome === undefined) throw new Error(`tool call "${name}" produced no result`)
    return outcome.result
  }
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await execute(name, args)
    expect(result.isError).not.toBe(true)
    expect(typeof result.value).toBe('string')
    return JSON.parse(result.value as string)
  }
  const nullable = (name: string) => {
    const schema = ctx.tools.get(name)!.parameters as { properties: Record<string, unknown>; required?: string[] }
    return Object.fromEntries(Object.keys(schema.properties).filter(key => !schema.required?.includes(key)).map(key => [key, null]))
  }
  return { ctx, root, child, call, execute, nullable, unregisterTools: () => unregisterTools!() }
}

const ids = (result: { items: { sessionId: string }[] }) => result.items.map(item => item.sessionId).sort()

describe('registered session tools and nullable optional arguments', () => {
  it('retains read-only effect evidence on the final registered definitions', async () => {
    const { ctx } = await fixture()
    for (const name of ['list_sessions', 'search_sessions', 'read_session']) {
      // The thread-management host consumes this exact property. Standard
      // defineTool does not carry custom options into the final definition.
      const tool = ctx.tools.get(name) as unknown as { hostEffect?: string }
      expect(tool.hostEffect).toBe('read-only')
    }
  })

  it('publishes nullable optional scalars without changing required arguments, and accepts an all-null first read', async () => {
    const { ctx, call, nullable } = await fixture()
    for (const [name, required] of [['list_sessions', []], ['search_sessions', ['query']], ['read_session', ['session_id']]] as const) {
      const schema = ctx.tools.get(name)!.parameters as { properties: Record<string, { oneOf?: unknown[] }>; required?: string[] }
      expect(schema.required ?? []).toEqual(required)
      for (const [key, property] of Object.entries(schema.properties)) {
        if (!(required as readonly string[]).includes(key)) expect(property.oneOf).toContainEqual({ type: 'null' })
      }
    }
    const omitted = await call('read_session', { session_id: 'root' })
    expect(omitted.status).toBe('ok')
    expect(await call('read_session', { ...nullable('read_session'), session_id: 'root' })).toEqual(omitted)
    for (const summarize of [null, false]) {
      expect(await call('read_session', { ...nullable('read_session'), session_id: 'root', mode: 'handoff', summarize })).toMatchObject({ status: 'ok', handoff: { source: 'extractive', summaryStatus: 'not-requested' } })
    }
    expect(await call('list_sessions', nullable('list_sessions'))).toEqual(await call('list_sessions', {}))
    // The standard host may disable content search. Null must preserve that typed outcome too.
    expect(await call('search_sessions', { ...nullable('search_sessions'), query: 'alpha' })).toEqual(await call('search_sessions', { query: 'alpha' }))
    expect(ids(await call('search_sessions', { ...nullable('search_sessions'), scope: 'title', query: 'alpha' }))).toEqual(['child', 'root'])
  })

  it('keeps real list/search filters, false and epoch zero rather than treating them as placeholders', async () => {
    const { call, nullable } = await fixture()
    for (const name of ['list_sessions', 'search_sessions']) {
      const base = { ...nullable(name), ...name === 'search_sessions' ? { query: 'alpha', scope: 'title' } : {} }
      expect(ids(await call(name, { ...base, cwd: resolve('b') }))).toEqual(['child'])
      expect(ids(await call(name, { ...base, parent_session_id: 'root', include_roots: false }))).toEqual(['child'])
      expect(ids(await call(name, { ...base, parent_session_id: 'root', include_roots: true }))).toEqual(['child', 'root'])
      expect(ids(await call(name, { ...base, created_from: 0 }))).toEqual(['child', 'root'])
      expect(ids(await call(name, { ...base, created_to: 0 }))).toEqual([])
      expect(await call(name, { ...base, cwd: '' })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_FILTER' })
      expect(await call(name, { ...base, parent_session_id: '' })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_FILTER' })
      expect(await call(name, { ...base, limit: 0 })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_LIMIT' })
    }
    expect(await call('search_sessions', { query: '' })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_QUERY' })
    expect(await call('read_session', { session_id: '' })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_FILTER' })
    expect(await call('list_sessions', { session_id: '' })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_FILTER' })
  })

  it('diagnoses the original screenshot call before reading and never discards seq', async () => {
    const { ctx, call } = await fixture()
    const observe = vi.spyOn(ctx.sessionQuery, 'observeSession')
    const result = await call('read_session', {
      cursor: '', include_reasoning: false, include_tool_detail: false, limit: 1,
      mode: 'conversation', model_surface: false, seq: 1, session_id: 'root', snapshot: '', summarize: false, turn_id: '',
    })
    expect(result).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_FILTER', message: expect.stringContaining('seq requires mode="details"') })
    expect(observe).not.toHaveBeenCalled()
    expect(await call('read_session', { session_id: 'root', seq: 0 })).toMatchObject({ code: 'SESSION_QUERY_INVALID_FILTER', message: expect.stringContaining('seq') })
    const detail = await call('read_session', { session_id: 'root', mode: 'details', seq: 0 })
    expect(detail).toMatchObject({ status: 'ok', items: [{ seq: 0, eventType: 'turn/start' }] })
    const full = await call('read_session', { session_id: 'root', mode: 'details', seq: 2 })
    const short = await call('read_session', { session_id: 'root', mode: 'details', seq: 2, include_tool_detail: false })
    expect(full.items[0]).toMatchObject({ seq: 2, text: 'x'.repeat(180) })
    expect(short.items[0].seq).toBe(2)
    expect(short.items[0].text.length).toBeLessThan(full.items[0].text.length)
    expect(short.items[0].text.endsWith('…')).toBe(true)
    expect(await call('read_session', { session_id: 'root', include_tool_detail: false })).toMatchObject({ code: 'SESSION_QUERY_INVALID_FILTER', message: expect.stringContaining('include_tool_detail') })
  })

  it('rejects empty and forged continuation tokens with a field and recovery instruction', async () => {
    const { call } = await fixture()
    for (const field of ['cursor', 'snapshot']) {
      for (const token of ['', ' ', 'forged.token']) {
        const result = await call('read_session', { session_id: 'root', [field]: token })
        expect(result).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_CURSOR' })
        expect(result.message).toContain(field)
        expect(result.message).toContain('null')
      }
    }
    for (const name of ['list_sessions', 'search_sessions']) {
      expect(await call(name, { ...name === 'search_sessions' ? { query: 'alpha', scope: 'title' } : {}, cursor: '' })).toMatchObject({ code: 'SESSION_QUERY_INVALID_CURSOR', message: expect.stringContaining('cursor') })
    }
  })

  it('retains schema validation for required nulls, invalid enums and wrong scalar types', async () => {
    const { execute } = await fixture()
    for (const [name, args] of [
      ['read_session', { session_id: null }], ['search_sessions', { query: null }],
      ['read_session', { session_id: 'root', mode: 'invented' }],
      ['search_sessions', { query: 'alpha', scope: 'invented' }],
      ['read_session', { session_id: 'root', seq: '1' }],
      ['list_sessions', { include_roots: 'false' }],
    ] as const) {
      expect(await execute(name, args)).toMatchObject({ isError: true, error: { info: { code: 'INVALID_ARGS' } } })
    }
  })
})

describe('agent action tools follow their own switches', () => {
  it.each([
    [false, false, []],
    [true, false, ['fork_session']],
    [false, true, ['send_session_message']],
    [true, true, ['fork_session', 'send_session_message']],
  ] as const)('registers only the enabled tools (allowSelfFork=%s, allowSendMessage=%s)', async (fork, send, expected) => {
    const { ctx } = await fixture({ allowSelfFork: fork, allowSendMessage: send })
    const names = ctx.tools.schemas().map(schema => schema.name)
    for (const read of ['list_sessions', 'search_sessions', 'read_session']) {
      expect(names).toContain(read)
    }
    for (const write of ['fork_session', 'send_session_message']) {
      expect(names.includes(write)).toBe(expected.includes(write))
    }
    if (expected.includes('fork_session')) {
      const schema = ctx.tools.get('fork_session')!.parameters as { properties: Record<string, unknown>; required?: string[] }
      expect(schema.required).toEqual(['prompt'])
    }
    if (expected.includes('send_session_message')) {
      const schema = ctx.tools.get('send_session_message')!.parameters as { properties: Record<string, unknown>; required?: string[] }
      expect(schema.required?.sort()).toEqual(['message', 'session_id'])
    }
  })

  it('fails closed on an absent caller and on missing host services, without touching the caller log', async () => {
    const { ctx, root, execute } = await fixture({ allowSelfFork: true, allowSendMessage: true })
    const callerAgent = { session: root }
    const eventCount = root.snapshotEvents().length
    const noCaller = JSON.parse((await execute('fork_session', { prompt: 'go' })).value as string)
    expect(noCaller).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_INVALID' })
    const noService = JSON.parse((await execute('fork_session', { prompt: 'go' }, callerAgent)).value as string)
    expect(noService).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_UNAVAILABLE' })
    const noSendService = JSON.parse((await execute('send_session_message', { session_id: 'other', message: 'hi' }, callerAgent)).value as string)
    expect(noSendService).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_UNAVAILABLE' })
    expect(root.snapshotEvents().length).toBe(eventCount)
    expect(ctx.tools.get('fork_session') as unknown as { hostEffect?: string }).not.toMatchObject({ hostEffect: 'read-only' })
  })

  it('forks the caller\'s latest seq and relays the prompt through followup, without the send switch', async () => {
    const followup = vi.fn()
    const sessionController = {
      fork: vi.fn(async () => ({ sessionId: 'child-1' })),
      resolveAgent: vi.fn(async () => ({ agent: { followup } })),
    }
    const { ctx, execute, root } = await fixture(
      { allowSelfFork: true, allowSendMessage: false },
      { sessionController, workspaceRegistry: { archivedSessionIds: [] } },
    )
    expect(ctx.tools.get('send_session_message')).toBeUndefined()
    const atSeq = root.snapshotEvents().at(-1)!.seq
    const outcome = JSON.parse((await execute('fork_session', { prompt: 'audit' }, { session: root })).value as string)
    expect(outcome).toMatchObject({ status: 'ok', sessionId: 'child-1' })
    expect(sessionController.fork).toHaveBeenCalledWith({ sessionId: 'root', atSeq })
    expect(followup).toHaveBeenCalledOnce()
    const message = followup.mock.calls[0]![0] as { source: Record<string, unknown>; content: { text: string }[] }
    expect(message.source).toMatchObject({ kind: 'agent-message', form: 'relay', senderSessionId: 'root' })
  })

  it('delivers an attributed message to a resolvable unarchived target', async () => {
    const followup = vi.fn()
    const sessionController = {
      resolveAgent: vi.fn(async () => ({ agent: { followup } })),
    }
    const { execute, root } = await fixture(
      { allowSendMessage: true },
      { sessionController, workspaceRegistry: { archivedSessionIds: [] } },
    )
    const outcome = JSON.parse((await execute('send_session_message', { session_id: 'child', message: 'ping' }, { session: root })).value as string)
    expect(outcome).toMatchObject({ status: 'ok', sessionId: 'child' })
    expect(sessionController.resolveAgent).toHaveBeenCalledWith('child')
    const message = followup.mock.calls[0]![0] as { source: Record<string, unknown>; content: { text: string }[] }
    expect(message.source).toMatchObject({ kind: 'agent-message', form: 'relay', senderSessionId: 'root' })
    expect(message.content[0]).toEqual({ type: 'text', text: 'Agent root sent a message: ping' })
  })

  it('refuses an archived target without resolving it', async () => {
    const resolveAgent = vi.fn()
    const { execute, root } = await fixture(
      { allowSendMessage: true },
      { sessionController: { resolveAgent }, workspaceRegistry: { archivedSessionIds: ['child'] } },
    )
    const outcome = JSON.parse((await execute('send_session_message', { session_id: 'child', message: 'ping' }, { session: root })).value as string)
    expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_ARCHIVED' })
    expect(resolveAgent).not.toHaveBeenCalled()
  })

  it('a stale definition captured before unload cannot deliver after dispose', async () => {
    const followup = vi.fn()
    const resolveAgent = vi.fn(async () => ({ agent: { followup } }))
    const { ctx, execute, root, unregisterTools } = await fixture(
      { allowSendMessage: true },
      { sessionController: { resolveAgent }, workspaceRegistry: { archivedSessionIds: [] } },
    )
    const definition = ctx.tools.get('send_session_message') as unknown as {
      execute: (args: unknown, exec: unknown) => Promise<string>
    }
    expect(definition).toBeDefined()
    // Capture a live definition, then unload: the in-flight resolve settles
    // after the lifetime aborts, and the delivery must not happen.
    const pending = definition.execute(
      { session_id: 'child', message: 'ping' },
      { agent: { session: root }, signal: new AbortController().signal },
    )
    unregisterTools()
    const outcome = JSON.parse(await pending)
    expect(outcome).toMatchObject({ status: 'failed' })
    expect(followup).not.toHaveBeenCalled()
    // A second call on the same stale definition fails closed too.
    const second = JSON.parse(await definition.execute(
      { session_id: 'child', message: 'ping' },
      { agent: { session: root }, signal: new AbortController().signal },
    ))
    expect(second).toMatchObject({ status: 'failed' })
    expect(followup).not.toHaveBeenCalled()
    void execute
  })
})
