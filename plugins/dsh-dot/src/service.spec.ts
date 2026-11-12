import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Timer } from './batcher.ts'
import type { RawEvent } from './chat.ts'
import { DEFAULT_SETTINGS, PRESET_ID, REMINDER_HEAD, type DotContextView, type DotSettings } from './contracts.ts'
import { FULL_ACCESS, type DotHost, type SessionRow, type WorkspaceRow } from './host.ts'
import { DotService, HOME_TITLE } from './service.ts'
import { agreementsSection } from './memory.ts'
import { DotStore } from './store.ts'

/** Manual timer: tests fire scheduled callbacks explicitly. */
function manualTimer() {
  const pending = new Map<number, { run: () => void; ms: number }>()
  let next = 0
  const timer: Timer = {
    set: (callback, ms) => { const id = ++next; pending.set(id, { run: callback, ms }); return id },
    clear: handle => { pending.delete(handle as number) },
    now: () => 1000,
  }
  return {
    timer,
    delays: () => [...pending.values()].map(entry => entry.ms),
    fire: () => { const due = [...pending.values()]; pending.clear(); for (const entry of due) entry.run() },
  }
}

function fakeHost() {
  const workspaces: WorkspaceRow[] = []
  const calls: string[] = []
  const timeline: string[] = []
  const said: Array<{ text: string; carriedNotices?: string }> = []
  const relayed: Array<{ target: string; text: string }> = []
  const dots = new Set<string>()
  const lost = new Set<string>()
  const events = new Map<string, RawEvent[]>()
  const running = new Set<string>()
  const unreadable = new Set<string>()
  let sessions = 0
  let permissionWorks = true
  let context: DotContextView = { live: false, compactions: 0 }
  let model: string | undefined
  let createFails = false
  let summaryFails = false
  let catalogFails = false
  let presetsFail = false
  const host: DotHost = {
    listWorkspaces: () => [...workspaces],
    async createWorkspace(path, title) {
      const found = workspaces.find(row => row.path === path)
      if (found) return found
      const row = { id: `w${workspaces.length + 1}`, path, title: title ?? path, sessionCount: 0 }
      workspaces.push(row)
      return row
    },
    async listSessions(): Promise<SessionRow[]> { return [] },
    async titles() { return new Map() },
    async createSession(place) {
      const id = `s${++sessions}`
      calls.push(`create ${id} ${place.workspaceId ?? place.cwd}${place.preset ? ` preset=${place.preset}` : ''}`)
      return id
    },
    async listPresets() {
      if (presetsFail) throw new Error('roster offline')
      return {
        fallback: 'standard',
        presets: [{ id: 'standard' }, { id: 'ptc' }, { id: 'cordis' }, { id: 'minimal' }, { id: 'dot' }, { id: 'mine', broken: 'a row does not load' }],
      }
    },
    async listModels() {
      if (catalogFails) throw new Error('catalog offline')
      return {
        fallback: { provider: 'p', model: 'base' },
        models: [{ provider: 'p', model: 'base', name: 'Base' }, { provider: 'p', model: 'big', name: 'Big' }, { provider: 'q', model: 'small', name: 'small' }],
      }
    },
    async selectModel(sessionId, choice) { calls.push(`model ${sessionId} ${choice.provider}/${choice.model}`) },
    async setPermission(sessionId, preset) { calls.push(`permit ${sessionId} ${preset}`); return permissionWorks },
    async prompt(sessionId, text) { calls.push(`prompt ${sessionId} ${text}`) },
    async relay(target, _sender, text) { relayed.push({ target, text }); timeline.push(`relay ${text}`) },
    async cancel(sessionId) { calls.push(`cancel ${sessionId}`) },
    async archive(sessionId) { calls.push(`archive ${sessionId}`) },
    async latestReply() { return 'done: wrote hello.txt' },
    async cwdOf() { return '/watched' },
    async createDot(cwd, preset) {
      if (createFails) throw new Error('no session for you')
      const id = `dot${++sessions}`
      dots.add(id)
      calls.push(`create-dot ${id} ${preset}`)
      return id
    },
    async resumeDot(sessionId) { calls.push(`resume-dot ${sessionId}`); return dots.has(sessionId) && !lost.has(sessionId) },
    async releaseDot(sessionId) { calls.push(`release-dot ${sessionId}`) },
    async readEvents(sessionId) {
      if (unreadable.has(sessionId)) throw new Error('no such session')
      return events.get(sessionId) ?? []
    },
    async summarize(sessionId, _instruction, _maxTokens, onUsage) {
      calls.push(`summarize ${sessionId}`)
      if (summaryFails) throw new Error('model unavailable')
      onUsage?.({ input: 15, cacheRead: 25, cacheWrite: 0, output: 10 })
      return 'NOTE FROM DOT'
    },
    handoffView(fromSessionId, toSessionId) {
      calls.push(`handoff-view ${fromSessionId} ${toSessionId}`)
    },
    modelKey: () => model,
    async say(sessionId, text, carriedNotices) { said.push({ text, ...carriedNotices ? { carriedNotices } : {} }); calls.push(`say ${sessionId} ${text}`); timeline.push(`say ${text}`) },
    async stop(sessionId) { calls.push(`stop ${sessionId}`) },
    syncModel(sessionId) { calls.push(`sync-model ${sessionId}`) },
    dotEvents: () => [],
    dotContext: async () => context,
    dotTrajectory: () => ({ turns: [], earlier: 0 }),
    isRunning: sessionId => running.has(sessionId),
    async dispose() {},
  }
  return {
    host, calls, timeline, said, relayed, workspaces, lost, events, running, unreadable,
    failPermission: () => { permissionWorks = false },
    setContext: (next: DotContextView) => { context = next },
    setModel: (next: string | undefined) => { model = next },
    failCreate: (fails: boolean) => { createFails = fails },
    failSummary: () => { summaryFails = true },
    failCatalog: () => { catalogFails = true },
    failPresets: () => { presetsFail = true },
  }
}

function setup(settings?: Partial<DotSettings>) {
  const fake = fakeHost()
  const clock = manualTimer()
  const store = new DotStore(undefined)
  if (settings) void store.setSettings({ ...DEFAULT_SETTINGS, ...settings })
  let at = 1000
  // The legacy note files live in memory here; only the one-time migration reads them.
  const notes = { path: '/dot/memory.md', text: '', cognition: '', read: async () => notes.text, readCognition: async () => notes.cognition }
  const service = new DotService({ host: fake.host, store, homeDir: join(tmpdir(), 'dsh-dot-spec'), notes, quietMs: 10_000, maxWaitMs: 60_000, approvalGraceMs: 0, timer: clock.timer, now: () => at })
  return { ...fake, ...clock, store, service, notes, advance: (ms: number) => { at += ms } }
}

describe('DotService.ensureDot', () => {
  it('creates dot once under its own preset and resumes it afterwards', async () => {
    const h = setup()
    const first = await h.service.ensureDot()
    expect(await h.service.ensureDot()).toBe(first)
    expect(h.calls.filter(call => call.startsWith('create-dot'))).toEqual([`create-dot ${first} ${PRESET_ID}`])
    expect(h.calls).toContain(`resume-dot ${first}`)
  })

  it('starts a fresh session when the stored one cannot be resumed', async () => {
    const h = setup()
    const first = await h.service.ensureDot()
    h.lost.add(first)
    const second = await h.service.ensureDot()
    expect(second).not.toBe(first)
    expect(h.store.dotSessionId).toBe(second)
  })

  it("delivers the human's chat message to dot", async () => {
    const h = setup()
    await h.service.say('  plan the release  ')
    const dot = h.store.dotSessionId!
    expect(h.calls).toContain(`say ${dot} plan the release`)
    // The model setting is applied before the message reaches dot.
    expect(h.calls.indexOf(`sync-model ${dot}`)).toBeLessThan(h.calls.indexOf(`say ${dot} plan the release`))
    await expect(h.service.say('   ')).rejects.toThrow(/non-empty/)
  })
})

const human = (text: string, time: number): RawEvent => ({ type: 'user/message', time, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } })
const reply = (text: string, time: number): RawEvent => ({ type: 'assistant/message', time, data: { message: { content: [{ type: 'text', text }] } } })
const OVER_THE_LINE: DotContextView = { live: true, compactions: 0, contextWindow: 128_000, usedTokens: 80_000, rolloverAt: 70_000 }

describe('DotService segments', () => {
  it('lets dot request a segment for the next turn boundary without releasing its running session', async () => {
    const h = setup()
    const first = await h.service.ensureDot()
    h.events.set(first, [human('a', 10), reply('b', 20)])
    expect(h.service.requestSegment('work on the UI')).toContain('when this turn ends')
    expect(h.store.dotSessionId).toBe(first)
    await h.service.onDotIdle(first)
    expect(h.store.segment).toMatchObject({ reason: 'dot-requested' })
    expect(h.store.segment!.opening).toContain('work on the UI')
  })

  it('switches mechanically from the panel and reports failure without moving', async () => {
    const h = setup()
    const first = await h.service.ensureDot()
    h.events.set(first, [human('a', 10), reply('b', 20)])
    const next = await h.service.newSegment()
    expect(next).not.toBe(first)
    expect(h.store.segment!.reason).toBe('manual')
    expect(h.said).toEqual([])
    h.failCreate(true)
    await expect(h.service.newSegment()).rejects.toMatchObject({ code: 'dot/rollover-failed' })
    expect(h.store.dotSessionId).toBe(next)
  })

  it('records the first segment with the persona and model it starts with', async () => {
    const h = setup()
    h.setModel('p/m@high')
    const dot = await h.service.ensureDot()
    expect(h.store.segment).toMatchObject({ sessionId: dot, model: 'p/m@high' })
    expect(h.store.segment!.persona).toContain('桃乐丝')
    expect(h.store.segment!.opening).toBeUndefined()
    expect(h.store.pastSegments).toEqual([])
  })

  it('carries the stored conversation into a new segment when the session is lost', async () => {
    const h = setup()
    const first = await h.service.ensureDot()
    h.events.set(first, [human('ship v2 on friday', 10), reply('on it', 20)])
    h.lost.add(first)
    const second = await h.service.ensureDot()
    expect(second).not.toBe(first)
    expect(h.store.segment).toMatchObject({ sessionId: second, reason: 'lost' })
    expect(h.store.segment!.opening).toContain('ship v2 on friday')
    expect(h.store.segment!.opening).toContain('could not be reopened')
    expect(h.store.pastSegments).toEqual([{ sessionId: first, startedAt: 1000, endedAt: 1000, reason: 'lost' }])
    // A session that is gone cannot be asked for a note.
    expect(h.calls).not.toContain(`summarize ${first}`)
  })

  it('moves to a new segment once a finished turn is past the rollover line', async () => {
    const h = setup()
    const dot = await h.service.ensureDot()
    h.events.set(dot, [human('ship v2 on friday', 10), reply('on it', 20)])
    h.setContext(OVER_THE_LINE)
    await h.service.onDotIdle(dot)
    const next = h.store.dotSessionId!
    expect(next).not.toBe(dot)
    expect(h.calls).toContain(`release-dot ${dot}`)
    expect(h.store.segment).toMatchObject({ sessionId: next, reason: 'context-full', handoff: { tier: 'verbatim' } })
    expect(h.store.segment!.opening).toContain('Human: ship v2 on friday')
    expect(h.store.segment!.opening).toContain('[dot ledger]')
    await h.service.say('and the changelog')
    expect(h.calls).toContain(`say ${next} and the changelog`)
  })

  it('checks the line again before a delivery when the turn-end check could not move', async () => {
    const h = setup()
    const dot = await h.service.ensureDot()
    h.events.set(dot, [human('a', 10), reply('b', 20)])
    h.setContext(OVER_THE_LINE)
    h.failCreate(true)
    await h.service.onDotIdle(dot)
    expect(h.store.dotSessionId).toBe(dot)
    expect(h.calls).not.toContain(`release-dot ${dot}`)
    h.failCreate(false)
    await h.service.say('go on')
    expect(h.store.dotSessionId).not.toBe(dot)
    expect(h.calls).toContain(`say ${h.store.dotSessionId} go on`)
  })

  it('keeps the segment while dot runs, and seamlessly hands off open cards on rollover', async () => {
    const h = setup()
    const dot = await h.service.ensureDot()
    h.setContext(OVER_THE_LINE)
    h.events.set(dot, [human('a', 10), reply('b', 20)])
    h.running.add(dot)
    await h.service.onDotIdle(dot)
    expect(h.store.dotSessionId).toBe(dot)
    h.running.delete(dot)
    h.events.set(dot, [
      human('deploy it', 10),
      { type: 'tool/call', time: 19, data: { callId: 'c1', name: 'show_view', arguments: '{"title":"Choose target"}' } },
      reply('pick one', 20),
      { type: 'tool/result', time: 21, data: { message: { toolCallId: 'c1' }, meta: { viewId: 'v1', awaitReply: true } } },
    ])
    await h.service.onDotIdle(dot)
    const second = h.store.dotSessionId!
    expect(second).not.toBe(dot)
    expect(h.calls).toContain(`handoff-view ${dot} ${second}`)
    expect(h.store.segment?.openCard).toBe('Choose target')
    expect(h.store.segment?.opening).toContain('An interactive show_view card ("Choose target") from the earlier segment is still open')
    expect(h.store.segment?.opening).toContain(`inspect ${dot} with dot_search_history and dot_read_history`)

    // A manual rollover before the user replies keeps forwarding the same open card.
    h.setContext({ live: true, compactions: 0 })
    const third = await h.service.newSegment()
    expect(third).not.toBe(second)
    expect(h.calls).toContain(`handoff-view ${second} ${third}`)
    expect(h.store.segment?.openCard).toBe('Choose target')
  })

  it('accumulates token usage across segment rollovers and supports clearing mid-segment', async () => {
    const h = setup()
    const first = await h.service.ensureDot()
    h.events.set(first, [human('hello', 10), reply('hi', 20)])
    h.setContext({
      live: true,
      compactions: 0,
      usage: { input: 120, cacheRead: 300, cacheWrite: 40, output: 60 },
    })
    expect((await h.service.contextView()).usage).toEqual({ input: 120, cacheRead: 300, cacheWrite: 40, output: 60 })

    const second = await h.service.newSegment()
    expect(second).not.toBe(first)
    // Fresh segment has no local usage yet, so cumulative usage stays intact.
    h.setContext({ live: true, compactions: 0 })
    expect((await h.service.contextView()).usage).toEqual({ input: 120, cacheRead: 300, cacheWrite: 40, output: 60 })

    // Second segment adds new usage on top of the carried total.
    h.setContext({
      live: true,
      compactions: 0,
      usage: { input: 30, cacheRead: 100, cacheWrite: 10, output: 20 },
    })
    expect((await h.service.contextView()).usage).toEqual({ input: 150, cacheRead: 400, cacheWrite: 50, output: 80 })

    // Clearing mid-segment zeroes cumulative usage immediately and offsets the active segment.
    const cleared = await h.service.clearUsage()
    expect(cleared.usage).toEqual({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })

    // Subsequent turns in the same segment count only the delta after clear, and carry only that delta forward.
    h.setContext({
      live: true,
      compactions: 0,
      usage: { input: 55, cacheRead: 160, cacheWrite: 15, output: 35 },
    })
    expect((await h.service.contextView()).usage).toEqual({ input: 25, cacheRead: 60, cacheWrite: 5, output: 15 })

    await h.service.newSegment()
    h.setContext({ live: true, compactions: 0 })
    expect((await h.service.contextView()).usage).toEqual({ input: 25, cacheRead: 60, cacheWrite: 5, output: 15 })
  })

  it('asks dot for a note when the conversation is too long to carry word for word', async () => {
    const h = setup()
    const dot = await h.service.ensureDot()
    const long = 'x'.repeat(40_000)
    h.events.set(dot, [human(long, 10), reply(long, 20), human('latest ask', 30), reply('latest answer', 40)])
    h.setContext(OVER_THE_LINE)
    await h.service.onDotIdle(dot)
    expect(h.calls).toContain(`summarize ${dot}`)
    expect(h.store.segment!.handoff).toMatchObject({ tier: 'summary', summary: 'NOTE FROM DOT' })
    expect(h.store.segment!.opening).toContain('NOTE FROM DOT')
    expect(h.store.segment!.opening).toContain('latest answer')
  })

  it('falls back to the latest messages when the note cannot be written', async () => {
    const h = setup()
    const dot = await h.service.ensureDot()
    const long = 'x'.repeat(40_000)
    h.events.set(dot, [human(long, 10), reply(long, 20), human('latest ask', 30), reply('latest answer', 40)])
    h.setContext(OVER_THE_LINE)
    h.failSummary()
    await h.service.onDotIdle(dot)
    expect(h.store.dotSessionId).not.toBe(dot)
    expect(h.store.segment!.handoff!.tier).toBe('tail')
    expect(h.store.segment!.opening).toContain('latest answer')
  })

  it('takes a persona edit in place before dot has replied and in a new segment after', async () => {
    const h = setup()
    const dot = await h.service.ensureDot()
    await h.store.setSettings({ ...DEFAULT_SETTINGS, persona: 'A calm librarian.' })
    await h.service.settingsChanged()
    expect(h.store.dotSessionId).toBe(dot)
    expect(h.store.segment!.persona).toContain('A calm librarian.')

    h.events.set(dot, [human('hi', 10), reply('hello', 20)])
    await h.store.setSettings({ ...DEFAULT_SETTINGS, persona: 'A cheerful pirate.' })
    await h.service.settingsChanged()
    // The segment dot already answered in keeps the persona its requests were built with.
    expect(h.store.dotSessionId).toBe(dot)
    expect(h.store.segment!.persona).toContain('A calm librarian.')
    await h.service.say('ahoy')
    const next = h.store.dotSessionId!
    expect(next).not.toBe(dot)
    expect(h.store.segment).toMatchObject({ reason: 'prompt-changed' })
    expect(h.store.segment!.persona).toContain('A cheerful pirate.')
    expect(h.calls).toContain(`say ${next} ahoy`)
  })

  it('applies a model change in a new segment and leaves the old one on its model', async () => {
    const h = setup()
    h.setModel('p/a@')
    const dot = await h.service.ensureDot()
    h.events.set(dot, [human('hi', 10), reply('hello', 20)])
    h.setModel('p/b@')
    await h.service.settingsChanged()
    expect(h.calls).not.toContain(`sync-model ${dot}`)
    await h.service.say('continue')
    const next = h.store.dotSessionId!
    expect(next).not.toBe(dot)
    expect(h.store.segment).toMatchObject({ reason: 'model-switch', model: 'p/b@' })
    expect(h.calls).toContain(`sync-model ${next}`)
  })

  it('delivers messages one at a time, each after the segment check before it', async () => {
    const h = setup()
    const dot = await h.service.ensureDot()
    h.events.set(dot, [human('a', 10), reply('b', 20)])
    h.setContext(OVER_THE_LINE)
    await Promise.all([h.service.say('one'), h.service.say('two')])
    const next = h.store.dotSessionId!
    expect(h.calls.filter(call => call.startsWith('say '))).toEqual([`say ${next} one`, `say ${next} two`])
    expect(h.store.pastSegments).toHaveLength(1)
  })
})

describe('DotService history', () => {
  /** One earlier segment, the current one, and a task session, each with something said in it. */
  async function threeSessions() {
    const h = setup()
    const first = await h.service.ensureDot()
    h.events.set(first, [human('ship v2 on friday', 10), reply('on it', 20)])
    h.setContext(OVER_THE_LINE)
    await h.service.onDotIdle(first)
    h.setContext({ live: false, compactions: 0 })
    const second = h.store.dotSessionId!
    await h.service.startTask({ cwd: '/proj', title: 'release', instruction: 'go' }, new AbortController().signal)
    const task = h.store.list()[0]!.sessionId
    h.events.set(task, [human('go', 30), reply('the friday build is green', 40), { type: 'tool/result', time: 41, data: { message: { content: [{ type: 'text', text: 'wrote friday.log' }] } } }])
    h.events.set(second, [human('how is it going', 50), reply('fine', 60)])
    return { h, first, second, task }
  }

  it('tells a new segment where the conversation before it can be read', async () => {
    const { h, first } = await threeSessions()
    expect(h.store.segment!.opening).toContain(`the session just before this one is ${first}`)
    expect(h.store.segment!.opening).toContain('dot_search_history')
  })

  it('finds a word in its earlier segments and in the task sessions, newest first', async () => {
    const { h, first, second, task } = await threeSessions()
    const all = await h.service.searchHistory({ query: 'FRIDAY' })
    expect(all).toContain('2 match(es) for "FRIDAY" (3 session(s) searched)')
    expect(all).toContain(`Task "release" · ${task}`)
    expect(all).toContain('Assistant: the friday build is green')
    expect(all).toContain(`· ${first}`)
    expect(all).toContain('Human: ship v2 on friday')
    expect(all.indexOf(task)).toBeLessThan(all.indexOf(first))
    expect(all).not.toContain(`· ${second}`)
    // Tool results are searched only on request.
    expect(all).not.toContain('friday.log')
    expect(await h.service.searchHistory({ query: 'friday', tools: true })).toContain('Tool result: wrote friday.log')
  })

  it('narrows a search to its own conversation, to the tasks, or to one session', async () => {
    const { h, first, task } = await threeSessions()
    const own = await h.service.searchHistory({ query: 'friday', scope: 'own' })
    expect(own).toContain(first)
    expect(own).not.toContain(task)
    const tasks = await h.service.searchHistory({ query: 'friday', scope: 'tasks' })
    expect(tasks).toContain(task)
    expect(tasks).not.toContain(first)
    expect(await h.service.searchHistory({ query: 'friday', sessionId: first })).toContain('(1 session(s) searched)')
    expect(await h.service.searchHistory({ query: 'saturday' })).toContain('Nothing found for "saturday"')
    await expect(h.service.searchHistory({ query: '   ' })).rejects.toMatchObject({ code: 'dot/invalid' })
  })

  it('goes on past a session it cannot read, and says so when that session was the one asked for', async () => {
    const { h, first, task } = await threeSessions()
    h.unreadable.add(task)
    const all = await h.service.searchHistory({ query: 'friday' })
    expect(all).toContain('2 session(s) searched, 1 could not be read')
    expect(all).toContain(first)
    await expect(h.service.searchHistory({ query: 'friday', sessionId: task })).rejects.toMatchObject({ code: 'dot/unknown-session' })
    await expect(h.service.readHistory({ sessionId: task })).rejects.toMatchObject({ code: 'dot/unknown-session' })
  })

  it('reads an earlier segment back word for word', async () => {
    const { h, first, task } = await threeSessions()
    const around = await h.service.readHistory({ sessionId: first, seq: 0, before: 0, after: 1 })
    expect(around).toContain(`Your conversation, earlier session`)
    expect(around).toContain('seq 0 [')
    expect(around).toContain('Human: ship v2 on friday')
    expect(around).toContain('You: on it')
    // Without a position: the end of the session; a task's replies are not dot's own.
    const tail = await h.service.readHistory({ sessionId: task, tools: true })
    expect(tail).toContain('Assistant: the friday build is green')
    expect(tail).toContain('Tool result: wrote friday.log')
    await expect(h.service.readHistory({ sessionId: '  ' })).rejects.toMatchObject({ code: 'dot/invalid' })
  })
})

describe('DotService knowledge', () => {
  it('freezes agreements and cognition into the segment and keeps it when dot changes them itself', async () => {
    const h = setup()
    await h.service.setAgreements('- use the standard preset\n')
    await h.service.setCognition('I notice you prefer short answers.')
    const dot = await h.service.ensureDot()
    expect(h.store.segment!.agreements).toContain('[agreements]')
    expect(h.store.segment!.agreements).toContain('standard preset')
    expect(h.store.segment!.cognition).toContain('[cognition]')
    expect(h.store.segment!.cognition).toContain('short answers')
    h.events.set(dot, [human('hi', 10), reply('hello', 20)])

    expect(await h.service.agreementAdd('never push to main')).toContain('Recorded as an agreement')
    expect(h.store.agreements).toContain('never push to main')
    expect(await h.service.cognitionRewrite('I notice you like detail.')).toContain('updated')
    expect(h.store.cognition).toBe('I notice you like detail.')
    // The frozen prompt of the running segment stays as it was built; dot's own change only moves the seen snapshot.
    expect(h.store.segment!.agreements).not.toContain('never push to main')
    expect(h.store.segment!.agreementsSeen).toContain('never push to main')
    expect(h.store.segment!.cognition).toContain('short answers')
    expect(h.store.segment!.cognitionSeen).toContain('like detail')
    await h.service.say('go on')
    expect(h.store.dotSessionId).toBe(dot)

    // The next segment starts with the blocks as they are by then.
    h.setContext(OVER_THE_LINE)
    await h.service.onDotIdle(dot)
    expect(h.store.dotSessionId).not.toBe(dot)
    expect(h.store.segment!.agreements).toContain('never push to main')
    expect(h.store.segment!.agreementsSeen).toBeUndefined()
    expect(h.store.segment!.cognition).toContain('like detail')
    expect(h.store.segment!.cognitionSeen).toBeUndefined()
  })

  it("takes the human's edit in place before dot has replied and in a new segment after", async () => {
    const h = setup()
    const dot = await h.service.ensureDot()
    expect(h.store.segment!.agreements).toBe('')
    expect((await h.service.setAgreements('- call me Captain\r\n\r\n')).agreements.text).toBe('- call me Captain\n')
    // A panel edit does not switch right away.
    expect(h.store.dotSessionId).toBe(dot)
    expect(h.store.segment!.agreements).toBe('')
    await h.service.say('hi')
    // Not replied yet: the untouched segment takes the current text in place.
    expect(h.store.dotSessionId).toBe(dot)
    expect(h.store.segment!.agreements).toContain('- call me Captain')

    h.events.set(dot, [human('hi', 10), reply('hello', 20)])
    await h.service.setAgreements('- call me Admiral')
    await h.service.say('ahoy')
    const next = h.store.dotSessionId!
    expect(next).not.toBe(dot)
    expect(h.store.segment).toMatchObject({ reason: 'prompt-changed' })
    expect(h.store.segment!.agreements).toContain('- call me Admiral')
    expect(h.calls).toContain(`say ${next} ahoy`)
  })

  it('does not swallow a human edit to one layer when dot changes the other in-session', async () => {
    const h = setup()
    const dot = await h.service.ensureDot()
    h.events.set(dot, [human('hi', 10), reply('hello', 20)])
    // The human edits the agreements in the panel; dot rewrites its cognition in the same segment.
    await h.service.setAgreements('- be terse')
    await h.service.cognitionRewrite('I feel you like detail.')
    // The agreements seen snapshot is still the pre-edit block, so the next message still moves.
    await h.service.say('continue')
    expect(h.store.dotSessionId).not.toBe(dot)
    expect(h.store.segment).toMatchObject({ reason: 'prompt-changed' })
    expect(h.store.segment!.agreements).toContain('be terse')
    expect(h.store.segment!.cognition).toContain('like detail')
  })

  it('takes the latest agreements change back once, whoever made it', async () => {
    const h = setup()
    await h.service.ensureDot()
    expect((await h.service.knowledgeView()).agreements).toEqual({ text: '', maxChars: 4000, canUndo: false })
    await expect(h.service.undoAgreements()).rejects.toMatchObject({ code: 'dot/nothing-to-undo' })
    await h.service.setAgreements('- call me Captain')
    await h.service.agreementAdd('likes tea')
    expect((await h.service.knowledgeView()).agreements).toMatchObject({ text: '- call me Captain\n- likes tea\n', canUndo: true })
    expect((await h.service.undoAgreements()).agreements).toMatchObject({ text: '- call me Captain\n', canUndo: true })
    // One step is kept: taking back again restores what was just taken back.
    expect((await h.service.undoAgreements()).agreements.text).toBe('- call me Captain\n- likes tea\n')
    await expect(h.service.setAgreements('x'.repeat(4001))).rejects.toMatchObject({ code: 'dot/invalid' })
  })

  it('rewrites cognition whole, keeps versions, rolls back, and lets the empty version return', async () => {
    const h = setup()
    await h.service.ensureDot()
    await h.service.cognitionRewrite('first')
    await h.service.cognitionRewrite('second')
    let view = await h.service.knowledgeView()
    expect(view.cognition.text).toBe('second')
    expect(view.cognition.history.map(version => version.text)).toEqual(['first', ''])
    const empty = view.cognition.history.find(version => version.text === '')!
    view = await h.service.restoreCognition(empty.at)
    expect(view.cognition.text).toBe('')
    // Restoring pushes the replaced text back onto the history too.
    expect(view.cognition.history[0]!.text).toBe('second')
    await expect(h.service.restoreCognition(-1)).rejects.toMatchObject({ code: 'dot/unknown-version' })
  })

  it('runs agreements changes one after another, so none is lost', async () => {
    const h = setup()
    await h.service.ensureDot()
    await Promise.all([h.service.agreementAdd('one'), h.service.agreementAdd('two'), h.service.agreementAdd('three')])
    expect(h.store.agreements).toBe('- one\n- two\n- three\n')
  })
})

describe('DotService knowledge migration', () => {
  it('imports the old policy into agreements, and the old state memory, notes file and cognition file into cognition', async () => {
    const h = setup({ policy: 'pushing to my own repos is fine' })
    h.notes.text = '- 普通开发任务用标准预设，不用破限\n- call me Captain\n'
    h.notes.cognition = 'I have learned that you like short answers.'
    await h.service.ensureDot()
    const view = await h.service.knowledgeView()
    expect(view.agreements.text).toContain('pushing to my own repos is fine')
    expect(view.agreements.text).not.toContain('普通开发任务用标准预设')
    expect(view.agreements.text).not.toContain('call me Captain')
    expect(agreementsSection(view.agreements.text)).toContain('pushing to my own repos is fine')
    expect(view.cognition.text).toContain('call me Captain')
    expect(view.cognition.text).toContain('I have learned that you like short answers.')
    // The import runs once: clearing it afterwards never pulls the old sources back in.
    await h.service.setAgreements('')
    await h.service.setCognition('')
    h.notes.text = '- a later edit of the file\n'
    const after = await h.service.knowledgeView()
    expect(after.agreements.text).toBe('')
    expect(after.cognition.text).toBe('')
  })

  it('turns the old policy into removable agreement items', async () => {
    const h = setup({ policy: '推送前问我' })
    await h.service.ensureDot()
    expect((await h.service.knowledgeView()).agreements.text).toContain('- 推送前问我')
    expect(await h.service.agreementRemove('推送前问我')).toContain('Removed this agreement')
    expect((await h.service.knowledgeView()).agreements.text).not.toContain('推送前问我')
  })

  it('imports the legacy state memory and notes file into cognition, keeping the old undo as a cognition history version', async () => {
    const h = setup({ policy: '推送前问我' })
    await h.store.setDot({ memory: 'state-held understanding', memoryUndo: '- an older rule\n' })
    h.notes.text = '- a rule from the notes file\n'
    await h.service.ensureDot()
    const view = await h.service.knowledgeView()
    expect(view.cognition.text).toContain('state-held understanding')
    expect(view.cognition.text).toContain('a rule from the notes file')
    expect(view.agreements.text).toContain('推送前问我')
    expect(view.agreements.text).not.toContain('a rule from the notes file')
    // The old single-step note undo becomes the previous cognition version, not an agreement undo.
    expect(view.cognition.history).toHaveLength(1)
    expect(view.cognition.history[0]!.text).toContain('an older rule')
    expect(typeof view.cognition.history[0]!.at).toBe('number')
  })

  it('preserves an empty legacy notes undo as an empty cognition history version', async () => {
    const h = setup({ policy: '推送前问我' })
    await h.store.setDot({ memoryUndo: '' })
    h.notes.text = '- 普通开发任务用标准预设，不用破限\n'
    await h.service.ensureDot()
    const view = await h.service.knowledgeView()
    expect(view.agreements.text).toBe('- 推送前问我\n')
    expect(view.cognition.text).toContain('普通开发任务用标准预设')
    expect(view.cognition.history).toHaveLength(1)
    expect(view.cognition.history[0]!.text).toBe('')
  })

  it('does not treat a failed import as done, and retries it next time', async () => {
    const h = setup()
    h.notes.text = '- important rule\n'
    const realCommit = h.store.commitKnowledgeMigration.bind(h.store)
    let failing = true
    h.store.commitKnowledgeMigration = async patch => {
      if (failing) throw new Error('disk writes are down')
      return realCommit(patch)
    }
    // The failure surfaces to the caller instead of being swallowed.
    await expect(h.service.ensureDot()).rejects.toThrow(/disk writes are down/)
    expect(h.store.knowledgeMigrated).toBe(false)
    failing = false
    const view = await h.service.knowledgeView()
    expect(h.store.knowledgeMigrated).toBe(true)
    expect(view.cognition.text).toContain('important rule')
  })

  it('does not mark the import done when a legacy read fails, and retries without losing the note', async () => {
    const h = setup()
    h.notes.text = '- must not be lost\n'
    const realRead = h.notes.read
    let failRead = true
    h.notes.read = async () => {
      if (failRead) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      return realRead()
    }
    await expect(h.service.ensureDot()).rejects.toThrow(/permission denied/)
    expect(h.store.knowledgeMigrated).toBe(false)
    // While the import keeps failing, a write is refused too, so it can never hide the old note.
    await expect(h.service.agreementAdd('added while the import is broken')).rejects.toThrow(/permission denied/)
    expect(h.store.agreements).toBe('')
    failRead = false
    const view = await h.service.knowledgeView()
    expect(h.store.knowledgeMigrated).toBe(true)
    expect(view.cognition.text).toContain('must not be lost')
  })

  it('carries an imported cognition set whole past the write limit, keeping the tail note', async () => {
    const h = setup()
    h.notes.text = `- ${'x'.repeat(3000)}\n- the last note that must stay in force\n`
    h.notes.cognition = 'y'.repeat(1500)
    await h.service.ensureDot()
    const view = await h.service.knowledgeView()
    // The stored cognition exceeds the 4000-char new-write limit; the import is not clipped.
    expect(view.cognition.text.length).toBeGreaterThan(4000)
    expect(view.cognition.text).toContain('the last note that must stay in force')
  })

  it('does not read a legacy file whose target layer already has content', async () => {
    const h = setup()
    await h.store.setAgreements('- keep me\n')
    await h.store.setCognition('my own understanding')
    // Both target layers are already filled, so neither legacy file should be consulted.
    let noteReads = 0
    let cognitionReads = 0
    const realRead = h.notes.read
    const realCognition = h.notes.readCognition!
    h.notes.read = async () => { noteReads += 1; return realRead() }
    h.notes.readCognition = async () => { cognitionReads += 1; return realCognition() }
    await h.service.ensureDot()
    expect(h.store.knowledgeMigrated).toBe(true)
    expect(noteReads).toBe(0)
    expect(cognitionReads).toBe(0)
    const view = await h.service.knowledgeView()
    expect(view.agreements.text).toBe('- keep me\n')
    expect(view.cognition.text).toBe('my own understanding')
  })
})

describe('DotService reminders', () => {
  it('sets, lists and removes reminders and explains a request it cannot take', async () => {
    const h = setup()
    await h.service.ensureDot()
    const reply = await h.service.scheduleAdd({ title: 'Morning summary', prompt: 'Sum up the board.', dailyTime: '09:00' })
    const id = h.store.schedules[0]!.id
    expect(reply).toContain(id)
    expect(reply).toContain('daily at 09:00')
    expect(h.service.scheduleList()).toContain(`- ${id} "Morning summary" (daily at 09:00;`)
    expect(h.service.board().schedules.map(record => record.id)).toEqual([id])
    await expect(h.service.scheduleAdd({ title: 't', prompt: 'p' })).rejects.toMatchObject({ code: 'dot/invalid', message: expect.stringContaining('exactly one') })
    expect(await h.service.scheduleRemove(` ${id} `)).toBe(`Removed reminder ${id}.`)
    await expect(h.service.scheduleRemove(id)).rejects.toMatchObject({ code: 'dot/unknown-reminder' })
    expect(h.service.scheduleList()).toContain('No reminders set')
  })

  it('wakes the segment dot is in when a reminder set in an earlier one comes due', async () => {
    const h = setup()
    const first = await h.service.ensureDot()
    await h.service.scheduleAdd({ title: 'Check the release', prompt: 'Read the release task and report.', afterMinutes: 10 })
    h.events.set(first, [human('ship v2 on friday', 10), reply('on it', 20)])
    h.setContext(OVER_THE_LINE)
    await h.service.onDotIdle(first)
    const next = h.store.dotSessionId!
    expect(next).not.toBe(first)
    // The new segment is told which reminders it still owns.
    expect(h.store.segment!.opening).toContain('"Check the release"')
    h.setContext({ live: true, compactions: 0 })

    // Nothing fires before the plugin says dot's session can be opened.
    h.advance(10 * 60_000)
    expect(h.delays()).toEqual([])
    h.service.startReminders()
    expect(h.delays()).toEqual([0])
    h.fire()
    await vi.waitFor(() => expect(h.relayed).toHaveLength(1))
    expect(h.relayed[0]!.target).toBe(next)
    expect(h.relayed[0]!.text.startsWith(REMINDER_HEAD)).toBe(true)
    expect(h.relayed[0]!.text).toContain('Read the release task and report.')
    await vi.waitFor(() => expect(h.store.schedules).toEqual([]))
    expect(h.delays()).toEqual([])
  })

  it('moves to a new segment first when one is due as the reminder fires', async () => {
    const h = setup()
    const first = await h.service.ensureDot()
    await h.service.scheduleAdd({ title: 'Pulse', prompt: 'Look at the board.', everyMinutes: 30 })
    h.service.startReminders()
    h.events.set(first, [human('hi', 10), reply('hello', 20)])
    await h.store.setSettings({ ...DEFAULT_SETTINGS, persona: 'A calm librarian.' })
    h.advance(30 * 60_000)
    h.fire()
    await vi.waitFor(() => expect(h.relayed).toHaveLength(1))
    const next = h.store.dotSessionId!
    expect(next).not.toBe(first)
    expect(h.relayed[0]!.target).toBe(next)
    await vi.waitFor(() => expect(h.store.schedules[0]).toMatchObject({ nextAt: 1000 + 60 * 60_000 }))
  })

  it('carries held updates when a reminder wakes dot', async () => {
    const h = setup()
    const dot = await h.service.ensureDot()
    await h.service.watch('watched-task', 'keep an eye on it')
    await h.service.onTurnEnd('watched-task')
    await h.service.scheduleAdd({ title: 'Pulse', prompt: 'Look at the board.', afterMinutes: 10 })
    h.service.startReminders()
    h.advance(10 * 60_000)
    h.fire()
    await vi.waitFor(() => expect(h.relayed).toHaveLength(1))
    expect(h.relayed[0]).toMatchObject({ target: dot })
    expect(h.relayed[0]!.text.startsWith(REMINDER_HEAD)).toBe(true)
    expect(h.relayed[0]!.text).toContain('watched-task')
  })

  it('stops the clock when the service is disposed', async () => {
    const h = setup()
    await h.service.ensureDot()
    h.service.startReminders()
    await h.service.scheduleAdd({ title: 'Pulse', prompt: 'p', everyMinutes: 30 })
    expect(h.delays()).toEqual([30 * 60_000])
    h.service.dispose()
    expect(h.delays()).toEqual([])
  })
})

describe('DotService tasks', () => {
  it('starts a task under default permissions when Dorothy screens approvals, tracks it and reports its finished turn', async () => {
    const h = setup()
    const dot = await h.service.ensureDot()
    const workspace = await h.host.createWorkspace('/proj', 'proj')
    const reply = await h.service.startTask({ workspaceId: workspace.id, title: 'hello', instruction: 'write hello.txt' }, new AbortController().signal)
    const task = h.store.list()[0]!
    expect(reply).toContain(task.sessionId)
    expect(reply).not.toContain('full access')
    expect(task).toMatchObject({ origin: 'started', cwd: '/proj', goal: 'write hello.txt' })
    expect(h.calls).toContain(`permit ${task.sessionId} workspace-write`)

    await h.service.onTurnEnd(task.sessionId)
    expect(h.store.task(task.sessionId)).toMatchObject({ status: 'idle', unseenTurns: 1 })
    await h.service.flushNotices()
    expect(h.relayed).toHaveLength(1)
    expect(h.relayed[0]).toMatchObject({ target: dot })
    expect(h.relayed[0]!.text).toContain('finished a turn')
  })

  it('applies the saved full access choice before the first instruction independently of approval mode', async () => {
    const h = setup({ taskPermission: 'danger-full-access' })
    await h.service.ensureDot()
    const workspace = await h.host.createWorkspace('/proj', 'proj')
    const reply = await h.service.startTask({ workspaceId: workspace.id, title: 'hello', instruction: 'write hello.txt' }, new AbortController().signal)
    const task = h.store.list()[0]!
    expect(reply).toContain('danger-full-access permissions')
    const permitAt = h.calls.indexOf(`permit ${task.sessionId} ${FULL_ACCESS}`)
    expect(permitAt).toBeGreaterThan(-1)
    expect(permitAt).toBeLessThan(h.calls.indexOf(`prompt ${task.sessionId} write hello.txt`))
  })

  it('holds a watched turn until a task dot started wakes her, with status only on the ledger', async () => {
    const h = setup()
    const dot = await h.service.ensureDot()
    await h.service.watch('watched-task', 'keep an eye on it')
    h.service.onStatus('watched-task', 'running')
    expect(h.store.task('watched-task')!.status).toBe('running')
    expect(h.delays()).toEqual([])

    await h.service.onTurnEnd('watched-task')
    expect(h.store.task('watched-task')).toMatchObject({ status: 'idle', unseenTurns: 1 })
    expect(h.delays()).toEqual([])
    expect(h.relayed).toEqual([])

    await h.service.startTask({ cwd: '/proj', title: 'own-task', instruction: 'go' }, new AbortController().signal)
    const started = h.store.list().find(task => task.origin === 'started')!.sessionId
    await h.service.onTurnEnd(started)
    await h.service.flushNotices()
    expect(h.relayed).toHaveLength(1)
    expect(h.relayed[0]).toMatchObject({ target: dot })
    expect(h.relayed[0]!.text.indexOf('watched-task')).toBeLessThan(h.relayed[0]!.text.indexOf('own-task'))
  })

  it('carries held updates in the human message instead of waking dot separately', async () => {
    const h = setup()
    await h.service.ensureDot()
    await h.service.watch('watched-task', 'keep an eye on it')
    await h.service.onTurnEnd('watched-task')
    expect(h.relayed).toEqual([])
    expect(h.delays()).toEqual([])

    await h.service.say('please check it')
    expect(h.relayed).toEqual([])
    expect(h.said).toHaveLength(1)
    expect(h.said[0]!.text).toBe('please check it')
    expect(h.said[0]!.carriedNotices).toContain('watched-task')
    expect(h.timeline).toEqual(['say please check it'])
    expect(h.calls).toContain(`say ${h.store.dotSessionId} please check it`)
  })

  it('does not send an instruction if the saved permission cannot be applied', async () => {
    const h = setup({ taskPermission: 'danger-full-access' })
    h.failPermission()
    await h.service.ensureDot()
    await expect(h.service.startTask({ cwd: '/proj', title: 't', instruction: 'go' }, new AbortController().signal)).rejects.toMatchObject({ code: 'dot/permission-failed' })
    expect(h.calls.some(call => call.startsWith('prompt '))).toBe(false)
  })

  it('preserves the explicit host-default permission choice', async () => {
    const h = setup({ taskPermission: 'default' })
    await h.service.ensureDot()
    const reply = await h.service.startTask({ cwd: '/proj', title: 't', instruction: 'go' }, new AbortController().signal)
    expect(reply).toContain('host default permissions')
    expect(h.calls.some(call => call.startsWith('permit '))).toBe(false)
  })

  it("registers dot's own workspace and runs a task there when no place is given", async () => {
    const h = setup()
    await h.service.ensureDot()
    await h.service.ensureDot()
    expect(h.workspaces).toHaveLength(1)
    const home = h.workspaces[0]!
    expect(home.title).toBe(HOME_TITLE)
    await h.host.createWorkspace('/proj', 'proj')
    const listed = await h.service.listWorkspaces()
    expect(listed.split('\n').filter(line => line.includes('your own workspace'))).toEqual([expect.stringContaining(home.id)])
    const reply = await h.service.startTask({ title: 'look it up', instruction: 'find out' }, new AbortController().signal)
    expect(h.calls).toContain(`create s${reply.match(/task s(\d+)/)![1]} ${home.id}`)
    expect(h.store.list()[0]).toMatchObject({ cwd: home.path, workspaceId: home.id })
  })

  it('leaves a task on the default model unless dot names one', async () => {
    const h = setup()
    await h.service.ensureDot()
    await h.service.startTask({ cwd: '/proj', title: 'a', instruction: 'go' }, new AbortController().signal)
    expect(h.calls.some(call => call.startsWith('model '))).toBe(false)
    const reply = await h.service.startTask({ cwd: '/proj', title: 'b', instruction: 'go', model: 'p/big' }, new AbortController().signal)
    const id = h.store.list().find(task => task.title === 'b')!.sessionId
    expect(reply).toContain('on p/big')
    expect(h.calls.indexOf(`model ${id} p/big`)).toBeGreaterThan(-1)
    expect(h.calls.indexOf(`model ${id} p/big`)).toBeLessThan(h.calls.indexOf(`prompt ${id} go`))
  })

  it('leaves a task on the default preset unless dot names another', async () => {
    const h = setup()
    await h.service.ensureDot()
    const signal = new AbortController().signal
    const plain = await h.service.startTask({ cwd: '/proj', title: 'a', instruction: 'go' }, signal)
    const named = await h.service.startTask({ cwd: '/proj', title: 'b', instruction: 'go', preset: 'standard' }, signal)
    const word = await h.service.startTask({ cwd: '/proj', title: 'c', instruction: 'go', preset: 'Default' }, signal)
    // The default is never named to the host, so these sessions are created like any other.
    expect(h.calls.filter(call => call.startsWith('create s'))).toEqual(['create s2 /proj', 'create s3 /proj', 'create s4 /proj'])
    for (const reply of [plain, named, word]) expect(reply).not.toContain('preset')
    expect(h.store.list().map(task => task.preset)).toEqual(['standard', 'standard', 'standard'])

    const scripted = await h.service.startTask({ cwd: '/proj', title: 'd', instruction: 'rename them all', preset: 'PTC' }, signal)
    const id = h.store.list().find(task => task.title === 'd')!.sessionId
    expect(h.calls).toContain(`create ${id} /proj preset=ptc`)
    expect(scripted).toContain('with the ptc preset')
    expect(h.store.task(id)!.preset).toBe('ptc')
  })

  it('refuses a preset that is not on the roster, is broken, or is its own, before any session exists', async () => {
    const h = setup()
    await h.service.ensureDot()
    const signal = new AbortController().signal
    await expect(h.service.startTask({ cwd: '/proj', title: 't', instruction: 'go', preset: 'turbo' }, signal)).rejects.toMatchObject({ code: 'dot/unknown-preset', message: expect.stringContaining('standard (the default), ptc, cordis, minimal') })
    await expect(h.service.startTask({ cwd: '/proj', title: 't', instruction: 'go', preset: 'dot' }, signal)).rejects.toMatchObject({ code: 'dot/unknown-preset' })
    await expect(h.service.startTask({ cwd: '/proj', title: 't', instruction: 'go', preset: 'mine' }, signal)).rejects.toMatchObject({ code: 'dot/preset-broken' })
    expect(h.calls.some(call => call.startsWith('create s'))).toBe(false)
    expect(h.store.list()).toEqual([])
  })

  it('starts on the default when the roster cannot be read, and refuses a named preset then', async () => {
    const h = setup()
    await h.service.ensureDot()
    h.failPresets()
    const signal = new AbortController().signal
    await h.service.startTask({ cwd: '/proj', title: 'a', instruction: 'go' }, signal)
    expect(h.calls).toContain('create s2 /proj')
    expect(h.store.list()[0]!.preset).toBeUndefined()
    await expect(h.service.startTask({ cwd: '/proj', title: 'b', instruction: 'go', preset: 'ptc' }, signal)).rejects.toMatchObject({ code: 'dot/presets-unavailable' })
    expect(h.store.list()).toHaveLength(1)
  })

  it('routes cordis tasks through the same dot approval rules as other presets', async () => {
    const h = setup()
    await h.service.ensureDot()
    const reply = await h.service.startTask({ cwd: '/proj', title: 'new plugin', instruction: 'scaffold it', preset: 'cordis' }, new AbortController().signal)
    const id = h.store.list()[0]!.sessionId
    expect(h.calls).toContain(`create ${id} /proj preset=cordis`)
    expect(h.calls).toContain(`permit ${id} workspace-write`)
    expect(reply).toContain('workspace-write permissions')

    const approval = h.service.relayRequest({ kind: 'approval', sessionId: id, subject: 'bash', detail: 'dsh plugin add x' })
    if (approval.decided !== 'pending') throw new Error('expected a pending relay')
    const question = h.service.relayRequest({ kind: 'question', sessionId: id, subject: 'which name?' })
    if (question.decided !== 'pending') throw new Error('expected a pending relay')
    await h.service.flushNotices()
    const text = h.relayed.map(item => item.text).join('\n')
    const [approvalPart, questionPart] = [text.slice(text.indexOf(approval.id), text.indexOf(question.id)), text.slice(text.indexOf(question.id))]
    expect(approvalPart).toContain('dsh plugin add x')
    expect(approvalPart).not.toContain('Never decide it yourself')
    expect(questionPart).toContain('which name?')

    // Under deny all, even cordis approvals are rejected immediately.
    await h.store.setSettings({ ...DEFAULT_SETTINGS, approvals: 'deny' })
    expect(h.service.relayRequest({ kind: 'approval', sessionId: id, subject: 'bash' })).toEqual({ decided: 'deny' })
  })

  it("refuses a model the human's list excludes before any session exists", async () => {
    const h = setup({ taskModels: { mode: 'deny', list: ['p/big'] } })
    await h.service.ensureDot()
    await expect(h.service.startTask({ cwd: '/proj', title: 't', instruction: 'go', model: 'p/big' }, new AbortController().signal)).rejects.toMatchObject({ code: 'dot/model-not-allowed' })
    await expect(h.service.startTask({ cwd: '/proj', title: 't', instruction: 'go', model: 'nope' }, new AbortController().signal)).rejects.toMatchObject({ code: 'dot/unknown-model' })
    expect(h.calls.some(call => call.startsWith('create s'))).toBe(false)
    expect(h.store.list()).toHaveLength(0)
    // The default is not on the list, so a task without a model still starts on it.
    await h.service.startTask({ cwd: '/proj', title: 't', instruction: 'go' }, new AbortController().signal)
    expect(h.calls.some(call => call.startsWith('model '))).toBe(false)
  })

  it('makes dot choose when the default model is excluded, and chooses itself when one model is left', async () => {
    const h = setup({ taskModels: { mode: 'allow', list: ['p/big', 'q/small'] } })
    await h.service.ensureDot()
    const refused = h.service.startTask({ cwd: '/proj', title: 't', instruction: 'go' }, new AbortController().signal)
    await expect(refused).rejects.toMatchObject({ code: 'dot/model-not-allowed' })
    await expect(refused).rejects.toThrow(/p\/big, q\/small/)
    expect(await h.service.listModels()).toContain('The default p/base is excluded, so pass model')

    await h.store.setSettings({ ...h.store.settings, taskModels: { mode: 'allow', list: ['q/small'] } })
    const reply = await h.service.startTask({ cwd: '/proj', title: 't', instruction: 'go' }, new AbortController().signal)
    expect(reply).toContain('on q/small')
  })

  it('does not start a task when the list cannot be checked', async () => {
    const h = setup({ taskModels: { mode: 'deny', list: ['p/big'] } })
    await h.service.ensureDot()
    h.failCatalog()
    await expect(h.service.startTask({ cwd: '/proj', title: 't', instruction: 'go' }, new AbortController().signal)).rejects.toMatchObject({ code: 'dot/models-unavailable' })
    expect(h.calls.some(call => call.startsWith('create s'))).toBe(false)
  })

  it('reading a tracked task clears its unread counter', async () => {
    const h = setup()
    await h.service.ensureDot()
    const workspace = await h.host.createWorkspace('/proj')
    await h.service.startTask({ workspaceId: workspace.id, title: 't', instruction: 'go' }, new AbortController().signal)
    const id = h.store.list()[0]!.sessionId
    await h.service.onTurnEnd(id)
    expect(await h.service.read(id)).toContain('done: wrote hello.txt')
    expect(h.store.task(id)!.unseenTurns).toBe(0)
  })

  it('refuses messages to dot itself', async () => {
    const h = setup()
    const dot = await h.service.ensureDot()
    await expect(h.service.send(dot, 'hi')).rejects.toThrow(/dot itself/)
  })
})

describe('DotService approval grace', () => {
  async function withGrace(run: (h: ReturnType<typeof setup>, service: DotService) => Promise<void>) {
    vi.useFakeTimers()
    const h = setup()
    const service = new DotService({ host: h.host, store: h.store, homeDir: join(tmpdir(), 'dsh-dot-spec'), notes: h.notes })
    try {
      await service.ensureDot()
      await run(h, service)
    } finally {
      service.dispose()
      h.service.dispose()
      vi.useRealTimers()
    }
  }

  it('drops approvals settled within the default ten seconds without a wake', async () => {
    await withGrace(async (h, service) => {
      const routed = service.relayRequest({ kind: 'approval', sessionId: 'task', subject: 'pwsh' })
      if (routed.decided !== 'pending') throw new Error('expected pending')
      await vi.advanceTimersByTimeAsync(2000)
      routed.withdraw()
      await vi.advanceTimersByTimeAsync(20_000)
      expect(h.relayed).toEqual([])
      expect(service.board().pending).toEqual([])
    })
  })

  it('reports already settled after a request was delivered, without applying a late answer', async () => {
    await withGrace(async (h, service) => {
      const routed = service.relayRequest({ kind: 'approval', sessionId: 'task', subject: 'pwsh' })
      if (routed.decided !== 'pending') throw new Error('expected pending')
      await vi.advanceTimersByTimeAsync(9999)
      expect(h.relayed).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(h.relayed).toHaveLength(1)
      routed.withdraw()
      expect(service.answer(routed.id, { kind: 'approval', allow: true })).toContain('Already settled:')
      await expect(routed.settled).resolves.toBeUndefined()
      expect(() => service.answer('ap-missing', { kind: 'approval', allow: true })).toThrow(/no known request/)
    })
  })

  it('does not carry an approval early in a human message or an unrelated urgent question', async () => {
    await withGrace(async (h, service) => {
      const routed = service.relayRequest({ kind: 'approval', sessionId: 'task', subject: 'pwsh' })
      if (routed.decided !== 'pending') throw new Error('expected pending')
      await service.say('hello')
      expect(h.said[0]?.carriedNotices).toBeUndefined()
      service.relayRequest({ kind: 'question', sessionId: 'other', subject: 'which?' })
      await vi.advanceTimersByTimeAsync(1500)
      expect(h.relayed).toHaveLength(1)
      expect(h.relayed[0]?.text).not.toContain(routed.id)
      routed.withdraw()
      await vi.advanceTimersByTimeAsync(20_000)
      expect(h.relayed).toHaveLength(1)
    })
  })
})

describe('DotService.relayRequest', () => {
  it('takes over requests from untracked sessions and lets dot judge approvals by default', async () => {
    const h = setup()
    await h.service.ensureDot()
    const routed = h.service.relayRequest({ kind: 'approval', sessionId: 'stranger', subject: 'bash', detail: 'arguments: {"command":"rm -rf build"}', cwd: '/elsewhere' })
    if (routed.decided !== 'pending') throw new Error('expected a pending relay')
    // Requests block a session: they use the short urgent window, not the quiet one.
    expect(Math.max(...h.delays())).toBeLessThan(10_000)
    await h.service.flushNotices()
    const text = h.relayed[0]!.text
    expect(text).toContain(routed.id)
    expect(text).toContain('untracked session in /elsewhere')
    expect(text).toContain('rm -rf build')
    expect(text).not.toContain('Decide it yourself')
    h.service.answer(routed.id, { kind: 'approval', allow: true })
    await expect(routed.settled).resolves.toEqual({ kind: 'approval', allow: true })
    expect(h.service.board().pending).toHaveLength(0)
  })

  it('stays completely silent when the original session settles a request before delivery', async () => {
    const h = setup()
    await h.service.ensureDot()
    const routed = h.service.relayRequest({ kind: 'approval', sessionId: 'stranger', subject: 'pwsh', cwd: '/proj' })
    if (routed.decided !== 'pending') throw new Error('expected a pending relay')
    routed.withdraw()
    await expect(routed.settled).resolves.toBeUndefined()
    await h.service.flushNotices()
    expect(h.relayed).toHaveLength(0)
    expect(h.service.board().pending).toHaveLength(0)
  })

  it('also removes questions settled in the original session and explains late answers', async () => {
    const h = setup()
    await h.service.ensureDot()
    const routed = h.service.relayRequest({ kind: 'question', sessionId: 'task', subject: 'which?', questions: [{ id: 'choice', question: 'which?' }] })
    if (routed.decided !== 'pending') throw new Error('expected pending')
    routed.withdraw()
    await h.service.flushNotices()
    expect(h.relayed).toEqual([])
    expect(h.service.answer(routed.id, { kind: 'question', answers: [{ id: 'choice', selected: [] }] })).toContain('Already settled:')
  })

  it('skips untracked sessions when the scope is tracked, and dot itself always', async () => {
    const h = setup({ scope: 'tracked' })
    const dot = await h.service.ensureDot()
    expect(h.service.relayRequest({ kind: 'approval', sessionId: 'stranger', subject: 'bash' })).toEqual({ decided: 'skip' })
    expect(h.service.relayRequest({ kind: 'approval', sessionId: dot, subject: 'bash' })).toEqual({ decided: 'skip' })
  })

  it('relays every approval to the human under the human rule', async () => {
    const h = setup({ questions: 'human', approvals: 'human' })
    await h.service.ensureDot()
    await h.service.watch('s9', 'keep it green')
    const routed = h.service.relayRequest({ kind: 'approval', sessionId: 's9', subject: 'bash' })
    if (routed.decided !== 'pending') throw new Error('expected a pending relay')
    await h.service.flushNotices()
    expect(h.relayed[0]!.text).not.toContain('Never decide it yourself')
    expect(h.relayed[0]!.text).toContain('task "s9"')
  })

  it('does not grant an in-flight approval after the human switches to deny', async () => {
    const h = setup()
    await h.service.ensureDot()
    const routed = h.service.relayRequest({ kind: 'approval', sessionId: 'task', subject: 'pwsh' })
    if (routed.decided !== 'pending') throw new Error('expected pending')
    await h.store.setSettings({ ...h.store.settings, approvals: 'deny' })
    expect(h.service.answer(routed.id, { kind: 'approval', allow: true })).toContain('approvals=deny; no grant')
    await expect(routed.settled).resolves.toEqual({ kind: 'approval', allow: false })
  })

  it('enforces deny approvals and off questions immediately, reading settings live', async () => {
    const h = setup()
    await h.service.ensureDot()
    await h.store.setSettings({ ...DEFAULT_SETTINGS, approvals: 'dot' })
    expect(h.service.relayRequest({ kind: 'approval', sessionId: 's9', subject: 'bash' }).decided).toBe('pending')
    expect(h.service.relayRequest({ kind: 'question', sessionId: 's9', subject: 'Which?', questions: [{ id: 'q', question: 'Which?' }] }).decided).toBe('pending')

    await h.store.setSettings({ ...DEFAULT_SETTINGS, approvals: 'deny', questions: 'off' })
    expect(h.service.relayRequest({ kind: 'approval', sessionId: 's9', subject: 'bash' })).toEqual({ decided: 'deny' })
    expect(h.service.relayRequest({ kind: 'question', sessionId: 's9', subject: 'Which?', questions: [{ id: 'q', question: 'Which?' }] })).toEqual({ decided: 'skip' })
  })

  it("keeps the human's rules in the agreements rather than repeating them in notices", async () => {
    const h = setup({ policy: 'pushing to my own repos is fine' })
    await h.service.ensureDot()
    h.service.relayRequest({ kind: 'approval', sessionId: 's9', subject: 'bash' })
    await h.service.flushNotices()
    expect(h.relayed[0]!.text).not.toContain('pushing to my own repos is fine')
    expect(h.store.agreements).toContain('pushing to my own repos is fine')
  })

  it('archiving a task dot started declines its waiting requests', async () => {
    const h = setup()
    await h.service.ensureDot()
    await h.service.startTask({ cwd: '/proj', title: 't', instruction: 'go' }, new AbortController().signal)
    const id = h.store.list()[0]!.sessionId
    const routed = h.service.relayRequest({ kind: 'approval', sessionId: id, subject: 'bash' })
    if (routed.decided !== 'pending') throw new Error('expected a pending relay')
    expect(await h.service.archive(id)).toBe(`Archived ${id}.`)
    await expect(routed.settled).resolves.toEqual({ kind: 'approval', allow: false })
    expect(h.calls).toContain(`archive ${id}`)
    expect(h.store.task(id)!.status).toBe('archived')
  })

  it('refuses to archive a session dot did not start, watched or not', async () => {
    const h = setup()
    await h.service.ensureDot()
    await h.service.watch('s9', 'g')
    const routed = h.service.relayRequest({ kind: 'approval', sessionId: 's9', subject: 'bash' })
    if (routed.decided !== 'pending') throw new Error('expected a pending relay')
    await expect(h.service.archive('s9')).rejects.toMatchObject({ code: 'dot/not-yours' })
    await expect(h.service.archive('s-unknown')).rejects.toMatchObject({ code: 'dot/not-yours' })
    expect(h.calls.some(call => call.startsWith('archive '))).toBe(false)
    expect(h.store.task('s9')!.status).not.toBe('archived')
    // The request of the session that stays is still waiting for an answer.
    expect(h.service.board().pending).toHaveLength(1)
  })

  it('a session dot started stays its own after it is watched again', async () => {
    const h = setup()
    await h.service.ensureDot()
    await h.service.startTask({ cwd: '/proj', title: 't', instruction: 'go' }, new AbortController().signal)
    const id = h.store.list()[0]!.sessionId
    await h.service.watch(id, 'new goal')
    expect(h.store.task(id)!.origin).toBe('started')
    await expect(h.service.archive(id)).resolves.toBe(`Archived ${id}.`)
  })
})
