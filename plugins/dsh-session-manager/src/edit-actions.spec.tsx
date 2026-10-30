import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { EditActions } from './edit-actions.tsx'
import type { EditHost } from './edit-host.ts'
import { createRetryModel, type RetryModel } from './session-actions.ts'

function nativeRetry(controlsRetry = false): RetryModel {
  const snapshot = { controlsRetry }
  return { subscribe: () => () => {}, getSnapshot: () => snapshot } as never
}

async function useDom(run: (dom: JSDOM) => Promise<void>): Promise<void> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const previous = new Map<string, unknown>()
  const assign = (key: string, value: unknown) => {
    previous.set(key, (globalThis as Record<string, unknown>)[key])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  assign('window', dom.window)
  assign('document', dom.window.document)
  assign('HTMLElement', dom.window.HTMLElement)
  assign('MouseEvent', dom.window.MouseEvent)
  assign('Node', dom.window.Node)
  assign('IS_REACT_ACT_ENVIRONMENT', true)
  try {
    await run(dom)
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key]
      else Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    dom.window.close()
  }
}

function host(modified: boolean): EditHost {
  return {
    prepare: vi.fn(async () => ({
      sessionId: 's', promptSeq: 3, text: 'original', modified,
    })),
  }
}

function change(dom: JSDOM, element: HTMLElement, value: string): void {
  ;(element as HTMLTextAreaElement).value = value
  const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps'))
  const props = propsKey ? (element as unknown as Record<string, { onChange?: (event: { target: HTMLElement }) => void }>)[propsKey] : undefined
  props?.onChange?.({ target: element })
  element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}

async function nativeModel(retry = vi.fn(async () => ({})), supported = true) {
  const model = createRetryModel({
    list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready' }), subscribe: () => () => {} },
    capabilities: async () => ({ retry: supported, retryModified: true, retryContent: true, freeSession: false, deleteSession: false }),
    previewRetry: async () => ({ branchRevision: 1, inputRevision: 'input-1', eligible: true }), retry,
  })
  await model.load()
  return { model, retry }
}

describe('same-session inline editing', () => {
  it('places media above the text box, replaces attachments in the original session, and freezes a lost reply', async () => {
    await useDom(async dom => {
      const face = host(false)
      face.prepare = vi.fn(async () => ({ sessionId: 's', promptSeq: 3, text: 'original', modified: false,
        content: [{ type: 'text', text: 'original' }, { type: 'image', attachmentId: 'old-image' }],
      }))
      face.attachment = vi.fn(async () => ({ attachment: { attachmentId: 'old-image', mediaType: 'image/png' }, data: 'aW1hZ2U=' }))
      face.uploadFile = vi.fn(async () => ({ receiptId: 'new-file' }))
      const retry = vi.fn().mockRejectedValueOnce(new Error('reply lost')).mockResolvedValue({})
      const { model } = await nativeModel(retry)
      let root: Root | undefined
      const button = (label: string) => [...dom.window.document.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') ?? item.textContent) === label)!
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<EditActions promptSeq={3} messageId="message-3" sessionId="s" locale="en" host={face} nativeRetry={model} />)
        })
        await act(async () => { button('Edit and resend').click() })
        expect(dom.window.document.querySelector('[role="dialog"]')).toBeNull()
        expect(dom.window.document.querySelector('.dsm-edit-attachments')?.nextElementSibling?.className).toBe('dsm-message-editor')
        expect(dom.window.document.querySelector('input[type="file"]')).toBeNull()
        expect(dom.window.document.body.textContent).not.toContain('Add attachments')
        await act(async () => { button('Remove attachment 1').click() })
        const textarea = dom.window.document.querySelector('textarea')!
        const key = Object.keys(textarea).find(item => item.startsWith('__reactProps'))!
        const file = new File(['ok'], 'new.txt', { type: 'text/plain' })
        await act(async () => { (textarea as any)[key].onPaste({ clipboardData: { files: [file] }, preventDefault() {} }); change(dom, textarea, 'replacement') })
        await act(async () => { button('Send').click() })
        await act(async () => { button('Confirm resend').click() })
        expect(face.uploadFile).toHaveBeenCalledExactlyOnceWith('s', file, expect.anything())
        expect(retry).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's', messageId: 'message-3', content: [
          { type: 'text', text: 'replacement' }, { type: 'file', receiptId: 'new-file' },
        ] }))
        expect(retry.mock.calls[0][0]).not.toHaveProperty('text')
        expect(textarea.disabled).toBe(true)
        await act(async () => { button('Send').click() })
        await act(async () => { button('Confirm resend').click() })
        expect(retry.mock.calls[1][0]).toEqual(retry.mock.calls[0][0])
        expect(face.uploadFile).toHaveBeenCalledTimes(1)
        expect(face.prepare).toHaveBeenCalledTimes(1)
        expect(dom.window.document.querySelector('textarea')).toBeNull()
      } finally { await act(async () => { root?.unmount() }) }
    })
  })

  it('refreshes a stale edit without locking or replacing the preserved draft', async () => {
    await useDom(async dom => {
      const face = host(false)
      let revision = 1
      const previewRetry = vi.fn(async () => ({ branchRevision: revision, inputRevision: `input-${revision}`, eligible: true }))
      const retry = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('branch moved'), { code: 'session/retry-revision' }))
        .mockResolvedValueOnce({ sessionId: 'child', sourceSessionId: 's', archived: true })
      const model = createRetryModel({
        list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready' }), subscribe: () => () => {} },
        capabilities: async () => ({ retry: true, retryModified: true, retryContent: true, freeSession: false, deleteSession: false }),
        previewRetry, retry,
      })
      await model.load()
      let root: Root | undefined
      const button = (label: string) => [...dom.window.document.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') ?? item.textContent) === label)!
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<EditActions promptSeq={3} messageId="message-3" sessionId="s" locale="en" host={face} nativeRetry={model} />)
        })
        await act(async () => { button('Edit and resend').click() })
        const textarea = dom.window.document.querySelector('textarea')!
        await act(async () => { change(dom, textarea, 'preserved draft') })
        revision = 2
        await act(async () => { button('Send').click() })
        await act(async () => { button('Confirm resend').click() })
        expect(dom.window.document.querySelector('textarea')).toBe(textarea)
        expect(textarea.value).toBe('preserved draft')
        expect(textarea.disabled).toBe(false)
        await act(async () => { change(dom, textarea, 'preserved draft, retried') })
        await act(async () => { button('Send').click() })
        await act(async () => { button('Confirm resend').click() })
        expect(previewRetry).toHaveBeenCalledTimes(2)
        expect(retry.mock.calls[1]?.[0]).toMatchObject({
          expectedRevision: 2,
          expectedInputRevision: 'input-2',
          text: 'preserved draft, retried',
        })
        expect(dom.window.document.querySelector('textarea')).toBeNull()
      } finally { await act(async () => { root?.unmount() }) }
    })
  })

  it('keeps a new message edit entry visible when the global capability is unavailable', async () => {
    await useDom(async dom => {
      const face = host(false)
      const { model, retry } = await nativeModel(undefined, false)
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<EditActions promptSeq={3} messageId="message-3" sessionId="s" locale="en" host={face} nativeRetry={model} />)
        })
        expect(dom.window.document.querySelector('button[aria-label="Edit and resend"]')).not.toBeNull()
        expect(dom.window.document.querySelector('[role="alert"]')).toBeNull()
        expect(dom.window.document.querySelector('textarea')).toBeNull()
        expect(face.prepare).not.toHaveBeenCalled()
        expect(retry).not.toHaveBeenCalled()
      } finally { await act(async () => { root?.unmount() }) }
    })
  })

  it('shows the branch warning only in the send confirmation and sends the consent', async () => {
    await useDom(async dom => {
      const face = host(false)
      const retry = vi.fn(async () => ({}))
      const model = createRetryModel({
        list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready' }), subscribe: () => () => {} },
        capabilities: async () => ({ retry: true, retryModified: true, retryContent: true, freeSession: false, deleteSession: false }),
        previewRetry: async () => ({ branchRevision: 2, eligible: false, reason: 'modified', inputRevision: 'input-2' }), retry,
      })
      await model.load()
      let root: Root | undefined
      const button = (label: string) => [...dom.window.document.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') ?? item.textContent) === label)!
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<EditActions promptSeq={3} messageId="message-3" sessionId="s" locale="en" host={face} nativeRetry={model} />)
        })
        await act(async () => { button('Edit and resend').click() })
        expect(dom.window.document.querySelector('textarea')?.value).toBe('original')
        expect(dom.window.document.querySelector('.dsm-message-editor')?.textContent).not.toContain('previous version moves to the archive')
        expect(dom.window.document.querySelector('.dsm-message-editor .dsh-free-warning')).toBeNull()
        await act(async () => { button('Send').click() })
        expect(dom.window.document.querySelector('[role="dialog"]')?.textContent).toContain('previous version moves to the archive')
        await act(async () => { button('Confirm resend').click() })
        expect(retry).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's', messageId: 'message-3', text: 'original', allowModified: true }))
      } finally { await act(async () => { root?.unmount() }) }
    })
  })
})
