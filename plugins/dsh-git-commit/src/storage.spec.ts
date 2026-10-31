import { describe, expect, it } from 'vitest'
import { defaultSettings } from './contracts.ts'
import { parseSettings, updateSettingsSchema } from './storage.ts'

describe('git commit settings row', () => {
  it('reads a row written before the fallback flag as the safe default', () => {
    // Version 1 rows have no flag at all, and an absent flag must never mean
    // "commit anyway": the run rejects until the user opts in.
    const parsed = parseSettings({ revision: 3, model: { provider: 'deepseek', model: 'deepseek-chat' } })
    expect(parsed.revision).toBe(3)
    expect(parsed.allowFallback).toBe(false)
  })

  it('keeps an explicit opt-in and drops a row whose flag is not a boolean', () => {
    const row = { revision: 1, model: { provider: 'deepseek', model: 'deepseek-chat' } }
    expect(parseSettings({ ...row, allowFallback: true }).allowFallback).toBe(true)
    // A flag of the wrong type invalidates the row like any other bad field, and
    // the defaults it falls back to have the flag off.
    expect(parseSettings({ ...row, allowFallback: 'yes' })).toEqual(defaultSettings())
  })

  it('falls back to defaults for a row it cannot read', () => {
    expect(parseSettings({ revision: 'one', model: {} })).toEqual(defaultSettings())
  })

  it('accepts the flag in a patch and rejects unknown keys', () => {
    const patched = updateSettingsSchema.safeParse({
      expectedRevision: 0,
      settings: { model: { provider: '', model: '' }, allowFallback: true },
    })
    expect(patched.success).toBe(true)
    expect(updateSettingsSchema.safeParse({ expectedRevision: 0, settings: { model: {}, nope: 1 } }).success).toBe(false)
  })
})
