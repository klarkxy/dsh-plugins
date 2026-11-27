import { describe, expect, it } from 'vitest'
import { escapeZhihuMarkdown, renderZhihuOpenPlatform } from './open-platform-render.ts'

describe('user-data list untrusted Markdown escaping and Pin extraction', () => {
  it('escapes Markdown links, images, formatting syntax and code spans while stripping decoded HTML tags', () => {
    const rendered = renderZhihuOpenPlatform({
      version: 1,
      operation: 'user.favlists',
      data: {
        Items: [
          {
            Title: '[诱导点击](https://evil.example/phish) ![tracker](https://evil.example/pixel.png) `code` *bold* > quote &lt;img src=x&gt;',
            Url: 'https://www.zhihu.com/collection/123',
          },
          {
            Unexpected: '[注入](https://evil.example/fallback)',
          },
        ],
      },
      paging: { isEnd: true, canContinue: false },
    })
    expect(rendered).toContain('1. \\[诱导点击\\]\\(https://evil.example/phish\\) \\!\\[tracker\\]\\(https://evil.example/pixel.png\\) \\`code\\` \\*bold\\* \\> quote')
    expect(rendered).not.toContain('img src=x')
    expect(rendered).toContain('   - 链接：https://www.zhihu.com/collection/123')
    expect(rendered).toContain('2. {"Unexpected":"\\[注入\\]\\(https://evil.example/fallback\\)"}')
    expect(rendered).not.toMatch(/(?<!\\)\[诱导点击\]\(/)
    expect(rendered).not.toMatch(/(?<!\\)!\[tracker\]\(/)
    expect(escapeZhihuMarkdown('普通标题')).toBe('普通标题')
  })

  it('uses ContentText or Excerpt for untitled Pins instead of Author.Name or Author.Url', () => {
    const rendered = renderZhihuOpenPlatform({
      version: 1,
      operation: 'user.contents',
      data: {
        Items: [
          {
            ContentType: 'pin',
            Title: '',
            ContentText: '<p>这是一条无标题想法正文</p>',
            Author: { Name: '作者昵称不应作为标题', Url: 'https://www.zhihu.com/people/author' },
            Url: 'https://www.zhihu.com/pin/1001',
          },
          {
            Author: { Name: '外层作者', Url: 'https://www.zhihu.com/people/outer' },
            Target: {
              Title: '',
              Excerpt: '收藏夹内无标题想法摘要',
              Author: { Name: '内层作者', Url: 'https://www.zhihu.com/people/inner' },
              Url: 'https://www.zhihu.com/pin/1002',
            },
          },
        ],
      },
      paging: { isEnd: true, canContinue: false },
    })
    expect(rendered).toContain('1. 这是一条无标题想法正文')
    expect(rendered).toContain('   - 链接：https://www.zhihu.com/pin/1001')
    expect(rendered).toContain('2. 收藏夹内无标题想法摘要')
    expect(rendered).toContain('   - 链接：https://www.zhihu.com/pin/1002')
    expect(rendered).not.toContain('作者昵称不应作为标题')
    expect(rendered).not.toContain('外层作者')
    expect(rendered).not.toContain('内层作者')
    expect(rendered).not.toContain('/people/')
  })
})
