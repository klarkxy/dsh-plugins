import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { apply } from './client.tsx'
import {
  dockEscapeKeyDown,
  guardImeEnter,
  hostComponentsFromRenderProps,
  IME_KEYCODE,
  renderInput,
  zhihuQueryKeyDown,
} from './client-host-ui.tsx'

function MockSelect() { return null }
function MockDialog() { return null }
function MockButton() { return null }
function MockInput() { return null }

function reactKey(partial: {
  key?: string
  isComposing?: boolean
  keyCode?: number
  nativeIsComposing?: boolean
  nativeKeyCode?: number
}) {
  const prevented: string[] = []
  return {
    key: partial.key,
    isComposing: partial.isComposing,
    keyCode: partial.keyCode,
    nativeEvent: { isComposing: partial.nativeIsComposing, keyCode: partial.nativeKeyCode },
    preventDefault() { prevented.push('default') },
    stopPropagation() { prevented.push('stop') },
    prevented,
  }
}

describe('public zhihu host compatibility', () => {
  it('extracts structural Select/Dialog/Button/Input from the slot owner without private imports', () => {
    expect(hostComponentsFromRenderProps({
      Select: MockSelect,
      Dialog: MockDialog,
      Button: MockButton,
      Input: MockInput,
    })).toEqual({
      Select: MockSelect,
      Dialog: MockDialog,
      Button: MockButton,
      Input: MockInput,
    })
    expect(hostComponentsFromRenderProps({
      owner: { Select: MockSelect, Dialog: MockDialog, Button: MockButton, Input: MockInput },
    })).toEqual({
      Select: MockSelect,
      Dialog: MockDialog,
      Button: MockButton,
      Input: MockInput,
    })
  })

  it('uses the host Input when provided and a native input otherwise', () => {
    const hosted = renderInput(MockInput, {
      value: '港口',
      type: 'search',
      onChange() {},
      'aria-label': '搜索',
    }) as { type: unknown; props: { value?: string; type?: string } }
    expect(hosted.type).toBe(MockInput)
    expect(hosted.props.value).toBe('港口')
    expect(hosted.props.type).toBe('search')

    const native = renderInput(undefined, {
      value: '港口',
      type: 'password',
      onChange() {},
      'aria-label': '密钥',
    }) as { type: unknown; props: { value?: string; type?: string } }
    expect(native.type).toBe('input')
    expect(native.props.value).toBe('港口')
    expect(native.props.type).toBe('password')
  })

  it('query consumer ignores synthetic isComposing and blocks native IME Enter/229', () => {
    const searches: string[] = []
    const lying = reactKey({ key: 'Enter', isComposing: true, keyCode: 13, nativeIsComposing: false, nativeKeyCode: 13 })
    zhihuQueryKeyDown(lying, { disabled: false, search: () => searches.push('go') })
    expect(searches).toEqual(['go'])

    const composing = reactKey({ key: 'Enter', nativeIsComposing: true, nativeKeyCode: 13 })
    zhihuQueryKeyDown(composing, { disabled: false, search: () => searches.push('go') })
    expect(searches).toEqual(['go'])
    expect(composing.prevented).toContain('default')

    const ime229 = reactKey({ key: 'Enter', nativeKeyCode: IME_KEYCODE })
    zhihuQueryKeyDown(ime229, { disabled: false, search: () => searches.push('go') })
    expect(searches).toEqual(['go'])
    expect(guardImeEnter(ime229)).toBe(true)

    const normal = reactKey({ key: 'Enter', nativeIsComposing: false, nativeKeyCode: 13 })
    zhihuQueryKeyDown(normal, { disabled: false, search: () => searches.push('go') })
    expect(searches).toEqual(['go', 'go'])
  })

  it('standalone Escape does not close while loading', () => {
    const closes: string[] = []
    dockEscapeKeyDown(reactKey({ key: 'Escape' }), { loading: true, close: () => closes.push('x') })
    expect(closes).toEqual([])
    dockEscapeKeyDown(reactKey({ key: 'Escape' }), { loading: false, close: () => closes.push('x') })
    expect(closes).toEqual(['x'])
  })

  it('registers only the package settings page and supports native and host controls', () => {
    const renders: Array<(props: unknown) => { props: Record<string, unknown> }> = []
    const injected: string[] = []
    const registrations: unknown[] = []
    const disposers: Array<() => void> = []
    let slotDisposed = false
    const credentials = {
      describe: async () => ({ ok: true as const, value: {} }),
      set: async () => ({ ok: true as const, value: undefined }),
      unset: async () => ({ ok: true as const, value: undefined }),
    }
    const ctx = {
      effect(fn: () => (() => void) | void) { const off = fn(); if (off) disposers.push(off) },
      slots: {
        inject(key: string, callback: () => unknown) {
          injected.push(key)
          callback()
          return () => { slotDisposed = true }
        },
        register(spec: unknown, render: unknown) {
          registrations.push(spec)
          renders.push(render as (typeof renders)[number])
          return () => {}
        },
      },
      connection: { rpc: { call: async () => ({}) } },
      remote: { credentials },
    }
    apply(ctx as never)
    expect(injected).toEqual(['plugins.bundle.config'])
    expect(registrations).toEqual([{
      name: 'plugins.bundle.config', key: '@klarkxy/dsh-zhihu', order: 120, label: '知乎',
    }])
    expect(renders).toHaveLength(1)
    const standalone = renders[0]!({ owner: { view: 'page' } })
    const html = renderToStaticMarkup(standalone as never)
    expect(html).toContain('zhihu-settings-embed')
    expect(html).toContain('知乎凭证设置')
    for (const label of ['设置', '用量', '知识库', '搜索']) expect(html).toContain(label)
    expect(html).not.toContain('zhihu-open')
    expect(html).not.toContain('zhihu-dock')
    const hosted = renders[0]!({ owner: { Select: MockSelect, Button: MockButton, Input: MockInput } })
    expect(hosted.props.Select).toBe(MockSelect)
    expect(hosted.props.Button).toBe(MockButton)
    expect(hosted.props.Input).toBe(MockInput)
    for (const dispose of disposers) dispose()
    expect(slotDisposed).toBe(true)
  })
})
