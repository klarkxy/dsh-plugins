import type { AssembledSection, PromptPresentation } from '@deepseek-ai/dsh-system-prompt'
import { CORE_CONTRACT, CORE_SECTION, DEV_CONTEXT_SECTIONS, DSH_SELF_MARKER, TOOL_REWRITES } from './texts.ts'

/** How to treat DSH's own development sections. */
export type DevContextMode = 'auto' | 'keep' | 'drop'

/** Resolved rewrite switches. */
export interface RewriteSettings {
  /** Insert the general working contract. */
  core: boolean
  /** Rewrite the native per-tool sections. */
  tools: boolean
  /** `auto` drops them unless the persona says the session works on DSH itself. */
  devContext: DevContextMode
  /** User text per section name; `null` removes the section. Applied last. */
  sections: Readonly<Record<string, string | null>>
  /** User replacement for the working contract. */
  coreText?: string
}

const PERSONA = 'deployment:persona-prefix'
const IDENTITY = 'harness:identity'

/** A replacement section never interpolates: our text and user text are literal. */
function literal(name: string, text: string): AssembledSection {
  return { name, text, interpolate: false }
}

/**
 * Rewrite one assembly's sections. Contexts and variables pass through.
 *
 * A `complete` section (the `minimal` preset) is restored by the host after
 * the waterfall, so this function needs no special case for it.
 * @param presentation - the assembly returned by the rest of the waterfall.
 * @param settings - resolved switches.
 * @returns a new presentation; the input is not mutated.
 */
export function rewriteSections(presentation: PromptPresentation, settings: RewriteSettings): PromptPresentation {
  const present = new Set(presentation.sections.filter(s => s.text.trim() !== '').map(s => s.name))
  const has = (name: string): boolean => present.has(name)
  const persona = presentation.sections.find(s => s.name === PERSONA)
  const dropDev = settings.devContext === 'drop'
    || (settings.devContext === 'auto' && !(persona?.text.includes(DSH_SELF_MARKER) ?? false))

  const out: AssembledSection[] = []
  for (const section of presentation.sections) {
    if (dropDev && DEV_CONTEXT_SECTIONS.includes(section.name)) continue
    const rewrite = settings.tools ? TOOL_REWRITES[section.name] : undefined
    out.push(rewrite !== undefined && has(section.name) ? literal(section.name, rewrite(has)) : section)
  }

  const core = settings.coreText ?? CORE_CONTRACT
  if (settings.core && core.trim() !== '' && !out.some(s => s.name === CORE_SECTION)) {
    const anchor = Math.max(out.findIndex(s => s.name === PERSONA), out.findIndex(s => s.name === IDENTITY))
    out.splice(anchor + 1, 0, literal(CORE_SECTION, core))
  }

  for (const [name, text] of Object.entries(settings.sections)) {
    const index = out.findIndex(s => s.name === name)
    if (index < 0) continue
    if (text === null) out.splice(index, 1)
    else if (out[index]!.text.trim() !== '') out[index] = literal(name, text)
  }

  return { ...presentation, sections: out }
}
