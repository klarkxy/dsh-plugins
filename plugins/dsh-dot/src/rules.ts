/** Code enforces the human's switches; dot applies the agreements and approval principles. */
import type { PendingKind, RuleConfig } from './contracts.ts'

export type Route =
  | { readonly action: 'skip' }
  | { readonly action: 'deny' }
  | { readonly action: 'dot'; readonly kind: PendingKind }
  | { readonly action: 'human' }

export function routeRequest(rules: RuleConfig, kind: PendingKind): Route {
  if (kind === 'approval') {
    switch (rules.approvals) {
      case 'deny': return { action: 'deny' }
      case 'dot': return { action: 'dot', kind }
      case 'human': return { action: 'human' }
      // An unparsed legacy value must never grant permission.
      default: return { action: 'human' }
    }
  }
  if (rules.questions === 'off') return { action: 'skip' }
  return rules.questions === 'dot' ? { action: 'dot', kind } : { action: 'human' }
}
