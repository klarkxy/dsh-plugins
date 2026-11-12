/**
 * Durable state: the dot session identity with its current and past segments,
 * the human's settings, the task ledger and dot's reminders. Pending
 * requests stay in memory on purpose — the host keeps pending approvals
 * per process only, so a persisted one could never be answered.
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { SETTING_FIELDS, type DotContextUsage, type DotUsageOffset, type ScheduleRecord, type SettingProposal, type TaskRecord } from './contracts.ts'
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
  memory: z.string().optional(),
  memorySeen: z.string().optional(),
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

const stateSchema = z.object({
  dotSessionId: z.string().optional(),
  dotWorkspaceId: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  segment: segmentSchema.optional(),
  pastSegments: z.array(pastSegmentSchema).optional(),
  memoryUndo: z.string().optional(),
  usageCarry: usageSchema.optional(),
  usageOffset: usageOffsetSchema.optional(),
}).strict()

const proposalValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.string(), z.unknown()), z.array(z.unknown())])

const proposalSchema = z.object({
  id: z.string().min(1),
  field: z.enum(SETTING_FIELDS),
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
  /** dot's notes as they read before their latest change; what one undo restores. */
  readonly memoryUndo?: string
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
  version: 1,
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
