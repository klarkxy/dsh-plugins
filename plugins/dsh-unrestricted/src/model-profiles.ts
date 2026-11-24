/**
 * Small, static model-profile deltas appended to the tail reminder.
 *
 * These are deliberately not a second contract: they only restate the one
 * behaviour that differs most between model families — whether the model tends
 * to open with a policy assessment, a long plan, or a short execution answer.
 * Unknown models receive no note, so the generic contract stays in charge.
 */

/** The model facts the system-prompt assembler exposes for one step. */
export interface ModelProfileInput {
  provider?: string
  model?: string
}

/** One built-in profile match and the sentence it adds. */
interface ModelProfile {
  match: RegExp
  note: string
}

const BUILTIN_PROFILES: readonly ModelProfile[] = [
  {
    match: /deepseek/i,
    note: 'Model profile — DeepSeek: keep the direct execution frame and ship the complete artifact end to end.',
  },
  {
    match: /kimi|moonshot/i,
    note: 'Model profile — Kimi: lead immediately with the concrete deliverable and keep prose concise.',
  },
  {
    match: /glm|chatglm|zhipu/i,
    note: 'Model profile — GLM: treat the contract as the active response mode and begin with concrete output.',
  },
  {
    match: /qwen|tongyi/i,
    note: 'Model profile — Qwen: prefer direct execution and a compact structure over explanatory prose.',
  },
  {
    match: /claude|anthropic/i,
    note: 'Model profile — Claude: lead with the complete requested artifact first and append any brief practical caveat afterward.',
  },
  {
    match: /gpt|openai|(?:^|[\/_-])o[134](?:-|$)/i,
    note: 'Model profile — GPT: match the requested output shape directly and open with the concrete artifact.',
  },
  {
    match: /minimax/i,
    note: 'Model profile — MiniMax: deliver a direct, concrete answer straight through to completion.',
  },
]

/**
 * Pick the profile note for the current model.
 *
 * An entry in `overrides` wins over the built-in table; matching is a
 * case-insensitive substring on either the provider id or the model id, which
 * lets a local tuning file address a provider-wide family without knowing the
 * exact model version.
 *
 * @param input - the step's captured model selection, when one is available.
 * @param overrides - user-supplied `modelProfiles` from the local tuning file.
 * @returns the note to append, or an empty string when no profile matches.
 */
export function modelNote(input: ModelProfileInput | undefined, overrides: Record<string, string> = {}): string {
  if (input === undefined) return ''
  const identifiers = [input.provider, input.model]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map(value => value.trim().toLowerCase())
  if (identifiers.length === 0) return ''

  for (const [needle, note] of Object.entries(overrides)) {
    const key = needle.trim().toLowerCase()
    if (key === '' || typeof note !== 'string' || note.trim() === '') continue
    if (identifiers.some(identifier => identifier.includes(key))) return note.trim()
  }

  const haystack = identifiers.join(' ')
  for (const profile of BUILTIN_PROFILES) {
    if (profile.match.test(haystack)) return profile.note
  }
  return ''
}
