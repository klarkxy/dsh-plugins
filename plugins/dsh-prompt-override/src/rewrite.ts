import type { AssembledSection, PromptPresentation } from '@deepseek-ai/dsh-system-prompt'
import { CORE_CONTRACT, CORE_SECTION, DEV_CONTEXT_SECTIONS, DSH_SELF_MARKER, TOOL_APPENDS, TOOL_REWRITES } from './texts.ts'

/** How to treat DSH's own development sections. */
export type DevContextMode = 'auto' | 'keep' | 'drop'

/** Resolved rewrite switches. */
export interface RewriteSettings {
  /** Insert the general working contract. */
  core: boolean
  /** Rewrite the native per-tool sections. */
  tools: boolean
  /** `auto` drops them unless the assembly works on DSH itself. */
  devContext: DevContextMode
  /** User text per section name; `null` removes the section. Applied last. */
  sections: Readonly<Record<string, string | null>>
  /** User replacement for the working contract. */
  coreText?: string
}

const PERSONA = 'deployment:persona-prefix'
const IDENTITY = 'harness:identity'

/** Preset ids whose sessions work on DSH itself and keep the dev sections. */
const DSH_SELF_PRESETS: ReadonlySet<string> = new Set(['cordis'])

/** A replacement section never interpolates: our text and user text are literal. */
function literal(name: string, text: string): AssembledSection {
  return { name, text, interpolate: false }
}

/** Minimal agent shape the auto dev-context check reads; the host fills this. */
export interface AssemblyAgent {
  ctx?: { get?: (name: string) => unknown }
  session?: { header?: { agentPreset?: string } }
}

/**
 * Whether this assembly works on DSH itself and should keep the development
 * sections in `auto` mode.
 *
 * The authoritative signal is the agent's composed preset id (`cordis` is the
 * official DSH-customization preset); a persona without the marker sentence is
 * not enough, because an explicitly-composed subagent persona overrides the
 * preset's own text and would silently misclassify the child. When neither
 * signal is available the answer is `true` — dropping a context section the
 * session still needs is worse than keeping two paragraphs of dev notes.
 * @param persona - the assembled persona text (template form; interpolation happens later).
 * @param agent - the assembly's agent, when the host provides one.
 */
export function isDshSelfAssembly(persona: string | undefined, agent: unknown): boolean {
  const record = agent as AssemblyAgent | undefined
  if (record !== null && typeof record === 'object') {
    const viaCtx = typeof record.ctx?.get === 'function'
      ? (record.ctx.get('agentPresets') as { composedPreset?: (ctx: unknown) => string | undefined } | undefined)?.composedPreset?.(record.ctx)
      : undefined
    const preset = viaCtx ?? record.session?.header?.agentPreset
    if (typeof preset === 'string' && preset !== '') return DSH_SELF_PRESETS.has(preset)
  }
  // No preset signal: a blank persona carries no information either, so keep
  // the dev sections rather than guess from silence.
  if (persona === undefined || persona.trim() === '') return true
  return persona.includes(DSH_SELF_MARKER)
}

/**
 * Rewrite one assembly's sections. Contexts and variables pass through.
 *
 * A `complete` section (the `minimal` preset) is restored by the host after
 * the waterfall, so this function needs no special case for it.
 * @param presentation - the assembly returned by the rest of the waterfall.
 * @param settings - resolved switches.
 * @param agent - the assembly's agent, when the host provides one.
 * @returns a new presentation; the input is not mutated.
 */
export function rewriteSections(presentation: PromptPresentation, settings: RewriteSettings, agent?: unknown): PromptPresentation {
  const present = new Set(presentation.sections.filter(s => s.text.trim() !== '').map(s => s.name))
  const has = (name: string): boolean => present.has(name)
  const persona = presentation.sections.find(s => s.name === PERSONA)
  const dropDev = settings.devContext === 'drop'
    || (settings.devContext === 'auto' && !isDshSelfAssembly(persona?.text, agent))

  const out: AssembledSection[] = []
  for (const section of presentation.sections) {
    // A section the user explicitly re-declared in `sections` is never
    // auto-dropped: their replacement or removal applies below instead, so
    // "harness:source": "…" really rescues the section the drop would remove.
    const userDeclared = Object.hasOwn(settings.sections, section.name)
    if (!userDeclared && dropDev && DEV_CONTEXT_SECTIONS.includes(section.name)) continue
    const rewrite = settings.tools && !userDeclared ? TOOL_REWRITES[section.name] : undefined
    if (rewrite !== undefined && has(section.name)) {
      out.push(literal(section.name, rewrite(has)))
      continue
    }
    const extra = settings.tools && !userDeclared ? TOOL_APPENDS[section.name] : undefined
    if (extra !== undefined && section.text.trim() !== '') {
      out.push({ ...section, text: `${section.text}\n${extra}`, ...section.interpolate === undefined ? {} : { interpolate: section.interpolate } })
      continue
    }
    out.push(section)
  }

  const core = settings.coreText ?? CORE_CONTRACT
  if (settings.core && core.trim() !== '' && !out.some(s => s.name === CORE_SECTION)) {
    const anchor = Math.max(out.findIndex(s => s.name === PERSONA), out.findIndex(s => s.name === IDENTITY))
    out.splice(anchor + 1, 0, literal(CORE_SECTION, core))
  }

  for (const [name, text] of Object.entries(settings.sections)) {
    const index = out.findIndex(s => s.name === name)
    if (text === null) {
      if (index >= 0) out.splice(index, 1)
      continue
    }
    // A non-null replacement only lands on a non-empty section: this can never
    // un-hide a tool the assembling scope cannot see.
    if (index < 0 || out[index]!.text.trim() === '') continue
    out[index] = literal(name, text)
  }

  return { ...presentation, sections: out }
}
