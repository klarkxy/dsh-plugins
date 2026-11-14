import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { FolderRecord } from './contracts.ts'
export const folderRecordSchema = z.object({
  folders: z.array(z.string().min(1).max(32768)).max(64),
  revision: z.number().int().nonnegative(),
}).strict()
export const foldersDomain = defineDomain({
  name: 'klarkxy_workspace_folders', version: 1,
  tables: { workspaces: domainTable<string, FolderRecord>(folderRecordSchema) },
})
