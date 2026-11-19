import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { migrateFetchOrder, migrateSearchOrder } from './contracts.ts'

const providerEntryKeySchema = z.string().regex(/^(search|fetch):[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/)

export const settingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  searchEnabled: z.boolean(),
  fetchEnabled: z.boolean(),
  searchMode: z.enum(['fusion', 'failover', 'single']),
  fetchMode: z.enum(['waterfall', 'single']),
  maxParallelSearch: z.number().int().min(2).max(5),
  multiSourceOptIn: z.array(providerEntryKeySchema).max(64),
  searchProvider: z.string().max(64),
  fetchProvider: z.string().max(64),
  searchOrder: z.array(z.string().min(1).max(64)).max(32),
  fetchOrder: z.array(z.string().min(1).max(64)).max(32),
  maxResults: z.number().int().min(1).max(20),
  maxQueries: z.number().int().min(1).max(10),
  timeoutMs: z.number().int().min(1000).max(120_000),
  maxFetchChars: z.number().int().min(1000).max(200_000),
  endpoints: z.record(providerEntryKeySchema, z.string().max(2048))
    .refine(value => Object.keys(value).length <= 50),
}).strict()

export const updateSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  // Keep omission observable so old RPC clients do not erase existing ordered or multi-source choices.
  settings: settingsSchema.omit({ revision: true }).extend({
    fetchOrder: settingsSchema.shape.fetchOrder.optional(),
    searchMode: settingsSchema.shape.searchMode.optional(),
    fetchMode: settingsSchema.shape.fetchMode.optional(),
    maxParallelSearch: settingsSchema.shape.maxParallelSearch.optional(),
    multiSourceOptIn: settingsSchema.shape.multiSourceOptIn.optional(),
  }),
}).strict()

export const storedSettingsSchema = settingsSchema.extend({
  searchOrder: settingsSchema.shape.searchOrder.optional(),
  fetchOrder: settingsSchema.shape.fetchOrder.optional(),
  searchMode: settingsSchema.shape.searchMode.optional(),
  fetchMode: settingsSchema.shape.fetchMode.optional(),
  maxParallelSearch: settingsSchema.shape.maxParallelSearch.optional(),
  multiSourceOptIn: settingsSchema.shape.multiSourceOptIn.optional(),
}).transform(settings => ({
  ...settings,
  searchMode: settings.searchMode ?? 'fusion',
  fetchMode: settings.fetchMode ?? 'waterfall',
  maxParallelSearch: settings.maxParallelSearch ?? 3,
  multiSourceOptIn: [...new Set(settings.multiSourceOptIn ?? [])],
  searchOrder: migrateSearchOrder(settings),
  fetchOrder: migrateFetchOrder(settings),
}))

export const webSettingsDomain = defineDomain({
  name: 'dsh_editor_web_search', version: 1,
  tables: { settings: domainTable<string, z.output<typeof storedSettingsSchema>>(storedSettingsSchema) },
})
