import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DomainFacility, defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { openCompatibleDomain } from '@klarkxy/dsh-plugin-kit'
import { z } from 'zod'

// Retained legacy-shaped fixtures test the shared storage bootstrap without
// importing retired plugins or claiming to validate their production schemas.
const settings = z.object({ revision: z.number().int().nonnegative() }).passthrough()
const recapDomain = defineDomain({
  name: 'dsh_editor_recap', version: 4, compatibleVersions: [2, 3], layout: 'per-record',
  tables: { state: domainTable<string, Record<string, unknown>>(z.object({
    settings, cards: z.array(z.object({ id: z.string() }).passthrough()), checkpoints: z.array(z.unknown()),
  }).passthrough()) },
})
const moodDomain = defineDomain({
  name: 'dsh_editor_mood', version: 2, compatibleVersions: [1], layout: 'per-record',
  tables: { state: domainTable<string, Record<string, unknown>>(z.object({
    settings, sessions: z.record(z.string(), z.object({}).passthrough()),
  }).passthrough()) },
})
const fusionDomain = defineDomain({
  name: 'dsh_editor_fusion', version: 2, compatibleVersions: [1], layout: 'per-record',
  tables: { state: domainTable<string, Record<string, unknown>>(z.object({
    version: z.number(), revision: z.number().int().nonnegative(), pairs: z.array(z.object({ id: z.string() }).passthrough()),
  }).passthrough()) },
})
const FUSION_STATE_KEY = 'state'

type DomainSpec = typeof recapDomain | typeof moodDomain | typeof fusionDomain

const roots: string[] = []
const hosts: Array<{ facility: DomainFacility; backend: JsonStorageBackend }> = []

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.facility.closeAll()
    await host.backend.close()
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-domain-mig-'))
  roots.push(root)
  return root
}

/** Fake Context only routes the json backend and swallows domain events/logs. */
function openHost(root: string) {
  const backend = new JsonStorageBackend(root)
  const facility = new DomainFacility({
    storage: { backend: { get: (name: string) => {
      if (name !== 'json') throw new Error(`backend-not-found: ${name}`)
      return backend
    } } },
    logger: { error() {}, warn() {} },
    emit() {},
  } as never, { backend: 'json' })
  hosts.push({ facility, backend })
  return facility
}

function sourcePath(root: string, name: string): string {
  return join(root, `${name}.json`)
}

function writeSingle(root: string, name: string, version: number, table: string, key: string, record: unknown) {
  writeFileSync(sourcePath(root, name), `${JSON.stringify({
    unit: { name, version },
    global: null,
    tables: { [table]: { [key]: record } },
  }, null, 2)}\n`)
}

function writePerRecord(root: string, name: string, version: number, table: string, key: string, record: unknown) {
  const dir = join(root, name, table)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${key}.json`), `${JSON.stringify({ version, record }, null, 2)}\n`)
}

function backups(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) }
    catch { return }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.includes('.bak.')) found.push(path)
    }
  }
  walk(root)
  return found
}

function recapCard() {
  return {
    id: 'keep-a',
    sessionId: 's1',
    sourceVersion: 's1#6',
    fromSeq: 0,
    toSeq: 6,
    trigger: 'turn-end' as const,
    sourceStatus: 'completed' as const,
    title: '回顾 · 已完成',
    body: 'kept',
    kind: 'deterministic' as const,
    generation: 'idle' as const,
    createdAt: 1,
    updatedAt: 1,
  }
}

function recapRecord(stamp: number) {
  const settings: Record<string, unknown> = {
    revision: 7,
    cardsEnabled: false,
    checkpointsEnabled: true,
    semanticCheckpointsEnabled: false,
    idleReturnMs: 120_000,
  }
  if (stamp >= 3) {
    settings.displayModel = { provider: 'p', model: 'display-m' }
    settings.checkpointModel = { provider: '', model: '' }
  }
  const record: Record<string, unknown> = { settings, cards: [recapCard()], checkpoints: [] }
  if (stamp >= 4) record.lastCompletedAt = { s1: 70_000 }
  return record
}

function recapContract(row: Record<string, unknown>, stamp: number) {
  const settings = row.settings as Record<string, unknown>
  expect(settings.revision).toBe(7)
  expect(settings.cardsEnabled).toBe(false)
  expect(settings.idleReturnMs).toBe(120_000)
  expect((row.cards as Array<{ id: string }>)[0]?.id).toBe('keep-a')
  if (stamp >= 3) expect((settings.displayModel as { model: string }).model).toBe('display-m')
  if (stamp >= 4) expect((row.lastCompletedAt as Record<string, number>).s1).toBe(70_000)
}

function moodSession() {
  return {
    pendingManual: false,
    lastHandledVersion: 'u1',
    projectId: '/work/novel',
    clarification: [{ id: 'q1', question: '范围？', status: 'answered', answer: '对白' }],
    heldRequest: { sourceVersion: 'old', trigger: 'material', messages: [{ kind: 'held' }] },
    contract: {
      id: 'keep-contract',
      sessionId: 'sess-1',
      sourceVersion: 'u1',
      revision: 1,
      goal: '保留原约定',
      deliverables: ['修订对白'],
      inScope: ['第一章'],
      outOfScope: [],
      constraints: [],
      acceptance: [],
      assumptions: [],
      questions: [],
      evidence: [{ sessionId: 'sess-1', seq: 2, kind: 'user', excerpt: '改对白' }],
      readiness: 'user-confirmed',
      updatedAt: 10,
    },
  }
}

function moodRecord(stamp: number) {
  const settings: Record<string, unknown> = { revision: 3, mode: 'manual' }
  if (stamp >= 2) settings.model = { provider: 'mood-p', model: 'mood-m' }
  return { settings, sessions: { 'sess-1': moodSession() } }
}

function moodContract(row: Record<string, unknown>, stamp: number) {
  const settings = row.settings as Record<string, unknown>
  expect(settings.revision).toBe(3)
  expect(settings.mode).toBe('manual')
  expect((row.sessions as Record<string, { contract?: { goal: string } }>)['sess-1']?.contract?.goal).toBe('保留原约定')
  if (stamp >= 2) expect((settings.model as { model: string }).model).toBe('mood-m')
}

function fusionRecord(stamp: number) {
  const record: Record<string, unknown> = {
    version: 1,
    revision: 9,
    pairs: [{
      id: 'pair-1',
      leadSessionId: 'lead-1',
      childSessionId: 'child-1',
      project: '/work',
      profile: 'generic',
      route: { provider: 'p', model: 'm' },
      established: true,
      tasks: [],
      createdAt: 1,
    }],
  }
  if (stamp >= 2) {
    record.settings = { revision: 5, model: { mode: 'fixed', provider: 'p', model: 'sidekick' } }
    record.selections = { 'lead-1': { mode: 'follow', provider: '', model: '' } }
  }
  return record
}

function fusionContract(row: Record<string, unknown>, stamp: number) {
  expect(row.revision).toBe(9)
  expect((row.pairs as Array<{ id: string }>)[0]?.id).toBe('pair-1')
  if (stamp >= 2) {
    expect((row.settings as { revision: number }).revision).toBe(5)
    expect((row.settings as { model: { model: string } }).model.model).toBe('sidekick')
    expect((row.selections as Record<string, { mode: string }>)['lead-1']?.mode).toBe('follow')
  }
}

const plugins = [
  {
    label: 'recap',
    spec: recapDomain,
    key: 'global',
    stamps: [2, 3, 4],
    record: recapRecord,
    preserved: recapContract,
    invalid: { settings: { revision: 1, cardsEnabled: true, checkpointsEnabled: true, semanticCheckpointsEnabled: true, idleReturnMs: 60_000 }, cards: 'nope', checkpoints: [] },
    bump(row: Record<string, unknown>) {
      const settings = row.settings as Record<string, unknown>
      return { ...row, settings: { ...settings, revision: Number(settings.revision) + 1 } }
    },
    bumped(row: Record<string, unknown>) {
      expect((row.settings as { revision: number }).revision).toBe(8)
    },
  },
  {
    label: 'mood',
    spec: moodDomain,
    key: 'global',
    stamps: [1, 2],
    record: moodRecord,
    preserved: moodContract,
    invalid: { settings: { revision: 1, mode: 'manual' }, sessions: [] },
    bump(row: Record<string, unknown>) {
      const settings = row.settings as Record<string, unknown>
      return { ...row, settings: { ...settings, revision: Number(settings.revision) + 1 } }
    },
    bumped(row: Record<string, unknown>) {
      expect((row.settings as { revision: number }).revision).toBe(4)
    },
  },
  {
    label: 'fusion',
    spec: fusionDomain,
    key: FUSION_STATE_KEY,
    stamps: [1, 2],
    record: fusionRecord,
    preserved: fusionContract,
    invalid: { version: 1, revision: 0, pairs: 'nope' },
    bump(row: Record<string, unknown>) {
      return { ...row, revision: Number(row.revision) + 1 }
    },
    bumped(row: Record<string, unknown>) {
      expect(row.revision).toBe(10)
    },
  },
] as const

async function openPlugin(facility: DomainFacility, spec: DomainSpec) {
  return openCompatibleDomain(candidate => facility.open(candidate), spec)
}

describe('legacy-shaped domain fixture layout', () => {
  it('declares official per-record layout and does not skip invalid records', () => {
    expect(recapDomain.layout).toBe('per-record')
    expect(moodDomain.layout).toBe('per-record')
    expect(fusionDomain.layout).toBe('per-record')
    expect(recapDomain.invalidRecords).toBeUndefined()
    expect(moodDomain.invalidRecords).toBeUndefined()
    expect(fusionDomain.invalidRecords).toBeUndefined()
  })

  it('rejects a recap v3 single file when the host opens current as layout single despite compatibleVersions', async () => {
    const root = scratchRoot()
    writeSingle(root, recapDomain.name, 3, 'state', 'global', recapRecord(3))
    const original = readFileSync(sourcePath(root, recapDomain.name))
    const facility = openHost(root)
    await expect(facility.open({ ...recapDomain, layout: 'single' })).rejects.toMatchObject({ code: 'version-mismatch' })
    expect(facility.get(recapDomain.name)).toBeUndefined()
    expect(readFileSync(sourcePath(root, recapDomain.name))).toEqual(original)
  })
})

describe.each(plugins)('$label accepted legacy stamps', plugin => {
  it.each(plugin.stamps)('preserves stamp %s through reopen, write roundtrip, and retained source bytes', async stamp => {
    const root = scratchRoot()
    const source = sourcePath(root, plugin.spec.name)
    writeSingle(root, plugin.spec.name, stamp, 'state', plugin.key, plugin.record(stamp))
    const original = readFileSync(source)
    const facility = openHost(root)

    const first = await openPlugin(facility, plugin.spec)
    const loaded = first.table('state').get(plugin.key) as Record<string, unknown>
    plugin.preserved(loaded, stamp)
    await first.close()
    expect(readFileSync(source)).toEqual(original)

    const reopened = await openPlugin(facility, plugin.spec)
    plugin.preserved(reopened.table('state').get(plugin.key) as Record<string, unknown>, stamp)
    await reopened.table('state').put(plugin.key, plugin.bump(reopened.table('state').get(plugin.key) as Record<string, unknown>) as never)
    await reopened.close()
    expect(readFileSync(source)).toEqual(original)

    const afterWrite = await openPlugin(facility, plugin.spec)
    const written = afterWrite.table('state').get(plugin.key) as Record<string, unknown>
    plugin.bumped(written)
    if (plugin.label === 'recap') expect((written.cards as Array<{ id: string }>)[0]?.id).toBe('keep-a')
    if (plugin.label === 'mood') expect((written.sessions as Record<string, { contract?: { goal: string } }>)['sess-1']?.contract?.goal).toBe('保留原约定')
    if (plugin.label === 'fusion') expect((written.pairs as Array<{ id: string }>)[0]?.id).toBe('pair-1')
    await afterWrite.close()
    expect(readFileSync(source)).toEqual(original)
    expect(backups(root)).toEqual([])
  })
})

describe.each(plugins)('$label per-record latest takes precedence', plugin => {
  it('keeps populated per-record data and leaves the stale single source untouched', async () => {
    const root = scratchRoot()
    const source = sourcePath(root, plugin.spec.name)
    const staleStamp = plugin.stamps[0]
    writeSingle(root, plugin.spec.name, staleStamp, 'state', plugin.key, plugin.bump(plugin.record(staleStamp)))
    const latest = plugin.record(plugin.spec.version)
    writePerRecord(root, plugin.spec.name, plugin.spec.version, 'state', plugin.key, latest)
    const original = readFileSync(source)
    const facility = openHost(root)
    const domain = await openPlugin(facility, plugin.spec)
    const row = domain.table('state').get(plugin.key) as Record<string, unknown>
    plugin.preserved(row, plugin.spec.version)
    if (plugin.label === 'fusion') expect(row.revision).toBe(9)
    else expect((row.settings as { revision: number }).revision).toBe(plugin.label === 'recap' ? 7 : 3)
    await domain.close()
    expect(readFileSync(source)).toEqual(original)
  })
})

describe.each(plugins)('$label visible failures leave the source unchanged', plugin => {
  it('rejects malformed JSON without replacing the source or leaking an open domain', async () => {
    const root = scratchRoot()
    const source = sourcePath(root, plugin.spec.name)
    writeFileSync(source, '{"unit":')
    const original = readFileSync(source)
    const facility = openHost(root)
    await expect(openPlugin(facility, plugin.spec)).rejects.toMatchObject({ code: 'malformed-medium' })
    expect(facility.get(plugin.spec.name)).toBeUndefined()
    expect(readFileSync(source)).toEqual(original)
    await expect(openPlugin(facility, plugin.spec)).rejects.toMatchObject({ code: 'malformed-medium' })
    expect(facility.get(plugin.spec.name)).toBeUndefined()
    expect(backups(root)).toEqual([])
  })

  it('rejects a future version legacy file without treating it as empty', async () => {
    const root = scratchRoot()
    const source = sourcePath(root, plugin.spec.name)
    writeSingle(root, plugin.spec.name, plugin.spec.version + 5, 'state', plugin.key, plugin.record(plugin.spec.version))
    const original = readFileSync(source)
    const facility = openHost(root)
    await expect(openPlugin(facility, plugin.spec)).rejects.toMatchObject({ code: 'version-mismatch' })
    expect(facility.get(plugin.spec.name)).toBeUndefined()
    expect(readFileSync(source)).toEqual(original)
    await expect(openPlugin(facility, plugin.spec)).rejects.toMatchObject({ code: 'version-mismatch' })
    expect(facility.get(plugin.spec.name)).toBeUndefined()
    expect(backups(root)).toEqual([])
  })

  it('rejects invalid schema without replacing the source or backing up records', async () => {
    const root = scratchRoot()
    const source = sourcePath(root, plugin.spec.name)
    writeSingle(root, plugin.spec.name, plugin.stamps[0], 'state', plugin.key, plugin.invalid)
    const original = readFileSync(source)
    const facility = openHost(root)
    await expect(openPlugin(facility, plugin.spec)).rejects.toMatchObject({ code: 'invalid-record' })
    expect(facility.get(plugin.spec.name)).toBeUndefined()
    expect(readFileSync(source)).toEqual(original)
    await expect(openPlugin(facility, plugin.spec)).rejects.toMatchObject({ code: 'invalid-record' })
    expect(facility.get(plugin.spec.name)).toBeUndefined()
    expect(backups(root)).toEqual([])
  })
})

describe.each(plugins)('$label missing domain', plugin => {
  it('opens a fresh empty domain and can write then reopen', async () => {
    const root = scratchRoot()
    const facility = openHost(root)
    const first = await openPlugin(facility, plugin.spec)
    expect([...first.table('state').entries()]).toEqual([])
    await first.table('state').put(plugin.key, plugin.record(plugin.spec.version) as never)
    await first.close()
    const again = await openPlugin(facility, plugin.spec)
    plugin.preserved(again.table('state').get(plugin.key) as Record<string, unknown>, plugin.spec.version)
    await again.close()
  })
})
