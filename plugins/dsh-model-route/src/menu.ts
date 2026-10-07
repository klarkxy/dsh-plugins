/**
 * Pure menu helpers over parsed catalog choices: provider grouping, display
 * names and search filtering. Pure and browser-safe like the rest of the core
 * entry — no React, no host imports. The popover component lives in `./ui.tsx`.
 */
import type { ModelMenuChoice } from './catalog.ts'

/** One provider group in the menu, in catalog order, after applying the search query. */
export interface ModelMenuGroup {
  readonly provider: string
  /** Provider display name, split from the catalog "Provider / Model" label. */
  readonly name: string
  readonly items: readonly ModelMenuChoice[]
}

/** The short model label shown inside a provider group. */
export function modelMenuShortName(choice: ModelMenuChoice): string {
  const sep = choice.label.indexOf(' / ')
  return sep > 0 ? choice.label.slice(sep + 3) : choice.model
}

/** Group catalog choices by provider and filter them by a case-insensitive query. */
export function groupModelMenuChoices(choices: readonly ModelMenuChoice[], query: string): ModelMenuGroup[] {
  const needle = query.trim().toLowerCase()
  const matched = needle
    ? choices.filter(choice => choice.label.toLowerCase().includes(needle)
      || choice.model.toLowerCase().includes(needle)
      || choice.provider.toLowerCase().includes(needle))
    : choices
  const groups: Array<{ provider: string; name: string; items: ModelMenuChoice[] }> = []
  for (const choice of matched) {
    const sep = choice.label.indexOf(' / ')
    const name = sep > 0 ? choice.label.slice(0, sep) : choice.provider
    const last = groups.at(-1)
    if (last && last.provider === choice.provider) last.items.push(choice)
    else groups.push({ provider: choice.provider, name, items: [choice] })
  }
  return groups
}
