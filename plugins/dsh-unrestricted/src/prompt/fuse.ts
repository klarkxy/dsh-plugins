/**
 * Structural prompt fusion for the `unrestricted` preset.
 *
 * The host builds a fresh assembly for every request, so this module never
 * mutates its input and never tries to rewrite another preset's prompt. It
 * extends only sections that belong to the active session:
 *
 * - `deployment:persona-prefix`: keep the declared contract, append a selected
 *   profile body;
 * - `plan:policy`, `tools:ptc-only`, `tool:structured_output`: append a boundary
 *   note only when the host actually supplies the corresponding section.
 *
 * Missing personas are reported as `missing-persona`; the caller keeps the
 * static preset declaration as the fallback instead of blanking the prompt.
 */

import type { AssembledSection } from '@deepseek-ai/dsh-system-prompt'
import {
  CONTRACT_MARKER,
  PERSONA_POINTER,
  PERSONA_SENTENCE,
  PLAN_NOTE,
  PTC_NOTE,
  STRUCTURED_NOTE,
  contractBlock,
} from './contract.ts'

/** One assembled prompt section. */
export type FusedSection = AssembledSection

/** Options for one fusion pass. */
export interface FuseOptions {
  /** Optional profile text appended after the contract. */
  profileBody?: string
}

/** Result of one fusion pass. */
export interface FuseResult {
  sections?: FusedSection[]
  issues?: string[]
}

/** Append a note once, and only when the host supplied that section. */
function appendNote(sections: FusedSection[], name: string, note: string): void {
  const section = sections.find(entry => entry.name === name)
  if (section === undefined || section.text.trim() === '') return
  if (section.text.includes(note.trim())) return
  section.text = `${section.text}${note}`
}

/**
 * Fuse the contract into one assembly.
 * @param sections - sections from the `system-prompt/assemble` waterfall.
 * @param options - the selected profile body, if any.
 * @returns the fused section list, or a structured issue when no persona exists.
 */
export function fuseSections(sections: readonly FusedSection[], options: FuseOptions = {}): FuseResult {
  const personaIndex = sections.findIndex(section => section.name === 'deployment:persona-prefix')
  if (personaIndex < 0) return { issues: ['missing-persona'] }

  const persona = sections[personaIndex]!
  let personaText = persona.text
  if (!personaText.includes(CONTRACT_MARKER)) {
    const opening = personaText.trim() === ''
      ? `${PERSONA_SENTENCE}${PERSONA_POINTER}`
      : personaText.trimEnd()
    personaText = `${opening}\n\n${contractBlock()}`
  }
  const profile = options.profileBody?.trim() ?? ''
  if (profile !== '' && !personaText.includes(profile)) {
    personaText = `${personaText}\n\n${profile}`
  }

  const next: FusedSection[] = sections.map(section => ({ ...section }))
  next[personaIndex] = { ...next[personaIndex]!, text: personaText }
  appendNote(next, 'plan:policy', PLAN_NOTE)
  appendNote(next, 'tools:ptc-only', PTC_NOTE)
  appendNote(next, 'tool:structured_output', STRUCTURED_NOTE)
  return { sections: next }
}
