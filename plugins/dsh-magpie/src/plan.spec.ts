import { describe, expect, it } from 'vitest'
import { planDisconnect, planSync, type DesiredSync, type SettingsDescriptorLike } from './plan.ts'

const ROOT = 'http://127.0.0.1:3425'
const PROFILE = { displayName: 'Magpie', apiKeyEnv: 'MAGPIE_GATEWAY_KEY', api: 'openai-completions', baseURL: `${ROOT}/v1`, models: [{ id: 'm/1' }] }

function descriptor(ns: string, opts: { user?: unknown; value?: unknown; revision?: number } = {}): SettingsDescriptorLike {
  return { ns, user: opts.user, value: opts.value ?? opts.user ?? {}, revision: opts.revision ?? 0 }
}

const desired = (over: Partial<DesiredSync> = {}): DesiredSync => ({
  routes: { magpie: PROFILE },
  apiKeyEnv: 'MAGPIE_GATEWAY_KEY',
  defaultModel: 'm/1',
  webSearch: true,
  webSearchModel: 'm/2',
  ...over,
})

describe('planSync', () => {
  it('writes routes, default model, and web search on a cold profile', () => {
    const plan = planSync([
      descriptor('llm-pi-ai', { user: {} }),
      descriptor('agent-default-model', { user: {}, value: { provider: 'deepseek-official', model: 'deepseek-flash' } }),
      descriptor('web-search-deepseek', { user: {}, value: { apiKeyEnv: 'DEEPSEEK_API_KEY' } }),
    ], desired(), ROOT)
    const byNs = Object.fromEntries(plan.namespaces.map(item => [item.ns, item.ops]))
    expect(byNs['llm-pi-ai']).toEqual([{ op: 'set', path: ['providers', 'magpie'], value: PROFILE }])
    expect(byNs['agent-default-model']).toEqual([
      { op: 'set', path: ['provider'], value: 'magpie' },
      { op: 'set', path: ['model'], value: 'm/1' },
    ])
    expect(byNs['web-search-deepseek']).toEqual([
      { op: 'set', path: ['apiKeyEnv'], value: 'MAGPIE_GATEWAY_KEY' },
      { op: 'set', path: ['baseURL'], value: `${ROOT}/v1` },
      { op: 'set', path: ['model'], value: 'm/2' },
    ])
    expect(plan.warnings).toEqual([])
  })

  it('emits no ops when the user layer already matches', () => {
    const plan = planSync([
      descriptor('llm-pi-ai', { user: { providers: { magpie: PROFILE } } }),
      descriptor('agent-default-model', { user: { provider: 'magpie', model: 'm/1' }, value: { provider: 'magpie', model: 'm/1', reasoningEffort: 'high' } }),
      descriptor('web-search-deepseek', { user: { apiKeyEnv: 'MAGPIE_GATEWAY_KEY', baseURL: `${ROOT}/v1`, model: 'm/2' } }),
    ], desired(), ROOT)
    expect(plan.namespaces).toEqual([])
  })

  it('unsets a route the new listing dropped and keeps other providers', () => {
    const user = {
      providers: {
        magpie: PROFILE,
        'magpie-responses': { models: [{ id: 'x' }] },
        'magpie-anthropic': { models: [{ id: 'y' }] },
        other: { models: [] },
      },
    }
    const plan = planSync([descriptor('llm-pi-ai', { user })], desired(), ROOT)
    expect(plan.namespaces).toEqual([{
      ns: 'llm-pi-ai', revision: 0,
      ops: [
        { op: 'unset', path: ['providers', 'magpie-responses'] },
        { op: 'unset', path: ['providers', 'magpie-anthropic'] },
      ],
    }])
  })

  it('skips the default model when unset or not offered', () => {
    const off = planSync([descriptor('llm-pi-ai', { user: {} })], desired({ defaultModel: undefined }), ROOT)
    expect(off.namespaces).toHaveLength(1)
    const missing = planSync([
      descriptor('llm-pi-ai', { user: {} }), descriptor('agent-default-model', { user: {} }),
    ], desired({ defaultModel: 'not/there' }), ROOT)
    expect(missing.namespaces.map(item => item.ns)).not.toContain('agent-default-model')
    expect(missing.warnings[0]).toContain('not/there')
  })

  it('warns instead of writing web search with no model', () => {
    const plan = planSync([
      descriptor('llm-pi-ai', { user: {} }), descriptor('web-search-deepseek', { user: {} }),
    ], desired({ defaultModel: undefined, webSearchModel: undefined }), ROOT)
    expect(plan.namespaces.map(item => item.ns)).not.toContain('web-search-deepseek')
    expect(plan.warnings[0]).toContain('web search')
  })

  it('falls back to the default model for web search', () => {
    const plan = planSync([
      descriptor('llm-pi-ai', { user: {} }), descriptor('web-search-deepseek', { user: {} }),
    ], desired({ webSearchModel: undefined }), ROOT)
    const ops = plan.namespaces.find(item => item.ns === 'web-search-deepseek')?.ops
    expect(ops).toContainEqual({ op: 'set', path: ['model'], value: 'm/1' })
  })

  it('reverts web search only while it points at this gateway', () => {
    const ours = planSync([
      descriptor('web-search-deepseek', { user: { apiKeyEnv: 'MAGPIE_GATEWAY_KEY', baseURL: `${ROOT}/v1`, model: 'm/1' } }),
    ], desired({ webSearch: false }), ROOT)
    expect(ours.namespaces[0].ops).toEqual([
      { op: 'unset', path: ['apiKeyEnv'] },
      { op: 'unset', path: ['baseURL'] },
      { op: 'unset', path: ['model'] },
    ])
    const foreign = planSync([
      descriptor('web-search-deepseek', { user: { baseURL: 'https://api.example.com/v1' } }),
    ], desired({ webSearch: false }), ROOT)
    expect(foreign.namespaces).toEqual([])
  })
})

describe('planDisconnect', () => {
  it('removes the three routes and reverts dependent settings', () => {
    const plan = planDisconnect([
      descriptor('llm-pi-ai', { user: { providers: { magpie: PROFILE, 'magpie-responses': {}, other: {} } } }),
      descriptor('agent-default-model', { user: { provider: 'magpie-responses', model: 'x', reasoningEffort: 'high' } }),
      descriptor('web-search-deepseek', { user: { apiKeyEnv: 'MAGPIE_GATEWAY_KEY', baseURL: `${ROOT}/v1`, model: 'x' } }),
    ], ROOT)
    const byNs = Object.fromEntries(plan.namespaces.map(item => [item.ns, item.ops]))
    expect(byNs['llm-pi-ai']).toEqual([
      { op: 'unset', path: ['providers', 'magpie'] },
      { op: 'unset', path: ['providers', 'magpie-responses'] },
    ])
    expect(byNs['agent-default-model']).toEqual([
      { op: 'unset', path: ['provider'] },
      { op: 'unset', path: ['model'] },
    ])
    expect(byNs['web-search-deepseek']).toHaveLength(3)
  })

  it('leaves a foreign default model alone', () => {
    const plan = planDisconnect([
      descriptor('agent-default-model', { user: { provider: 'deepseek-official', model: 'deepseek-flash' } }),
    ], ROOT)
    expect(plan.namespaces).toEqual([])
  })
})
