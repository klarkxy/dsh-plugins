import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MODEL_ROUTE_MARKER } from './marker.ts'
import { modelRouteZod, withModelRouteMarker } from './zod.ts'

describe('zod binding', () => {
  it('parses empty input into the empty route', () => {
    expect(modelRouteZod().parse({})).toEqual({ provider: '', model: '' })
    expect(modelRouteZod().parse({ provider: 'a', model: 'b', reasoningEffort: 'high' }))
      .toEqual({ provider: 'a', model: 'b', reasoningEffort: 'high' })
  })

  it('carries the marker into zod JSON-schema output', () => {
    const projected = z.toJSONSchema(modelRouteZod({ purpose: 'summary' })) as Record<string, unknown>
    expect(projected[MODEL_ROUTE_MARKER]).toEqual({ purpose: 'summary' })
  })

  it('attaches the marker to an existing schema', () => {
    const schema = withModelRouteMarker(z.object({ provider: z.string(), model: z.string() }), { label: '标题' })
    const projected = z.toJSONSchema(schema) as Record<string, unknown>
    expect(projected[MODEL_ROUTE_MARKER]).toEqual({ label: '标题' })
  })
})
