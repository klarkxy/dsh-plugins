import { describe, expect, it, vi } from 'vitest'
import { createZhihuSyncTool } from './sync-tools.ts'
import type { ZhihuService } from './index.ts'

describe('Zhihu sync model tool', () => {
  it('exposes draft and upload operations but not human confirmation or publication', async () => {
    const syncCall = vi.fn(async () => ({ id: 'draft-1', revision: 1 }))
    const tool = createZhihuSyncTool({ syncCall } as unknown as ZhihuService)
    const schema = JSON.stringify(tool.parameters)
    expect(schema).not.toContain('reviewToken')
    expect(schema).not.toContain('confirmed')
    expect(schema).not.toContain('sync.publish')
    const exec = { signal: new AbortController().signal } as Parameters<typeof tool.execute>[1]
    await tool.execute({ action: 'prepare', id: 'draft-1', expectedRevision: 1 }, exec)
    expect(syncCall).toHaveBeenCalledWith('sync.prepare', { id: 'draft-1', expectedRevision: 1 }, exec.signal, 'tool')
    await tool.execute({ action: 'upload_image', image: { fileName: 'picture.png', contentBase64: 'AAAA', scene: 'article' } }, exec)
    expect(syncCall).toHaveBeenLastCalledWith('sync.media.upload', { fileName: 'picture.png', contentBase64: 'AAAA', scene: 'article' }, exec.signal, 'tool')
  })
})
