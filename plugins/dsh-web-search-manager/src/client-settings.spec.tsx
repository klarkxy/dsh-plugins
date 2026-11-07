// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from './client.tsx'

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
})
