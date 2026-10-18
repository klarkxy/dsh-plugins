import { describe, expect, it } from 'vitest'
import {
  defaultModelRoute as sharedDefault, modelRouteOverride,
  normalizeModelRoute as sharedNormalize,
} from '@klarkxy/dsh-model-route'
import { defaultModelRoute, normalizeModelRoute } from './contracts.ts'
import { titleModelRoute } from './generate.ts'

describe('title model route contract', () => {
  it('re-exports the shared default and normalizer, including the 250/80 caps', () => {
    const samples = [
      undefined,
      null,
      [],
      { provider: ' p ', model: ' m ', reasoningEffort: ' high ' },
      { provider: 'x'.repeat(251), model: 'm' },
      { provider: 'a', model: 'b', reasoningEffort: 'y'.repeat(81) },
    ]
    expect(defaultModelRoute()).toEqual(sharedDefault())
    for (const sample of samples) expect(normalizeModelRoute(sample)).toEqual(sharedNormalize(sample))
  })

  it('does not trim the way modelRouteOverride does', () => {
    const normalized = { provider: 'deepseek', model: 'chat', reasoningEffort: 'low' }
    expect(titleModelRoute(normalized)).toEqual(modelRouteOverride(normalized))
    const raw = { provider: ' p ', model: 'm' }
    expect(titleModelRoute(raw)).toEqual({ provider: ' p ', model: 'm' })
    expect(modelRouteOverride(raw)).toEqual({ provider: 'p', model: 'm' })
    expect(titleModelRoute({ provider: '', model: '' })).toBeUndefined()
  })
})
