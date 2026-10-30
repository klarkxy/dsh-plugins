import '../tests/legacy-call-policy.ts'
import { describe, expect, it } from 'vitest'
import { createZhihuGlobalSearchTool, createZhihuSearchTool } from './tool-definitions.ts'

const responses: Array<{ Items: Array<{ Title: string; Url: string }>; EmptyReason?: string | null }> = [
  { Items: [{ Title: 'Result', Url: 'https://example.com' }] },
  { Items: [] },
  { Items: [], EmptyReason: 'No matching content' },
  { Items: [], EmptyReason: '' },
  { Items: [], EmptyReason: null },
]

describe.each([
  ['zhihu_search', createZhihuSearchTool],
  ['zhihu_global_search', createZhihuGlobalSearchTool],
] as const)('%s JSON output', (_name, createTool) => {
  it.each(responses)('returns lossless JSON for %j', async data => {
    const tool = createTool({
      resolveCredential: async () => 'test-credential',
      fetcher: async () => ({
        ok: true, status: 200,
        json: async () => ({ Code: 0, Data: data }),
        text: async () => JSON.stringify({ Code: 0, Data: data }),
      }),
    })
    const value = await tool.execute({ query: 'test query', count: 8 }, { signal: new AbortController().signal } as Parameters<typeof tool.execute>[1])
    // Strict equality catches undefined properties that JSON.stringify silently drops.
    expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value)
    expect(value.items).toHaveLength(data.Items.length)
    if (typeof data.EmptyReason === 'string') expect(value.emptyReason).toBe(data.EmptyReason)
    else expect(Object.hasOwn(value, 'emptyReason')).toBe(false)
  })
})
