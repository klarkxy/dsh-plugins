import { expect, it, vi } from 'vitest'
import { createFontSettingsStore, STORAGE_KEY } from './contracts.ts'
import { migrateFontPreferences, MIGRATION_KEY, type FontRole } from './preferences.ts'

it('migrates once per browser, preserves existing native choices and retains the legacy backup', () => {
  const data = new Map([[STORAGE_KEY, JSON.stringify({ uiFont: 'Old Sans', codeFont: 'Old Mono' })]])
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
  const families = { text: 'Native Sans', code: '', terminal: 'Native Terminal' }
  const setFontFamily = vi.fn((role: FontRole, value: string) => { families[role] = value })
  const theme = { getTheme: () => ({ fontFamilies: families, fontSizes: { text: 14, code: 14, terminal: 14 } }), setFontFamily, setFontSize: vi.fn() }
  const store = createFontSettingsStore(storage)
  migrateFontPreferences(theme, store, storage)
  expect(setFontFamily.mock.calls).toEqual([['code', 'Old Mono']])
  expect(data.get(MIGRATION_KEY)).toBe('1')
  expect(data.get(STORAGE_KEY)).toContain('Old Sans')
  families.code = ''
  migrateFontPreferences(theme, store, storage)
  expect(setFontFamily).toHaveBeenCalledTimes(1)
})
