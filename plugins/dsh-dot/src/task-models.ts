/**
 * Which model a task dot starts runs on. The human keeps a list in dot's
 * settings and says whether it allows or excludes; this file holds the pure
 * decisions, and the service applies them before a task's first prompt.
 */
import { TOOL, type ModelChoice, type TaskModelRule } from './contracts.ts'

export interface CatalogModel { readonly provider: string; readonly model: string; readonly name: string }

/** The host's model catalog as dot needs it. */
export interface TaskModelCatalog {
  /** Model of a new session that nobody picked one for. */
  readonly fallback?: ModelChoice
  readonly models: readonly CatalogModel[]
}

/** Models listed in one tool answer. */
export const LISTED_MODELS_MAX = 80

export class TaskModelError extends Error {
  constructor(readonly code: 'dot/unknown-model' | 'dot/model-not-allowed', message: string) { super(message); this.name = 'TaskModelError' }
}

export const modelKey = (choice: { readonly provider: string; readonly model: string }): string => `${choice.provider}/${choice.model}`

export function permits(rule: TaskModelRule, key: string): boolean {
  if (rule.mode === 'all') return true
  const listed = rule.list.includes(key)
  return rule.mode === 'allow' ? listed : !listed
}

/** Catalog models the rule lets a task run on, in catalog order. */
export function permitted(rule: TaskModelRule, catalog: TaskModelCatalog): CatalogModel[] {
  return catalog.models.filter(model => permits(rule, modelKey(model)))
}

const keys = (models: readonly CatalogModel[]): string => {
  const shown = models.slice(0, 12).map(modelKey).join(', ')
  return models.length > 12 ? `${shown}, and ${models.length - 12} more (${TOOL.listModels} lists them)` : shown
}

/**
 * The model to select for a new task.
 * @param requested - what dot asked for: a `provider/model` key, or a bare model id when only one provider has it.
 * @returns the model to select, or undefined when the session keeps the host default.
 * @throws TaskModelError when the request names no model or the rule excludes the choice.
 */
export function pickTaskModel(rule: TaskModelRule, catalog: TaskModelCatalog, requested?: string): ModelChoice | undefined {
  const allowed = permitted(rule, catalog)
  const wanted = requested?.trim()
  if (wanted) {
    const lower = wanted.toLowerCase()
    const exact = catalog.models.filter(model => modelKey(model) === wanted)
    const loose = exact.length > 0 ? exact : catalog.models.filter(model => model.model === wanted || modelKey(model).toLowerCase() === lower || model.model.toLowerCase() === lower)
    if (loose.length === 0) throw new TaskModelError('dot/unknown-model', `no model "${wanted}" on this host; ${TOOL.listModels} shows the ones a task can run on`)
    const usable = loose.filter(model => permits(rule, modelKey(model)))
    if (usable.length === 0) {
      throw new TaskModelError('dot/model-not-allowed', `the human does not allow tasks on ${modelKey(loose[0]!)}. ${allowed.length > 0 ? `Allowed: ${keys(allowed)}.` : 'Their list leaves no model for tasks; tell them, they change it in your settings.'}`)
    }
    if (usable.length > 1) throw new TaskModelError('dot/unknown-model', `"${wanted}" matches several models: ${keys(usable)}. Give the full provider/model key.`)
    return { provider: usable[0]!.provider, model: usable[0]!.model }
  }
  if (rule.mode === 'all') return undefined
  if (catalog.fallback && permits(rule, modelKey(catalog.fallback))) return undefined
  // The default is excluded: a single remaining model needs no choice from dot.
  if (allowed.length === 1) return { provider: allowed[0]!.provider, model: allowed[0]!.model }
  const fallback = catalog.fallback ? modelKey(catalog.fallback) : 'the host default model'
  if (allowed.length === 0) throw new TaskModelError('dot/model-not-allowed', `the human's task model list leaves no model for tasks (${fallback} is excluded too). Tell them; they change it in your settings.`)
  throw new TaskModelError('dot/model-not-allowed', `the human does not allow tasks on ${fallback}, the default. Pass model, one of: ${keys(allowed)}.`)
}

/** Model-facing answer of the list tool. */
export function formatTaskModels(rule: TaskModelRule, catalog: TaskModelCatalog): string {
  const allowed = permitted(rule, catalog)
  if (allowed.length === 0) return "The human's task model list leaves no model for tasks, so you cannot start one. Tell them; they change it in your settings."
  const lines: string[] = []
  if (rule.mode === 'all') lines.push('A task may run on any model below.')
  else if (rule.mode === 'allow') lines.push('The human allows tasks only on the models below.')
  else lines.push(`The human excludes ${catalog.models.length - allowed.length} model(s) from tasks; the rest are below.`)
  if (catalog.fallback) {
    const key = modelKey(catalog.fallback)
    lines.push(permits(rule, key)
      ? `A task you start without a model runs on ${key}, the default.`
      : allowed.length === 1 ? `The default ${key} is excluded; a task you start without a model runs on ${modelKey(allowed[0]!)}.` : `The default ${key} is excluded, so pass model when you start a task.`)
  }
  for (const model of allowed.slice(0, LISTED_MODELS_MAX)) lines.push(`- ${modelKey(model)}${model.name && model.name !== model.model ? ` "${model.name}"` : ''}`)
  if (allowed.length > LISTED_MODELS_MAX) lines.push(`(${allowed.length - LISTED_MODELS_MAX} more not shown)`)
  return lines.join('\n')
}
