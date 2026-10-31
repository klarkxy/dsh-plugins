import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'
import { DELEGATION_TOOLS } from './contracts.ts'
import { coordinatorPrompt, coordinatorReminder, EXECUTOR_PROMPT, EXECUTOR_REMINDER } from './prompts.ts'

export interface DelegationSessionLike {
  readonly id: string
  readonly header?: { readonly parentSession?: unknown }
}

/** The per-assembly lookups the policy needs; callers inject the live stores. */
export interface DelegationLookups {
  /** Parsed per-session record; undefined means no record. */
  record(sessionId: string): { readonly enabled: boolean } | undefined
  session(sessionId: string): DelegationSessionLike | undefined
  /** Whether a tool name resolves in this assembly's scope. */
  toolVisible(name: string, scope: unknown): boolean
}

export interface DelegationAssembleContext {
  readonly agent?: { readonly session: DelegationSessionLike }
  readonly scope?: unknown
}

/** Ancestor walk bound: subagent chains deeper than this bail out as off. */
const MAX_PARENT_HOPS = 16

/** First non-subagent ancestor reachable through `header.parentSession`. */
function topLevelSession(
  session: DelegationSessionLike,
  sessions: DelegationLookups['session'],
): DelegationSessionLike | undefined {
  const seen = new Set<string>([session.id])
  let current = session
  for (let hop = 0; hop < MAX_PARENT_HOPS && isSubagentSession(current); hop++) {
    const parentId = typeof current.header?.parentSession === 'string' ? current.header.parentSession : undefined
    if (!parentId || seen.has(parentId)) return undefined
    seen.add(parentId)
    const parent = sessions(parentId)
    if (!parent) return undefined
    current = parent
  }
  return isSubagentSession(current) ? undefined : current
}

type Policy = { role: 'executor' } | { role: 'coordinator'; tools: readonly string[] }

/** Both prompt surfaces must use the same role and capability decision. */
function delegationPolicy(context: DelegationAssembleContext, lookups: DelegationLookups): Policy | undefined {
  const session = context.agent?.session
  if (!session) return undefined
  if (isSubagentSession(session)) {
    const root = topLevelSession(session, lookups.session)
    return root && lookups.record(root.id)?.enabled ? { role: 'executor' } : undefined
  }
  if (!lookups.record(session.id)?.enabled) return undefined
  const visible = DELEGATION_TOOLS.filter(name => lookups.toolVisible(name, context.scope))
  return visible.length ? { role: 'coordinator', tools: visible } : undefined
}

/** Static system guidance. No per-step counters or progress belong in this text. */
export function delegationSectionText(context: DelegationAssembleContext, lookups: DelegationLookups): string {
  const policy = delegationPolicy(context, lookups)
  if (!policy) return ''
  return policy.role === 'executor' ? EXECUTOR_PROMPT : coordinatorPrompt(policy.tools)
}

/** Stable user-role context snapshot, refreshed by the host after compaction. */
export function delegationReminderText(context: DelegationAssembleContext, lookups: DelegationLookups): string {
  const policy = delegationPolicy(context, lookups)
  if (!policy) return ''
  return policy.role === 'executor' ? EXECUTOR_REMINDER : coordinatorReminder(policy.tools)
}
