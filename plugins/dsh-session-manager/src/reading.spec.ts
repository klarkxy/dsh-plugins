import { Context } from '@deepseek-ai/cordis'
import Sessions, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import Query from '@deepseek-ai/dsh-session-query'
import { afterEach, describe, expect, it } from 'vitest'
import { readSession } from './query.ts'
import { resolveConfig } from './contracts.ts'
import { createCursorKey } from './cursor.ts'
import { projectTurns, pageTurns } from './turns.ts'
import { extractHandoff, nativeHandoffSummarizer } from './handoff.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
async function fixture(pageChars = 4_000) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Sessions); await ctx.plugin(Query)
  const session = ctx.sessions.create(SessionId('reading'), { meta: { cwd: 'H:/fixture' } })
  const config = resolveConfig({ pageChars }), key = createCursorKey()
  const read = (request: Record<string, unknown> = {}) => readSession(ctx.sessionQuery as never, { sessionId: session.id, ...request }, {}, config, key)
  return { ctx, session, read, config, key }
}
function request(session: Session, text: string, source: 'user' | 'inject' = 'user') {
  return session.append('user/message', { id: `u${session.snapshotEvents().length}`, role: 'user', source: { kind: source } as never, content: [{ type: 'text', text }] }, { surfaceOp: 'append' })
}
function response(session: Session, turn: number, text: string, interrupted = false, tools = false) {
  return session.append('assistant/message', { turn, step: 1, stream: [],
    ...interrupted ? { interrupted: true as const } : {},
    message: { id: `a${turn}`, role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text }, ...tools ? [{ type: 'tool-call' as const, id: `c${turn}`, name: 'write_file', arguments: '{"path":"file.txt"}' }] : []] },
  }, { surfaceOp: 'append' })
}
function finish(session: Session, turn: number, kind = 'completed') {
  return session.append('turn/end', { turn, reason: { kind, ...kind === 'error' ? { error: { message: 'failed', code: 'MOCK' } } : {} } } as never)
}

describe('three-layer session reading on the standard host', () => {
  it('defaults to recent complete turns with requests, conclusions and states instead of tool logs', async () => {
    const { session, read } = await fixture()
    session.append('turn/start', { turn: 1 }); request(session, 'Old request'); response(session, 1, 'Old outcome'); finish(session, 1)
    session.append('turn/start', { turn: 2 }); request(session, 'Change the menu'); request(session, 'Injected diagnostics', 'inject')
    response(session, 2, 'I will inspect', false, true)
    session.append('tool/call', { turn: 2, step: 1, callId: 'c2', name: 'write_file', arguments: '{"secretFixture":"raw arguments"}' })
    session.append('tool/result', { turn: 2, step: 1, message: { role: 'tool', toolCallId: 'c2', content: [{ type: 'text', text: 'RAW LOG '.repeat(2_000) }] } }, { surfaceOp: 'append' })
    response(session, 2, 'Menu changed; tests passed'); finish(session, 2)
    const result = await read()
    expect(result).toMatchObject({ status: 'ok', mode: 'conversation', view: 'turns' })
    const turns = (result as any).turns
    expect(turns.map((turn: any) => turn.number)).toEqual([2, 1])
    expect(turns[0]).toMatchObject({ state: 'completed', toolCalls: 1, requests: [{ text: 'Change the menu' }], context: [{ text: 'Injected diagnostics' }], conclusion: { text: 'Menu changed; tests passed' } })
    expect(JSON.stringify(result)).not.toContain('RAW LOG')
    expect(JSON.stringify(result)).not.toContain('raw arguments')
    expect(result).not.toHaveProperty('items')
  })

  it.each(['aborted', 'blocked', 'error', 'max-tokens', 'interrupted', 'forked', 'open'])('keeps %s separate from task completion and final conclusions', async kind => {
    const { session, read } = await fixture()
    session.append('turn/start', { turn: 1 }); request(session, 'Do the work'); response(session, 1, 'Still working', kind === 'aborted')
    if (kind !== 'open') finish(session, 1, kind)
    const turn = (await read() as any).turns[0]
    expect(turn.state).toBe(kind === 'open' ? 'in-progress' : kind)
    expect(turn.conclusion).toBeUndefined()
    expect(turn.partialResponse.text).toBe('Still working')
  })

  it('handles no-step, unknown legacy history and explicitly interrupted assistant messages', async () => {
    const { session, read } = await fixture()
    request(session, 'Legacy request'); response(session, 0, 'Legacy response')
    session.append('turn/start', { turn: 1 }); finish(session, 1, 'blocked')
    session.append('turn/start', { turn: 2 }); request(session, 'A request'); response(session, 2, 'Prefix', true); finish(session, 2)
    const turns = (await read() as any).turns
    expect(turns[0]).toMatchObject({ state: 'completed', partialResponse: { text: 'Prefix' } })
    expect(turns[0].conclusion).toBeUndefined()
    expect(turns[1]).toMatchObject({ state: 'blocked', requests: [] })
    expect(turns[2]).toMatchObject({ state: 'unknown', boundary: 'legacy', partialResponse: { text: 'Legacy response' } })
  })

  it('keeps an oversized failure readable through a bounded preview and original state reference', async () => {
    const { session, read } = await fixture()
    session.append('turn/start', { turn: 1 }); request(session, 'Failed work')
    const message = '非常长的错误🙂'.repeat(2_000)
    const event = session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { message, code: 'E'.repeat(2_000) } } } as never)
    const result = await read() as any
    expect(result.status).toBe('ok')
    expect(result.turns[0]).toMatchObject({ state: 'error', errorTruncated: true, stateReference: { seq: event.seq }, requests: [{ text: 'Failed work' }] })
    expect(await read({ mode: 'handoff' })).toMatchObject({ status: 'ok' })
    let cursor: string | undefined, text = ''
    for (let page = 0; page < 50; page++) {
      const detail = await read({ mode: 'details', seq: event.seq, snapshot: result.snapshot, cursor }) as any
      expect(detail.status).toBe('ok')
      text += detail.items[0].text; cursor = detail.nextCursor
      if (!cursor) break
    }
    expect(cursor).toBeUndefined(); expect(JSON.parse(text).reason.error.message).toBe(message)
  })

  it('pages whole messages before Unicode fragments and always exposes the response locator', async () => {
    const { session } = await fixture()
    session.append('turn/start', { turn: 1 })
    const text = '很长的需求🙂'.repeat(600)
    request(session, text); response(session, 1, '结果：入口完成'); finish(session, 1)
    const turns = projectTurns(session.snapshotEvents(), session.id, 0)
    let index = 0, offset = 0, restored = '', conclusion = '', fragments = 0
    for (let count = 0; count < 40; count++) {
      const page = pageTurns(turns, index, offset, 1_400, 5)
      expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(1_400)
      const row = page.turns[0]!
      expect(row.responseLocator?.seq).toBe(turns[0]!.parts.at(-1)!.reference.seq)
      expect(row.responsePreview).toBe('结果：入口完成')
      for (const part of row.requests) { restored += part.text; expect(Array.from(text).slice(part.reference.start ?? 0, part.reference.end).join('')).toBe(part.text) }
      conclusion += row.conclusion?.text ?? ''; fragments++
      if (page.nextIndex === undefined) break
      expect(page.nextIndex > index || (page.nextIndex === index && (page.nextOffset ?? 0) > offset)).toBe(true)
      index = page.nextIndex; offset = page.nextOffset ?? 0
    }
    expect(fragments).toBeGreaterThan(1); expect(restored).toBe(text); expect(conclusion).toBe('结果：入口完成')
  })

  it('reopens cited tool arguments/results and turn state using an immutable cross-mode snapshot', async () => {
    const { session, read } = await fixture()
    session.append('turn/start', { turn: 1 }); request(session, 'Write it')
    const call = session.append('tool/call', { turn: 1, step: 1, callId: 'c', name: 'write_file', arguments: '{"path":"a.txt","content":"original"}' })
    const result = session.append('tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c', content: [{ type: 'text', text: 'file written' }] } }, { surfaceOp: 'append' })
    response(session, 1, 'Written'); const end = finish(session, 1)
    const overview = await read() as any
    const turnId = overview.turns[0].turnId
    session.append('turn/start', { turn: 2 }); request(session, 'New work'); response(session, 2, 'New result'); finish(session, 2)
    const detail = await read({ mode: 'details', turnId, snapshot: overview.snapshot }) as any
    expect(detail.items.find((item: any) => item.seq === call.seq)).toMatchObject({ eventType: 'tool/call', text: call.data.arguments })
    expect(detail.items.find((item: any) => item.seq === result.seq)).toMatchObject({ eventType: 'tool/result', text: 'file written' })
    expect(JSON.stringify(detail)).not.toContain('New work')
    expect(await read({ mode: 'details', seq: end.seq, snapshot: overview.snapshot })).toMatchObject({ status: 'ok', items: [{ eventType: 'turn/end' }] })
    expect(await read({ mode: 'details', seq: 999, snapshot: overview.snapshot })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_FILTER', message: expect.stringContaining('seq') })
    expect(await read({ turnId: 'missing', snapshot: overview.snapshot })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_FILTER', message: expect.stringContaining('turn_id') })
    expect(await read({ turnId: '' })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_FILTER', message: expect.stringContaining('null') })
  })

  it('retains an extractive handoff without model calls, explicit missing facts and resolvable sources', async () => {
    const { session, read } = await fixture()
    session.append('turn/start', { turn: 1 }); request(session, 'Earlier'); response(session, 1, 'Error occurred'); finish(session, 1, 'error')
    session.append('turn/start', { turn: 2 }); request(session, 'Finish the menu')
    response(session, 2, '## 决定\n保留原入口。\n## 下一步\n重启 Desktop 验证。\n## 约束\n不发布。'); finish(session, 2)
    const handoff = await read({ mode: 'handoff' }) as any
    expect(handoff.handoff).toMatchObject({ source: 'extractive', summaryStatus: 'not-requested', sections: {
      objective: { facts: [{ text: 'Finish the menu' }] }, decisions: { facts: [{ text: '保留原入口。' }] },
      nextSteps: { facts: [{ text: '重启 Desktop 验证。' }] }, constraints: { facts: [{ text: '不发布。' }] },
      outstanding: { status: 'not-established', facts: [] },
    } })
    for (const section of Object.values(handoff.handoff.sections) as any[]) for (const fact of section.facts) for (const ref of fact.references) {
      expect(await read({ mode: 'details', seq: ref.seq, snapshot: handoff.snapshot })).toMatchObject({ status: 'ok', items: [expect.objectContaining({ seq: ref.seq })] })
    }
    expect(await readSession((await fixture()).ctx.sessionQuery as never, { sessionId: 'reading', mode: 'handoff', summarize: true }, { signal: new AbortController().signal }, resolveConfig({}), createCursorKey())).toMatchObject({ status: 'ok', handoff: { source: 'extractive', summaryStatus: 'unavailable' } })
  })

  it('rejects incompatible modes and binds continuation to projection/options while excluding append growth', async () => {
    const { session, read } = await fixture(1_400)
    session.append('turn/start', { turn: 1 }); request(session, '长文本🙂'.repeat(400)); response(session, 1, 'Done'); finish(session, 1)
    const first = await read() as any
    expect(first.nextCursor).toBeTypeOf('string')
    expect(await read({ mode: 'details', cursor: first.nextCursor })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_CURSOR' })
    session.append('turn/start', { turn: 2 }); request(session, 'Appended'); finish(session, 2)
    expect(JSON.stringify(await read({ cursor: first.nextCursor }))).not.toContain('Appended')
    expect(await read({ includeToolDetail: true })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_FILTER', message: expect.stringContaining('include_tool_detail') })
    expect(await read({ mode: 'conversation', summarize: true })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_FILTER', message: expect.stringContaining('summarize') })
    expect(await read({ mode: 'handoff', modelSurface: true })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_FILTER', message: expect.stringContaining('model_surface') })
    expect(await read({ mode: 'details', seq: -1 })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_FILTER', message: expect.stringContaining('seq') })
    expect(await read({ limit: 0 })).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_LIMIT', message: expect.stringContaining('1 to 20') })
  })
})
