import { describe, expect, it } from 'vitest'
import type { TaskModelRule } from './contracts.ts'
import { TaskModelError, formatTaskModels, permits, permitted, pickTaskModel, type TaskModelCatalog } from './task-models.ts'

const catalog: TaskModelCatalog = {
  fallback: { provider: 'magpie', model: 'team/flash' },
  models: [
    { provider: 'magpie', model: 'team/flash', name: 'Flash' },
    { provider: 'magpie', model: 'team/pro', name: 'Pro' },
    { provider: 'other', model: 'team/pro', name: 'team/pro' },
    { provider: 'other', model: 'Mini', name: 'Mini' },
  ],
}
const any: TaskModelRule = { mode: 'all', list: [] }
const code = (work: () => unknown): string | undefined => {
  try { work(); return undefined } catch (error) { return error instanceof TaskModelError ? error.code : 'other' }
}

describe('task model rule', () => {
  it('allows, excludes or lets everything through by provider/model key', () => {
    expect(permits(any, 'magpie/team/pro')).toBe(true)
    expect(permits({ mode: 'allow', list: ['magpie/team/pro'] }, 'magpie/team/pro')).toBe(true)
    expect(permits({ mode: 'allow', list: ['magpie/team/pro'] }, 'other/team/pro')).toBe(false)
    expect(permits({ mode: 'deny', list: ['magpie/team/pro'] }, 'magpie/team/pro')).toBe(false)
    expect(permitted({ mode: 'deny', list: ['magpie/team/pro', 'gone/model'] }, catalog).map(model => model.model)).toEqual(['team/flash', 'team/pro', 'Mini'])
  })

  it('keeps the default when nothing is asked for and the default is allowed', () => {
    expect(pickTaskModel(any, catalog)).toBeUndefined()
    expect(pickTaskModel({ mode: 'deny', list: ['magpie/team/pro'] }, catalog)).toBeUndefined()
    expect(pickTaskModel({ mode: 'allow', list: ['magpie/team/flash'] }, catalog)).toBeUndefined()
  })

  it('resolves a full key, and a bare or differently cased id when it names one model', () => {
    expect(pickTaskModel(any, catalog, 'other/team/pro')).toEqual({ provider: 'other', model: 'team/pro' })
    expect(pickTaskModel(any, catalog, ' mini ')).toEqual({ provider: 'other', model: 'Mini' })
    expect(code(() => pickTaskModel(any, catalog, 'team/pro'))).toBe('dot/unknown-model')
    // The rule leaves one of the two, so the bare id is no longer ambiguous.
    expect(pickTaskModel({ mode: 'deny', list: ['other/team/pro'] }, catalog, 'team/pro')).toEqual({ provider: 'magpie', model: 'team/pro' })
    expect(code(() => pickTaskModel(any, catalog, 'nope'))).toBe('dot/unknown-model')
  })

  it('refuses an excluded model and names the allowed ones', () => {
    const rule: TaskModelRule = { mode: 'allow', list: ['magpie/team/flash', 'other/Mini'] }
    expect(code(() => pickTaskModel(rule, catalog, 'magpie/team/pro'))).toBe('dot/model-not-allowed')
    expect(() => pickTaskModel(rule, catalog, 'magpie/team/pro')).toThrow(/Allowed: magpie\/team\/flash, other\/Mini/)
  })

  it('asks for a choice when the default is excluded, unless one model is left', () => {
    expect(code(() => pickTaskModel({ mode: 'deny', list: ['magpie/team/flash'] }, catalog))).toBe('dot/model-not-allowed')
    expect(pickTaskModel({ mode: 'allow', list: ['other/Mini'] }, catalog)).toEqual({ provider: 'other', model: 'Mini' })
    expect(code(() => pickTaskModel({ mode: 'allow', list: [] }, catalog))).toBe('dot/model-not-allowed')
    expect(code(() => pickTaskModel({ mode: 'allow', list: ['gone/model'] }, catalog))).toBe('dot/model-not-allowed')
  })

  it('lists what dot may use and what a task gets without a model', () => {
    const open = formatTaskModels(any, catalog)
    expect(open).toContain('runs on magpie/team/flash, the default')
    expect(open).toContain('- magpie/team/flash "Flash"')
    expect(open).toContain('- other/team/pro\n')
    const narrowed = formatTaskModels({ mode: 'allow', list: ['other/Mini'] }, catalog)
    expect(narrowed).toContain('only on the models below')
    expect(narrowed).toContain('runs on other/Mini')
    expect(narrowed).not.toContain('magpie/team/pro')
    expect(formatTaskModels({ mode: 'allow', list: [] }, catalog)).toContain('leaves no model for tasks')
  })
})
