// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ZhihuLocaleContext } from './client-locale.ts'
import { ZhihuOpenPlatformSection } from './client-open-platform.tsx'

// The inspector must receive the original response, including decimal strings
// beyond Number's precision, while keeping returned markup inert.
describe('open platform response inspector', () => {
  it('retains exact data and paging when rendered with the official inspector', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const data = { Offset: '9007199254740993', Body: '<img src=x onerror="alert(1)">', Missing: null }
    const call = vi.fn(async (_channel: string, _operation: string, _params: unknown, _signal?: AbortSignal) => ({ ok: true, value: {
      version: 1, operation: 'question.answers', data,
      paging: { canContinue: true, nextOffset: '9007199254740993' },
    } }))
    const button = (label: string) => [...container.querySelectorAll('button')].find(node => node.textContent === label)!
    try {
      await act(async () => root.render(<ZhihuLocaleContext.Provider value="en">
        <ZhihuOpenPlatformSection rpc={{ call }} selectedOperation="question.answers" />
      </ZhihuLocaleContext.Provider>))
      expect(call).not.toHaveBeenCalled()
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Zhihu question link"]')!
      await act(async () => {
        Simulate.change(input, { target: { value: 'https://www.zhihu.com/question/123' } } as never)
      })
      await act(async () => button('Run request').click())
      const inspector = container.querySelector('[role="tree"][aria-label="Response data"]')
      expect(inspector?.textContent).toContain('9007199254740993')
      expect(JSON.parse(inspector?.textContent ?? '{}')).toEqual(data)
      expect(container.querySelector('img,script')).toBeNull()
      await act(async () => button('Next page').click())
      expect(call).toHaveBeenCalledTimes(2)
      expect(call.mock.calls[1]?.[2]).toMatchObject({ offset: '9007199254740993' })
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })
})
