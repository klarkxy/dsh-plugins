import { describe, expect, it, vi } from 'vitest'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { CAST_WATCH_NAMESPACES, type CastApi } from './client-cast.tsx'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { apply, inject, SubagentModelsPage } from './client.tsx'
import { subagentCatalogCopy } from './client-subagent-catalog.tsx'

const catalog = { groups: [{ id: 'p', name: 'Provider', models: [{ id: 'one', name: 'One' }] }] }
const cast = { enabled: false, revision: 0, tendencyRevision: 0, routes: [] }

describe('subagent model settings', () => {
  it('contains only the subagent model editor', () => {
    const html = renderToStaticMarkup(createElement(SubagentModelsPage, {
      locale: 'zh-CN',
      api: { getCast: async () => cast, modelCatalog: async () => catalog },
    }))
    expect(html).toContain('aria-label="子代理"')
    expect(html).toContain('添加模型')
    expect(html).not.toContain('字段总览')
    expect(html).not.toContain('运行中的子代理')
  })

  it('keeps the section id stable and uses the short localized label', async () => {
    const waiting: Array<() => void> = []
    const registered: Array<{ options: { id?: string; name?: string; label?: () => string } }> = []
    const cleanup: Array<() => void | Promise<void>> = []
    await apply({
      slots: { inject: (_name: string, fn: () => void) => waiting.push(fn), register: (options: { name: string }) => { if (options.name === 'settings.section') registered.push({ options }) } },
      connection: { rpc: { call: async () => ({ ok: true, value: [] }) } },
      remote: { session: { modelCatalog: async () => ({ ok: true, value: catalog }) }, $mount: async () => async () => {} },
      effect: (callback: () => () => void | Promise<void>) => { cleanup.push(callback()) },
      inject: () => ({ dispose() {} }), locale: 'en',
      sessions: { refreshProjections: async () => {} }, uiWorkspace: { openSession: () => {} }, sidebarRight: { openResource: () => {} },
    })
    waiting.forEach(fn => fn())
    expect(registered[0]?.options).toMatchObject({ id: 'model-hub', order: 180 })
    expect(registered[0]?.options.label?.()).toBe('Subagents')
    for (const dispose of cleanup.reverse()) await dispose()
  })

  it('refreshes subscribers for its cast stores but ignores unrelated settings traffic', async () => {
    const frames: unknown[] = [{ kind: 'ready' }]
    let wake: (() => void) | undefined
    const controller = new AbortController()
    const remote = {
      $mount: async () => async () => {},
      [modelSettingsChangesIdentity('@klarkxy/dsh-model-hub').namespace]: { watch() {} },
      $stream: () => ({
        async *[Symbol.asyncIterator]() {
          while (!controller.signal.aborted) {
            if (frames.length) {
              yield { generation: 1, value: frames.shift(), signal: controller.signal, accept() {} }
            } else await new Promise<void>(resolve => { wake = resolve })
          }
        },
        async dispose() { controller.abort(); wake?.() },
      }),
    }
    let api!: CastApi
    apply({
      slots: {
        inject(name: string, run: () => void) { if (name === 'settings.section') run() },
        register(options: { inject?: () => { api: CastApi } }) { if (options.inject) api = options.inject().api },
      },
      connection: { rpc: { call: async () => ({ ok: true, value: cast }) } },
      locale: 'en',
      inject(_deps: string[], run: (scope: unknown) => void) {
        const cleanup: Array<() => unknown> = []
        run({ remote, effect: (fn: () => () => unknown) => cleanup.push(fn()) })
        return { dispose() { for (const off of cleanup.reverse()) off() } }
      },
    })
    const changed = vi.fn(), failed = vi.fn()
    const off = api.subscribeChanges!(changed, failed)
    const send = async (ns: string) => {
      frames.push({ kind: 'changed', ns, revision: 1 }); wake?.()
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    try {
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
      await send('@klarkxy/dsh-current-title')
      await send('@klarkxy/dsh-model-hub/running-subagents')
      expect(changed).toHaveBeenCalledTimes(1)
      await send(CAST_WATCH_NAMESPACES[0])
      await send(CAST_WATCH_NAMESPACES[1])
      expect(changed).toHaveBeenCalledTimes(3)
      expect(failed).not.toHaveBeenCalled()
    } finally { off() }
    expect(controller.signal.aborted).toBe(true)
  })

  it('keeps route copy bilingual', () => {
    expect(Object.keys(subagentCatalogCopy.zh)).toEqual(Object.keys(subagentCatalogCopy.en))
  })
})
