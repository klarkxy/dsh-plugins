import { z } from 'zod'

const items = () => z.array(z.string().trim().min(1).max(400)).max(16).default([])
export const requirementsSchema = z.object({
  goal: z.string().trim().min(1).max(2000),
  deliverables: items(), inScope: items(), outOfScope: items(),
  constraints: items(), acceptance: items(), assumptions: items(),
  questions: z.array(z.string().trim().min(1).max(400)).max(8).default([]),
}).strict()

export const toolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read') }).strict(),
  z.object({
    action: z.literal('record'), expectedRevision: z.number().int().nonnegative(),
    sourceVersion: z.string().min(1).max(400), requirements: requirementsSchema,
  }).strict(),
])
export type RecordRequirements = Extract<z.infer<typeof toolRequestSchema>, { action: 'record' }>
