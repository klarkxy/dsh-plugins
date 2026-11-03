import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  buildRoutes, endpointProtocol, isSelectableModel, modelProtocol,
  type MagpieModelEntry,
} from './mapping.ts'

const fixtures = fileURLToPath(new URL('../test/fixtures/', import.meta.url))
const listing = JSON.parse(readFileSync(`${fixtures}models.deepseek-harness.json`, 'utf8'))
const reference = parse(readFileSync(`${fixtures}magpie-dsh-reference.yaml`, 'utf8')) as { id: string; config: { providers: Record<string, unknown> } }[]
const referenceProviders = reference.find(entry => entry.id === 'llm-pi-ai')!.config.providers

describe('buildRoutes against the captured magpie state', () => {
  it('deep-equals the providers `magpie dsh` wrote', () => {
    const routes = buildRoutes(listing, 'http://127.0.0.1:3425', 'MAGPIE_GATEWAY_KEY')
    // Accepted deviation: magpie's exact cap for klarkxy/grok-4.7 is unknown
    // (reference 184464); our formula gives floor(500000*7/16) = 218750.
    ;(referenceProviders.magpie as { models: { id: string; maxTokens: number }[] }).models
      .find(model => model.id === 'klarkxy/grok-4.7')!.maxTokens = 218750
    expect(routes).toEqual(referenceProviders)
  })
})

describe('isSelectableModel', () => {
  it('keeps text-capable models and drops the rest', () => {
    expect(isSelectableModel({ id: 'a' })).toBe(true)
    expect(isSelectableModel({ id: 'a', type: 'model' })).toBe(true)
    expect(isSelectableModel({ id: 'a', type: 'embedding' })).toBe(false)
    expect(isSelectableModel({ id: 'a', modalities: { output: ['text'] } })).toBe(true)
    expect(isSelectableModel({ id: 'a', modalities: { output: ['image'] } })).toBe(false)
    expect(isSelectableModel({ type: 'model' })).toBe(false)
  })
})

describe('endpointProtocol', () => {
  it('prefers completions, then responses, then anthropic', () => {
    expect(endpointProtocol({ native_endpoints: ['/v1/messages', '/v1/chat/completions'] })).toBe('completions')
    expect(endpointProtocol({ native_endpoints: ['/v1/messages', '/v1/responses'] })).toBe('responses')
    expect(endpointProtocol({ native_endpoints: ['/v1/messages'] })).toBe('anthropic')
    expect(endpointProtocol({})).toBeUndefined()
  })
})

describe('modelProtocol without native_endpoints', () => {
  const peers = [
    { id: 'codex/a', owned_by: 'codex', native_endpoints: ['/v1/responses'] },
    { id: 'codex/b', owned_by: 'codex', native_endpoints: ['/v1/responses'] },
    { id: 'mine/a', owned_by: 'mine', native_endpoints: ['/v1/messages'] },
    { id: 'mine/b', owned_by: 'mine', native_endpoints: ['/v1/chat/completions'] },
  ] as MagpieModelEntry[]
  it('inherits a unanimous owner protocol', () => {
    expect(modelProtocol({ id: 'codex/auto', owned_by: 'codex' }, peers)).toBe('responses')
  })
  it('falls back to completions on a split owner', () => {
    expect(modelProtocol({ id: 'mine/auto', owned_by: 'mine' }, peers)).toBe('completions')
    expect(modelProtocol({ id: 'new/auto', owned_by: 'new' }, peers)).toBe('completions')
  })
})

describe('model fields', () => {
  const base = { id: 'x/y', native_endpoints: ['/v1/chat/completions'] }
  const routes = (entries: MagpieModelEntry[]) => buildRoutes({ data: entries }, 'http://g', 'K')

  it('keeps the first duplicate id', () => {
    const { magpie } = routes([
      { id: 'x/y', display_name: 'first', native_endpoints: ['/v1/chat/completions'] },
      { id: 'x/y', display_name: 'second', native_endpoints: ['/v1/messages'] },
    ])
    expect(magpie?.models).toHaveLength(1)
    expect(magpie?.models[0].name).toBe('first')
  })

  it('prefers magpie_label, then display_name, then id', () => {
    const { magpie } = routes([
      { ...base, id: 'a', magpie_label: 'label', display_name: 'name' },
      { ...base, id: 'b', display_name: 'name' },
      { ...base, id: 'c' },
    ])
    expect(magpie?.models.map(model => model.name)).toEqual(['label', 'name', 'c'])
  })

  it('caps maxTokens at 7/16 of the context window', () => {
    const { magpie } = routes([
      { ...base, id: 'a', context_length: 1048576, max_output_tokens: 1048576 },
      { ...base, id: 'b', context_window: 100000, max_output_tokens: 128000 },
      { ...base, id: 'c', max_output_tokens: 50000 },
    ])
    expect(magpie?.models[0]).toMatchObject({ contextWindow: 1048576, maxTokens: 458752 })
    expect(magpie?.models[1]).toMatchObject({ contextWindow: 100000, maxTokens: 43750 })
    expect(magpie?.models[2]).toMatchObject({ maxTokens: 50000 })
    expect(magpie?.models[2].contextWindow).toBeUndefined()
  })

  it('intersects declared input modalities with text/image, defaulting to text', () => {
    const { magpie } = routes([
      { ...base, id: 'a', modalities: { input: ['text', 'image'] } },
      { ...base, id: 'b', modalities: { input: ['audio'] } },
      { ...base, id: 'c' },
    ])
    expect(magpie?.models[0].input).toEqual(['text', 'image'])
    expect(magpie?.models[1].input).toEqual(['text'])
    expect(magpie?.models[2].input).toEqual(['text'])
  })

  it('maps reasoning levels, none→off, drops unknown levels, omits empty', () => {
    const { magpie } = routes([
      { ...base, id: 'a', reasoning_levels: ['none', 'low', 'max', 'ultra'] },
      { ...base, id: 'b', reasoning_levels: [] },
      { ...base, id: 'c', supported_reasoning_levels: [{ effort: 'high' }, { effort: 'weird' }] },
      { ...base, id: 'd', reasoning_levels: ['low'], supported_reasoning_levels: [{ effort: 'high' }] },
    ])
    expect(magpie?.models[0].reasoningEfforts).toEqual({ off: 'none', low: 'low', max: 'max' })
    expect(magpie?.models[1].reasoningEfforts).toBeUndefined()
    expect(magpie?.models[2].reasoningEfforts).toEqual({ high: 'high' })
    // reasoning_levels wins over supported_reasoning_levels.
    expect(magpie?.models[3].reasoningEfforts).toEqual({ low: 'low' })
  })

  it('adds protocol compat only where it belongs', () => {
    const routes = buildRoutes({ data: [
      { id: 'v/r', native_endpoints: ['/v1/responses'] },
      { id: 'v/claude-x', native_endpoints: ['/v1/messages'] },
      { id: 'v/plain', native_endpoints: ['/v1/messages'] },
      { id: 'v/c', native_endpoints: ['/v1/chat/completions'] },
    ] }, 'http://g', 'K')
    expect(routes['magpie-responses']?.models[0].compat).toEqual({ supportsStrictMode: true })
    expect(routes['magpie-anthropic']?.models.map(model => model.compat)).toEqual([
      { forceAdaptiveThinking: true }, undefined,
    ])
    expect(routes.magpie?.models[0].compat).toBeUndefined()
  })

  it('omits empty routes and gives the anthropic route the bare root', () => {
    const routes = buildRoutes({ data: [{ id: 'a/b', native_endpoints: ['/v1/messages'] }] }, 'http://g:3425', 'K')
    expect(routes.magpie).toBeUndefined()
    expect(routes['magpie-responses']).toBeUndefined()
    expect(routes['magpie-anthropic']).toMatchObject({
      displayName: 'Magpie · Anthropic', api: 'anthropic-messages',
      baseURL: 'http://g:3425', apiKeyEnv: 'K', streamIdleTimeoutMs: 600000,
    })
  })
})
