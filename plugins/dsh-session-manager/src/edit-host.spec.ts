import { describe, expect, it, vi } from 'vitest'
import { bindEditHost, prepareEditContent, previewEdit, type EditHost, type EditSubmission } from './edit-host.ts'
import type { EditPrepareValue } from './contracts.ts'

const preview: EditPrepareValue = {
  sessionId: 'source', promptSeq: 4, text: 'beforeafter', modified: false,
  content: [{ type: 'text', text: 'before' }, { type: 'image', attachmentId: 'image-a' }, { type: 'text', text: 'after' }],
}

function host(): EditHost {
  return {
    attachment: vi.fn(async () => ({ attachment: { attachmentId: 'image-a', mediaType: 'image/png', name: 'screenshot.png' }, data: 'aW1hZ2U=' })),
  }
}

describe('edit content preparation', () => {
  it('sends only the edited attachment list and does not read a removed original image', async () => {
    const face = host()
    const content = await prepareEditContent(face, preview, 'without image', { requestId: 'removed' }, new AbortController().signal, [])
    expect(face.attachment).not.toHaveBeenCalled()
    expect(content).toEqual([{ type: 'text', text: 'without image' }])
  })

  it('stages existing and new files and freezes receipts and bytes after a failed send', async () => {
    const face = host()
    face.stageFile = vi.fn(async () => ({ receiptId: 'existing-receipt' }))
    face.uploadFile = vi.fn(async () => ({ receiptId: 'new-receipt' }))
    const submission: EditSubmission = { requestId: 'same-request' }
    const file = new File(['ok'], 'added.txt', { type: 'text/plain' })
    const attachments = [
      { type: 'file' as const, attachmentId: 'file-a', name: 'notes.txt', bytes: 2 },
      { type: 'upload' as const, file },
    ]
    const first = await prepareEditContent(face, preview, 'first', submission, new AbortController().signal, attachments)
    expect(face.stageFile).toHaveBeenCalledExactlyOnceWith({ sessionId: 'source', promptSeq: 4, attachmentId: 'file-a' }, expect.anything())
    expect(face.uploadFile).toHaveBeenCalledExactlyOnceWith('source', file, expect.anything())
    expect(first).toEqual([
      { type: 'text', text: 'first' }, { type: 'file', receiptId: 'existing-receipt' }, { type: 'file', receiptId: 'new-receipt' },
    ])
    const second = await prepareEditContent(face, preview, 'changed after failure', submission, new AbortController().signal, [])
    expect(second).toEqual(first)
    expect(face.stageFile).toHaveBeenCalledTimes(1)
    expect(face.uploadFile).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('reads the original authorized image and preserves it when edited=%s', async edit => {
    const face = host()
    const content = await prepareEditContent(face, preview, edit ? 'changed' : preview.text, { requestId: 'request' }, new AbortController().signal)
    expect(face.attachment).toHaveBeenCalledWith({ sessionId: 'source', attachmentId: 'image-a' })
    const image = { type: 'image', data: 'aW1hZ2U=', mediaType: 'image/png', name: 'screenshot.png' }
    expect(content).toEqual(edit
      ? [{ type: 'text', text: 'changed' }, image]
      : [{ type: 'text', text: 'before' }, image, { type: 'text', text: 'after' }])
  })

  it('fails when the authorized image read fails or returns a different image', async () => {
    const face = host()
    face.uploadFile = vi.fn(async () => ({ receiptId: 'new-receipt' }))
    vi.mocked(face.attachment!).mockRejectedValueOnce(new Error('missing image')).mockResolvedValueOnce({
      attachment: { attachmentId: 'different-image', mediaType: 'image/png' }, data: 'aW1hZ2U=',
    })
    await expect(prepareEditContent(face, preview, preview.text, { requestId: 'request' }, new AbortController().signal)).rejects.toThrow('missing image')
    await expect(prepareEditContent(face, preview, preview.text, { requestId: 'request' }, new AbortController().signal)).rejects.toMatchObject({ code: 'session/attachment-invalid' })
    expect(face.uploadFile).not.toHaveBeenCalled()
  })

  it('cancels after reading an image without staging anything', async () => {
    const face = host()
    face.uploadFile = vi.fn(async () => ({ receiptId: 'new-receipt' }))
    const controller = new AbortController()
    const attachment = face.attachment!
    face.attachment = async request => { controller.abort(); return attachment(request) }
    await expect(prepareEditContent(face, preview, preview.text, { requestId: 'request' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(face.uploadFile).not.toHaveBeenCalled()
  })

  it('binds the source image endpoint and rejects unsupported preview blocks', async () => {
    const attachment = vi.fn(async () => ({}))
    const bound = bindEditHost({ remote: { session: { attachment } } })
    await bound.attachment!({ sessionId: 'source', attachmentId: 'image-a' })
    expect(attachment).toHaveBeenCalledWith({ sessionId: 'source', attachmentId: 'image-a' })
    const face = { prepare: async () => ({ ...preview, content: [{ type: 'file', receiptId: 'untrusted' }] }) }
    await expect(previewEdit(face, 'source', 4, new AbortController().signal)).rejects.toMatchObject({ code: 'session-manager/unavailable' })
  })
})
