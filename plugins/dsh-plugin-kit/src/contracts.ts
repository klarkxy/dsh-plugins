import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { ModelRoute } from '@klarkxy/dsh-model-route'

/**
 * The canonical home is @klarkxy/dsh-model-route; re-exported here so existing
 * plugin-kit consumers keep compiling.
 */
export type { ModelRoute }

/** Public, browser-safe contracts. Host implementations stay in their owning packages. */
export type ProducerSourceKind = `plugin:${string}`
export type ProducerMessageSource = { kind: ProducerSourceKind; plugin: string } & ContextFormed

/**
 * V4 sessions persist the producing extension in `kind`; the retired generic
 * `plugin` wrapper is not admitted. Each feature plugin declares its own kind.
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    [kind: ProducerSourceKind]: ProducerMessageSource
  }
}

export function producerMessageSource(plugin: string): ProducerMessageSource {
  return { kind: `plugin:${plugin}`, plugin }
}

export type RpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export const CHAT_EVENTS_SLOT = 'dsh-editor.chat.events'
export interface EvidenceRef { sessionId: string; seq: number; kind: 'user' | 'tool' | 'turn' | 'manual'; excerpt?: string }
export interface TaskContract {
  id: string
  sessionId: string
  sourceVersion: string
  revision: number
  goal: string
  deliverables: string[]
  inScope: string[]
  outOfScope: string[]
  constraints: string[]
  acceptance: string[]
  assumptions: string[]
  questions: string[]
  evidence: EvidenceRef[]
  readiness: 'pending' | 'clear-request' | 'user-confirmed' | 'disclosed-assumptions' | 'cancelled' | 'stale'
  updatedAt: number
}
export interface TaskCheckpoint {
  id: string
  sessionId: string
  sourceVersion: string
  contractVersion?: number
  fromSeq: number
  toSeq: number
  revision: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  items: Array<{ label: string; state: 'pending' | 'verified' | 'failed'; evidence: EvidenceRef[] }>
  constraints: string[]
  nextAction: string
  createdAt: number
}
export type KnowledgeScope = { kind: 'global' } | { kind: 'project'; projectId: string }
export type KnowledgeKind = 'preference' | 'project-fact' | 'decision' | 'vocabulary' | 'activity' | 'lesson'
/** Descriptive context, never an executable instruction or authorization. */
export interface ContextKnowledge {
  subject: string
  domain: string
  key: string
  aliases: string[]
  observedAt: number
  /** The user's own time expression, not an inferred completion date. */
  eventTime?: string
  activityStatus?: 'planned' | 'in-progress' | 'blocked' | 'paused' | 'completed' | 'cancelled' | 'unknown'
}
/** A scoped method. Observations remain candidates until explicitly accepted. */
export interface ProcedureKnowledge {
  origin: 'instruction' | 'observation'
  goal: string
  when: string[]
  steps: string[]
  avoid: string[]
  verify: string[]
}
export interface MemoryRecord {
  id: string
  revision: number
  scope: KnowledgeScope
  kind: KnowledgeKind
  status: 'candidate' | 'active' | 'rejected' | 'superseded' | 'revoked' | 'deleted'
  title: string
  content: string
  tags: string[]
  evidence: EvidenceRef[]
  exceptions: string[]
  source: 'user' | 'memory' | 'dream' | 'self-improvement'
  context?: ContextKnowledge
  procedure?: ProcedureKnowledge
  createdAt: number
  updatedAt: number
  expiresAt?: number
  supersedes?: string[]
  /** Exact record revisions behind a derived candidate; revalidated on adoption. */
  basis?: Array<{ id: string; revision: number }>
}
export type NewMemoryRecord = Omit<MemoryRecord, 'id' | 'revision' | 'createdAt' | 'updatedAt'>
export interface MemoryQuery { scope: KnowledgeScope; query?: string; kinds?: KnowledgeKind[]; statuses?: MemoryRecord['status'][]; limit?: number }
export interface MemoryMutationOptions { signal?: AbortSignal; isCurrent?: () => boolean }
export interface MemoryService {
  list(query: MemoryQuery): Promise<MemoryRecord[]>
  create(record: NewMemoryRecord, options?: MemoryMutationOptions): Promise<MemoryRecord>
  update(id: string, patch: Partial<Pick<MemoryRecord, 'title' | 'content' | 'tags' | 'exceptions' | 'status' | 'expiresAt'>>, expectedRevision: number, options?: MemoryMutationOptions): Promise<MemoryRecord>
  /** Explicit user promotion, persisted atomically on the same record; preserves expiry and evidence. */
  promoteToGlobal(id: string, expectedRevision: number, options?: MemoryMutationOptions): Promise<MemoryRecord>
  remove(id: string, expectedRevision: number, options?: MemoryMutationOptions): Promise<void>
  recall(query: MemoryQuery): Promise<MemoryRecord[]>
}

/**
 * The session creation metadata the host snapshots when it creates a delegated child
 * thread. Mirrors `CreateAgentOptions.meta` in `@deepseek-ai/dsh-agent`; it is durable
 * session data, so it survives a restart and needs no ancestry walk.
 */
export interface SubagentSessionLike {
  readonly header?: {
    readonly parentSession?: unknown
    readonly origin?: unknown
    readonly delegationDepth?: unknown
    readonly isSeeded?: unknown
    readonly classification?: unknown
  }
}

/**
 * True when `session` is a delegated child thread rather than a human-driven top-level
 * conversation.
 *
 * A message's `source.kind === 'user'` cannot answer this: a lead agent's dispatch prompt
 * is delivered as the child's own user message, so delegated work is indistinguishable
 * from a person typing once you only look at the message. Plugins use this to keep
 * automatic writes and derived model calls on top-level sessions.
 */
export function isSubagentSession(session: unknown): boolean {
  const header = (session as SubagentSessionLike | null | undefined)?.header
  if (!header || typeof header !== 'object') return false
  if (header.origin === 'subagent' || Number(header.delegationDepth ?? 0) > 0) return true
  // Native human forks also persist parentSession for history lineage. A fork's
  // seeded header distinguishes it from legacy children whose parent is the
  // only marker. Native rc.2 forks omit depth; patched hosts may persist zero.
  // Explicit delegation and unknown metadata still keep the child guard.
  const humanFork = header.isSeeded === true
    && (header.delegationDepth === undefined || header.delegationDepth === 0)
    && header.origin === undefined
    && (header.classification === undefined || header.classification === 'ordinary' || header.classification === 'free')
  return Boolean(header.parentSession) && !humanFork
}

/** Project keys come only from the host-validated session directory, never client input. */
export function projectIdFromCwd(cwd: string | undefined): string | undefined {
  if (typeof cwd !== 'string') return undefined
  const normalized = cwd.trim().replaceAll('\\', '/')
  if (!normalized) return undefined
  return normalized === '/' || /^[A-Za-z]:\/$/.test(normalized) ? normalized : normalized.replace(/\/+$/, '')
}

/**
 * One settings owner's Remote stream. Typert accepts either case in an RPC
 * segment, so the Cordis service key and the wire namespace use the same
 * Pascal segment. The scope's first letter stays uppercase.
 */
export interface ModelSettingsChangesIdentity {
  readonly service: string
  readonly namespace: string
}

/** `@klarkxy/dsh-git-commit` becomes `KlarkxyDshGitCommitModelSettingsChanges`. */
export function modelSettingsChangesIdentity(packageName: string): ModelSettingsChangesIdentity {
  const scoped = /^@([^/]+)\/(.+)$/.exec(packageName)
  const body = scoped ? `${scoped[1]}/${scoped[2]}` : packageName
  const parts = body.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (!parts.length) throw new Error('Model settings package name has no RPC segment')
  const segment = `${parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')}ModelSettingsChanges`
  if (!/^[A-Z][A-Za-z0-9]*$/.test(segment)) throw new Error(`Model settings sync name is not an RPC segment: ${segment}`)
  return { service: segment, namespace: segment }
}

/**
 * Repository extension: a native web provider announces that its local
 * availability changed. Kind is `search` or `fetch`; id is the provider id.
 * Listeners refresh management state and must not treat this as a network probe.
 */
export const WEB_PROVIDER_AVAILABILITY_EVENT = 'web/provider-availability-updated' as const

/**
 * Optional display metadata a provider may attach when it registers directly
 * with `ctx.web`. Execution and credentials stay with the provider; this object
 * is display-only and must never carry secret values.
 */
export interface DshWebManagementDescriptor {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly defaultBaseURL?: string
  readonly credentialRef?: string
  /** True when the key is shared with another surface. The page must not delete it. */
  readonly credentialShared?: boolean
  /** Optional notice naming the settings surface that owns a shared credential. */
  readonly credentialHint?: string
  readonly billing: 'request' | 'model-and-tools' | 'none' | 'unknown'
  /** Optional provider-supplied billing summary. */
  readonly pricing?: string
  /** Public HTTPS page explaining provider charges. */
  readonly pricingUrl?: string
  /** Public HTTPS page where the user can create an API key. */
  readonly signupUrl?: string
  /** Plugin that owns configuration. Native providers keep their settings there. */
  readonly configurationOwner?: string
  /** Explicit settings link supplied by the provider, never inferred from its id. */
  readonly configurationUrl?: string
  /** Fixed legacy route migrated by a bundle-owned adapter; not used by native plugins. */
  readonly legacyId?: string
}

/**
 * Host Creator agent-preset id (`agentPresets.composedPreset`).
 * Plugins that gate Creator-only tools or prompt sections compare against this.
 */
export const CREATOR_PRESET_ID = 'cordis'
