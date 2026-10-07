import { describe, expect, it } from 'vitest'
import {
  defaultModelRoute, isModelRouteValue, modelRouteKey, modelRouteOverride,
  normalizeModelRoute, parseModelRouteKey, sameModelRoute,
} from './route.ts'

describe('model-route values', () => {
  it('normalizes malformed values to the empty route', () => {
    expect(normalizeModelRoute(undefined)).toEqual({ provider: '', model: '' })
    expect(normalizeModelRoute(null)).toEqual({ provider: '', model: '' })
    expect(normalizeModelRoute('deepseek')).toEqual({ provider: '', model: '' })
    expect(normalizeModelRoute([])).toEqual({ provider: '', model: '' })
    expect(normalizeModelRoute({ provider: 1, model: 'x' })).toEqual({ provider: '', model: '' })
    expect(normalizeModelRoute({ provider: ' p ', model: ' ' })).toEqual({ provider: '', model: '' })
    expect(normalizeModelRoute({ provider: 'x'.repeat(251), model: 'm' })).toEqual({ provider: '', model: '' })
  })

  it('keeps valid values, trims, and carries a bounded reasoning effort', () => {
    expect(normalizeModelRoute({ provider: ' deepseek ', model: ' chat ', reasoningEffort: ' high ' }))
      .toEqual({ provider: 'deepseek', model: 'chat', reasoningEffort: 'high' })
    expect(normalizeModelRoute({ provider: 'deepseek', model: 'chat' }))
      .toEqual({ provider: 'deepseek', model: 'chat' })
    expect(normalizeModelRoute({ provider: 'deepseek', model: 'chat', reasoningEffort: 'x'.repeat(81) }))
      .toEqual({ provider: 'deepseek', model: 'chat' })
  })

  it('recognizes route-shaped values without demanding content', () => {
    expect(isModelRouteValue(defaultModelRoute())).toBe(true)
    expect(isModelRouteValue({ provider: 'a', model: 'b' })).toBe(true)
    expect(isModelRouteValue({ provider: 'a' })).toBe(false)
    expect(isModelRouteValue('ab')).toBe(false)
  })

  it('collapses empty overrides and trims the rest', () => {
    expect(modelRouteOverride(undefined)).toBeUndefined()
    expect(modelRouteOverride({ provider: '', model: '' })).toBeUndefined()
    expect(modelRouteOverride({ provider: ' deepseek ', model: '' })).toBeUndefined()
    expect(modelRouteOverride({ provider: ' deepseek ', model: ' chat ', reasoningEffort: ' ' }))
      .toEqual({ provider: 'deepseek', model: 'chat' })
  })

  it('round-trips the internal route key without losing either part', () => {
    const key = modelRouteKey('deepseek', 'deepseek-chat')
    expect(key).toContain('deepseek')
    expect(key).toContain('deepseek-chat')
    expect(parseModelRouteKey(key)).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(modelRouteKey('', 'm')).toBe('')
    expect(parseModelRouteKey('')).toBeUndefined()
    expect(parseModelRouteKey('nokey')).toBeUndefined()
  })

  it('compares routes by target, treating two empty routes as equal', () => {
    expect(sameModelRoute(undefined, { provider: '', model: '' })).toBe(true)
    expect(sameModelRoute({ provider: 'a', model: 'b' }, { provider: 'a', model: 'b' })).toBe(true)
    expect(sameModelRoute({ provider: 'a', model: 'b' }, { provider: 'a', model: 'b', reasoningEffort: 'high' })).toBe(false)
    expect(sameModelRoute({ provider: 'a', model: 'b' }, { provider: 'a', model: 'c' })).toBe(false)
  })
})
