export type InputSnapshot = {
  draft: string
  phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting' | 'sending'
}
export type ComposerActions = {
  captureInsertion(): unknown
  insertText(text: string, span: unknown): boolean
  setDraft(text: string): void
  persistDraft(): void
}
export type FillDraft = (input: { sessionId: string; text: string; viewId?: string }) => Promise<'filled' | 'rejected'>

export function fillComposerDraft(input: InputSnapshot, actions: ComposerActions | undefined, text: string, replace: boolean): boolean {
  if (!actions || input.phase !== 'plain') return false
  if (replace || input.draft.trim() === '') actions.setDraft(text)
  else {
    const captured = actions.captureInsertion()
    const span = captured !== null && typeof captured === 'object'
      ? { ...captured, start: input.draft.length, end: input.draft.length }
      : captured
    if (!actions.insertText(`\n\n${text}`, span)) return false
  }
  actions.persistDraft()
  return true
}
