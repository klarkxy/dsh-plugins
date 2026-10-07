import { describe, expect, it } from 'vitest'
import { MODEL_ROUTE_MARKER, modelRouteMarker, readModelRouteMarker } from './marker.ts'
import { detectModelFields, hasModelRouteShape } from './detect.ts'

const ROUTE_NODE = {
  type: 'object',
  properties: {
    provider: { type: 'string', default: '' },
    model: { type: 'string', default: '' },
    reasoningEffort: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
}

describe('model-route marker', () => {
  it('round-trips through a projected node', () => {
    const node = { type: 'object', ...modelRouteMarker({ purpose: 'summary', label: '总结模型' }) }
    expect(node[MODEL_ROUTE_MARKER]).toEqual({ purpose: 'summary', label: '总结模型' })
    expect(readModelRouteMarker(node)).toEqual({ purpose: 'summary', label: '总结模型' })
  })

  it('accepts a bare true marker and rejects garbage', () => {
    expect(readModelRouteMarker({ [MODEL_ROUTE_MARKER]: true })).toEqual({})
    expect(readModelRouteMarker({ [MODEL_ROUTE_MARKER]: 'yes' })).toBeUndefined()
    expect(readModelRouteMarker({})).toBeUndefined()
    expect(readModelRouteMarker(null)).toBeUndefined()
  })
})

describe('detectModelFields', () => {
  it('finds a flat provider/model pair at the config root', () => {
    const found = detectModelFields(ROUTE_NODE)
    expect(found).toEqual([{ path: [], via: 'shape' }])
  })

  it('finds nested route objects and treats them as leaves', () => {
    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: ROUTE_NODE,
      },
    }
    const found = detectModelFields(schema)
    expect(found).toEqual([{ path: ['summary'], via: 'shape' }])
  })

  it('prefers the marker over shape and reports marker metadata', () => {
    const schema = {
      type: 'object',
      properties: {
        rerank: { type: 'object', ...modelRouteMarker({ purpose: 'rerank' }) },
      },
    }
    const found = detectModelFields(schema)
    expect(found).toEqual([{ path: ['rerank'], via: 'marker', marker: { purpose: 'rerank' } }])
  })

  it('walks anyOf branches, local $refs, and array items', () => {
    const schema = {
      type: 'object',
      $defs: { route: ROUTE_NODE },
      properties: {
        primary: { anyOf: [{ $ref: '#/$defs/route' }, { type: 'null' }] },
        pool: { type: 'array', items: { $ref: '#/$defs/route' } },
      },
    }
    const found = detectModelFields(schema)
    expect(found.map(field => field.path)).toEqual([['primary'], ['pool', '[]']])
    expect(found[1]).toMatchObject({ editable: false, arrayItem: true })
  })

  it('maps every existing array entry, including nested arrays, to its own value', () => {
    const schema = { type: 'object', properties: { groups: { type: 'array', items: { type: 'object', properties: { pool: { type: 'array', items: ROUTE_NODE } } } } } }
    const fields = detectModelFields(schema, { value: { groups: [{ pool: [{ provider: 'a', model: 'one' }, { provider: 'b', model: 'two' }] }, { pool: [] }] } })
    expect(fields).toEqual([
      { path: ['groups', '0', 'pool', '0'], via: 'shape', arrayItem: true, current: { provider: 'a', model: 'one' } },
      { path: ['groups', '0', 'pool', '1'], via: 'shape', arrayItem: true, current: { provider: 'b', model: 'two' } },
      { path: ['groups', '1', 'pool', '[]'], via: 'shape', editable: false, arrayItem: true },
    ])
  })

  it('does not mistake model catalog records or metadata for route fields', () => {
    const schema = { type: 'object', properties: { metadata: { type: 'object', properties: { provider: { type: 'number' }, model: { type: 'string' } } }, ordinary: { type: 'string', meta: { example: ROUTE_NODE } } }, $defs: { unused: ROUTE_NODE } }
    expect(detectModelFields(schema)).toEqual([])
    expect(detectModelFields({ type: 'object', properties: { route: { anyOf: [ROUTE_NODE, ROUTE_NODE] } } })).toEqual([{ path: ['route'], via: 'shape' }])
  })

  it('reads the live value at each path and cross-checks known models', () => {
    const schema = { type: 'object', properties: { summary: ROUTE_NODE } }
    const value = { summary: { provider: ' deepseek ', model: ' chat ', reasoningEffort: 'high' } }
    const found = detectModelFields(schema, {
      value,
      knownModel: route => route.provider === 'deepseek',
    })
    expect(found).toEqual([{
      path: ['summary'],
      via: 'shape',
      current: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' },
      known: true,
    }])
  })

  it('marks unknown routes instead of dropping them', () => {
    const found = detectModelFields(ROUTE_NODE, {
      value: { provider: 'gone', model: 'ghost' },
      knownModel: () => false,
    })
    expect(found[0]).toMatchObject({ known: false })
  })

  it('survives circular $refs within the depth budget', () => {
    const schema = {
      type: 'object',
      properties: { child: { $ref: '#' } },
    }
    expect(() => detectModelFields(schema)).not.toThrow()
    expect(detectModelFields(schema)).toEqual([])
  })

  it('hasModelRouteShape requires both string ids but not the effort', () => {
    expect(hasModelRouteShape(ROUTE_NODE)).toBe(true)
    expect(hasModelRouteShape({ type: 'object', properties: { provider: { type: 'string' } } })).toBe(false)
    expect(hasModelRouteShape({ type: 'string' })).toBe(false)
  })
})
