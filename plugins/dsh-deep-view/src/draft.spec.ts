import { describe, expect, it, vi } from 'vitest'
import { fillComposerDraft } from './draft.ts'

function fixture(draft = '', phase: 'plain' | 'sending' = 'plain') {
  return {
    input: { draft, phase },
    actions: {
      captureInsertion: vi.fn(() => ({ draftRev: 3 })),
      insertText: vi.fn(() => true),
      setDraft: vi.fn(),
      persistDraft: vi.fn(),
    },
  }
}

describe('composer draft filling', () => {
  it('fills and persists an empty composer without submitting', () => {
    const { input, actions } = fixture()
    expect(fillComposerDraft(input, actions, 'Choose One', false)).toBe(true)
    expect(actions.setDraft).toHaveBeenCalledWith('Choose One')
    expect(actions.persistDraft).toHaveBeenCalledOnce()
    expect(actions).not.toHaveProperty('submit')
  })
  it('offers revision-guarded append without replacing existing work', () => {
    const { input, actions } = fixture('Existing notes')
    expect(fillComposerDraft(input, actions, 'Choose One', false)).toBe(true)
    expect(actions.insertText).toHaveBeenCalledWith('\n\nChoose One', { draftRev: 3, start: 14, end: 14 })
    expect(actions.setDraft).not.toHaveBeenCalled()
  })
  it('replaces only on an explicit user choice', () => {
    const { input, actions } = fixture('Existing notes')
    expect(fillComposerDraft(input, actions, 'Choose One', true)).toBe(true)
    expect(actions.setDraft).toHaveBeenCalledWith('Choose One')
    expect(actions.insertText).not.toHaveBeenCalled()
  })
  it('refuses an in-flight submission or a changed draft', () => {
    const sending = fixture('Existing notes', 'sending')
    expect(fillComposerDraft(sending.input, sending.actions, 'Choose One', true)).toBe(false)
    expect(sending.actions.setDraft).not.toHaveBeenCalled()
    const changed = fixture('Existing notes')
    changed.actions.insertText.mockReturnValue(false)
    expect(fillComposerDraft(changed.input, changed.actions, 'Choose One', false)).toBe(false)
    expect(changed.actions.persistDraft).not.toHaveBeenCalled()
  })
  it('fails closed when a host has no composer adapter', () => {
    expect(fillComposerDraft({ draft: '', phase: 'plain' }, undefined, 'Choose One', false)).toBe(false)
  })
})
