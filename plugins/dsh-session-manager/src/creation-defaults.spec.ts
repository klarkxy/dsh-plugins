import { describe, expect, it } from 'vitest'
import {
  AGENT_PRESET_SETTINGS_NS,
  CreationDefaultsMirror,
  PERMISSION_SETTINGS_NS,
  type AgentPresetRosterLike,
  type CreationDefaultsDeps,
  type CreationSessionLike,
  type CreationSettingsDescriptor,
  type PermissionCatalogLike,
} from './creation-defaults.ts'

const top = (id: string): CreationSessionLike => ({ id, header: {} })
const fork = (id: string, parentSession: string): CreationSessionLike => ({
  id,
  header: { parentSession, isSeeded: true },
})
const child = (id: string, parentSession: string): CreationSessionLike => ({
  id,
  header: { parentSession, origin: 'subagent', delegationDepth: 1, isSeeded: true },
})

const blank = { openTurnStartSeq: null as number | null, lastTurn: 0 }
const started = { openTurnStartSeq: null as number | null, lastTurn: 1 }
const seededKnobs = { preset: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' }
const unseededKnobs = { preset: null, sandbox: null, approval: null }

type MutateOp = { op: 'set'; path: readonly string[]; value: unknown }
type MutateCall = { ns: string; ops: readonly MutateOp[]; expectedRevision?: number }

interface Harness {
  deps: CreationDefaultsDeps
  mirror: CreationDefaultsMirror
  descriptors: CreationSettingsDescriptor[]
  writes: MutateCall[]
  warnings: string[]
}

/** Fold one mutate into the descriptor the way the host does: user layer + revision bump. */
function applyOps(row: CreationSettingsDescriptor, ops: readonly MutateOp[]): void {
  const layer = { ...(row.value as Record<string, unknown>) }
  for (const op of ops) layer[op.path[0]!] = op.value
  ;(row as { value: unknown }).value = layer
  ;(row as { revision: number }).revision += 1
}

function harness(overrides: {
  descriptors?: CreationSettingsDescriptor[]
  sessions?: Map<string, CreationSessionLike>
  projections?: Record<string, Record<string, unknown>>
  catalog?: PermissionCatalogLike
  roster?: AgentPresetRosterLike
  writable?: boolean
  mutateImpl?: (ns: string, ops: readonly MutateOp[], expectedRevision: number | undefined, row: CreationSettingsDescriptor | undefined) => Promise<unknown>
} = {}): Harness {
  const descriptors = overrides.descriptors ?? [
    { ns: AGENT_PRESET_SETTINGS_NS, value: { selectedDefault: 'standard' }, revision: 3 },
    { ns: PERMISSION_SETTINGS_NS, value: { defaultPreset: 'workspace-write' }, revision: 7 },
  ]
  const writes: MutateCall[] = []
  const warnings: string[] = []
  const projections = overrides.projections ?? {}
  const knobOf = (session: CreationSessionLike, key: string): unknown => {
    if (key === 'turnBoundary') {
      const row = projections[session.id]
      // An explicit null must stay null. `??` would hide the host's unfolded boundary.
      if (row !== undefined && Object.hasOwn(row, 'turnBoundary')) return row.turnBoundary
      return blank
    }
    if (key === 'permissions') return projections[session.id]?.permissions ?? seededKnobs
    return undefined
  }
  const settings = {
    describe: () => descriptors,
    writable: overrides.writable ?? true,
    mutate: async (ns: string, ops: readonly MutateOp[], expectedRevision?: number) => {
      const row = descriptors.find(d => d.ns === ns)
      if (overrides.mutateImpl) return overrides.mutateImpl(ns, ops, expectedRevision, row)
      writes.push({ ns, ops, expectedRevision })
      if (row) applyOps(row, ops)
    },
  }
  const sessions = overrides.sessions ?? new Map<string, CreationSessionLike>()
  const deps: CreationDefaultsDeps = {
    settings,
    sessions: { get: id => sessions.get(id) },
    sessionProjections: { stateOf: (session: unknown, key: string) => knobOf(session as CreationSessionLike, key) },
    permissionPresets: {
      catalog: () => overrides.catalog ?? ({
        defaultOptions: [{ value: 'workspace-write' }, { value: 'danger-full-access' }],
      }),
    },
    agentPresets: {
      remoteExportList: async () => overrides.roster ?? ({
        presets: [
          { id: 'standard' },
          { id: 'minimal' },
          { id: 'broken-one', broken: 'bad yaml' },
        ],
      }),
    },
    log: { warn: message => warnings.push(message) },
  }
  return { deps, mirror: new CreationDefaultsMirror(deps), descriptors, writes, warnings }
}

const wait = () => new Promise(resolve => setTimeout(resolve, 10))

describe('agent preset mirroring', () => {
  it('persists a blank top-level pick into selectedDefault', async () => {
    const h = harness()
    h.mirror.onSessionEvent(top('s1'), { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } })
    await wait()
    expect(h.writes).toEqual([{
      ns: AGENT_PRESET_SETTINGS_NS,
      ops: [{ op: 'set', path: ['selectedDefault'], value: 'minimal' }],
      expectedRevision: 3,
    }])
  })

  it('skips a pick identical to the stored default', async () => {
    const h = harness()
    h.mirror.onSessionEvent(top('s1'), { type: 'agent-preset/selected', data: { agentPreset: 'standard' } })
    await wait()
    expect(h.writes).toHaveLength(0)
  })

  it('never mirrors a subagent thread event', async () => {
    const h = harness()
    h.mirror.onSessionEvent(child('c1', 'root'), { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } })
    await wait()
    expect(h.writes).toHaveLength(0)
  })

  it('never mirrors a human fork event', async () => {
    const h = harness()
    h.mirror.onSessionEvent(fork('f1', 'root'), { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } })
    await wait()
    expect(h.writes).toHaveLength(0)
  })

  it('fails closed when the turn boundary is null instead of throwing', async () => {
    const h = harness({ projections: { s1: { turnBoundary: null } } })
    h.mirror.onSessionEvent(top('s1'), { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } })
    await wait()
    expect(h.writes).toHaveLength(0)
    expect(h.warnings).toHaveLength(0)
  })

  it('never mirrors once the session has started', async () => {
    const h = harness({ projections: { s1: { turnBoundary: started } } })
    h.mirror.onSessionEvent(top('s1'), { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } })
    await wait()
    expect(h.writes).toHaveLength(0)
  })

  it('refuses unknown or broken presets so later creates cannot fail at resolve', async () => {
    const h = harness()
    h.mirror.onSessionEvent(top('s1'), { type: 'agent-preset/selected', data: { agentPreset: 'ghost' } })
    h.mirror.onSessionEvent(top('s2'), { type: 'agent-preset/selected', data: { agentPreset: 'broken-one' } })
    await wait()
    expect(h.writes).toHaveLength(0)
  })
})

describe('permission preset mirroring', () => {
  it('ignores the creation pin event itself (sandbox knob still unset)', async () => {
    const h = harness({ projections: { s1: { permissions: unseededKnobs } } })
    h.mirror.onSessionEvent(top('s1'), { type: 'permission/preset', data: { preset: 'workspace-write' } })
    await wait()
    expect(h.writes).toHaveLength(0)
  })

  it('persists a post-seed user pick into defaultPreset', async () => {
    const h = harness()
    h.mirror.onSessionEvent(top('s1'), { type: 'permission/preset', data: { preset: 'danger-full-access' } })
    await wait()
    expect(h.writes).toEqual([{
      ns: PERMISSION_SETTINGS_NS,
      ops: [{ op: 'set', path: ['defaultPreset'], value: 'danger-full-access' }],
      expectedRevision: 7,
    }])
  })

  it('skips session-only and derived values the host can never seed (auto/custom)', async () => {
    const h = harness()
    h.mirror.onSessionEvent(top('s1'), { type: 'permission/preset', data: { preset: 'auto' } })
    h.mirror.onSessionEvent(top('s1'), { type: 'permission/preset', data: { preset: 'custom' } })
    await wait()
    expect(h.writes).toHaveLength(0)
  })

  it('does not pollute the default for a mid-session switch', async () => {
    const h = harness({ projections: { s1: { turnBoundary: started } } })
    h.mirror.onSessionEvent(top('s1'), { type: 'permission/preset', data: { preset: 'danger-full-access' } })
    await wait()
    expect(h.writes).toHaveLength(0)
  })
})

describe('settings writes', () => {
  it('retries once after a stale revision rejection', async () => {
    let calls = 0
    const h = harness({
      mutateImpl: async (ns, ops, _revision, row) => {
        calls += 1
        if (calls === 1) throw new Error('Config field changed since it was read')
        if (row) applyOps(row, ops)
      },
    })
    h.mirror.onSessionEvent(top('s1'), { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } })
    await wait()
    expect(calls).toBe(2)
    expect(h.warnings).toHaveLength(0)
  })

  it('warns and keeps going when the write fails hard', async () => {
    const h = harness({ mutateImpl: async () => { throw new Error('settings backend down') } })
    h.mirror.onSessionEvent(top('s1'), { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } })
    await wait()
    expect(h.warnings).toHaveLength(1)
    h.mirror.onSessionEvent(top('s2'), { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } })
    await wait()
    expect(h.warnings).toHaveLength(2)
  })

  it('serializes concurrent mirrors so the last pick lands last', async () => {
    const order: string[] = []
    const resolvers: Array<() => void> = []
    const h = harness({
      mutateImpl: async (_ns, ops, _revision, row) => {
        await new Promise<void>(resolve => resolvers.push(resolve))
        order.push(String(ops[0]!.value))
        if (row) applyOps(row, ops)
      },
    })
    h.mirror.onSessionEvent(top('s1'), { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } })
    h.mirror.onSessionEvent(top('s1'), { type: 'agent-preset/selected', data: { agentPreset: 'standard' } })
    await wait()
    // Only the first pick reached mutate; the second waits on the queue.
    expect(resolvers).toHaveLength(1)
    resolvers[0]!()
    await wait()
    // The second pick re-read the descriptor after the first write bumped it,
    // still differs ('minimal' stored vs 'standard' picked), so it writes too.
    expect(resolvers).toHaveLength(2)
    resolvers[1]!()
    await wait()
    expect(order).toEqual(['minimal', 'standard'])
  })

  it('does not write after unloading while the preset roster is pending', async () => {
    const h = harness()
    const pending = Promise.withResolvers<AgentPresetRosterLike>()
    h.deps.agentPresets!.remoteExportList = () => pending.promise
    h.mirror.onSessionEvent(top('s1'), { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } })
    await wait()
    h.mirror.dispose()
    pending.resolve({ presets: [{ id: 'minimal' }] })
    await wait()
    expect(h.writes).toHaveLength(0)
  })

  it('does nothing without a writable Settings service', async () => {
    const h = harness({ writable: false })
    h.mirror.onSessionEvent(top('s1'), { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } })
    await wait()
    expect(h.writes).toHaveLength(0)
  })
})
