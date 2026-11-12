import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './contracts.ts'
import { DEFAULT_ADDRESS, DEFAULT_PERSONA, PERSONA_MAX_CHARS } from './persona.ts'
import { parseSettings, patchSettings } from './settings.ts'
import { DotStore } from './store.ts'

describe('parseSettings', () => {
  it('fills defaults and keeps each valid field on its own', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    const parsed = parseSettings({ approvals: 'deny', questions: 'nonsense', taskPermission: 'inherit', approvalAllowlist: ['read'], notifyQuietSeconds: 30, awayMinutes: 20, model: { provider: 'p', model: 'm' } })
    expect(parsed.approvals).toBe('deny')
    expect(parsed.questions).toBe('dot')
    expect(parsed.taskPermission).toBe('workspace-write')
    expect(parsed).not.toHaveProperty('approvalAllowlist')
    expect(parsed).not.toHaveProperty('notifyQuietSeconds')
    expect(parsed).not.toHaveProperty('awayMinutes')
    expect(parsed.model).toEqual({ provider: 'p', model: 'm' })
    expect(parseSettings({ approvals: 'off' }).approvals).toBe('dot')
  })

  it('defaults a fresh install to workspace write and keeps a saved permission', () => {
    expect(DEFAULT_SETTINGS.taskPermission).toBe('workspace-write')
    expect(parseSettings({}).taskPermission).toBe('workspace-write')
    expect(parseSettings({ taskPermission: 'danger-full-access' }).taskPermission).toBe('danger-full-access')
    expect(parseSettings({ taskPermission: 'default' }).taskPermission).toBe('default')
    // An unknown value never replaces a known one.
    expect(parseSettings({ taskPermission: 'inherit' }).taskPermission).toBe('workspace-write')
  })

  it('reads the plural legacy permission name once, without guessing a shape', () => {
    expect(parseSettings({ taskPermissions: 'danger-full-access' }).taskPermission).toBe('danger-full-access')
    expect(parseSettings({ taskPermissions: 'workspace-write' }).taskPermission).toBe('workspace-write')
    expect(parseSettings({ taskPermissions: { mode: 'danger-full-access' } }).taskPermission).toBe('workspace-write')
    // The singular field wins over the legacy one.
    expect(parseSettings({ taskPermission: 'default', taskPermissions: 'danger-full-access' }).taskPermission).toBe('default')
  })

  it('falls back to the human for the removed blanket allow mode', () => {
    expect(parseSettings({ approvals: 'allow' }).approvals).toBe('human')
    expect(parseSettings({ approvals: 'dot' }).approvals).toBe('dot')
  })

  it('reads the deprecated policy text but never lets it be edited', () => {
    expect(parseSettings({ policy: 'ask before push' }).policy).toBe('ask before push')
    expect(() => patchSettings(DEFAULT_SETTINGS, { policy: 'new rules' })).toThrow(/unknown setting/)
  })
})

describe('patchSettings', () => {
  it('applies a valid patch and clears the model with null', () => {
    const withModel = patchSettings(DEFAULT_SETTINGS, { model: { provider: 'p', model: 'm', reasoningEffort: 'high' } })
    expect(withModel.model).toEqual({ provider: 'p', model: 'm', reasoningEffort: 'high' })
    expect(patchSettings(withModel, { model: null }).model).toBeUndefined()
  })

  it('stores a changed persona and address, and clears them back to the defaults', () => {
    const custom = patchSettings(DEFAULT_SETTINGS, { persona: 'A calm librarian.', address: ' 老板 ' })
    expect(custom.persona).toBe('A calm librarian.')
    expect(custom.address).toBe('老板')
    const restored = patchSettings(custom, { persona: null, address: null })
    expect(restored.persona).toBeUndefined()
    expect(restored.address).toBeUndefined()
    // Saving the default text keeps following the default.
    expect(patchSettings(custom, { persona: DEFAULT_PERSONA + '\n', address: DEFAULT_ADDRESS }).persona).toBeUndefined()
    expect(() => patchSettings(DEFAULT_SETTINGS, { address: '   ' })).toThrow(/address/)
    expect(parseSettings({ persona: 'x'.repeat(PERSONA_MAX_CHARS + 1), address: '小鱼' })).toMatchObject({ address: '小鱼' })
    expect(parseSettings({ persona: 'x'.repeat(PERSONA_MAX_CHARS + 1) }).persona).toBeUndefined()
  })

  it('uses a Chinese default persona without sibling roles', () => {
    expect(DEFAULT_PERSONA).toContain('你叫桃乐丝')
    expect(DEFAULT_PERSONA).toContain('简称 dot')
    expect(DEFAULT_PERSONA).not.toMatch(/姐姐|妹妹|鲸鱼娘|大肥鱼|粉色虎鲸|粉毛小狗|大小姐|sister|At work|Off duty|the human/i)
  })

  it('stores the task model list and keeps the default for settings saved before it existed', () => {
    expect(parseSettings({ approvals: 'human' }).taskModels).toEqual({ mode: 'all', list: [] })
    const next = patchSettings(DEFAULT_SETTINGS, { taskModels: { mode: 'deny', list: [' magpie/team/pro '] } })
    expect(next.taskModels).toEqual({ mode: 'deny', list: ['magpie/team/pro'] })
    expect(parseSettings(next).taskModels).toEqual(next.taskModels)
    expect(() => patchSettings(DEFAULT_SETTINGS, { taskModels: { mode: 'block', list: [] } })).toThrow(/taskModels/)
    expect(() => patchSettings(DEFAULT_SETTINGS, { taskModels: { mode: 'allow' } })).toThrow(/taskModels/)
    expect(parseSettings({ taskModels: { mode: 'allow', list: 'p/m' } }).taskModels).toEqual({ mode: 'all', list: [] })
  })

  it('refuses unknown keys and bad values as a whole', () => {
    expect(() => patchSettings(DEFAULT_SETTINGS, { colour: 'pink' })).toThrow(/unknown setting/)
    expect(() => patchSettings(DEFAULT_SETTINGS, { approvals: 'allowlist' })).toThrow(/approvals/)
    // The removed blanket allow mode cannot be set again.
    expect(() => patchSettings(DEFAULT_SETTINGS, { approvals: 'allow' })).toThrow(/approvals/)
    expect(() => patchSettings(DEFAULT_SETTINGS, { approvalAllowlist: ['read'] })).toThrow(/unknown setting/)
    expect(() => patchSettings(DEFAULT_SETTINGS, { notifyQuietSeconds: 30 })).toThrow(/unknown setting/)
    expect(() => patchSettings(DEFAULT_SETTINGS, { awayMinutes: 10 })).toThrow(/unknown setting/)
    expect(() => patchSettings(DEFAULT_SETTINGS, { taskPermission: 'inherit' })).toThrow(/taskPermission/)
    expect(() => patchSettings(DEFAULT_SETTINGS, 'off')).toThrow(/object/)
  })

  it('stores the task permission and the reflection switch', () => {
    const next = patchSettings(DEFAULT_SETTINGS, { taskPermission: 'danger-full-access', reflection: false })
    expect(next.taskPermission).toBe('danger-full-access')
    expect(next.reflection).toBe(false)
    expect(parseSettings(next).taskPermission).toBe('danger-full-access')
    expect(parseSettings(next).reflection).toBe(false)
  })

  it('keeps every setting unlocked by default and saves individual locks', () => {
    expect(parseSettings(undefined).locks).toBeUndefined()
    const next = patchSettings(DEFAULT_SETTINGS, { locks: { model: true, memory: false } })
    expect(next.locks).toEqual({ model: true, memory: false })
    expect(parseSettings(next).locks).toEqual(next.locks)
    expect(parseSettings({ locks: { model: true, taskPermission: true } }).locks).toEqual({ model: true, taskPermission: true })
    expect(() => patchSettings(DEFAULT_SETTINGS, { locks: { locks: true } })).toThrow()
  })
})

describe('DotStore settings', () => {
  it('keeps settings next to the dot session id', async () => {
    const rows = new Map<string, unknown>()
    const table = { entries: () => rows.entries(), get: (key: string) => rows.get(key), put: async (key: string, value: unknown) => { rows.set(key, value) } }
    const empty = new Map<string, unknown>()
    const domain = { table: (name: 'state' | 'tasks') => name === 'state' ? table : { entries: () => empty.entries(), get: () => undefined, put: async () => {} }, close: async () => {} }
    const store = new DotStore(domain)
    await store.setDot({ dotSessionId: 'dot1' })
    await store.setSettings(patchSettings(store.settings, { scope: 'tracked' }))
    const reloaded = new DotStore(domain)
    expect(reloaded.dotSessionId).toBe('dot1')
    expect(reloaded.settings.scope).toBe('tracked')
  })
})
