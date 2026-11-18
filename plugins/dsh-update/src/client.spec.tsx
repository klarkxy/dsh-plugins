// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  DshUpdateOverlay,
  PluginUpdatesTab,
  apply,
  createUpdateClientController,
  type ClientHostContext,
} from './client.tsx'
import { RPC_CHANNEL } from './contracts.ts'
import { installUpdateButtonInterceptor, matchInterceptableTrigger } from './dsh-interceptor.ts'

describe('dsh-update client button interception & confirmation flow', () => {
  it('intercepts clicking [新版本] before download starts, shows Release Logs, and triggers download ONLY on confirm', async () => {
    const rpcCalls: Array<[string, unknown]> = []
    const client: ClientHostContext = {
      connection: {
        rpc: {
          call: async (_channel, endpoint, payload) => {
            rpcCalls.push([endpoint, payload])
            if (endpoint === 'dsh.check') {
              return {
                ok: true,
                value: {
                  currentVersion: '0.2.2-rc.1',
                  latestVersion: '0.2.2-rc.4',
                  targetVersion: '0.2.2-rc.4',
                  channel: 'prerelease',
                  hasUpdate: true,
                  isDesktopHost: true,
                  checkedAt: '2026-11-18T00:00:00Z',
                  releasesUrl: 'https://github.com/deepseek-ai/deepseek-harness/releases',
                  releaseSource: 'github-releases',
                  releases: [
                    {
                      tag: 'dsh-v0.2.2-rc.4',
                      version: '0.2.2-rc.4',
                      title: '0.2.2-rc.4',
                      body: '### 修复\n- 修复桌面端侧栏气泡',
                      publishedAt: '2026-11-16T00:00:00Z',
                      url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.4',
                      prerelease: true,
                    },
                  ],
                },
              }
            }
            throw new Error(`Unexpected endpoint ${endpoint}`)
          },
        },
      },
      locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe: () => () => {} },
      slots: { inject: () => () => {}, register: () => () => {} },
    }

    const controller = createUpdateClientController(client)
    let nativeDownloadsStarted = 0

    const sidebar = document.createElement('aside')
    const newVersionBtn = document.createElement('button')
    newVersionBtn.type = 'button'
    newVersionBtn.textContent = '新版本'
    newVersionBtn.setAttribute('title', '0.2.2-rc.4')
    newVersionBtn.addEventListener('click', () => {
      nativeDownloadsStarted += 1
    })
    sidebar.appendChild(newVersionBtn)
    document.body.appendChild(sidebar)

    const dispose = installUpdateButtonInterceptor(trigger => controller.handleInterceptedTrigger(trigger), window)
    try {
      // 1. User clicks [↓ 新版本]: immediate download MUST be blocked!
      newVersionBtn.click()
      expect(nativeDownloadsStarted).toBe(0)
      expect(controller.getSnapshot().modal?.kind).toBe('dsh')

      await new Promise(resolve => setTimeout(resolve, 10))
      expect(rpcCalls.map(([ep]) => ep)).toEqual(['dsh.check'])
      expect(controller.getSnapshot().dshStatus?.releases[0]?.version).toBe('0.2.2-rc.4')

      // 2. Dismissing the modal does NOT start the download.
      controller.closeModal()
      expect(nativeDownloadsStarted).toBe(0)
      expect(controller.getSnapshot().modal).toBeNull()

      // 3. Clicking [↓ 新版本] again and confirming starts the native download ONCE.
      newVersionBtn.click()
      expect(nativeDownloadsStarted).toBe(0)
      await controller.confirmDshUpdate('zh')
      expect(nativeDownloadsStarted).toBe(1)
    } finally {
      dispose()
      sidebar.remove()
    }
  })

  it('leaves the native control alone while no changelog surface can take the click', () => {
    const sidebar = document.createElement('aside')
    const newVersionBtn = document.createElement('button')
    newVersionBtn.type = 'button'
    newVersionBtn.textContent = '新版本'
    newVersionBtn.setAttribute('title', '0.2.2-rc.4')
    let nativeDownloads = 0
    newVersionBtn.addEventListener('click', () => { nativeDownloads += 1 })
    sidebar.appendChild(newVersionBtn)
    document.body.appendChild(sidebar)

    const intercepted: string[] = []
    let overlayAvailable = false
    const dispose = installUpdateButtonInterceptor(
      trigger => { intercepted.push(trigger.kind) },
      window,
      { shouldIntercept: () => overlayAvailable },
    )
    try {
      // The host never declared `shell.overlay`: the click must still reach the Desktop download.
      newVersionBtn.click()
      expect(intercepted).toEqual([])
      expect(nativeDownloads).toBe(1)

      // With the overlay in place the same click opens the changelog and skips the download.
      overlayAvailable = true
      newVersionBtn.click()
      expect(intercepted).toEqual(['dsh-new-version'])
      expect(nativeDownloads).toBe(1)
    } finally {
      dispose()
      sidebar.remove()
    }
  })

  it('intercepts Enter once and leaves Space to the button', () => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = '新版本'
    button.setAttribute('title', '0.2.2-rc.4')
    document.body.appendChild(button)
    let activations = 0
    button.addEventListener('click', () => { activations += 1 })

    const intercepted: string[] = []
    const dispose = installUpdateButtonInterceptor(trigger => { intercepted.push(trigger.kind) }, window)
    try {
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      expect(intercepted).toEqual(['dsh-new-version'])
      // Space bonds to the button's own activation, which surfaces as a click and is caught there.
      button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
      expect(intercepted).toEqual(['dsh-new-version'])
      button.click()
      expect(intercepted).toEqual(['dsh-new-version', 'dsh-new-version'])
      expect(activations).toBe(0)
    } finally {
      dispose()
      button.remove()
    }
  })

  it('does not intercept downloading progress (42%), retry pills, or chat message buttons', () => {
    const progressBtn = document.createElement('button')
    progressBtn.textContent = '42%'
    expect(matchInterceptableTrigger(progressBtn, document)).toBeNull()

    const retryBtn = document.createElement('button')
    retryBtn.textContent = '连接异常，刷新重试'
    expect(matchInterceptableTrigger(retryBtn, document)).toBeNull()

    const article = document.createElement('article')
    const chatBtn = document.createElement('button')
    chatBtn.textContent = '新版本'
    article.appendChild(chatBtn)
    expect(matchInterceptableTrigger(chatBtn, document)).toBeNull()
  })

  it('renders Updates tab and Overlay cleanly and never registers forbidden settings seats', () => {
    const injectedSeats: string[] = []
    const client: ClientHostContext = {
      connection: { rpc: { call: vi.fn(async () => ({ ok: true, value: { plugins: [], dshVersion: '0.2.2-rc.1', checkedAt: '' } })) } },
      locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe: () => () => {} },
      slots: {
        inject(key) {
          injectedSeats.push(key)
          return () => {}
        },
        register: () => () => {},
      },
    }

    apply({
      ...client,
      effect(run: () => () => void) {
        run()
        return () => {}
      },
    } as never)

    expect(injectedSeats).not.toContain('plugins.bundle.config')
    expect(injectedSeats).not.toContain('plugins.row.config')
    expect(injectedSeats).toEqual(
      expect.arrayContaining([
        'shell.overlay',
        'plugins.tab',
        'plugins.detail.badge',
        'plugins.detail.actions',
        'settings.general.item',
      ]),
    )

    const controller = createUpdateClientController(client)
    const tabHtml = renderToStaticMarkup(createElement(PluginUpdatesTab, { client, controller }))
    expect(tabHtml).toContain('DeepSeek Harness')
    expect(renderToStaticMarkup(createElement(DshUpdateOverlay, { client, controller }))).toBe('')
    expect((client.connection.rpc.call as ReturnType<typeof vi.fn>).mock.calls).toEqual([])
    expect(RPC_CHANNEL).toBe('/api/plugins/klarkxy-dsh-update')
  })
})
