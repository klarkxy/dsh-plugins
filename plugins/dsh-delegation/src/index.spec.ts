import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from './index.ts'
import type { SessionDelegation } from './storage.ts'

const top = (id: string) => ({ id, header: {} })
const agent = (session: { id: string; header: Record<string, unknown> }) => ({
  id: session.id, session,
  runMaintenance: <T>(job: (signal: AbortSignal) => Promise<T>) => job(new AbortController().signal),
})

function domain() {
  const rows = {
    settings: new Map<string, unknown>(),
    sessions: new Map<string, unknown>(),
    recent: new Map<string, unknown>(),
  }
  // Tables are stable instances: the service keeps the handle it opened.
  const tables = {
    settings: {
      get: (key: string) => rows.settings.get(key),
      put: async (key: string, value: unknown) => { rows.settings.set(key, value) },
    },
    sessions: {
      get: (key: string) => rows.sessions.get(key),
      put: async (key: string, value: unknown) => { rows.sessions.set(key, value) },
    },
    recent: {
      get: (key: string) => rows.recent.get(key),
      put: async (key: string, value: unknown) => { rows.recent.set(key, value) },
    },
  }
  let closed = 0
  return {
    rows, tables,
    get closed() { return closed },
    table: (name: 'settings' | 'sessions' | 'recent') => tables[name],
    close: async () => { closed++ },
  }
}

function host() {
  const ctx = new Context()
  const sessions = new Map<string, ReturnType<typeof top>>()
  const agents = new Map<string, ReturnType<typeof agent>>()
  const tools = new Map<string, Set<string>>()
  const section = vi.fn(() => () => {})
  const contextRegistration = vi.fn(() => () => {})
  const store = domain()
  const boundary = { openTurnStartSeq: null as number | null, lastTurn: 0 }
  ctx.provide('sessionProjections', { stateOf: () => boundary } as never)
  ctx.provide('systemPrompt', {
    section, context: contextRegistration, getSectionOrder: () => 2800, getContextOrder: () => 120,
  } as never)
  ctx.provide('storageDomain', { open: async () => store } as never)
  ctx.provide('sessions', { get: (id: string) => sessions.get(id) } as never)
  ctx.provide('agents', { get: (id: string) => agents.get(id) } as never)
  ctx.provide('tools', { get: (name: string, scope?: { id?: string }) => tools.get(scope?.id ?? '')?.has(name) ? {} : undefined } as never)
  ctx.provide('connection', {} as never)
  ctx.provide('webServer', { register: () => () => {} } as never)
  return { ctx, sessions, agents, tools, section, contextRegistration, store, boundary }
}

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function mount() {
  const fixture = host()
  contexts.push(fixture.ctx)
  await apply(fixture.ctx)
  const options = fixture.section.mock.calls[0]?.[0] as {
    name: string; order: number; interpolate: boolean; text: (context: unknown) => string
  } | undefined
  return { ...fixture, options }
}

describe('delegation apply wiring', () => {
  it('locks at the first turn boundary and remains locked after the turn ends', async () => {
    const { ctx, sessions, agents, boundary } = await mount()
    const session = top('s1')
    sessions.set('s1', session)
    agents.set('s1', agent(session))
    expect(await ctx.delegation.sessionStatus('s1')).toMatchObject({ locked: false })
    boundary.openTurnStartSeq = 1
    await expect(ctx.delegation.updateSession('s1', true, 0)).rejects.toMatchObject({ code: 'session-locked' })
    boundary.openTurnStartSeq = null
    boundary.lastTurn = 1
    await expect(ctx.delegation.updateSession('s1', true, 0)).rejects.toMatchObject({ code: 'session-locked' })
  })

  it('registers a static section and a required durable role reminder', async () => {
    const { options, section, contextRegistration } = await mount()
    expect(section).toHaveBeenCalledOnce()
    expect(options).toMatchObject({ name: 'delegation:policy', order: 2802, interpolate: false })
    expect(contextRegistration).toHaveBeenCalledOnce()
    expect(contextRegistration).toHaveBeenCalledWith(expect.objectContaining({
      name: 'delegation:role', order: 122, required: true, interpolate: false,
    }))
  })

  it('gives a forked executor its own reminder and keeps disabled sessions empty', async () => {
    const { ctx, sessions, agents, tools, contextRegistration } = await mount()
    const root = top('root')
    const child = { id: 'child', header: { parentSession: 'root', origin: 'subagent', delegationDepth: 1, isSeeded: true } }
    sessions.set('root', root).set('child', child)
    const parentAgent = agent(root)
    agents.set('root', parentAgent)
    tools.set('root', new Set(['subagent']))
    const reminder = contextRegistration.mock.calls[0]?.[0] as { text: (context: unknown) => string }
    expect(reminder.text({ agent: parentAgent, scope: parentAgent })).toBe('')
    await ctx.delegation.updateSession('root', true, 0)
    expect(reminder.text({ agent: parentAgent, scope: parentAgent })).toContain('coordinator')
    expect(reminder.text({ agent: agent(child) })).toContain('executor')
    await ctx.delegation.updateSession('root', false, 1)
    expect(reminder.text({ agent: agent(child) })).toBe('')
  })

  it('keeps two top-level sessions independently toggled', async () => {
    const { ctx, sessions, agents, tools, options } = await mount()
    const s1 = top('s1')
    const s2 = top('s2')
    const a1 = agent(s1)
    const a2 = agent(s2)
    sessions.set('s1', s1).set('s2', s2)
    agents.set('s1', a1).set('s2', a2)
    tools.set('s1', new Set(['subagent'])).set('s2', new Set(['subagent']))
    const service = ctx.delegation
    const textFor = (a: typeof a1) => options!.text({ agent: a, scope: a })

    expect(textFor(a1)).toBe('')
    expect(textFor(a2)).toBe('')

    await service.updateSession('s1', true, 0)
    expect(textFor(a1)).toContain('Delegation mode')
    expect(textFor(a2)).toBe('')

    await service.updateSession('s2', true, 0)
    expect(textFor(a1)).toContain('Delegation mode')
    expect(textFor(a2)).toContain('Delegation mode')

    await service.updateSession('s1', false, 1)
    expect(textFor(a1)).toBe('')
    expect(textFor(a2)).toContain('Delegation mode')
  })

  it('seeds a startup top-level session and swallows storage errors', async () => {
    const { ctx, store } = await mount()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const session = top('seeded')
    await ctx.serial('agent/created', { agent: agent(session), source: 'startup' })
    expect(store.rows.sessions.get('seeded')).toEqual({ enabled: false, revision: 1 } satisfies SessionDelegation)

    store.tables.sessions.put = async () => { throw new Error('io error') }
    await expect(ctx.serial('agent/created', { agent: agent(top('broken')), source: 'startup' })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('remembers the last creation-page choice for later fresh sessions only', async () => {
    const { ctx, sessions, agents, store } = await mount()
    const s1 = top('s1')
    sessions.set('s1', s1)
    agents.set('s1', agent(s1))
    await ctx.delegation.updateSession('s1', true, 0)
    expect(store.rows.recent.get('global')).toEqual({ enabled: true })

    // The remembered choice seeds the next fresh session, including after a
    // restart: a new service instance reads the same stored row.
    const s2 = top('s2')
    sessions.set('s2', s2)
    agents.set('s2', agent(s2))
    await ctx.serial('agent/created', { agent: agent(s2), source: 'startup' })
    expect(store.rows.sessions.get('s2')).toEqual({ enabled: true, revision: 1 } satisfies SessionDelegation)

    // A human fork inherits its parent and must not rewrite the remembered
    // choice, whichever way its own switch is set.
    const forked = { id: 'f1', header: { parentSession: 's1', isSeeded: true } }
    sessions.set('f1', forked)
    agents.set('f1', agent(forked))
    await ctx.serial('agent/created', { agent: agent(forked), source: 'startup' })
    await ctx.delegation.updateSession('f1', false, 1)
    expect(store.rows.sessions.get('f1')).toEqual({ enabled: false, revision: 2 } satisfies SessionDelegation)
    expect(store.rows.recent.get('global')).toEqual({ enabled: true })
  })
})
