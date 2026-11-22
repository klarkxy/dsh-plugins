// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TriggerSettings } from './trigger-settings.tsx'

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals() })

describe('desktop palette shortcut confirmation', () => {
  it.each([
    ['en', 'Use Ctrl+K', 'Saves in two steps: unbind session search, then bind the palette. If it fails, review both settings. Session search remains clickable.'],
    ['zh', '使用 Ctrl+K', '将分两次保存：先解绑会话搜索，再绑定命令面板；失败时请核对两项设置。会话搜索仍可点击使用。'],
  ] as const)('retains the two-step save warning in %s', async (locale, action, warning) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(<TriggerSettings
      locale={locale}
      runtime="desktop"
      useTrigger={selector => selector({ binding: null, error: null })}
      saveTrigger={() => true}
      conflicts={() => []}
      claim={vi.fn(async () => null)}
    />))
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent === action)!
    await act(async () => button.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(warning)
    await act(async () => root.unmount())
  })
})
