import { type FontSettingsStore, type FontSettingsStorage, normalizeFontFamily } from './contracts.ts'

export type FontRole = 'text' | 'code' | 'terminal'
export interface FontThemeSnapshot {
  fontSizes: Record<FontRole, number>
  fontFamilies: Record<FontRole, string>
}
export interface FontTheme {
  getTheme(): FontThemeSnapshot
  setFontSize(role: FontRole, px: number): void
  setFontFamily(role: FontRole, value: string): void
}
export const MIGRATION_KEY = 'klarkxy.dsh-font.host-preferences.v1'

/** Preserve the old selection as a backup, but never replay it over native
 * preferences on subsequent loads. Each role migrates independently. */
export function migrateFontPreferences(theme: FontTheme, store: FontSettingsStore, storage?: FontSettingsStorage): void {
  try { if (storage?.getItem(MIGRATION_KEY)) return } catch { return }
  const old = store.load()
  const families = theme.getTheme().fontFamilies
  for (const [role, value] of [['text', old.uiFont], ['code', old.codeFont], ['terminal', old.codeFont]] as const) {
    if (!families[role] && normalizeFontFamily(value)) theme.setFontFamily(role, value)
  }
  try { storage?.setItem(MIGRATION_KEY, '1') } catch { /* Host preferences still protect migrated nonempty roles. */ }
}
