import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CapabilitiesNote, SETTINGS_TABS, TEST_OPTIONS, ZhihuTestSelector, apply } from './client.tsx'
import type { Context } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'

describe('Zhihu configuration capability navigation', () => {
  it('combines search and question/creator queries in one test tab', () => {
    expect(SETTINGS_TABS).toEqual(['settings', 'usage', 'quota', 'knowledge', 'test'])
  })
  it('offers all eleven business query operations through exactly one function selector', () => {
    expect(TEST_OPTIONS.map(option => option.value)).toEqual([
      'search', 'global', 'hot', 'knowledge', 'ask',
      'question.recommendations', 'question.answers', 'content.detail', 'content.comments',
      'creator.account.stats', 'creator.content.stats',
    ])
    const html = renderToStaticMarkup(<ZhihuTestSelector value="content.comments" onChange={() => {}} />)
    expect(html.match(/<select\b/g)).toHaveLength(1)
    expect(html.match(/<option\b/g)).toHaveLength(11)
    expect(html).toContain('aria-label="测试功能"')
    // The primitives ship no select, so the platform control carries the
    // contract's own settings-field class rather than a plugin recipe.
    expect(html).toContain('dsh-ui-select')
    expect(html).toContain('value="content.comments" selected=""')
  })
  it('explains all supported capabilities and the optional tool entry without running queries', () => {
    // Folded by default; opened here so the list itself is asserted.
    const html = renderToStaticMarkup(<CapabilitiesNote defaultOpen />)
    for (const copy of ['问题推荐', '回答摘要', '本人已发布内容及评论', '单篇创作数据', '官方剩余额度', 'OAuth', '@klarkxy/dsh-zhihu/tools', '不会自动重试']) expect(html).toContain(copy)
  })
  it('retains the bundle configuration seat and package key', () => {
    let seat = ''
    let registration: unknown
    let render: ((props: unknown) => ReactNode) | undefined
    const context = {
      connection: { rpc: { call: async () => { throw new Error('unexpected RPC') } } },
      remote: { credentials: {} },
      effect(callback: () => unknown) { callback() },
      slots: {
        inject(key: string, callback: () => unknown) { seat = key; callback(); return () => {} },
        register(spec: unknown, callback: (props: unknown) => ReactNode) { registration = spec; render = callback },
      },
    }
    apply(context as unknown as Context)
    expect(seat).toBe('plugins.bundle.config')
    expect(registration).toMatchObject({ name: 'plugins.bundle.config', key: '@klarkxy/dsh-zhihu' })
    const html = renderToStaticMarkup(render!({}) as ReactNode)
    // The tab strip is the official primitive: it still emits the same five
    // tabs and still names the same panel ids, so the panel below is unchanged.
    expect(html.match(/role="tab"/g)).toHaveLength(5)
    expect(html.match(/role="tablist"/g)).toHaveLength(1)
    expect(html).toContain('aria-controls="zhihu-tabpanel-test"')
    expect(html).toContain('>测试</button>')
    expect(html).toContain('>统计</button>')
    expect(html).toContain('>官方用量</button>')
    expect(html).toContain('aria-controls="zhihu-tabpanel-quota"')
    expect(html).not.toContain('aria-controls="zhihu-tabpanel-search"')
    expect(html).not.toContain('aria-controls="zhihu-tabpanel-creator"')
  })
})
