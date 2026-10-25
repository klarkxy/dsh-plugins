// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ZHIHU_APP_KEY_REF, ZHIHU_APP_SECRET_REF, ZhihuSyncCredentials } from './client-sync-credentials.tsx'

describe('publisher credentials', () => {
  it('saves a credential and clears it again, but never offers to clear an env-provided one', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const set = vi.fn(async () => ({ ok: true as const, value: {} }))
    const unset = vi.fn(async () => ({ ok: true as const, value: {} }))
    const describe = vi.fn(async () => ({
      ok: true as const,
      value: {
        credentials: {
          [ZHIHU_APP_KEY_REF]: { configured: true, writable: true },
          [ZHIHU_APP_SECRET_REF]: { configured: true, writable: false },
        },
      },
    }))
    try {
      await act(async () => root.render(<ZhihuSyncCredentials credentials={{ describe, set, unset }} />))
      // 凭据状态是异步读回来的：等一次宏任务，字段才渲染出来。
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      const input = container.querySelector<HTMLInputElement>('input[aria-label="App Key"]')
      expect(input).not.toBeNull()
      await act(async () => Simulate.change(input!, { target: { value: 'my-token' } }))
      await act(async () => [...container.querySelectorAll('button')].find(node => node.textContent === '保存')!.click())
      expect(set).toHaveBeenCalledWith({ ref: ZHIHU_APP_KEY_REF, value: 'my-token' })

      // 只有可写的凭据有清除按钮；只读的那份来自环境变量。
      const clears = [...container.querySelectorAll('button')].filter(node => node.textContent === '清除')
      expect(clears).toHaveLength(1)
      await act(async () => clears[0].click())
      const confirmed = [...document.querySelectorAll('button')].filter(node => node.textContent === '清除').at(-1)!
      await act(async () => confirmed.click())
      expect(unset).toHaveBeenCalledWith({ ref: ZHIHU_APP_KEY_REF })
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })
})
