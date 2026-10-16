import { describe, expect, it, vi } from 'vitest'
import type { Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ShortcutConfigSnapshot, ShortcutEdit, ShortcutSaveResult } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { claimPaletteKey } from './takeover.ts'
import { PALETTE_ID } from './web-trigger.ts'

function fixture(statuses: ShortcutSaveResult['status'][] = ['saved', 'saved'], overrides = {}) {
  let snapshot = { revision: 'r0', status: 'ready', document: { schemaVersion: 1, profiles: { 'desktop:windows': overrides } } } as unknown as ShortcutConfigSnapshot
  const edit = vi.fn(async (_edit: ShortcutEdit, revision: string) => {
    expect(revision).toBe(snapshot.revision)
    const status = statuses.shift() ?? 'saved'
    if (status === 'saved' || status === 'stale') snapshot = { ...snapshot, revision: `r${Number(snapshot.revision.slice(1)) + 1}` as ShortcutConfigSnapshot['revision'] }
    return { status, snapshot }
  })
  const shortcuts = { runtime: 'desktop', platform: 'windows', config: { getSnapshot: () => snapshot }, describeBinding: () => ({ issue: null, conflicts: ['session.search'] }), edit } as unknown as Shortcuts
  return { shortcuts, edit }
}
describe('explicit Ctrl+K handover', () => {
  it('unbinds session search before binding palette, using each accepted revision', async () => {
    const { shortcuts, edit } = fixture()
    expect(await claimPaletteKey(shortcuts)).toBeNull()
    expect(edit.mock.calls.map(call => call[0])).toEqual([{ type: 'set', id: 'session.search', binding: null }, { type: 'set', id: PALETTE_ID, binding: { code: 'KeyK', modifiers: ['control'] } }])
  })
  it('restores an inherited search binding on failed second save', async () => {
    const { shortcuts, edit } = fixture(['saved', 'write-failed', 'saved'])
    expect(await claimPaletteKey(shortcuts)).toBe('write-failed')
    expect(edit.mock.calls[2]![0]).toEqual({ type: 'reset', id: 'session.search' })
  })
  it('restores explicit overrides as overrides instead of resetting', async () => {
    const binding = { code: 'KeyK', modifiers: ['control'] }
    const { shortcuts, edit } = fixture(['saved', 'write-failed', 'saved'], { 'session.search': binding })
    await claimPaletteKey(shortcuts)
    expect(edit.mock.calls[2]![0]).toEqual({ type: 'set', id: 'session.search', binding })
  })
  it('does not roll back over a concurrent edit', async () => {
    const { shortcuts, edit } = fixture(['saved', 'stale'])
    expect(await claimPaletteKey(shortcuts)).toContain('stale')
    expect(edit).toHaveBeenCalledTimes(2)
  })
  it('leaves every binding untouched when another command owns Ctrl+K', async () => {
    const { shortcuts, edit } = fixture()
    shortcuts.describeBinding = () => ({ binding: null, keys: [], issue: null, conflicts: ['other.command' as never] })
    expect(await claimPaletteKey(shortcuts)).toContain('other.command')
    expect(edit).not.toHaveBeenCalled()
  })
})
