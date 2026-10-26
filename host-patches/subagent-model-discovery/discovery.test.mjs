import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { buildModelCatalog, modelAvailable } from '../../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/catalog.js'
import { listSubagentModels, discoveryDescription } from './list-models.mjs'
import { patchHostFile, targets } from './patch.mjs'

const signal = () => new AbortController().signal
const route = (model, provider = 'p') => ({ provider, model })
function setup(routes = [route('visible'), route('vendor/hidden')]) {
  const calls = { catalogs: [], resolved: [] }
  const llm = {
    listProviders: () => [{ id: 'p', name: 'Provider' }],
    listModels: async provider => { calls.catalogs.push(provider); return [{ id: 'visible', name: 'Visible' }, { id: 'not-authorized', name: 'Private' }] },
    resolveModelInfo: async (provider, model, cancellation) => {
      calls.resolved.push({ provider, model, cancellation })
      return { id: model, name: model, reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }
    },
  }
  const ctx = { get: () => llm }
  const policy = { routes }
  return { llm, ctx, policy, calls, call: async (args = {}, cancellation = signal()) => JSON.parse(await listSubagentModels(ctx, policy, args, cancellation)) }
}

test('lists all authorized routes, including an unadvertised exact model, with separate ids', async () => {
  const host = setup()
  const result = await host.call()
  assert.deepEqual(result.models.map(row => [row.provider, row.model]), [['p', 'visible'], ['p', 'vendor/hidden']])
  assert.equal(result.models[1].catalog.advertised, false)
  assert.equal(result.models[1].metadata.status, 'resolved')
  assert.equal(result.callability, 'not-tested')
  assert.equal(result.settingsChangesApplyTo, 'new-top-level-sessions')
  assert.deepEqual(result.models[1].reasoningEfforts, [{ id: 'high', name: 'High' }])
  assert.equal(result.models[1].defaultReasoningEffort, 'high')
  assert.deepEqual(host.calls.catalogs, ['p'])
  assert(!JSON.stringify(result).includes('not-authorized'))
})

test('retains an unregistered allowed provider and its models', async () => {
  const host = setup([route('visible'), route('missing-model', 'missing')])
  const result = await host.call()
  assert.equal(result.models[1].providerRegistered, false)
  assert.equal(result.models[1].metadata.error.code, 'NO_ADAPTER')
  assert.equal(host.calls.resolved.length, 1)
  assert.equal((await host.call({ provider: 'missing' })).models.length, 1)
})

test('catalog errors and missing credentials remain visible alongside metadata', async () => {
  for (const code of ['MISSING_CREDENTIAL', 'INVALID_CATALOG']) {
    const host = setup()
    host.llm.listModels = async () => { throw Object.assign(new Error('secret-token=do-not-leak'), { code }) }
    const result = await host.call({ provider: 'p' })
    assert.equal(result.models.length, 2)
    assert.equal(result.models[0].catalog.error.code, code)
    assert.equal(result.models[0].metadata.status, 'resolved')
    assert(!JSON.stringify(result).includes('do-not-leak'))
  }
})

test('one failed model does not hide sibling models or emit raw exception details', async () => {
  const host = setup()
  host.llm.resolveModelInfo = async (_provider, model) => {
    if (model === 'vendor/hidden') throw Object.assign(new Error('private response'), { code: 'INVALID_CONFIG' })
    return { id: model, name: 'Visible' }
  }
  const result = await host.call()
  assert.equal(result.models[0].metadata.status, 'resolved')
  assert.deepEqual(result.models[0].reasoningEfforts, [])
  assert.equal(result.models[1].metadata.error.code, 'INVALID_CONFIG')
  assert(!JSON.stringify(result).includes('private response'))
})

test('unknown error text and codes are not reflected to the model', async () => {
  const host = setup()
  host.llm.resolveModelInfo = async () => { throw { code: 'key=private', message: 'sensitive endpoint' } }
  const result = await host.call()
  assert.equal(result.models[0].metadata.error.code, 'DISCOVERY_FAILED')
  assert(!JSON.stringify(result).includes('private'))
})

test('rejects unauthorized and malformed requests before accessing adapters', async () => {
  const host = setup()
  for (const args of [{ provider: 'other' }, { provider: 'p', model: 'not-authorized' }, { provider: 'p', model: 'p/vendor/hidden' }, { model: 'visible' }, { provider: '' }, { provider: 'p', model: '' }]) {
    await assert.rejects(() => host.call(args))
  }
  assert.deepEqual(host.calls.catalogs, [])
  assert.deepEqual(host.calls.resolved, [])
})

test('exact-model selection uses the supplied model id and forwards cancellation', async () => {
  const host = setup()
  const cancellation = signal()
  const result = await host.call({ provider: 'p', model: 'vendor/hidden' }, cancellation)
  assert.equal(result.models.length, 1)
  assert.equal(result.models[0].model, 'vendor/hidden')
  assert.equal(host.calls.resolved[0].cancellation, cancellation)
})

test('cancellation is never converted into a successful partial result', async () => {
  const host = setup()
  const controller = new AbortController()
  host.llm.listModels = async () => { controller.abort(); return [] }
  await assert.rejects(() => host.call({}, controller.signal), { name: 'AbortError' })
  assert.deepEqual(host.calls.resolved, [])
  const second = setup()
  second.llm.resolveModelInfo = async () => { throw new DOMException('cancelled', 'AbortError') }
  await assert.rejects(() => second.call(), { name: 'AbortError' })
})

test('uses the captured Session list even when unrelated settings change', async () => {
  const host = setup([route('original')])
  const globalSettings = { routes: [route('original')] }
  globalSettings.routes = [route('new')]
  assert.deepEqual((await host.call()).models.map(row => row.model), ['original'])
  await assert.rejects(() => host.call({ provider: 'p', model: 'new' }), /not allowed for this Session/)
})

test('missing LLM service remains an explicit failure', async () => {
  await assert.rejects(() => listSubagentModels({ get: () => undefined }, { routes: [route('visible')] }, {}, signal()), /service is unavailable/)
})

const toolPath = Object.keys(targets)[0]
const adapterPath = Object.keys(targets)[1]
const localSource = path => readFileSync(new URL('../../node_modules/' + path.slice('dsh/node_modules/'.length), import.meta.url))

test('patch refuses unrelated host versions and produces parsable code', () => {
  for (const path of [toolPath, adapterPath]) {
    assert.throws(() => patchHostFile(path, Buffer.from('unrelated host')), /Unsupported host code/)
    const before = localSource(path).toString('utf8')
    const patched = patchHostFile(path, before).toString('utf8')
    assert.doesNotThrow(() => new vm.SourceTextModule(patched))
    if (path === toolPath) {
      assert.equal(patched.slice(0, patched.indexOf('//#region lib/types/list-models.js')), before.slice(0, before.indexOf('//#region lib/types/list-models.js')))
      assert.equal(patched.slice(patched.indexOf('//#region lib/types/preset-selection.js')), before.slice(before.indexOf('//#region lib/types/preset-selection.js')))
    }
  }
})

test('patched native registration works through the real tool runtime', async () => {
  const source = patchHostFile(toolPath, localSource(toolPath)).toString('utf8')
  const start = source.indexOf('/** Session-authorized discovery;')
  const end = source.indexOf('//#endregion', start)
  const { registerListSubagentModels } = vm.runInNewContext(source.slice(start, end) + '\n({registerListSubagentModels})', { defineTool })
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const host = setup()
    ctx.provide('llm', host.llm)
    registerListSubagentModels(ctx, host.policy)
    assert.equal(ctx.tools.get('list_subagent_models').description, discoveryDescription)
    const result = await ctx.tools.execute({ name: 'list_subagent_models', callId: 'discovery-patch', arguments: {}, signal: signal() })
    assert.equal(result.isError, false)
    assert.equal(typeof result.value, 'string')
    assert.equal(result.content[0].text, result.value)
    assert.equal(JSON.parse(result.value).models.length, 2)
    const denied = await ctx.tools.execute({ name: 'list_subagent_models', callId: 'discovery-denied', arguments: { provider: 'other' }, signal: signal() })
    assert.equal(denied.isError, true)
  } finally {
    const tools = ctx.tools
    await ctx.fiber.dispose()
    assert.equal(tools.get('list_subagent_models'), undefined)
  }
})

test('patched pi-ai catalog propagates missing credentials instead of returning empty', async () => {
  const source = patchHostFile(adapterPath, localSource(adapterPath)).toString('utf8')
  const start = source.indexOf('\tlistModels(provider) {')
  const end = source.indexOf('\n\tresolveModel(provider,', start)
  const Adapter = vm.runInNewContext('(class Probe {\n' + source.slice(start, end) + '\n})', { LlmError })
  const adapter = new Adapter()
  adapter.current = () => ({ models: { getModels: () => [{ id: 'visible', name: 'Visible', input: ['text'] }] } })
  adapter.profileOf = () => ({})
  const missing = new LlmError('private credential reference', 'MISSING_CREDENTIAL')
  adapter.config = { resolveApiKey: async () => { throw missing } }
  const expected = 'Provider credentials are missing; configure them before selecting a model.'
  await assert.rejects(() => adapter.listModels('p'), error => error.code === 'MISSING_CREDENTIAL' && error.message === expected && error.cause === undefined)
  const browserContext = { llm: {
    listProviders: () => [{ id: 'p', name: 'Provider' }],
    listModels: provider => adapter.listModels(provider),
  } }
  const catalog = await buildModelCatalog(browserContext, { provider: 'p', model: 'visible' })
  assert.deepEqual(catalog.groups, [])
  assert.deepEqual(catalog.failures, [{ id: 'p', name: 'Provider', message: expected }])
  await assert.rejects(() => modelAvailable(browserContext, { provider: 'p', model: 'visible' }), error => error.message === expected)
  adapter.config.resolveApiKey = async () => 'test-only'
  assert.equal((await adapter.listModels('p'))[0].id, 'visible')
})
