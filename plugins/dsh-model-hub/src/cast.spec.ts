import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { buildCastPrompt, createCast, tendencyKey, CAST_NAMESPACE, type CastDeps } from './cast.ts'
import { apply } from './index.ts'

function setTendency(cast: ReturnType<typeof createCast>, provider: unknown, model: unknown, tendency: unknown) {
  return cast.setTendency(provider, model, tendency, cast.getCast().tendencyRevision)
}

type Op = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }

const dirs: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempProfile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'model-hub-cast-'))
  dirs.push(dir)
  return dir
}

/** Minimal host-settings double: CAS check, path ops with array splice semantics. */
function applyOps(value: Record<string, unknown>, ops: readonly Op[]): Record<string, unknown> {
  const root = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  for (const op of ops) {
    let parent: unknown = root
    for (const segment of op.path.slice(0, -1)) parent = (parent as Record<string, unknown>)[segment]
    const key = op.path[op.path.length - 1]!
    if (Array.isArray(parent)) {
      if (op.op === 'set') parent[Number(key)] = op.value
      else parent.splice(Number(key), 1)
    } else {
      const record = parent as Record<string, unknown>
      if (op.op === 'set') record[key] = op.value
      else Reflect.deleteProperty(record, key)
    }
  }
  return root
}

function host(initial: Record<string, unknown>, revision = 3) {
  let value = JSON.parse(JSON.stringify(initial)) as Record<string, unknown>
  let current = revision
  const mutate = vi.fn(async (ns: string, ops: readonly Op[], expected?: number) => {
    if (expected !== undefined && expected !== current) throw new Error(`Settings "${ns}" changed since revision ${expected}`)
    value = applyOps(value, ops)
    current += 1
  })
  const schema = {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      allowedModels: { type: 'array', items: { type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' } } } },
    },
  }
  return {
    mutate,
    describe: () => [{ ns: CAST_NAMESPACE, schema, value: JSON.parse(JSON.stringify(value)), revision: current }],
    value: () => value,
    revision: () => current,
  }
}

function castDeps(target: ReturnType<typeof host>, profileDir?: string, warn = vi.fn()) {
  const deps: CastDeps = { describe: target.describe, mutate: target.mutate, profileDir, logger: { warn } }
  return { deps, warn }
}

describe('getCast', () => {
  it('reads enabled state, revision and valid routes with their raw indexes', () => {
    const target = host({ enabled: true, allowedModels: [
      { provider: 'ocg', model: 'a' },
      'junk',
      null,
      { provider: '', model: 'x' },
      { provider: 'ocg', model: 'b', reasoningEffort: 'high' },
    ] })
    const cast = createCast(castDeps(target).deps)
    expect(cast.getCast()).toEqual({
      enabled: true,
      revision: 3,
      tendencyRevision: 0,
      routes: [
        { index: 0, provider: 'ocg', model: 'a' },
        { index: 4, provider: 'ocg', model: 'b', reasoningEffort: 'high' },
      ],
    })
  })

  it('throws a clear error when the native namespace is absent', () => {
    const cast = createCast({ describe: () => [], mutate: vi.fn(async () => {}) })
    expect(() => cast.getCast()).toThrow('native subagent-model-selection-settings not found')
  })

  it('treats a malformed descriptor value as disabled with no routes', () => {
    const cast = createCast({
      describe: () => [{ ns: CAST_NAMESPACE, schema: {}, value: 'garbage', revision: 7 }],
      mutate: vi.fn(async () => {}),
    })
    expect(cast.getCast()).toEqual({ enabled: false, revision: 7, tendencyRevision: 0, routes: [] })
  })
})

describe('cast writes', () => {
  for (const action of ['enable', 'add', 'set', 'remove'] as const) {
    it(`acknowledges ${action} even when descriptor reads fail after the native commit`, async () => {
      const target = host({ enabled: false, allowedModels: [{ provider: 'a', model: 'one' }, { provider: 'b', model: 'two' }] })
      let committed = false
      const describe = vi.fn(() => { if (committed) throw Error('descriptor read failed after commit'); return target.describe() })
      const cast = createCast({ describe, mutate: async (ns, ops, revision) => { await target.mutate(ns, ops, revision); committed = true } })
      const save = action === 'enable' ? cast.setEnabled(true, 3)
        : action === 'add' ? cast.addRoute({ provider: 'c', model: 'three' }, 3)
        : action === 'set' ? cast.setRoute(0, { provider: 'c', model: 'three' }, 3)
        : cast.removeRoute(0, 3)
      await expect(save).resolves.toEqual({ committed: true })
      expect(target.mutate).toHaveBeenCalledTimes(1)
      expect(target.revision()).toBe(4)
      expect(describe).toHaveBeenCalledTimes(1)
      expect(() => cast.getCast()).toThrow('descriptor read failed after commit')
    })
  }
  it('rejects enabling an empty list, and disables in the same commit when removing the last model', async () => {
    const target = host({ enabled: false, allowedModels: [] })
    const cast = createCast(castDeps(target).deps)
    await expect(cast.setEnabled(true, 3)).rejects.toThrow('Add a model')
    expect(target.mutate).not.toHaveBeenCalled()
    await cast.addRoute({ provider: 'a', model: 'one' }, 3)
    await cast.setEnabled(true, 4)
    const commit = await cast.removeRoute(0, 5)
    expect(target.mutate).toHaveBeenLastCalledWith(CAST_NAMESPACE, [
      { op: 'unset', path: ['allowedModels', '0'] }, { op: 'set', path: ['enabled'], value: false },
    ], 5)
    expect(commit).toEqual({ committed: true })
    expect(cast.getCast()).toMatchObject({ enabled: false, routes: [] })
  })

  it('repairs an existing enabled empty list by adding a model or switching it off', async () => {
    const target = host({ enabled: true, allowedModels: [] })
    const cast = createCast(castDeps(target).deps)
    expect(cast.getCast()).toMatchObject({ enabled: true, routes: [] })
    await cast.addRoute({ provider: 'a', model: 'one' }, 3)
    expect(target.value()).toEqual({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }] })
    await cast.removeRoute(0, 4)
    expect(target.value()).toEqual({ enabled: false, allowedModels: [] })
  })
  it('setEnabled issues one set op and acknowledges without inventing a native revision', async () => {
    const target = host({ enabled: true, allowedModels: [] })
    const cast = createCast(castDeps(target).deps)
    const commit = await cast.setEnabled(false, 3)
    expect(target.mutate).toHaveBeenCalledWith(CAST_NAMESPACE, [{ op: 'set', path: ['enabled'], value: false }], 3)
    expect(commit).toEqual({ committed: true })
    expect(cast.getCast()).toEqual({ enabled: false, revision: 4, tendencyRevision: 0, routes: [] })
  })

  it('rejects stale revisions before mutating and validates the revision itself', async () => {
    const target = host({ enabled: false, allowedModels: [] })
    const cast = createCast(castDeps(target).deps)
    await expect(cast.setEnabled(true, 2)).rejects.toThrow('Settings changed; refresh and retry')
    await expect(cast.setEnabled(true, undefined)).rejects.toThrow('A valid expected revision is required; refresh and retry')
    await expect(cast.setEnabled(true, -1)).rejects.toThrow('A valid expected revision is required; refresh and retry')
    await expect(cast.setEnabled(true, 1.5)).rejects.toThrow('A valid expected revision is required; refresh and retry')
    await expect(cast.setEnabled('yes', 3)).rejects.toThrow('Invalid enabled state')
    expect(target.mutate).not.toHaveBeenCalled()
  })

  it('addRoute appends at the raw array length, normalizes and rejects duplicates', async () => {
    const target = host({ enabled: false, allowedModels: ['junk', { provider: 'a', model: 'one' }] })
    const cast = createCast(castDeps(target).deps)
    const commit = await cast.addRoute({ provider: ' b ', model: ' two ', reasoningEffort: 'high' }, 3)
    expect(target.mutate).toHaveBeenCalledWith(CAST_NAMESPACE, [
      { op: 'set', path: ['allowedModels', '2'], value: { provider: 'b', model: 'two', reasoningEffort: 'high' } },
    ], 3)
    expect(commit).toEqual({ committed: true })
    expect(cast.getCast().routes).toEqual([
      { index: 1, provider: 'a', model: 'one' },
      { index: 2, provider: 'b', model: 'two', reasoningEffort: 'high' },
    ])
    await expect(cast.addRoute({ provider: 'b', model: 'two' }, 4)).rejects.toThrow('Route "b/two" already exists')
    expect(target.mutate).toHaveBeenCalledTimes(1)
  })

  it('addRoute validates route fields', async () => {
    const target = host({ enabled: false, allowedModels: [] })
    const cast = createCast(castDeps(target).deps)
    await expect(cast.addRoute({ provider: '', model: 'm' }, 3)).rejects.toThrow('non-empty provider and model ids')
    await expect(cast.addRoute({ provider: 'p' }, 3)).rejects.toThrow('non-empty provider and model ids')
    await expect(cast.addRoute({ provider: 'p'.repeat(251), model: 'm' }, 3)).rejects.toThrow('limited to 250 characters')
    await expect(cast.addRoute({ provider: 'p', model: 'm', reasoningEffort: ' ' }, 3)).rejects.toThrow('reasoning effort must be a non-empty string')
    await expect(cast.addRoute({ provider: 'p', model: 'm', reasoningEffort: 42 }, 3)).rejects.toThrow('reasoning effort must be a non-empty string')
    expect(target.mutate).not.toHaveBeenCalled()
  })

  it('setRoute rewrites one index, tolerates self-duplicates and malformed raw entries', async () => {
    const target = host({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }, 'junk'] })
    const cast = createCast(castDeps(target).deps)
    await cast.setRoute(0, { provider: 'a', model: 'one' }, 3)
    expect(target.mutate).toHaveBeenLastCalledWith(CAST_NAMESPACE, [
      { op: 'set', path: ['allowedModels', '0'], value: { provider: 'a', model: 'one' } },
    ], 3)
    const commit = await cast.setRoute(1, { provider: 'b', model: 'two' }, 4)
    expect(target.mutate).toHaveBeenLastCalledWith(CAST_NAMESPACE, [
      { op: 'set', path: ['allowedModels', '1'], value: { provider: 'b', model: 'two' } },
    ], 4)
    expect(commit).toEqual({ committed: true })
    expect(cast.getCast().routes).toEqual([
      { index: 0, provider: 'a', model: 'one' },
      { index: 1, provider: 'b', model: 'two' },
    ])
    await expect(cast.setRoute(1, { provider: 'a', model: 'one' }, 5)).rejects.toThrow('Route "a/one" already exists')
  })

  it('setRoute and removeRoute reject out-of-range indexes', async () => {
    const target = host({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }] })
    const cast = createCast(castDeps(target).deps)
    await expect(cast.setRoute(5, { provider: 'b', model: 'two' }, 3)).rejects.toThrow('Invalid route index')
    await expect(cast.setRoute(-1, { provider: 'b', model: 'two' }, 3)).rejects.toThrow('Invalid route index')
    await expect(cast.removeRoute('0', 3)).rejects.toThrow('Invalid route index')
    await expect(cast.removeRoute(1, 3)).rejects.toThrow('Invalid route index')
    expect(target.mutate).not.toHaveBeenCalled()
  })

  it('removeRoute splices the native array and re-indexes the remaining routes', async () => {
    const target = host({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }, { provider: 'b', model: 'two' }] })
    const cast = createCast(castDeps(target).deps)
    const commit = await cast.removeRoute(0, 3)
    expect(target.mutate).toHaveBeenCalledWith(CAST_NAMESPACE, [{ op: 'unset', path: ['allowedModels', '0'] }], 3)
    expect(commit).toEqual({ committed: true })
    expect(cast.getCast().routes).toEqual([{ index: 0, provider: 'b', model: 'two' }])
  })
})

describe('tendency store', () => {
  for (const [contents, message] of [
    ['{ not json', 'damaged'],
    [JSON.stringify({ schemaVersion: 7, tendencies: {} }), 'version is unsupported'],
    [JSON.stringify({ schemaVersion: 2, revision: 'bad', tendencies: {} }), 'schema is invalid'],
    [JSON.stringify({ schemaVersion: 1, tendencies: { bad: 'note' } }), 'schema is invalid'],
    [JSON.stringify({ schemaVersion: 1, tendencies: { [tendencyKey('a', 'one')]: 42 } }), 'schema is invalid'],
  ]) {
    it(`preserves a ${message} store, rejects writes and recovers after repair`, () => {
      const profileDir = tempProfile(), file = join(profileDir, 'data', 'model-hub', 'cast.json')
      mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, contents!)
      const target = host({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }] })
      const cast = createCast(castDeps(target, profileDir).deps)
      expect(cast.getCast()).toMatchObject({ tendencyError: expect.stringContaining(message!), routes: [{ index: 0, provider: 'a', model: 'one' }] })
      expect(cast.getCast().tendencyRevision).toBeUndefined()
      expect(() => cast.setTendency('a', 'one', 'new', 0)).toThrow(message)
      expect(readFileSync(file, 'utf8')).toBe(contents)
      expect(cast.promptText()).toContain('list_subagent_models')
      expect(cast.promptText()).not.toContain('User-provided task tendencies')
      expect(readFileSync(file, 'utf8')).toBe(contents)
      writeFileSync(file, JSON.stringify({ schemaVersion: 1, tendencies: { [tendencyKey('a', 'one')]: 'restored' } }))
      expect(cast.getCast()).toMatchObject({ tendencyRevision: 0, routes: [{ tendency: 'restored' }] })
      expect(cast.setTendency('a', 'one', 'new', 0).tendencyRevision).toBe(1)
    })
  }

  it('keeps an unreadable path and allows native repair while tendencies are unavailable', async () => {
    const profileDir = tempProfile(), file = join(profileDir, 'data', 'model-hub', 'cast.json')
    mkdirSync(file, { recursive: true }) // deterministic EISDIR on every platform
    const target = host({ enabled: true, allowedModels: [] })
    const cast = createCast(castDeps(target, profileDir).deps)
    expect(cast.getCast().tendencyError).toContain('cannot be read')
    expect(() => cast.setTendency('a', 'one', 'new', 0)).toThrow('cannot be read')
    expect(await cast.setEnabled(false, 3)).toEqual({ committed: true })
    expect(cast.getCast().enabled).toBe(false)
    rmSync(file, { recursive: true }); writeFileSync(file, JSON.stringify({ schemaVersion: 1, tendencies: {} }))
    expect(cast.getCast().tendencyError).toBeUndefined()
  })

  it('migrates v1 only on commit, checks durable CAS across instances and notifies after persistence', () => {
    const profileDir = tempProfile(), file = join(profileDir, 'data', 'model-hub', 'cast.json')
    mkdirSync(dirname(file), { recursive: true })
    const original = JSON.stringify({ schemaVersion: 1, tendencies: { [tendencyKey('a', 'one')]: 'old', [tendencyKey('b', 'two')]: 'keep' } })
    writeFileSync(file, original)
    const target = host({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }, { provider: 'b', model: 'two' }] })
    const notify = vi.fn(revision => { expect(JSON.parse(readFileSync(file, 'utf8')).revision).toBe(revision); throw Error('observer failed') })
    const first = createCast({ ...castDeps(target, profileDir).deps, notifyTendenciesChanged: notify })
    const second = createCast(castDeps(target, profileDir).deps)
    expect(first.getCast().tendencyRevision).toBe(0); expect(second.getCast().tendencyRevision).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(original)
    expect(first.setTendency('a', 'one', 'new', 0)).toMatchObject({ tendencyRevision: 1 })
    expect(notify).toHaveBeenCalledExactlyOnceWith(1)
    expect(() => second.setTendency('a', 'one', 'stale', 0)).toThrow('changed; refresh and retry')
    expect(second.getCast().routes[0]!.tendency).toBe('new')
    expect(second.setTendency('b', 'two', 'changed', 1).tendencyRevision).toBe(2)
    expect(first.getCast().routes.map(route => route.tendency)).toEqual(['new', 'changed'])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ schemaVersion: 2, revision: 2 })
    expect(target.mutate).not.toHaveBeenCalled()
  })

  it('does not persist or notify an aborted or failed write', () => {
    const profileDir = tempProfile(), file = join(profileDir, 'data', 'model-hub', 'cast.json')
    const target = host({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }] }), notify = vi.fn()
    const cast = createCast({ ...castDeps(target, profileDir).deps, notifyTendenciesChanged: notify })
    expect(() => cast.setTendency('a', 'one', 'new', 0, AbortSignal.abort())).toThrow()
    mkdirSync(`${file}.${process.pid}.tmp`, { recursive: true })
    expect(() => cast.setTendency('a', 'one', 'new', 0)).toThrow()
    expect(cast.getCast().tendencyRevision).toBe(0)
    expect(notify).not.toHaveBeenCalled()
  })
  it('stores trimmed tendencies atomically and merges them into the cast', () => {
    const profileDir = tempProfile()
    const target = host({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }, { provider: 'b', model: 'two' }] })
    const cast = createCast(castDeps(target, profileDir).deps)
    const state = setTendency(cast, 'a', 'one', '  careful code reviews  ')
    expect(state.routes[0]).toEqual({ index: 0, provider: 'a', model: 'one', tendency: 'careful code reviews' })
    expect(state.routes[1]).toEqual({ index: 1, provider: 'b', model: 'two' })
    const file = join(profileDir, 'data', 'model-hub', 'cast.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      schemaVersion: 2, revision: 1,
      tendencies: { [tendencyKey('a', 'one')]: 'careful code reviews' },
    })
    // A fresh instance reads the persisted store.
    const reloaded = createCast(castDeps(target, profileDir).deps)
    expect(reloaded.getCast().routes[0]!.tendency).toBe('careful code reviews')
    expect(target.mutate).not.toHaveBeenCalled()
  })

  it('deletes the key on an empty tendency and enforces the length limit', () => {
    const profileDir = tempProfile()
    const target = host({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }] })
    const cast = createCast(castDeps(target, profileDir).deps)
    expect(setTendency(cast, 'a', 'one', 'x'.repeat(500)).routes[0]!.tendency).toHaveLength(500)
    expect(() => setTendency(cast, 'a', 'one', 'x'.repeat(501))).toThrow('limited to 500 characters')
    expect(setTendency(cast, 'a', 'one', '   ').routes[0]).toEqual({ index: 0, provider: 'a', model: 'one' })
    const file = join(profileDir, 'data', 'model-hub', 'cast.json')
    expect(JSON.parse(readFileSync(file, 'utf8')).tendencies).toEqual({})
    expect(() => setTendency(cast, '', 'one', 'note')).toThrow('non-empty provider and model ids')
    expect(() => setTendency(cast, 'a', 'one', undefined)).toThrow('A tendency must be a string')
  })

  it('requires a profile directory for tendency writes but not for reads', () => {
    const target = host({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }] })
    const cast = createCast(castDeps(target).deps)
    expect(() => setTendency(cast, 'a', 'one', 'note')).toThrow('No profile directory')
    expect(cast.getCast().routes[0]).toEqual({ index: 0, provider: 'a', model: 'one' })
  })
})

describe('buildCastPrompt', () => {
  const routes = [
    { index: 0, provider: 'a', model: 'team/one', reasoningEffort: 'high', tendency: 'careful reviews' },
    { index: 1, provider: 'b', model: 'two' },
    { index: 2, provider: 'c', model: 'c/three', tendency: 'fast drafts' },
  ]

  it('stays empty when disabled or routeless', () => {
    expect(buildCastPrompt(false, routes)).toBe('')
    expect(buildCastPrompt(true, [])).toBe('')
  })

  it('guides explicit selection without inventing per-model tendencies', () => {
    const text = buildCastPrompt(true, [{ index: 0, provider: 'a', model: 'one' }])
    expect(text).toContain('list_subagent_models')
    expect(text).toContain('supply provider and model together explicitly')
    expect(text).toContain('do not copy the whole label into model')
    expect(text).toContain('{"provider":"example-provider","model":"team/model-a"}')
    expect(text).toContain('copy both exactly without stripping or adding any prefix')
    expect(text).toContain('prefer a model different from your own')
    expect(text).toContain('using the same model is appropriate')
    expect(text).toContain('Do not create extra subtasks solely for model diversity')
    expect(text).toContain('discovery results and tool schema are authoritative')
    expect(text).toContain('later list edits apply to new top-level Sessions')
    expect(text).toContain('explicit selection, not pure route inheritance')
    expect(text).toContain('do not invent routes or pass unsupported fields')
    expect(text).not.toContain('User-provided task tendencies')
    expect(text).not.toContain('a/one')
    expect(buildCastPrompt(true, [{ index: 0, provider: 'a', model: 'one', tendency: '   ' }])).toBe(text)
  })

  it('renders the guidance and one line per annotated route', () => {
    const text = buildCastPrompt(true, routes)
    expect(text).toContain('task tendencies')
    expect(text).toContain('advisory')
    expect(text).toContain('- {"provider":"a","model":"team/one"} (reasoning effort: high): careful reviews')
    expect(text).toContain('- {"provider":"c","model":"c/three"}: fast drafts')
    expect(text).not.toContain('b/two')
  })
})

describe('promptText', () => {
  it('keeps generic guidance when the tendency file is absent or the last note is cleared', () => {
    const profileDir = tempProfile()
    const target = host({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }] })
    const cast = createCast(castDeps(target, profileDir).deps)
    const generic = cast.promptText()
    expect(generic).toContain('supply provider and model together explicitly')
    expect(() => readFileSync(join(profileDir, 'data', 'model-hub', 'cast.json'))).toThrow()
    setTendency(cast, 'a', 'one', 'careful reviews')
    expect(cast.promptText()).toContain('- {"provider":"a","model":"one"}: careful reviews')
    setTendency(cast, 'a', 'one', '')
    expect(cast.promptText()).toBe(generic)
    expect(target.mutate).not.toHaveBeenCalled()
  })

  it('prefers the native service snapshot and merges stored tendencies', () => {
    const profileDir = tempProfile()
    const target = host({ enabled: false, allowedModels: [] })
    const { deps } = castDeps(target, profileDir)
    const cast = createCast(deps)
    setTendency(cast, 'a', 'one', 'careful reviews')
    const text = cast.promptText(() => ({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }] }))
    expect(text).toContain('- {"provider":"a","model":"one"}: careful reviews')
  })

  it('falls back to the settings descriptor when the service is missing or failing', () => {
    const profileDir = tempProfile()
    const target = host({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }] })
    const { deps } = castDeps(target, profileDir)
    const cast = createCast(deps)
    setTendency(cast, 'a', 'one', 'careful reviews')
    expect(cast.promptText(() => undefined)).toContain('- {"provider":"a","model":"one"}: careful reviews')
    expect(cast.promptText(() => { throw new Error('no routes configured') })).toContain('- {"provider":"a","model":"one"}: careful reviews')
    expect(cast.promptText(() => 'garbage')).toContain('- {"provider":"a","model":"one"}: careful reviews')
  })

  it('returns empty text when the selection is disabled or every source fails', () => {
    const target = host({ enabled: false, allowedModels: [{ provider: 'a', model: 'one' }] })
    const cast = createCast(castDeps(target).deps)
    expect(cast.promptText(() => ({ enabled: false, allowedModels: [{ provider: 'a', model: 'one' }] }))).toBe('')
    const broken = createCast({ describe: () => { throw new Error('settings unavailable') }, mutate: vi.fn(async () => {}) })
    expect(broken.promptText(() => { throw new Error('service down') })).toBe('')
  })
})

describe('apply wiring', () => {
  it('registers the cast section next to TOOL_SUBAGENT with literal interpolation', () => {
    const profileDir = tempProfile()
    const file = join(profileDir, 'data', 'model-hub', 'cast.json')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, tendencies: { [tendencyKey('a', 'one')]: 'careful reviews' } }))
    const target = host({ enabled: true, allowedModels: [{ provider: 'a', model: 'one' }] })
    const ctx = new Context()
    contexts.push(ctx)
    const section = vi.fn(() => () => {})
    ctx.provide('settings', { describe: () => target.describe(), mutate: target.mutate } as never)
    ctx.provide('webServer', { register: () => () => {} } as never)
    ctx.provide('connection', {} as never)
    ctx.provide('profileContext', { dir: profileDir } as never)
    ctx.provide('systemPrompt', { section, getSectionOrder: () => 2800 } as never)
    let current = { enabled: true, allowedModels: [{ provider: 'a', model: 'one' }] }
    ctx.provide('subagentModelSelection', { current: () => current } as never)
    apply(ctx)
    expect(section).toHaveBeenCalledOnce()
    const options = section.mock.calls[0]![0] as { name: string; order: number; interpolate: boolean; text: () => string }
    expect(options.name).toBe('model-hub:subagent-cast')
    expect(options.order).toBe(2801)
    expect(options.interpolate).toBe(false)
    expect(options.text()).toContain('- {"provider":"a","model":"one"}: careful reviews')
    current = { enabled: false, allowedModels: [{ provider: 'a', model: 'one' }] }
    expect(options.text()).toBe('')
  })
})
