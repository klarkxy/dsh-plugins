// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { clearClientPluginLogs, readClientPluginLogs } from '@klarkxy/dsh-plugin-kit/client-logger'
import { apply, inject, name } from './client.tsx'

describe('web search manager settings seats', () => {
  it('registers the section and its nav icon under matching ids', () => {
    const injected: string[] = []
    const registrations: Array<{ spec: Record<string, unknown>; render: unknown }> = []
    const ctx = {
      effect: (callback: () => (() => void) | void) => { callback() },
      slots: {
        inject(key: string, callback: () => unknown) { injected.push(key); callback(); return () => {} },
        register(spec: Record<string, unknown>, render: unknown) { registrations.push({ spec, render }); return () => {} },
      },
      locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe: () => () => {} },
    }
    apply(ctx as unknown as Context)
    expect(injected).toEqual(['settings.section', 'settings.section.icon'])
    const section = registrations.find(entry => entry.spec.name === 'settings.section')
    const icon = registrations.find(entry => entry.spec.name === 'settings.section.icon')
    expect(section?.spec).toMatchObject({ id: 'web-search-manager', order: 150 })
    expect(typeof section?.spec.label).toBe('function')
    expect((section!.spec.label as () => string)()).toBe('网页搜索')
    expect(icon?.spec).toMatchObject({ id: 'web-search-manager', order: 150 })
    // The official globe glyph receives owner {size, active} props.
    const element = (icon!.render as (props: unknown) => { props: Record<string, unknown> })({ size: 18, active: true })
    expect(element.props['data-icon']).toBe('globe')
    expect(element.props['aria-hidden']).toBe('true')
  })

  it('activates on a real Cordis Context proxy whose services are prototype-resolved', async () => {
    clearClientPluginLogs()
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    const injected: string[] = []
    const registrations: Array<{ spec: Record<string, unknown>; render: unknown }> = []
    const call = vi.fn(async () => { throw new Error('rpc down') })
    const root = new Context()
    root.provide('slots', {
      inject(key: string, callback: () => unknown) { injected.push(key); callback(); return () => {} },
      register(spec: Record<string, unknown>, render: unknown) { registrations.push({ spec, render }); return () => {} },
    })
    root.provide('connection', { rpc: { call } })
    root.provide('remote', { credentials: { describe: vi.fn(), set: vi.fn(), unset: vi.fn() } })
    root.provide('remote.credentials', {})
    root.provide('locale', { getSnapshot: () => ({ active: 'en-US' }), subscribe: () => () => {} })

    const scope = await root.plugin({ name, inject: [...inject], apply })

    expect(scope.state).toBe(2)
    expect(injected).toEqual(['settings.section', 'settings.section.icon'])
    const section = registrations.find(entry => entry.spec.name === 'settings.section')
    expect((section!.spec.label as () => string)()).toBe('Web Search')

    const host = document.createElement('div')
    document.body.appendChild(host)
    const reactRoot = createRoot(host)
    try {
      await act(async () => {
        reactRoot.render((section!.render as (props?: { hidden?: boolean }) => ReactElement)())
      })
      expect(call).toHaveBeenCalled()
      const logs = readClientPluginLogs('dsh-web-search-manager')
      expect(logs.some(entry => entry.event === 'rpc.call-failed')).toBe(true)
    } finally {
      await act(async () => { reactRoot.unmount() })
      host.remove()
      await root.fiber.dispose()
    }
  })
})
