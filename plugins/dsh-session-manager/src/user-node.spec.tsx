import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { UserNodeWithEdit } from './user-node.tsx'
import type { EditHost } from './edit-host.ts'
import { createRetryModel, type RetryModel } from './session-actions.ts'

async function nativeRetry() {
  const retry = vi.fn(async () => ({}))
  const model = createRetryModel({
    list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready' }), subscribe: () => () => {} },
    capabilities: async () => ({ retry: true, retryModified: true, freeSession: false, deleteSession: false }),
    previewRetry: async () => ({ branchRevision: 1, inputRevision: 'input-1', eligible: true }), retry,
  })
  await model.load()
  return { model, retry }
}

async function useDom(run: (dom: JSDOM) => Promise<void>): Promise<void> {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    MouseEvent: dom.window.MouseEvent, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, (globalThis as Record<string, unknown>)[key])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
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

function host(): EditHost {
  return {
    prepare: vi.fn(async () => ({ sessionId: 's', promptSeq: 7, text: 'original', modified: false })),
  }
}

const t = (key: string) => key

describe('user message edit renderer', () => {
  it('uses the current host content factory for images, files, and reference chips without the legacy image callback', async () => {
    await useDom(async dom => {
      const face = host()
      const native = await nativeRetry()
      const loadImage = vi.fn()
      const image = { attachmentId: 'screenshot', mimeType: 'image/png' }
      const file = { attachmentId: 'document', name: 'notes.txt', bytes: 12 }
      const extra = { type: 'custom', text: 'extra' }
      const renderFactorySlot = vi.fn((_name, input) => <div data-host-user-content>{input.content.text}</div>)
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<UserNodeWithEdit
            node={{ id: 'message-7', data: {
              seq: 7, time: Date.now(), referenceLabels: ['Session'], skillNames: ['review'],
              content: [{ type: 'text', text: 'original' }, { type: 'image', attachment: image }, { type: 'file', attachment: file }, extra],
            } }}
            sessionId="s" locale="en" host={face} nativeRetry={native.model}
            renderFactorySlot={renderFactorySlot} loadImage={loadImage} t={t}
          />)
        })
        expect(renderFactorySlot).toHaveBeenCalledWith('conversation.chat.user.content', {
          content: {
            text: 'original', attachments: [{ type: 'image', image: { attachment: image } }, { type: 'file', file }],
            extraBlocks: [extra], referenceLabels: ['Session'],
          },
          loadImage, facts: { sessionLabels: ['Session'], skillNames: ['review'] }, interactive: true,
        })
        const chrome = dom.window.document.querySelector('.dsm-user-chrome')!
        expect(chrome.previousElementSibling?.hasAttribute('data-host-user-content')).toBe(true)
        expect(chrome.textContent).toContain('Edit and resend')
        expect(chrome.textContent).not.toContain('Retry')
        const edit = [...chrome.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === 'Edit and resend')!
        await act(async () => { edit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(face.prepare).toHaveBeenCalledWith({ sessionId: 's', promptSeq: 7 }, expect.anything())
        expect(dom.window.document.querySelector('textarea')?.value).toBe('original')
        expect(dom.window.document.querySelector('[role="dialog"]')).toBeNull()
        expect(dom.window.document.querySelector('.dsm-user-original')?.hasAttribute('hidden')).toBe(true)
        const cancel = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === 'Cancel')!
        await act(async () => { cancel.click() })
        expect(dom.window.document.querySelector('textarea')).toBeNull()
        expect(dom.window.document.querySelector('.dsm-user-original')?.hasAttribute('hidden')).toBe(false)
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })

  it('keeps the native text-only edit alive while its action row is hidden by the inline editor', async () => {
    await useDom(async dom => {
      const face = host()
      const native = await nativeRetry()
      const retry = vi.fn(async () => ({}))
      const model = createRetryModel({
        list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready' }), subscribe: () => () => {} },
        capabilities: async () => ({ retry: true, retryModified: true, freeSession: false, deleteSession: false }),
        previewRetry: async () => ({ branchRevision: 1, inputRevision: 'input-1', eligible: true }), retry,
      })
      await model.load()
      let root: Root | undefined
      const button = (label: string) => [...dom.window.document.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') ?? item.textContent) === label)!
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(<UserNodeWithEdit node={{ id: 'message-7', data: { seq: 7, time: 0, content: [{ type: 'text', text: 'original' }] } }}
            sessionId="s" locale="en" host={face} nativeRetry={model} t={t} />)
        })
        await act(async () => { button('Edit and resend').click() })
        expect(model.getSnapshot().editing).toBe(true)
        expect(dom.window.document.querySelectorAll('textarea')).toHaveLength(1)
        await act(async () => { button('Send').click() })
        await act(async () => { button('Confirm resend').click() })
        expect(retry).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's', messageId: 'message-7', text: 'original' }))
        expect(dom.window.document.querySelector('textarea')).toBeNull()
      } finally { await act(async () => { root?.unmount() }) }
    })
  })

  it('keeps the user bubble, clock, and copy row while editing the exact prompt', async () => {
    await useDom(async dom => {
      const face = host()
      const native = await nativeRetry()
      const time = new Date().setHours(12, 27, 0, 0)
      const renderFactorySlot = vi.fn(() => { throw new Error('This older host has no user-content factory') })
      let root: Root | undefined
      try {
        await act(async () => {
          root = createRoot(dom.window.document.getElementById('root')!)
          root.render(
            <UserNodeWithEdit
              node={{ id: 'message-7', data: { seq: 7, time, content: [{ type: 'text', text: 'original' }] } }}
              sessionId="s"
              locale="en"
              host={face}
              nativeRetry={native.model}
              renderMessageImages={() => null}
              renderFactorySlot={renderFactorySlot}
              t={t}
              ids={() => 'request-7'}
            />,
          )
        })
        const chrome = dom.window.document.querySelector('.dsm-user-chrome')!
        expect(dom.window.document.querySelector('.dsm-user-bubble')?.textContent).toBe('original')
        expect(chrome.textContent).toContain('12:27')
        expect([...chrome.querySelectorAll('button')].map(item => item.getAttribute('aria-label')))
          .toEqual(['Edit and resend', 'copy'])
        expect(renderFactorySlot).not.toHaveBeenCalled()
        const edit = [...chrome.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === 'Edit and resend')!
        await act(async () => { edit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
        expect(dom.window.document.querySelector('textarea')?.value).toBe('original')
        expect(native.retry).not.toHaveBeenCalled()
      } finally {
        await act(async () => { root?.unmount() })
      }
    })
  })
})
