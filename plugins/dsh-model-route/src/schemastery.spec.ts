import { describe, expect, it } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { MODEL_ROUTE_MARKER, MODEL_ROUTE_ROLE, readModelRouteMarker } from './marker.ts'
import { detectModelFields } from './detect.ts'
import { modelRouteRoleSchemastery, modelRouteSchemastery } from './schemastery.ts'

describe('schemastery binding', () => {
  it('attaches the marker to the node metadata (extra-key channel)', () => {
    const schema = modelRouteSchemastery({ purpose: 'summary' })
    expect((schema.meta as Record<string, unknown>)[MODEL_ROUTE_MARKER]).toEqual({ purpose: 'summary' })
    expect(schema.type).toBe('object')
  })

  it('attaches the marker through the renderer-role channel', () => {
    const schema = modelRouteRoleSchemastery({ label: '标题' })
    expect(schema.meta.role).toBe(MODEL_ROUTE_ROLE)
    expect(schema.meta.extra).toEqual({ label: '标题' })
  })

  it('validates like a ModelRoute field', () => {
    expect(modelRouteSchemastery()(undefined)).toEqual({ provider: '', model: '' })
    expect(modelRouteSchemastery()({ provider: 'a', model: 'b' })).toEqual({ provider: 'a', model: 'b' })
  })

  it('reads both channels back from projected node shapes', () => {
    expect(readModelRouteMarker({ type: 'object', [MODEL_ROUTE_MARKER]: { purpose: 'p' } })).toEqual({ purpose: 'p' })
    expect(readModelRouteMarker({ type: 'object', 'x-cordis': { role: MODEL_ROUTE_ROLE, extra: { purpose: 'q' } } })).toEqual({ purpose: 'q' })
    expect(readModelRouteMarker({ type: 'object', role: MODEL_ROUTE_ROLE })).toEqual({})
  })

  it('detects a marked field inside a projected config schema', () => {
    const projected = {
      type: 'object',
      properties: {
        titleModel: {
          type: 'object',
          'x-cordis': { role: MODEL_ROUTE_ROLE, extra: { purpose: 'title' } },
          properties: { provider: { type: 'string' }, model: { type: 'string' } },
        },
      },
    }
    expect(detectModelFields(projected)).toEqual([{ path: ['titleModel'], via: 'marker', marker: { purpose: 'title' } }])
  })

  it('walks real native transforms and bounded cycles, without treating unknown list nodes as branches', () => {
    const route = Schema.object({ provider: Schema.string(), model: Schema.string() })
    const wrapped = Schema.object({ transformed: Schema.transform(route, value => value) })
    expect(detectModelFields(wrapped.toJSON())).toEqual([{ path: ['transformed'], via: 'shape' }])
    const cyclic = Schema.object({ child: Schema.lazy(() => cyclic), modelRoute: route })
    const fields = detectModelFields(cyclic.toJSON(), { maxDepth: 3 })
    expect(fields.map(field => field.path)).toEqual([['child', 'modelRoute'], ['modelRoute']])
    expect(detectModelFields({ type: 'unknown', list: [route.toJSON()] })).toEqual([])
  })
})
