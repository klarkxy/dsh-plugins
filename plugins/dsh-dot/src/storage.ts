/**
 * Durable state: the dot session identity with its current and past segments,
 * the human's settings, the task ledger and dot's reminders. Pending
 * requests stay in memory on purpose — the host keeps pending approvals
 * per process only, so a persisted one could never be answered.
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { SETTING_FIELDS, type CognitionVersion, type DotContextUsage, type DotUsageOffset, type ScheduleRecord, type SettingProposal, type TaskRecord } from './contracts.ts'
import type { PastSegment, Segment } from './segments.ts'

export const STATE_KEY = 'current'

const taskSchema = z.object({
  sessionId: z.string().min(1),
  origin: z.enum(['started', 'watched']),
  title: z.string(),
  goal: z.string(),
  cwd: z.string(),
  workspaceId: z.string().optional(),
  preset: z.string().optional(),
  status: z.enum(['running', 'idle', 'blocked', 'error', 'archived']),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastNote: z.string().optional(),
  unseenTurns: z.number().int().nonnegative(),
}).strict()

const reasonSchema = z.enum(['context-full', 'idle-expired', 'model-switch', 'prompt-changed', 'lost', 'manual', 'dot-requested'])

const handoffSchema = z.object({
  tier: z.enum(['verbatim', 'summary', 'tail']),
  summary: z.string().optional(),
  rows: z.array(z.object({ role: z.enum(['human', 'notice', 'dot']), text: z.string(), at: z.number() }).strict()),
}).strict()

const segmentSchema = z.object({
  sessionId: z.string().min(1),
  startedAt: z.number(),
  persona: z.string(),
  model: z.string().optional(),
  /** Legacy notes block frozen before the split into agreements and cognition. */
  memory: z.string().optional(),
  memorySeen: z.string().optional(),
  /** Agreements block of the system prompt as it read when the segment started; absent while there are none. */
  agreements: z.string().optional(),
  /** Agreements block as this segment's conversation last accounted for it (dot's own change). */
  agreementsSeen: z.string().optional(),
  /** Cognition block as it read when the segment started; absent while dot has written none. */
  cognition: z.string().optional(),
  /** Cognition block as this segment's conversation last accounted for it. */
  cognitionSeen: z.string().optional(),
  opening: z.string().optional(),
  openCard: z.string().optional(),
  handoff: handoffSchema.optional(),
  reason: reasonSchema.optional(),
}).strict()

const pastSegmentSchema = z.object({
  sessionId: z.string().min(1),
  startedAt: z.number(),
  endedAt: z.number(),
  reason: reasonSchema.optional(),
}).strict()

const timingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.number() }).strict(),
  z.object({ kind: z.literal('every'), minutes: z.number().int().positive(), anchor: z.number() }).strict(),
  z.object({ kind: z.literal('daily'), time: z.string().regex(/^\d{2}:\d{2}$/), weekdays: z.array(z.number().int().min(1).max(7)).optional() }).strict(),
])

const scheduleSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  prompt: z.string(),
  timing: timingSchema,
  createdAt: z.number(),
  nextAt: z.number(),
  lastFiredAt: z.number().optional(),
}).strict()

const usageSchema = z.object({
  input: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  output: z.number().nonnegative(),
}).strict()

const usageOffsetSchema = usageSchema.extend({
  sessionId: z.string().min(1),
}).strict()

const cognitionVersionSchema = z.object({
  text: z.string(),
  at: z.number(),
}).strict()

const stateSchema = z.object({
  dotSessionId: z.string().optional(),
  dotWorkspaceId: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  segment: segmentSchema.optional(),
  pastSegments: z.array(pastSegmentSchema).optional(),
  /** Legacy notes captured in old state rows; read only by the one-time migration. */
  memory: z.string().optional(),
  /** Legacy note undo snapshot; the migration preserves it as cognition history. */
  memoryUndo: z.string().optional(),
  /** The human's own standing requirements, verbatim. */
  agreements: z.string().optional(),
  /** What one undo of the agreements restores. */
  agreementsUndo: z.string().optional(),
  /** dot's own understanding, rewritten whole. */
  cognition: z.string().optional(),
  /** Earlier cognition texts, newest first; used for rollback. */
  cognitionHistory: z.array(cognitionVersionSchema).optional(),
  /** Marker once the legacy notes have been imported; cleared content is never re-imported after it. */
  knowledgeMigrated: z.string().optional(),
  usageCarry: usageSchema.optional(),
  usageOffset: usageOffsetSchema.optional(),
}).strict()

const proposalValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.string(), z.unknown()), z.array(z.unknown())])

/**
 * Fields a stored proposal may name. `policy` was a setting before the
 * agreements took its place; old rows still have to open, so the name stays
 * readable, but it is no longer in SETTING_FIELDS and can never be proposed
 * again. Deciding such a row is refused as an unknown setting.
 */
const PROPOSAL_FIELDS = [...SETTING_FIELDS, 'policy'] as const

const proposalSchema = z.object({
  id: z.string().min(1),
  field: z.enum(PROPOSAL_FIELDS),
  before: proposalValueSchema,
  after: proposalValueSchema,
  reason: z.string().min(1).max(2000),
  createdAt: z.number(),
}).strict()

export interface DotState {
  readonly dotSessionId?: string
  readonly dotWorkspaceId?: string
  /** The human's settings; read through parseSettings. */
  readonly settings?: Readonly<Record<string, unknown>>
  /** The segment dotSessionId is running; absent for a session started before segments existed. */
  readonly segment?: Segment
  /** Ended segments, oldest first. */
  readonly pastSegments?: readonly PastSegment[]
  /** Legacy notes captured in old state rows; read only by the one-time migration. */
  readonly memory?: string
  /** Legacy note undo snapshot; the migration preserves it as cognition history. */
  readonly memoryUndo?: string
  /** The human's own standing requirements, verbatim. */
  readonly agreements?: string
  /** What one undo of the agreements restores. */
  readonly agreementsUndo?: string
  /** dot's own understanding, rewritten whole. */
  readonly cognition?: string
  /** Earlier cognition texts, newest first. */
  readonly cognitionHistory?: readonly CognitionVersion[]
  /** Marker once the legacy notes have been imported; cleared content is never re-imported after it. */
  readonly knowledgeMigrated?: string
  /** Cumulative token totals carried from ended segments and handoff notes. */
  readonly usageCarry?: DotContextUsage
  /** Segment usage subtracted after the human clears cumulative totals mid-segment. */
  readonly usageOffset?: DotUsageOffset
}

export function parseSettingProposal(value: unknown): SettingProposal | undefined {
  const parsed = proposalSchema.safeParse(value)
  return parsed.success ? parsed.data as SettingProposal : undefined
}

export const dotDomain = defineDomain({
  name: 'klarkxy_dsh_dot',
  // v2 adds agreements/cognition and their seen snapshots. Rows written by v1
  // stay readable (the new fields are optional), so v2 lists v1 as compatible;
  // older readers then never reject a v2 row under the same version stamp.
  version: 2,
  compatibleVersions: [1],
  tables: {
    state: domainTable<string, DotState>(stateSchema),
    tasks: domainTable<string, TaskRecord>(taskSchema),
    schedules: domainTable<string, ScheduleRecord>(scheduleSchema),
    proposals: domainTable<string, SettingProposal>(proposalSchema),
  },
})

/** A malformed reminder reads as absent. */
export function parseScheduleRecord(value: unknown): ScheduleRecord | undefined {
  const parsed = scheduleSchema.safeParse(value)
  return parsed.success ? parsed.data as ScheduleRecord : undefined
}

/** A malformed row reads as absent instead of breaking the ledger. */
export function parseTask(value: unknown): TaskRecord | undefined {
  const parsed = taskSchema.safeParse(value)
  return parsed.success ? parsed.data as TaskRecord : undefined
}

export function parseState(value: unknown): DotState {
  const parsed = stateSchema.safeParse(value)
  return parsed.success ? parsed.data as DotState : {}
}
