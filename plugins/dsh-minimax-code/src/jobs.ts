import { z } from 'zod'
import type { MediaKind } from '@klarkxy/dsh-plugin-kit/cli-media'

export const assetSchema = z.object({
  index: z.number().int().nonnegative(), kind: z.enum(['image', 'audio', 'video']),
  nodeId: z.string().max(200).optional(), name: z.string().max(200),
  sourceUrl: z.string().url().max(8192).optional(),
  localPath: z.string().max(4096).optional(), error: z.string().max(500).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict()
export const jobSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), workspace: z.string().max(4096),
  operation: z.string().max(60), createdAt: z.string(), updatedAt: z.string(),
  status: z.enum(['prepared', 'submitting', 'pending', 'complete', 'partial', 'failed', 'uncertain', 'download_failed']),
  model: z.string().max(80).optional(), taskId: z.string().max(200).optional(),
  assets: z.array(assetSchema).max(100),
  failures: z.array(z.object({ index: z.number().int().nonnegative(), error: z.string().max(500) }).strict()).max(100),
  error: z.string().max(500).optional(),
}).strict()
export type MediaJob = z.infer<typeof jobSchema>
export type JobAsset = z.infer<typeof assetSchema> & { kind: MediaKind }
export interface JobStore {
  get(id: string): Promise<MediaJob | undefined>
  put(job: MediaJob): Promise<void>
  list(workspace: string): Promise<MediaJob[]>
}
