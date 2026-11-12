/**
 * Rule table: decides, before dot sees anything, whether a request from
 * another session is left to its own card, judged by dot, or relayed to the
 * human through dot. The judgement itself belongs to dot's
 * model turn; code routes.
 */
import type { PendingKind, RuleConfig } from './contracts.ts'

export type Route =
  | { readonly action: 'skip' }
  | { readonly action: 'allow' }
  | { readonly action: 'deny' }
  | { readonly action: 'dot'; readonly kind: PendingKind }
  | { readonly action: 'human' }

export function routeRequest(rules: RuleConfig, kind: PendingKind): Route {
  if (kind === 'approval') {
    switch (rules.approvals) {
      case 'allow': return { action: 'allow' }
      case 'deny': return { action: 'deny' }
      case 'dot': return { action: 'dot', kind }
      case 'human': return { action: 'human' }
    }
  }
  if (rules.questions === 'off') return { action: 'skip' }
  return rules.questions === 'dot' ? { action: 'dot', kind } : { action: 'human' }
}

/** Text dot reads for each routed request, telling it what it may decide. */
export function routeInstruction(route: Route, policy = ''): string {
  switch (route.action) {
    case 'skip':
    case 'allow':
    case 'deny':
      return ''
    case 'dot': {
      const base = route.kind === 'approval'
        ? 'Decide it yourself with dot_answer: approve silently (no chat reply) when the action fits the session\'s goal, stays inside its project, and can be undone. Ask the human first (a show_view confirm card) when it deletes data outside the project, publishes or pushes anything, spends money, touches credentials, or you cannot tell what it does; then relay their decision with dot_answer.'
        : 'Answer it yourself silently with dot_answer (no chat reply) when the session\'s goal and what the human told you settle it. Ask the human first (a show_view card) when the answer changes direction or scope, deletes data, costs money or publishes anything; then relay their answer with dot_answer.'
      const own = policy.trim()
      if (!own) return base
      return base + '\n  The human\'s own rules, which take precedence over the defaults above:\n' + own.split(/\r?\n/).map(line => '  > ' + line).join('\n')
    }
    case 'human':
      return 'Ask the human in this chat (a show_view card or plain text), then relay their exact decision with dot_answer. Never decide it yourself.'
  }
}
