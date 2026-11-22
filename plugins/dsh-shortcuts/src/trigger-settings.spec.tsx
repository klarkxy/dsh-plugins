// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TriggerSettings } from './trigger-settings.tsx'

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals() })

describe('desktop palette shortcut confirmation', () => {
  it.each([
    ['en', 'Use Ctrl+K', 'If session search still uses Ctrl+K, it is unbound before the palette is saved. If either step fails, review both settings. Session search remains clickable.'],
    ['zh', '使用 Ctrl+K', '若会话搜索仍占用 Ctrl+K，将先解绑再绑定面板；分步保存失败时请核对两项设置。搜索仍可点击使用。'],
  ] as const)('retains the conditional two-step save warning in %s', async (locale, action, warning) => {
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

describe('web palette shortcut recording', () => {
  it('Escape cancels only the recording modal without bubbling to the settings page', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(<TriggerSettings
      locale="en"
      runtime="web"
      useTrigger={selector => selector({ binding: null, error: null })}
      saveTrigger={() => true}
      conflicts={() => []}
      claim={vi.fn(async () => null)}
    />))
    const change = Array.from(container.querySelectorAll('button')).find(item => item.textContent === 'Change')!
    await act(async () => change.click())
    const input = document.querySelector<HTMLInputElement>('input[aria-describedby="shortcut-record-hint"]')!
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => { input.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('.shortcuts-root')).not.toBeNull()
    await act(async () => root.unmount())
  })
})
