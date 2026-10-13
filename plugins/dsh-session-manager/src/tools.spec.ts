import { resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Query from '@deepseek-ai/dsh-session-query'
import Tools from '@deepseek-ai/dsh-tools'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from './contracts.ts'
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

async function fixture() {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(PromptStub)
  await ctx.plugin(Tools)
  await ctx.plugin(Sessions)
  await ctx.plugin(Query)
  ctx.effect(() => registerSessionTools(ctx, resolveConfig({ pageChars: 1_000 }), createCursorKey()))
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
  const execute = (name: string, args: Record<string, unknown>) => ctx.tools.execute({
    callId: `call-${++calls}` as ToolCallId, name, arguments: args, signal: new AbortController().signal,
  })
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
  return { ctx, root, child, call, execute, nullable }
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
