import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import * as candidate from 'C:/Users/27837/.codex/worktrees/thread-management/dsh-plugins/plugins/dsh-session-manager/lib/index.js'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('loads the built plugin, searches real SQLite across cwd pages, reads cold logs without activation, and disposes tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-manager-acceptance-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(SqliteSessionQueryEngine, { path: join(root, 'search.db') })
  const loader = Object.create(Loader.prototype) as Loader
  const unwrapped = loader.unwrapExports(candidate) as Parameters<Context['plugin']>[0]
  const mounted = await ctx.plugin(unwrapped, { pageChars: 1_000, listLimit: 1, searchLimit: 1 })
  for (const [id, cwd, time, text] of [
    ['same-cold', 'C:/acceptance/here', 1, 'needle one weaker'],
    ['other-cold', 'C:/acceptance/elsewhere', 100, 'needle needle needle'],
  ] as const) {
    const writer = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id: SessionId(id), cwd, createdAt: time, isSeeded: false })
    await writer.append([{ type: 'user/message', seq: SessionSeq(0), time, surfaceOp: 'append', data: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }) }])
    await writer.close()
  }
  const caller = ctx.sessions.create(SessionId('acceptance-caller'), { meta: { cwd: 'C:/acceptance/here', createdAt: 200 } })
  const loadedBefore = ctx.sessions.list().map(session => session.id)
  let calls = 0
  async function execute(name: string, args: unknown) {
    const result = await ctx.tools.execute({ name, arguments: args, callId: ToolCallId(`acceptance-${++calls}`), signal: new AbortController().signal, agent: { id: caller.id, session: caller } as never })
    expect(result.isError).toBe(false)
    return JSON.parse(result.content.map(block => block.type === 'text' ? block.text : '').join(''))
  }
  const found: string[] = []
  let cursor: string | undefined
  const seen = new Set<string>()
  for (let i = 0; i < 8; i += 1) {
    const result = await execute('search_sessions', { query: 'needle', limit: 1, ...(cursor ? { cursor } : {}) })
    expect(result.status).toBe('ok')
    found.push(...result.items.map((item: { sessionId: string }) => item.sessionId))
    cursor = result.nextCursor
    if (!cursor) break
    expect(seen.has(cursor)).toBe(false)
    seen.add(cursor)
  }
  expect(cursor).toBeUndefined()
  expect(found).toEqual(['same-cold', 'other-cold'])
  const cold = await execute('read_session', { session_id: 'same-cold' })
  expect(cold.status).toBe('ok')
  expect(cold.items.map((item: { text: string }) => item.text).join('')).toBe('needle one weaker')
  expect(ctx.sessions.list().map(session => session.id)).toEqual(loadedBefore)
  await mounted.dispose()
  for (const name of ['list_sessions', 'search_sessions', 'read_session']) expect(ctx.tools.get(name)).toBeUndefined()
})
