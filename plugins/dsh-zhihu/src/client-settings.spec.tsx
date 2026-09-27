import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from './client.tsx'
import { ZHIHU_CREDENTIAL_REF } from './contracts.ts'

type Registration = {
  spec: { name: string; key?: string; id?: string }
  render: (props: unknown) => ReactElement<Record<string, unknown>> | null
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose()
})

function setup(declared = ['plugins.bundle.config', 'dsh-editor.settings.zhihu']) {
  const available = new Set(declared)
  const waiting = new Map<string, () => unknown>()
  const registrations: Registration[] = []
  const credentials = {
    describe: vi.fn(async (_refs: string[]) => ({
      ok: true as const,
      value: { [ZHIHU_CREDENTIAL_REF]: { configured: true, writable: true } },
    })),
    set: vi.fn(async (_ref: string, _value: string) => ({ ok: true as const, value: undefined })),
    unset: vi.fn(async (_ref: string) => ({ ok: true as const, value: undefined })),
  }
  const rpc = { call: vi.fn(async () => ({ ok: true as const, value: {} })) }
  const ctx = {
    effect(callback: () => (() => void) | void) {
      const dispose = callback()
      if (dispose) cleanups.push(dispose)
    },
    slots: {
      inject(key: string, callback: () => unknown) {
        waiting.set(key, callback)
        if (available.has(key)) return callback()
        return () => waiting.delete(key)
      },
      register(spec: Registration['spec'], render: unknown) {
        const registration = { spec, render: render as Registration['render'] }
        registrations.push(registration)
        return () => {
          const index = registrations.indexOf(registration)
          if (index >= 0) registrations.splice(index, 1)
        }
      },
    },
    connection: { rpc },
    remote: { credentials },
  }
  apply(ctx as never)
  return { waiting, registrations, credentials, rpc }
}

function entry(registrations: Registration[], name: string): Registration {
  const result = registrations.find(row => row.spec.name === name)
  if (!result) throw new Error(`Missing settings registration: ${name}`)
  return result
}

describe('Zhihu configuration belongs to the Plugins page', () => {
  it('keys the configuration to its own bundle and never registers a chat launcher', () => {
    const { waiting, registrations, rpc, credentials } = setup()
    expect([...waiting.keys()]).toEqual(['plugins.bundle.config', 'dsh-editor.settings.zhihu'])
    expect(registrations).toHaveLength(2)
    expect(entry(registrations, 'plugins.bundle.config').spec).toEqual({
      name: 'plugins.bundle.config', key: '@klarkxy/dsh-zhihu',
    })
    expect(entry(registrations, 'dsh-editor.settings.zhihu').spec.id).toBe('zhihu')
    expect(waiting.has('shell.overlay')).toBe(false)
    expect(waiting.has('settings.section')).toBe(false)
    expect(rpc.call).not.toHaveBeenCalled()
    expect(credentials.describe).not.toHaveBeenCalled()
  })

  it.each(['plugins.bundle.config', 'dsh-editor.settings.zhihu'])(
    '%s embeds all four tabs, defaults to settings, and has no floating button or nested dialog',
    slot => {
      const { registrations } = setup()
      const Dialog = vi.fn(() => null)
      const rendered = entry(registrations, slot).render({ view: 'page', Dialog })
      expect(rendered?.props.surface).toBe('settings')
      const html = renderToStaticMarkup(rendered)
      expect(html).toContain('data-testid="zhihu-settings-embed"')
      expect(html).toContain('data-testid="zhihu-settings"')
      expect(html.match(/role="tab"/g)).toHaveLength(4)
      for (const label of ['设置', '用量', '知识库', '连接测试']) {
        expect(html).toContain(`>${label}</button>`)
      }
      expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>设置<\/button>/)
      expect(html).not.toContain('data-testid="zhihu-open"')
      expect(html).not.toContain('class="zhihu-dock"')
      expect(html).not.toContain('data-testid="zhihu-panel"')
      expect(html).not.toContain('zhihu-panel-close')
      expect(Dialog).not.toHaveBeenCalled()
    },
  )

  it('does not mount a settings form in a summary view', () => {
    const { registrations, credentials, rpc } = setup()
    expect(entry(registrations, 'plugins.bundle.config').render({ view: 'summary' })).toBeNull()
    expect(credentials.describe).not.toHaveBeenCalled()
    expect(rpc.call).not.toHaveBeenCalled()
  })

  it('waits for a late Plugins page instead of falling back to an available overlay', () => {
    const { waiting, registrations } = setup(['shell.overlay'])
    expect(registrations).toHaveLength(0)
    expect(waiting.has('shell.overlay')).toBe(false)
    const register = waiting.get('plugins.bundle.config')
    expect(register).toBeTypeOf('function')
    const dispose = register!()
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.spec.key).toBe('@klarkxy/dsh-zhihu')
    expect(dispose).toBeTypeOf('function')
    if (typeof dispose === 'function') dispose()
    expect(registrations).toHaveLength(0)
  })

  it('retains the existing RPC and credential reference without migrating saved data', async () => {
    const { registrations, credentials, rpc } = setup()
    const rendered = entry(registrations, 'plugins.bundle.config').render({ view: 'page' })
    expect(rendered?.props.rpc).toBe(rpc)
    const wrapped = rendered!.props.credentials as {
      describe(request: { refs: string[] }): Promise<unknown>
      set(request: { ref: string; value: string }): Promise<unknown>
      unset(request: { ref: string }): Promise<unknown>
    }
    expect(await wrapped.describe({ refs: [ZHIHU_CREDENTIAL_REF] })).toEqual({
      ok: true,
      value: { credentials: { [ZHIHU_CREDENTIAL_REF]: { configured: true, writable: true } } },
    })
    expect(credentials.describe).toHaveBeenCalledWith([ZHIHU_CREDENTIAL_REF])
    await wrapped.set({ ref: ZHIHU_CREDENTIAL_REF, value: 'test-secret' })
    expect(credentials.set).toHaveBeenCalledWith(ZHIHU_CREDENTIAL_REF, 'test-secret')
    await wrapped.unset({ ref: ZHIHU_CREDENTIAL_REF })
    expect(credentials.unset).toHaveBeenCalledWith(ZHIHU_CREDENTIAL_REF)
    expect(rpc.call).not.toHaveBeenCalled()
  })
})
