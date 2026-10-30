import { describe, expect, it, vi } from 'vitest'
import { stageEditFile } from './edit-file.ts'

function fixture() {
  const dispose = vi.fn()
  const ref = { attachmentId: 'file-a', name: 'a.txt', bytes: 3 }
  const query = { observeSession: vi.fn(async () => ({
    header: { version: 5 }, events: [{ seq: 5, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'file', attachment: ref }] } }],
    [Symbol.dispose]: dispose,
  })) } as never
  const services = {
    attachments: { readFileStream: vi.fn(async function* () { yield new Uint8Array([1, 2]); yield new Uint8Array([3]) }) },
    fileUploads: { uploadStream: vi.fn(async (request: { data: AsyncIterable<Uint8Array> }) => {
      const chunks = []
      for await (const chunk of request.data) chunks.push(...chunk)
      expect(chunks).toEqual([1, 2, 3])
      return { receiptId: 'session-receipt' }
    }) },
  }
  return { dispose, ref, query, services }
}

describe('edit file staging', () => {
  it('streams only the source prompt file back into the same host receipt service', async () => {
    const f = fixture()
    const signal = new AbortController().signal
    await expect(stageEditFile(f.query, f.services, { sessionId: 'source', promptSeq: 5, attachmentId: 'file-a' }, signal)).resolves.toEqual({ receiptId: 'session-receipt' })
    expect(f.services.attachments.readFileStream).toHaveBeenCalledWith(f.ref, signal)
    expect(f.services.fileUploads.uploadStream).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'source', name: 'a.txt', signal }))
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it.each([{ promptSeq: 4, attachmentId: 'file-a' }, { promptSeq: 5, attachmentId: 'foreign-file' }])('rejects foreign references before reading any bytes: %j', async selection => {
    const f = fixture()
    await expect(stageEditFile(f.query, f.services, { sessionId: 'source', ...selection }, new AbortController().signal)).rejects.toMatchObject({ code: 'session-manager/unavailable' })
    expect(f.services.attachments.readFileStream).not.toHaveBeenCalled()
    expect(f.services.fileUploads.uploadStream).not.toHaveBeenCalled()
    expect(f.dispose).toHaveBeenCalledOnce()
  })
})
