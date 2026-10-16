import type { Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ShortcutBinding, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { PALETTE_ID } from './web-trigger.ts'

/** Explicit user action only. The native edit API has no multi-command transaction. */
export async function claimPaletteKey(shortcuts: Shortcuts): Promise<string | null> {
  const binding: ShortcutBinding = { code: 'KeyK', modifiers: ['control'] }
  const initial = shortcuts.config.getSnapshot()
  if (initial.status !== 'ready') return 'Shortcut preferences are not ready.'
  const description = shortcuts.describeBinding(binding)
  if (description.issue) return description.issue
  const conflicts = description.conflicts.filter(id => id !== PALETTE_ID)
  const search = 'session.search' as ShortcutCommandId
  if (conflicts.some(id => id !== search)) return `Conflicting shortcuts: ${conflicts.join(', ')}`
  let revision = initial.revision
  const profile = `${shortcuts.runtime}:${shortcuts.platform}` as const
  const overrides = initial.document.profiles[profile]
  const hadOverride = overrides != null && Object.hasOwn(overrides, search)
  const previous = overrides?.[search]
  let cleared = false
  if (conflicts.includes(search)) {
    const result = await shortcuts.edit({ type: 'set', id: search, binding: null }, revision)
    if (result.status !== 'saved') return result.status
    revision = result.snapshot.revision
    cleared = true
  }
  try {
    const result = await shortcuts.edit({ type: 'set', id: PALETTE_ID, binding }, revision)
    if (result.status === 'saved') return null
    // A stale result belongs to someone else's change; never overwrite it to roll back.
    if (cleared && result.status !== 'stale' && shortcuts.config.getSnapshot().revision === revision) {
      const rollback = await shortcuts.edit(hadOverride ? { type: 'set', id: search, binding: previous ?? null } : { type: 'reset', id: search }, revision)
      return rollback.status === 'saved' ? result.status : `${result.status}; restoring session search failed: ${rollback.status}`
    }
    return `${result.status}${cleared ? '; session search was unbound; review current shortcuts before retrying' : ''}`
  } catch (error) {
    // A rejected publish may already have committed; inspect rather than guessing a rollback.
    return `${String(error)}${cleared ? '; review session search and palette bindings' : ''}`
  }
}
