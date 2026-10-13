import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import SettingsForms from '@deepseek-ai/dsh-settings'
import { detectModelFields } from '@klarkxy/dsh-model-route'
import { modelRouteSchemastery, modelRouteRoleSchemastery } from '@klarkxy/dsh-model-route/schemastery'
import { Config } from './index.ts'
import { buildProbeReport, listModelFields, planFieldWrite } from './probe.ts'
import { CAST_NAMESPACE, createCast } from './cast.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose() })

/** The native service owns projection and mutation; only its profile seam is in memory. */
async function nativeSettings(schema: typeof Config, initial: Record<string, unknown>, ns = '@klarkxy/dsh-model-hub') {
  const ctx = new Context()
  contexts.push(ctx)
  let stored = initial
  const entry = { id: ns, options: { id: ns, config: stored }, fiber: {
    uid: 1, state: 2, runtime: { Config: schema }, config: stored, ctx,
  } }
  ctx.provide('profileContext', { home: '.scratch/model-hub-no-profile', name: 'isolated-test' } as never)
  ctx.provide('loader', { await: async () => {} } as never)
  ctx.provide('configEditor', {
    configuration: () => [{ entry, inherited: {}, override: stored }], entries: () => [entry],
    edit: async (_entry: unknown, apply: (raw: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>) => {
      stored = apply(stored, {})
      entry.options.config = stored
      entry.fiber.config = schema(stored)
    },
  } as never)
  await ctx.plugin(SettingsForms)
  const descriptors = () => ctx.settings.describe({ redactSecrets: true })
  const mutate = async (payload: unknown) => {
    const row = payload as { ns: string; expectedRevision?: number }
    const entries = listModelFields(descriptors())
    const plan = planFieldWrite(entries, { ...row, expectedRevision: row.expectedRevision ?? entries.find(entry => entry.ns === row.ns)?.revision })
    await ctx.settings.mutate(plan.ns, plan.ops, plan.expectedRevision)
  }
  return { ctx, entry, descriptors, mutate, read: () => stored }
}

describe('native SettingsForms 0.2.0-rc.2 projection and mutation', () => {
  it('keeps the pinned native subagent current() usable through repair, enable and last-route removal', async () => {
    // Resolve this package's pinned test dependency directly;
    // Model Hub does not add a runtime copy of this host-provided service.
    const nativeRequire = createRequire(new URL('../package.json', import.meta.url))
    const { default: NativeSelection } = await import(pathToFileURL(nativeRequire.resolve('@deepseek-ai/dsh-tool-subagent/model-selection-settings')).href)
    const host = await nativeSettings(NativeSelection.Config, { enabled: true, allowedModels: [] }, CAST_NAMESPACE)
    const selection = new NativeSelection(host.ctx, {
      enabled: { get: () => host.read().enabled }, allowedModels: { get: () => host.read().allowedModels },
    })
    const cast = createCast({ describe: host.descriptors, mutate: (ns, ops, revision) => host.ctx.settings.mutate(ns, ops, revision) })
    expect(() => selection.current()).toThrow('at least one allowed model')
    await cast.setEnabled(false, cast.getCast().revision)
    expect(selection.current()).toEqual({ enabled: false, allowedModels: [] })
    await expect(cast.setEnabled(true, cast.getCast().revision)).rejects.toThrow('Add a model')
    await cast.addRoute({ provider: 'p', model: 'one' }, cast.getCast().revision)
    await cast.setEnabled(true, cast.getCast().revision)
    expect(selection.current()).toEqual({ enabled: true, allowedModels: [{ provider: 'p', model: 'one' }] })
    await cast.removeRoute(0, cast.getCast().revision)
    expect(selection.current()).toEqual({ enabled: false, allowedModels: [] })
  })
  it('retains sibling fields inside a shaped route and accepts a marked root transform', async () => {
    const route = Schema.object({ provider: Schema.string().default(''), model: Schema.string().default(''), reasoningEffort: Schema.string(), prompt: Schema.string() })
    const host = await nativeSettings(Schema.object({ reviewer: route }).volatile(), { reviewer: { provider: 'p', model: 'm', reasoningEffort: 'high', prompt: 'keep' } }, 'nested-siblings')
    await host.mutate({ ns: 'nested-siblings', path: ['reviewer'], route: { provider: 'new', model: 'changed' } })
    expect(host.read()).toEqual({ reviewer: { provider: 'new', model: 'changed', prompt: 'keep' } })
    await host.mutate({ ns: 'nested-siblings', path: ['reviewer'], route: {} })
    expect(host.read()).toEqual({ reviewer: { prompt: 'keep' } })
    const schema = Schema.transform(route, value => value).role('model-route', {}).volatile()
    const root = await nativeSettings(schema as never, { provider: 'p', model: 'm', prompt: 'keep root' }, 'wrapped-root')
    expect(listModelFields(root.descriptors())[0]!.fields[0]!.rootKeys).toEqual(['provider', 'model', 'reasoningEffort'])
    await root.mutate({ ns: 'wrapped-root', path: [], route: { provider: 'new', model: 'model' } })
    expect(root.read()).toEqual({ provider: 'new', model: 'model', prompt: 'keep root' })
  })
  it('preserves sibling settings declared on separate native intersection branches', async () => {
    const route = Schema.object({ provider: Schema.string().default(''), model: Schema.string().default(''), reasoningEffort: Schema.string() })
    for (const marked of [false, true]) {
      const combined = Schema.intersect([route, Schema.object({ prompt: Schema.string() })])
      if (marked) combined.role('model-route', {})
      const ns = `intersection-${marked}`
      const host = await nativeSettings(Schema.object({ reviewer: combined }).volatile(), { reviewer: { provider: 'p', model: 'm', reasoningEffort: 'high', prompt: 'keep' } }, ns)
      expect(listModelFields(host.descriptors())[0]!.fields[0]).toMatchObject({ preserveSiblings: true, writeKeys: ['provider', 'model', 'reasoningEffort'] })
      await host.mutate({ ns, path: ['reviewer'], route: { provider: 'new', model: 'changed' } })
      expect(host.read()).toEqual({ reviewer: { provider: 'new', model: 'changed', prompt: 'keep' } })
      await host.mutate({ ns, path: ['reviewer'], route: {} })
      expect(host.read()).toEqual({ reviewer: { prompt: 'keep' } })
    }
  })
  it('edits flat root model leaves without replacing sibling configuration or retaining old effort', async () => {
    const schema = Schema.object({ provider: Schema.string().default('default'), model: Schema.string().default('base'), reasoningEffort: Schema.string(), prompt: Schema.string() }).volatile()
    const host = await nativeSettings(schema, { provider: 'p', model: 'm', reasoningEffort: 'high', prompt: 'keep' }, 'root-route')
    await host.mutate({ ns: 'root-route', path: [], route: { provider: 'new', model: 'new-model' } })
    expect(host.read()).toEqual({ provider: 'new', model: 'new-model', prompt: 'keep' })
    await host.mutate({ ns: 'root-route', path: [], route: {} })
    expect(host.read()).toEqual({ prompt: 'keep' })
    expect(listModelFields(host.descriptors())[0]!.fields[0]!.current).toEqual({ provider: 'default', model: 'base' })
  })
  it('projects both hub self-test fields, preserving marker metadata and filtering ordinary fields', async () => {
    const schema = Schema.object({ ...Config.dict, ordinary: Schema.string() })
    const host = await nativeSettings(schema, { ordinary: 'private ordinary config', selfTestMeta: { provider: 'a', model: 'one' }, selfTestRole: { provider: 'b', model: 'two' } })
    const [descriptor] = host.descriptors()
    expect(descriptor!.schema).toHaveProperty('uid')
    expect(descriptor!.schema).toHaveProperty('refs')
    expect(descriptor!.value).not.toHaveProperty('ordinary')
    expect(buildProbeReport(host.descriptors()).selfTest).toMatchObject({ extraKey: 'marker', role: 'marker' })
    const fields = detectModelFields(descriptor!.schema, { value: descriptor!.value })
    expect(fields).toEqual([
      { path: ['selfTestMeta'], via: 'marker', marker: { purpose: 'self-test-meta', label: { zh: '自检字段（自定义键通道）', en: 'Self-test field (custom key)' } }, current: { provider: 'a', model: 'one' } },
      { path: ['selfTestRole'], via: 'marker', marker: { purpose: 'self-test-role', label: { zh: '自检字段（role 通道）', en: 'Self-test field (role)' } }, current: { provider: 'b', model: 'two' } },
    ])
    await host.mutate({ ns: descriptor!.ns, path: ['selfTestMeta'], route: { provider: 'new', model: 'route' } })
    expect(host.read().ordinary).toBe('private ordinary config')
    expect(host.read().selfTestRole).toEqual({ provider: 'b', model: 'two' })
  })

  it('detects unmarked native shapes and role markers without matching non-model fields', async () => {
    const schema = Schema.object({
      native: Schema.object({ provider: Schema.string(), model: Schema.union([Schema.string(), Schema.const(null)]) }).volatile(),
      marked: modelRouteRoleSchemastery({ purpose: 'role', custom: 'kept' } as never).volatile(),
      ordinary: Schema.object({ provider: Schema.number(), model: Schema.string() }).volatile(),
    })
    const host = await nativeSettings(schema, { native: { provider: 'a', model: 'b' }, marked: {}, ordinary: { provider: 3, model: 'ordinary' } })
    const fields = listModelFields(host.descriptors())[0]!.fields
    expect(fields.map(field => [field.path, field.via])).toEqual([[['native'], 'shape'], [['marked'], 'marker']])
    expect(fields[1]!.marker).toEqual({ purpose: 'role', custom: 'kept' })
  })

  it('writes concrete multiple and nested array entries without deleting their siblings', async () => {
    const schema = Schema.object({
      pool: Schema.array(modelRouteSchemastery()).volatile(),
      groups: Schema.array(Schema.object({ label: Schema.string(), model: modelRouteSchemastery() })).volatile(),
      empty: Schema.array(modelRouteSchemastery()).volatile(),
      nested: Schema.array(Schema.array(modelRouteSchemastery())).volatile(),
      ordinary: Schema.string(),
    })
    const host = await nativeSettings(schema, {
      pool: [{ provider: 'a', model: 'one' }, { provider: 'b', model: 'two' }],
      groups: [{ label: 'keep', model: { provider: 'g', model: 'three' } }], empty: [],
      nested: [[{ provider: 'n', model: 'four' }]], ordinary: 'keep',
    }, 'array-plugin')
    const entry = listModelFields(host.descriptors())[0]!
    expect(entry.fields.map(field => [field.path, field.current?.model, field.editable])).toEqual([
      [['pool', '0'], 'one', undefined], [['pool', '1'], 'two', undefined],
      [['groups', '0', 'model'], 'three', undefined], [['empty', '[]'], undefined, false],
      [['nested', '0', '0'], 'four', undefined],
    ])
    await host.mutate({ ns: entry.ns, path: ['pool', '1'], route: { provider: 'c', model: 'changed' }, expectedRevision: entry.revision })
    expect(host.read().pool).toEqual([{ provider: 'a', model: 'one' }, { provider: 'c', model: 'changed' }])
    await host.mutate({ ns: entry.ns, path: ['pool', '1'], route: {} })
    expect(host.read().pool).toEqual([{ provider: 'a', model: 'one' }, { provider: '', model: '' }])
    await host.mutate({ ns: entry.ns, path: ['nested', '0', '0'], route: { provider: 'x', model: 'nested' } })
    expect(host.read().nested).toEqual([[{ provider: 'x', model: 'nested' }]])
    await host.mutate({ ns: entry.ns, path: ['groups', '0', 'model'], route: { provider: 'x', model: 'group' } })
    expect(host.read().groups).toEqual([{ label: 'keep', model: { provider: 'x', model: 'group' } }])
    expect(host.read().ordinary).toBe('keep')
    await expect(host.mutate({ ns: entry.ns, path: ['empty', '[]'], route: { provider: 'x', model: 'bad' } })).rejects.toThrow('No collection item')
    await expect(host.mutate({ ns: entry.ns, path: ['groups', '0', 'label'], route: {} })).rejects.toThrow('Not a detected model field')
    await expect(host.mutate({ ns: entry.ns, path: ['pool', '1'], route: {}, expectedRevision: entry.revision })).rejects.toThrow('changed since')
    host.entry.fiber.config = { ...host.read(), pool: [] }
    host.entry.options.config = host.entry.fiber.config
    await expect(host.mutate({ ns: entry.ns, path: ['pool', '1'], route: {} })).rejects.toThrow('Not a detected model field')
  })
})
