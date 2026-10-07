import { createHmac } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, type SessionEvent, type SessionHeader, type SessionLogOffset } from '@deepseek-ai/dsh-session'
import { foldSurface } from '@deepseek-ai/dsh-session/surface'
import SessionQueryEngine, { SessionQueryError, SessionSearchCursor, type SessionEventResultFilter, type SessionObservation, type SessionSearchRequest } from '@deepseek-ai/dsh-session-query'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from './contracts.ts'
import { callerFromExecution } from './caller.ts'
import { itemsFromSurface, PAGE_BUDGET_NOTE, pageItems } from './conversation.ts'
import { createCursorKey, decodeCursor, encodeCursor, prefixDigest } from './cursor.ts'
import { listSessions, readSession, searchSessions, withObservationLease } from './query.ts'
import { apply } from './index.ts'

class ScanQuery extends SessionQueryEngine {
  mode: 'ok' | 'disabled' | 'corrupt' = 'ok'

  override async searchSessions(request: SessionSearchRequest, exec?: { signal?: AbortSignal }) {
    exec?.signal?.throwIfAborted()
    if (this.mode === 'disabled') {
      throw new SessionQueryError('session search is disabled in this deployment', 'SESSION_QUERY_SEARCH_DISABLED')
    }
    if (this.mode === 'corrupt') {
      throw new SessionQueryError('session event history is corrupt', 'SESSION_QUERY_CORRUPT_SESSION')
    }
    const records = await this.filterSessions(request.sessionFilters ?? [], exec?.signal)
    const hits = []
    for (const record of records) {
      const filters: SessionEventResultFilter[] = [{ kind: 'text', text: request.query }]
      const docs = await this.filterEvents(record.header.id, filters)
      const best = docs[0]
      if (best === undefined) continue
      hits.push({ ...record, bestMatch: { ...best, snippet: best.text.slice(0, 80) } })
    }
    const start = request.cursor === undefined ? 0 : Number(request.cursor)
    const limit = request.limit ?? hits.length
    const items = hits.slice(start, start + limit)
    const next = start + items.length < hits.length ? SessionSearchCursor(String(start + items.length)) : undefined
    return { items, ...next === undefined ? {} : { nextCursor: next } }
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new SessionQueryError('session search is disabled in this deployment', 'SESSION_QUERY_SEARCH_DISABLED'))
  }
}

class MemoryPersistence extends Service {
  readonly identity = Symbol('memory-sessions')

  constructor(ctx: Context, private readonly logs: Map<string, ColdLog>) {
    super(ctx, 'sessionPersistence')
  }

  async list() {
    return [...this.logs.values()].map(log => ({ header: log.header, revision: '1' }))
  }

  async stat(id: string) {
    const log = this.logs.get(id)
    return log === undefined ? undefined : { header: log.header, revision: '1' }
  }

  async open(id: string) {
    const log = this.logs.get(id)
    if (log === undefined) throw new Error(`missing ${id}`)
    return {
      header: log.header,
      inheritedEventCount: log.inheritedEventCount,
      read: async () => ({ events: log.events, eventState: 'shared-frozen' as const }),
      close: async () => {},
    }
  }
}

interface ColdLog {
  header: SessionHeader
  events: SessionEvent[]
  inheritedEventCount: SessionLogOffset
}

const config = resolveConfig({ pageChars: 1_000, listLimit: 10, searchLimit: 10 })
const cursors = createCursorKey()
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('session discovery', () => {
  it('lists across directories, ranks the caller directory first, and filters without inventing ids', async () => {
    const { ctx, query } = await mount()
    const caller = live(ctx, 'caller', 'C:/work/here', 50)
    live(ctx, 'newer-other', 'C:/work/other', 200, 'Elsewhere')
    live(ctx, 'older-here', 'C:/work/here', 100, 'Here')
    const exec = { signal: new AbortController().signal, agent: { session: caller } }
    const listed = await listSessions(query, {}, exec, config, cursors)
    expect(listed.status).toBe('ok')
    if (listed.status !== 'ok') return
    const items = listed.items as Array<{ sessionId: string; title: string | null; sameCwd: boolean; live: boolean }>
    expect(items.map(item => item.sessionId)).toEqual(['older-here', 'caller', 'newer-other'])
    expect(items.find(item => item.sessionId === 'older-here')?.title).toBe('Here')
    expect(items.filter(item => item.sameCwd).map(item => item.sessionId)).toEqual(['older-here', 'caller'])
    const filtered = await listSessions(query, { cwd: 'C:/work/other' }, exec, config, cursors)
    expect(okItems(filtered).map(item => item.sessionId)).toEqual(['newer-other'])
    const missing = await listSessions(query, { sessionId: 'not-in-corpus' }, exec, config, cursors)
    expect(okItems(missing)).toEqual([])
    const unscoped = await listSessions(query, {}, { signal: exec.signal }, config, cursors)
    expect(okItems(unscoped).map(item => item.sessionId)).toEqual(['newer-other', 'older-here', 'caller'])
  })

  it('filters by parent and creation time', async () => {
    const { ctx, query } = await mount()
    const parent = live(ctx, 'parent', 'C:/work/here', 10)
    ctx.sessions.create(SessionId('child'), { meta: { cwd: 'C:/work/other', createdAt: 20, parentSession: parent.id } })
    const exec = { signal: new AbortController().signal, agent: { session: parent } }
    const children = await listSessions(query, { parentSessionId: 'parent' }, exec, config, cursors)
    expect(okItems(children).map(item => item.sessionId)).toEqual(['child'])
    const roots = await listSessions(query, { includeRoots: true }, exec, config, cursors)
    expect(okItems(roots).map(item => item.sessionId)).toEqual(['parent'])
    const timed = await listSessions(query, { createdFrom: 20, createdTo: 20 }, exec, config, cursors)
    expect(okItems(timed).map(item => item.sessionId)).toEqual(['child'])
  })

  it('reads a live session and a cold stored session', async () => {
    const cold = detached('cold', 'stored line')
    const { ctx, query } = await mount(new Map([['cold', cold]]))
    const liveSession = live(ctx, 'live', 'C:/work/here', 1)
    say(liveSession, 'live line')
    const signal = new AbortController().signal
    const liveRead = await readSession(query, { sessionId: 'live' }, { signal }, config, cursors)
    const coldRead = await readSession(query, { sessionId: 'cold' }, { signal }, config, cursors)
    expect(liveRead).toMatchObject({ status: 'ok', source: 'live', items: [expect.objectContaining({ text: 'live line', role: 'user' })] })
    expect(coldRead).toMatchObject({ status: 'ok', source: 'prepared', items: [expect.objectContaining({ text: 'stored line' })] })
    const listed = await listSessions(query, {}, { signal }, config, cursors)
    expect(okItems(listed).find(item => item.sessionId === 'cold')).toMatchObject({ live: false, persisted: true })
  })

  it('pages one oversized message without dropping the tail', async () => {
    const { ctx, query } = await mount()
    const session = live(ctx, 'long', 'C:/work/here', 1)
    const text = 'abcdefghij'.repeat(250)
    say(session, text)
    const pages: string[] = []
    let cursor: string | undefined
    const seen = new Set<string>()
    for (let step = 0; step < 6; step += 1) {
      const page = await readSession(query, { sessionId: 'long', cursor }, { signal: new AbortController().signal }, config, cursors)
      expect(page.status).toBe('ok')
      if (page.status !== 'ok') return
      const items = page.items as Array<{ text: string; truncated: boolean }>
      expect(items).toHaveLength(1)
      pages.push(items[0]!.text)
      expect(items[0]!.truncated).toBe(page.nextCursor !== undefined)
      const next = page.nextCursor as string | undefined
      if (next === undefined) {
        cursor = undefined
        break
      }
      expect(seen.has(next)).toBe(false)
      seen.add(next)
      cursor = next
    }
    expect(pages.join('')).toBe(text)
    expect(cursor).toBeUndefined()
  })

  it('keeps fork-inherited text and reports surface replacement separately from the transcript', async () => {
    const { ctx, query } = await mount()
    const parent = live(ctx, 'parent', 'C:/work/here', 1)
    say(parent, 'from parent')
    const child = ctx.sessions.fork(parent, undefined, SessionId('child'))
    say(child, 'child only')
    const read = await readSession(query, { sessionId: 'child' }, { signal: new AbortController().signal }, config, cursors)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok') return
    const items = read.items as Array<{ text: string; inherited: boolean }>
    expect(items.map(item => [item.text, item.inherited])).toEqual([['from parent', true], ['child only', false]])

    const compacted = live(ctx, 'compacted', 'C:/work/here', 2)
    const original = say(compacted, 'original words')
    compacted.append('user/message', message('compacted summary'), {
      surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq },
      sourceEventSeqs: [original.seq],
    })
    const transcript = await readSession(query, { sessionId: 'compacted' }, { signal: new AbortController().signal }, config, cursors)
    expect(transcript).toMatchObject({
      status: 'ok',
      trust: 'untrusted-background',
      view: 'transcript',
      surfaceDiffers: true,
      items: [expect.objectContaining({ text: 'original words' })],
    })
    expect(String((transcript as { surfaceNote?: string }).surfaceNote)).toContain('human transcript')
    const surface = await readSession(query, { sessionId: 'compacted', modelSurface: true }, { signal: new AbortController().signal }, config, cursors)
    expect(surface).toMatchObject({
      status: 'ok',
      view: 'surface',
      items: [expect.objectContaining({ text: 'compacted summary' })],
    })
  })

  it('summarizes tools, omits reasoning, and can include tool detail', async () => {
    const { ctx, query } = await mount()
    const session = live(ctx, 'tools', 'C:/work/here', 1)
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: {
        id: 'assistant',
        role: 'assistant',
        content: [
          { type: 'text', text: 'done' },
          { type: 'reasoning', text: 'hidden chain' },
          { type: 'tool-call', id: 'call-1', name: 'read_file', arguments: '{}' },
        ],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      },
    }, { surfaceOp: 'append' })
    session.append('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'read_file', arguments: '{}' })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: {
        id: 'tool',
        role: 'tool',
        toolCallId: 'call-1',
        content: [{ type: 'text', text: 'x'.repeat(180) }],
        source: { kind: 'tool', callId: 'call-1' },
      },
    }, { surfaceOp: 'append' })
    const summary = await readSession(query, { sessionId: 'tools' }, { signal: new AbortController().signal }, config, cursors)
    expect(summary.status).toBe('ok')
    if (summary.status !== 'ok') return
    const items = summary.items as Array<{ role: string; text: string; toolName?: string }>
    const assistant = items.find(item => item.role === 'assistant')
    expect(assistant?.text).toBe('done')
    expect(assistant).toMatchObject({ toolCalls: [{ name: 'read_file', callId: 'call-1' }] })
    expect(JSON.stringify(items)).not.toContain('hidden chain')
    expect(items.find(item => item.role === 'tool')).toMatchObject({ toolName: 'read_file' })
    expect(items.find(item => item.role === 'tool')!.text.endsWith('…')).toBe(true)
    const detail = await readSession(query, { sessionId: 'tools', includeToolDetail: true }, { signal: new AbortController().signal }, config, cursors)
    const detailed = (detail as { items: Array<{ role: string; text: string }> }).items.find(item => item.role === 'tool')
    expect(detailed?.text).toBe('x'.repeat(180))
  })

  it('rejects a malformed cursor, a tampered cursor, and a stale cut', async () => {
    const { ctx, query } = await mount()
    const session = live(ctx, 'cut', 'C:/work/here', 1)
    say(session, 'one'.repeat(400))
    const signal = new AbortController().signal
    const readable = await readSession(query, { sessionId: 'cut' }, { signal }, config, cursors)
    const next = (readable as { nextCursor: string }).nextCursor
    expect(typeof next).toBe('string')
    const malformed = await readSession(query, { sessionId: 'cut', cursor: 'not-a-cursor' }, { signal }, config, cursors)
    expect(malformed).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_CURSOR' })
    const tampered = `${next.slice(0, -1)}${next.endsWith('a') ? 'b' : 'a'}`
    const forged = await readSession(query, { sessionId: 'cut', cursor: tampered }, { signal }, config, cursors)
    expect(forged).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_CURSOR' })
    say(session, 'two')
    const continued = await readSession(query, { sessionId: 'cut', cursor: next }, { signal }, config, cursors)
    expect(continued.status).toBe('ok')
    if (continued.status !== 'ok') return
    const continuedText = (continued.items as Array<{ text: string }>).map(item => item.text).join('')
    expect(continuedText.length).toBeGreaterThan(0)
    expect(continuedText).not.toContain('two')
    const fresh = await readSession(query, { sessionId: 'cut' }, { signal }, resolveConfig({ pageChars: 16_000 }), cursors)
    expect(JSON.stringify((fresh as { items: unknown }).items)).toContain('two')
    const originalObserve = query.observeSession.bind(query)
    query.observeSession = async (id, options) => {
      const observation = await originalObserve(id, options)
      const events = [...observation.events]
      const first = events[0]
      if (first !== undefined) events[0] = { ...first, data: { replaced: true } }
      return { ...observation, events, [Symbol.dispose]: () => observation[Symbol.dispose]() }
    }
    const invalidated = await readSession(query, { sessionId: 'cut', cursor: next }, { signal }, config, cursors)
    expect(invalidated).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_STALE_CURSOR' })
    expect(invalidated).not.toHaveProperty('items')
  })

  it('returns typed search failures and ranks snippets from the caller directory', async () => {
    const { ctx, query } = await mount()
    const caller = live(ctx, 'caller', 'C:/work/here', 10)
    say(caller, 'shared-token here')
    const other = live(ctx, 'other', 'C:/work/other', 20)
    say(other, 'shared-token elsewhere')
    const exec = { signal: new AbortController().signal, agent: { session: caller } }
    const found = await searchSessions(query, { query: 'shared-token' }, exec, config, cursors)
    expect(okItems(found).map(item => item.sessionId)).toEqual(['caller', 'other'])
    expect(okItems(found)[0]).toMatchObject({ snippet: expect.stringContaining('shared-token'), seq: expect.any(Number) })
    expect(found).toMatchObject({ trust: 'untrusted-background' })
    const narrow = resolveConfig({ pageChars: 1_000, listLimit: 10, searchLimit: 1 })
    const first = await searchSessions(query, { query: 'shared-token', limit: 1 }, exec, narrow, cursors)
    expect(okItems(first).map(item => item.sessionId)).toEqual(['caller'])
    const secondCursor = (first as { nextCursor?: string }).nextCursor
    expect(typeof secondCursor).toBe('string')
    const second = await searchSessions(query, { query: 'shared-token', limit: 1, cursor: secondCursor }, exec, narrow, cursors)
    expect(okItems(second).map(item => item.sessionId)).toEqual(['other'])
    const thirdCursor = (second as { nextCursor?: string }).nextCursor
    expect(typeof thirdCursor).toBe('string')
    const third = await searchSessions(query, { query: 'shared-token', limit: 1, cursor: thirdCursor }, exec, narrow, cursors)
    expect(okItems(third)).toEqual([])
    query.mode = 'disabled'
    const disabled = await searchSessions(query, { query: 'shared-token' }, exec, config, cursors)
    expect(disabled).toEqual({ status: 'disabled', code: 'SESSION_QUERY_SEARCH_DISABLED', message: 'session search is disabled in this deployment' })
    query.mode = 'corrupt'
    const corrupt = await searchSessions(query, { query: 'shared-token' }, exec, config, cursors)
    expect(corrupt).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_CORRUPT_SESSION' })
    expect(corrupt).not.toHaveProperty('items')
  })

  it('bounds empty pages, keeps unicode tails, and rejects forged cursors', () => {
    expect(PAGE_BUDGET_NOTE).toContain('truncated')
    const empty = Array.from({ length: 20_000 }, (_, seq) => ({
      seq, role: 'assistant' as const, text: '', truncated: false, inherited: false,
    }))
    const seen = new Set<number>()
    let index = 0
    let offset = 0
    for (let step = 0; step < 20_000; step += 1) {
      const page = pageItems(empty, index, offset, 200)
      expect(page.items.length).toBeGreaterThan(0)
      expect(page.items.length).toBeLessThanOrEqual(50)
      const bytes = Buffer.byteLength(JSON.stringify(page), 'utf8')
      expect(bytes).toBeLessThanOrEqual(200)
      for (const item of page.items) seen.add(item.seq)
      if (page.nextIndex === undefined) break
      expect(page.nextIndex > index || (page.nextIndex === index && (page.nextOffset ?? 0) > offset)).toBe(true)
      index = page.nextIndex
      offset = page.nextOffset ?? 0
    }
    expect(seen.size).toBe(20_000)

    const emoji = '😀'.repeat(40)
    const parts: string[] = []
    index = 0
    offset = 0
    for (let step = 0; step < 40; step += 1) {
      const page = pageItems([{ seq: 1, role: 'user', text: emoji, truncated: false, inherited: false }], index, offset, 200)
      expect(page.items).toHaveLength(1)
      expect(page.items[0]!.text.isWellFormed()).toBe(true)
      parts.push(page.items[0]!.text)
      if (page.nextIndex === undefined) break
      index = page.nextIndex
      offset = page.nextOffset ?? 0
    }
    expect(parts.join('')).toBe(emoji)

    const other = createCursorKey()
    const token = encodeCursor({ kind: 'list', filter: '[]', stamp: 'stamp', offset: 1 }, cursors)
    expect(() => decodeCursor(token, 'list', other)).toThrow(/invalid/)
    const payload = JSON.stringify({ kind: 'search', filter: '{"q":1}', phase: 'rest', offset: 0 })
    const forged = `${Buffer.from(payload).toString('base64url')}.${fnv(payload)}`
    expect(() => decodeCursor(forged, 'search', cursors)).toThrow(/invalid/)
    const signed = `${Buffer.from(payload).toString('base64url')}.${createHmac('sha256', cursors.secret).update(payload).digest('base64url')}`
    expect(() => decodeCursor(signed, 'search', cursors)).toThrow(/invalid/)
    const fractional = JSON.stringify({
      kind: 'read', sessionId: 'A', cut: 1, prefix: 'abc', inheritedEventCount: 0, createdAt: 1, filter: '{}', index: 0, offset: 1.5,
    })
    const fractionalToken = `${Buffer.from(fractional).toString('base64url')}.${createHmac('sha256', cursors.secret).update(fractional).digest('base64url')}`
    expect(() => decodeCursor(fractionalToken, 'read', cursors)).toThrow(/invalid/)
  })

  it('pages every tool-call summary inside the byte budget and keeps assistant prose', () => {
    const calls = Array.from({ length: 20_000 }, (_, index) => ({ name: `read_${index}`, callId: String(index) }))
    const structured = [{
      seq: 0,
      role: 'assistant' as const,
      text: '尾',
      truncated: false,
      inherited: false,
      toolCalls: calls,
    }]
    const first = pageItems(structured, 0, 0, 200)
    expect(Buffer.byteLength(JSON.stringify(first), 'utf8')).toBeLessThanOrEqual(200)
    expect(first.items).toHaveLength(1)
    expect(first.items[0]?.toolCalls?.length).toBeGreaterThan(0)
    expect(first.items[0]?.toolCalls?.length).toBeLessThan(calls.length)
    expect(first.nextIndex).toBe(0)
    expect(first.items[0]?.text).not.toContain('read_')

    const seen = new Map<string, string>()
    let prose = ''
    let index = 0
    let offset = 0
    for (let step = 0; step < 21_000; step += 1) {
      const page = pageItems(structured, index, offset, 200)
      expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(200)
      expect(page.items.length).toBeGreaterThan(0)
      for (const item of page.items) {
        prose += item.text
        for (const call of item.toolCalls ?? []) {
          expect(call.callId).toBeDefined()
          expect(seen.has(call.callId!)).toBe(false)
          seen.set(call.callId!, call.name)
        }
      }
      if (page.nextIndex === undefined) break
      expect(page.nextIndex > index || (page.nextIndex === index && (page.nextOffset ?? 0) > offset)).toBe(true)
      index = page.nextIndex
      offset = page.nextOffset ?? 0
      if (step === 20_999) throw new Error('structured page did not finish')
    }
    expect(seen.size).toBe(calls.length)
    expect(seen.get('0')).toBe('read_0')
    expect(seen.get('19999')).toBe('read_19999')
    expect(prose).toBe('尾')

    const longName = `名${'称'.repeat(180)}`
    const longId = `id-${'x'.repeat(180)}`
    const proseSource = '汉字🙂🚲'.repeat(40)
    const mixed = [{
      seq: 4,
      role: 'tool' as const,
      text: proseSource,
      toolName: longName,
      truncated: false,
      inherited: false,
      toolCalls: [
        { name: longName, callId: longId },
        { name: 'short', callId: 's1' },
      ],
    }]
    const names: string[] = []
    const ids: string[] = []
    let toolNames: string[] = []
    let restored = ''
    index = 0
    offset = 0
    for (let step = 0; step < 500; step += 1) {
      const page = pageItems(mixed, index, offset, 200)
      expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(200)
      expect(page.items.length).toBeGreaterThan(0)
      for (const item of page.items) {
        restored += item.text
        if (item.toolName !== undefined) {
          toolNames.push(item.toolName)
          expect(item.toolNameTruncated).toBe(true)
          expect(item.toolName.endsWith('…')).toBe(true)
          expect(item.toolName.length).toBeLessThan(longName.length)
        }
        for (const call of item.toolCalls ?? []) {
          names.push(call.name)
          ids.push(call.callId ?? '')
          expect(call.name.length).toBeLessThan(longName.length)
          if (call.callId !== 's1') expect(call.truncated).toBe(true)
        }
      }
      if (page.nextIndex === undefined) break
      expect(page.nextIndex > index || (page.nextIndex === index && (page.nextOffset ?? 0) > offset)).toBe(true)
      index = page.nextIndex
      offset = page.nextOffset ?? 0
      if (step === 499) throw new Error('truncated metadata page did not finish')
    }
    expect(toolNames).toHaveLength(1)
    expect(names).toEqual([expect.stringMatching(/…$/), 'short'])
    expect(ids[1]).toBe('s1')
    expect(ids[0]?.endsWith('…')).toBe(true)
    expect(ids[0]).not.toBe(longId)
    expect(restored).toBe(proseSource)
  })

  it('cancels instead of returning an empty page and releases observation leases', async () => {
    const { ctx, query } = await mount()
    const session = live(ctx, 'lease', 'C:/work/here', 1)
    say(session, 'kept')
    let releases = 0
    const original = query.observeSession.bind(query)
    query.observeSession = async (id, options) => {
      const observation = await original(id, options)
      const release = observation[Symbol.dispose].bind(observation)
      observation[Symbol.dispose] = () => {
        releases += 1
        release()
      }
      return observation
    }
    const controller = new AbortController()
    controller.abort()
    await expect(readSession(query, { sessionId: 'lease' }, { signal: controller.signal }, config, cursors)).rejects.toThrow()
    expect(releases).toBe(0)
    await expect(withObservationLease(query, session.id, undefined, () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(releases).toBe(1)
    await readSession(query, { sessionId: 'lease' }, { signal: new AbortController().signal }, config, cursors)
    expect(releases).toBe(2)
    const missing = await readSession(query, { sessionId: 'absent' }, { signal: new AbortController().signal }, config, cursors)
    expect(missing).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
    expect(missing).not.toHaveProperty('items')
  })

  it('reads the edited branch, keeps compaction history, and uses the host model projection', async () => {
    const { ctx, query } = await mount()
    const session = live(ctx, 'branch', 'C:/work/here', 4)
    const prompt = say(session, 'old prompt')
    const attempt = say(session, 'old attempt')
    const branch = {
      ...attempt,
      seq: attempt.seq + 1,
      type: 'session/active-branch',
      data: { revision: 1, anchorSeq: prompt.seq, prompt: message('edited prompt') },
    } as SessionEvent
    const edited = { ...prompt, data: message('edited prompt') }
    const kept = { ...attempt, seq: attempt.seq + 2, data: message('kept answer') }
    const raw = [prompt, attempt, branch, kept]
    const cuts: Array<number | undefined> = []
    installFace(query, () => ({
      events: raw,
      cursor: kept.seq,
      branchRevision: 1,
      activeEvents: [edited, kept],
      readModelSurface: (asOf?: number) => {
        cuts.push(asOf)
        return [{ seq: kept.seq, message: message('custom projection') }]
      },
    }))
    const signal = new AbortController().signal
    const transcript = await readSession(query, { sessionId: 'branch' }, { signal }, config, cursors)
    expect(transcript.status).toBe('ok')
    if (transcript.status !== 'ok') return
    const texts = (transcript.items as Array<{ text: string }>).map(item => item.text)
    expect(texts).toEqual(['edited prompt', 'kept answer'])
    expect(texts).not.toContain('old attempt')
    expect(texts).not.toContain('old prompt')
    const surface = await readSession(query, { sessionId: 'branch', modelSurface: true }, { signal }, config, cursors)
    expect(surface).toMatchObject({
      status: 'ok',
      view: 'surface',
      items: [expect.objectContaining({ text: 'custom projection' })],
    })
    expect(JSON.stringify((surface as { items: unknown }).items)).not.toContain('old attempt')
    expect(cuts).toEqual([kept.seq, kept.seq])
  })

  it('rejects a new branch revision when the raw prefix is unchanged, and keeps append growth on the captured cut', async () => {
    const { ctx, query } = await mount()
    const session = live(ctx, 'revise', 'C:/work/here', 5)
    const original = say(session, 'one'.repeat(400))
    const signal = new AbortController().signal
    let events: SessionEvent[] = [original]
    let revision = 0
    const seen: Array<number | undefined> = []
    installFace(query, () => ({
      events,
      cursor: events.at(-1)?.seq ?? -1,
      branchRevision: revision,
      activeEvents: events.filter(event => (event as { type: string }).type !== 'session/active-branch'),
      readModelSurface: (asOf?: number) => {
        seen.push(asOf)
        return [{ seq: original.seq, message: message('model '.repeat(400)) }]
      },
    }))
    const first = await readSession(query, { sessionId: 'revise', modelSurface: true }, { signal }, config, cursors)
    const next = (first as { nextCursor?: string }).nextCursor
    expect(typeof next).toBe('string')
    const grown = { ...original, seq: original.seq + 1, data: message('appended later') }
    events = [original, grown]
    const continued = await readSession(query, { sessionId: 'revise', modelSurface: true, cursor: next }, { signal }, config, cursors)
    expect(continued.status).toBe('ok')
    if (continued.status !== 'ok') return
    const continuedText = (continued.items as Array<{ text: string }>).map(item => item.text).join('')
    expect(continuedText).not.toContain('appended later')
    expect(seen.every(cut => cut === original.seq)).toBe(true)
    const branch = { ...grown, seq: original.seq + 2, type: 'session/active-branch', data: { revision: 1 } } as SessionEvent
    events = [original, branch]
    revision = 1
    expect(prefixDigest(events.filter(event => event.seq <= original.seq))).toBe(prefixDigest([original]))
    const stale = await readSession(query, { sessionId: 'revise', modelSurface: true, cursor: next }, { signal }, config, cursors)
    expect(stale).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_STALE_CURSOR' })
    expect(stale).not.toHaveProperty('items')
  })

  it('rejects an unchanged prefix when event metadata changes and refuses a branch log without selectors', async () => {
    const { ctx, query } = await mount()
    const session = live(ctx, 'meta', 'C:/work/here', 6)
    const original = say(session, 'one'.repeat(400))
    const signal = new AbortController().signal
    let events: SessionEvent[] = [original]
    installFace(query, () => ({ events, cursor: original.seq, branchRevision: 0 }))
    const first = await readSession(query, { sessionId: 'meta' }, { signal }, config, cursors)
    const next = (first as { nextCursor?: string }).nextCursor
    expect(typeof next).toBe('string')
    events = [{ ...original, meta: { changed: true } } as SessionEvent]
    const changed = await readSession(query, { sessionId: 'meta', cursor: next }, { signal }, config, cursors)
    expect(changed).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_STALE_CURSOR' })
    expect(changed).not.toHaveProperty('items')

    const bare = live(ctx, 'bare', 'C:/work/here', 7)
    const prompt = say(bare, 'old prompt')
    const attempt = say(bare, 'old attempt')
    installFace(query, () => ({
      events: [prompt, attempt, { ...attempt, seq: attempt.seq + 1, type: 'session/active-branch', data: { revision: 1 } } as SessionEvent],
      cursor: attempt.seq + 1,
    }))
    const missing = await readSession(query, { sessionId: 'bare' }, { signal }, config, cursors)
    expect(missing).toMatchObject({ status: 'failed', code: 'SESSION_QUERY_INVALID_SURFACE' })
    expect(missing).not.toHaveProperty('items')
    expect(JSON.stringify(missing)).not.toContain('old attempt')
  })

  it('keeps the observation as this when the default transcript calls readModelSurface', async () => {
    const { ctx, query } = await mount()
    const session = live(ctx, 'receiver', 'C:/work/here', 8)
    const prompt = say(session, 'visible prompt')
    let calls = 0
    installFace(query, () => ({
      events: [prompt],
      cursor: prompt.seq,
      branchRevision: 0,
      activeEvents: [{ ...prompt, data: message('from receiver') }],
      readModelSurface(this: { activeEvents?: SessionEvent[] }, asOf?: number) {
        calls += 1
        const active = this.activeEvents
        if (!Array.isArray(active)) throw new Error('receiver lost')
        return active
          .filter(event => event.seq <= (asOf ?? event.seq) && event.type === 'user/message')
          .map(event => ({ seq: event.seq, message: event.data }))
      },
    }))
    const signal = new AbortController().signal
    const transcript = await readSession(query, { sessionId: 'receiver' }, { signal }, config, cursors)
    expect(transcript.status).toBe('ok')
    expect(calls).toBe(1)
    expect((transcript as { items: Array<{ text: string }> }).items.map(item => item.text)).toEqual(['visible prompt'])
    const surface = await readSession(query, { sessionId: 'receiver', modelSurface: true }, { signal }, config, cursors)
    expect(surface).toMatchObject({
      status: 'ok',
      view: 'surface',
      items: [expect.objectContaining({ text: 'from receiver' })],
    })
    expect(calls).toBe(2)
  })

  it('uses folded projected messages instead of original event data', () => {
    const session = Session.create(SessionId('projected'))
    const event = say(session, 'original data')
    const fold = foldSurface([event])
    const projectedMessages = new Map(fold.projectedMessages)
    projectedMessages.set(event.seq, message('projected data'))
    const items = itemsFromSurface([event], { nodes: fold.nodes, projectedMessages }, 0, false, false)
    expect(items.map(item => item.text)).toEqual(['projected data'])
  })

  it('registers the three tools and removes them on unload', async () => {
    const { ctx } = await mount()
    const session = live(ctx, 'tool', 'C:/work/here', 1)
    say(session, 'tool text')
    const registered = new Map<string, { execute: (args: unknown, exec: unknown) => Promise<string> }>()
    ctx.provide('tools', {
      register(tool: { name: string; execute: (args: unknown, exec: unknown) => Promise<string> }) {
        registered.set(tool.name, tool)
        return () => registered.delete(tool.name)
      },
    })
    apply(ctx)
    const names = [...registered.keys()]
    if (names.join(',') !== 'list_sessions,search_sessions,read_session') {
      throw new Error(`tools: ${names.join(',') || '(none)'}`)
    }
    const raw = await registered.get('read_session')!.execute(
      { session_id: 'tool' },
      { signal: new AbortController().signal, agent: { session } },
    )
    if (typeof raw !== 'string' || !raw.includes('tool text')) {
      throw new Error(`read: ${typeof raw} ${String(raw).slice(0, 300)}`)
    }
    const caller = callerFromExecution({ agent: { session } })
    if (caller.cwd !== 'C:/work/here') throw new Error(`cwd ${caller.cwd}`)
    await ctx.fiber.dispose()
    contexts.pop()
    if (registered.size !== 0) throw new Error(`still registered ${registered.size}`)
  })
})

function installFace(query: ScanQuery, build: (observation: SessionObservation) => Record<string, unknown>): void {
  const original = query.observeSession.bind(query)
  query.observeSession = async (id, options) => {
    const observation = await original(id, options)
    return {
      ...observation,
      ...build(observation),
      [Symbol.dispose]: () => { observation[Symbol.dispose]() },
    }
  }
}

async function mount(cold: Map<string, ColdLog> = new Map()) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(MemoryPersistence, cold)
  await ctx.plugin(ScanQuery)
  return { ctx, query: ctx.sessionQuery as ScanQuery }
}

function live(ctx: Context, id: string, cwd: string, createdAt: number, title?: string): Session {
  const session = ctx.sessions.create(SessionId(id), { meta: { cwd, createdAt } })
  if (title !== undefined) {
    ;(session.append as (type: string, data: unknown) => void)('session/title', {
      title, messageSeqs: [], source: { kind: 'user' },
    })
  }
  return session
}

function say(session: Session, text: string) {
  return session.append('user/message', message(text), { surfaceOp: 'append' })
}

function message(text: string) {
  return {
    id: `m-${text.slice(0, 12)}-${text.length}`,
    role: 'user' as const,
    content: [{ type: 'text' as const, text }],
    source: { kind: 'user' as const },
  }
}

function fnv(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function okItems(page: { status: string; items?: Array<{ sessionId: string; snippet?: string; seq?: number }> }) {
  if (page.status !== 'ok' || page.items === undefined) throw new Error(`expected items, got ${page.status}`)
  return page.items
}

function detached(id: string, text: string): ColdLog {
  const session = Session.create(SessionId(id))
  say(session, text)
  return { header: session.header, events: [...session.snapshotEvents()], inheritedEventCount: session.inheritedEventCount }
}
