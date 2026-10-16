import { describe, expect, it, vi } from 'vitest'
import { createRunningTracker, routeFromHeader, type RunningEvents } from './running.ts'

interface Listener { (...args: never[]): void }

function events() {
  const listeners = new Map<string, Listener[]>()
  const face: RunningEvents = {
    on(name: string, callback: Listener) {
      listeners.set(name, [...listeners.get(name) ?? [], callback])
      return () => {}
    },
  } as RunningEvents
  return {
    face,
    emit(name: 'subagent/start' | 'subagent/end' | 'agent/disposed' | 'session/event', ...args: unknown[]) {
      for (const listener of listeners.get(name) ?? []) listener(...args as never[])
    },
  }
}

function session(id: string, header: unknown, extra: { parentSession?: string; createdAt?: number } = {}) {
  return { id, header: { parentSession: extra.parentSession, createdAt: extra.createdAt, origin: 'subagent' }, requestHeader: () => header }
}

function agents(...list: Array<{ id: string; session?: unknown }>) {
  const byId = new Map(list.map(agent => [agent.id, agent]))
  return {
    get: (id: string) => byId.get(id),
    list: () => [...byId.values()],
  } as never
}

describe('routeFromHeader', () => {
  it('reads provider, model and effort, and flags adapter-default efforts', () => {
    expect(routeFromHeader({ config: { provider: ' p ', model: ' m ', reasoningEffort: ' high ' } }))
      .toEqual({ route: { provider: 'p', model: 'm', reasoningEffort: 'high' } })
    expect(routeFromHeader({ config: { provider: 'p', model: 'm' } }))
      .toEqual({ route: { provider: 'p', model: 'm' } })
    expect(routeFromHeader({ config: { provider: 'p', model: 'm', reasoningEffort: 'low' }, adapterDefaults: { reasoningEffort: true } }))
      .toEqual({ route: { provider: 'p', model: 'm', reasoningEffort: 'low' }, effortIsAdapterDefault: true })
    expect(routeFromHeader(undefined)).toEqual({})
    expect(routeFromHeader({ config: { provider: '', model: 'm' } })).toEqual({})
  })
})

describe('running subagent tracker', () => {
  it('tracks start/end, reads the route from the epoch header and notifies with revisions', async () => {
    const bus = events()
    const notify = vi.fn()
    const registry: Array<{ id: string; session?: unknown }> = []
    const live = { get: (id: string) => registry.find(agent => agent.id === id), list: () => registry }
    const tracker = createRunningTracker({ events: bus.face, agents: live as never, notify })
    /* The start notification fires after the child is published, so the
     * registry already resolves it by the time the listener runs. */
    registry.push({ id: 'child-1', session: session('child-1', { config: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' } }, { parentSession: 'parent', createdAt: 42 }) })
    bus.emit('subagent/start', { id: 'child-1', provider: 'subagent', local: true })
    expect(notify).toHaveBeenCalledWith(1)
    const state = await tracker.list()
    expect(state).toEqual({ revision: 1, entries: [
      { id: 'child-1', local: true, providerName: 'subagent', parentSessionId: 'parent', startedAt: 42,
        route: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' } },
    ] })
    bus.emit('subagent/end', { id: 'child-1' })
    expect(notify).toHaveBeenCalledWith(2)
    expect(await tracker.list()).toEqual({ revision: 2, entries: [] })
  })

  it('starts with a pending route and follows request/header events, bumping only on change', async () => {
    const bus = events()
    const notify = vi.fn()
    const tracker = createRunningTracker({ events: bus.face, agents: agents(), notify })
    bus.emit('subagent/start', { id: 'child-1', provider: 'subagent', local: true })
    expect((await tracker.list()).entries[0]).toMatchObject({ id: 'child-1', route: undefined })
    bus.emit('session/event', { id: 'other' }, { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } })
    bus.emit('session/event', { id: 'child-1' }, { type: 'turn/start', data: {} })
    expect(notify).toHaveBeenCalledTimes(1)
    bus.emit('session/event', { id: 'child-1' }, { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm', reasoningEffort: 'low' }, adapterDefaults: { reasoningEffort: true } } } })
    expect((await tracker.list()).entries[0]).toMatchObject({
      route: { provider: 'p', model: 'm', reasoningEffort: 'low' }, effortIsAdapterDefault: true,
    })
    bus.emit('session/event', { id: 'child-1' }, { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm', reasoningEffort: 'low' }, adapterDefaults: { reasoningEffort: true } } } })
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('recovers already-running children from the registry and skips top-level sessions', async () => {
    const bus = events()
    const tracker = createRunningTracker({
      events: bus.face,
      agents: agents(
        { id: 'child-old', session: session('child-old', { config: { provider: 'p', model: 'm' } }) },
        { id: 'top', session: { id: 'top', header: { cwd: '/work' }, requestHeader: () => ({ config: { provider: 'x', model: 'y' } }) } },
      ),
      notify: () => {},
    })
    const state = await tracker.list()
    expect(state.entries.map(entry => entry.id)).toEqual(['child-old'])
    expect(state.entries[0]).toMatchObject({ local: true, route: { provider: 'p', model: 'm' } })
    expect(state.entries[0]).not.toHaveProperty('providerName')
  })

  it('removes a tracked child when its agent is disposed', async () => {
    const bus = events()
    const notify = vi.fn()
    const tracker = createRunningTracker({ events: bus.face, agents: agents(), notify })
    bus.emit('subagent/start', { id: 'child-1', provider: 'subagent', local: true })
    bus.emit('agent/disposed', { agent: { id: 'child-1' } })
    bus.emit('agent/disposed', { agent: { id: 'unknown' } })
    expect(notify).toHaveBeenCalledTimes(2)
    expect((await tracker.list()).entries).toEqual([])
  })

  it('marks non-local runs as unreadable and tolerates a missing registry', async () => {
    const bus = events()
    const tracker = createRunningTracker({ events: bus.face, notify: () => {} })
    bus.emit('subagent/start', { id: 'remote-1', provider: 'remote', local: false })
    expect((await tracker.list()).entries[0]).toMatchObject({ id: 'remote-1', local: false, route: undefined })
  })

  it('resolves delegation labels through the subagent catalog and caches them', async () => {
    const bus = events()
    const listChildren = vi.fn(async (parent: string) => parent === 'parent'
      ? [{ id: 'child-1', label: ' reviewer ' }]
      : [])
    const tracker = createRunningTracker({
      events: bus.face,
      agents: agents({ id: 'child-1', session: session('child-1', undefined, { parentSession: 'parent', createdAt: 1 }) }),
      subagents: { listChildren } as never,
      notify: () => {},
    })
    bus.emit('subagent/start', { id: 'child-1', provider: 'subagent', local: true })
    const state = await tracker.list()
    expect(state.entries[0]).toMatchObject({ label: 'reviewer' })
    await tracker.list()
    expect(listChildren).toHaveBeenCalledTimes(1)
  })

  it('serves entries sorted by start time with detached routes', async () => {
    const bus = events()
    const tracker = createRunningTracker({
      events: bus.face,
      agents: agents(
        { id: 'b', session: session('b', { config: { provider: 'p', model: 'm' } }, { createdAt: 20 }) },
        { id: 'a', session: session('a', { config: { provider: 'p', model: 'm' } }, { createdAt: 10 }) },
      ),
      notify: () => {},
    })
    bus.emit('subagent/start', { id: 'b', provider: 'subagent', local: true })
    bus.emit('subagent/start', { id: 'a', provider: 'subagent', local: true })
    const state = await tracker.list()
    expect(state.entries.map(entry => entry.id)).toEqual(['a', 'b'])
    state.entries[0]!.route!.model = 'mutated'
    expect((await tracker.list()).entries[0]!.route!.model).toBe('m')
  })
})
