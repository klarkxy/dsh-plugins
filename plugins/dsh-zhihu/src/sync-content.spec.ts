import { describe, expect, it } from 'vitest'
import { buildZhihuPublishRequest, normalizeCodeLang, prepareZhihuSyncDraft, SYNC_LIMITS } from './sync-content.ts'
import type { SyncDraft, SyncPrepared } from './sync-types.ts'

const base = (partial: Partial<SyncDraft> = {}): SyncDraft => ({
  type: 'article',
  title: '测试标题',
  body: '这是一段足够长的正文内容，超过九个字，用于测试。',
  format: 'markdown',
  ...partial,
})

const prepare = (d: unknown) => prepareZhihuSyncDraft(d)

describe('prepareZhihuSyncDraft · draft normalization', () => {
  it('rejects non-object input', () => {
    const r = prepare('x')
    expect(r.canPublish).toBe(false)
    expect(r.issues.some(i => i.code === 'input.invalid')).toBe(true)
  })
  it('falls back to article + markdown for missing fields', () => {
    const r = prepare({})
    expect(r.draft.type).toBe('article')
    expect(r.draft.format).toBe('markdown')
    // empty title → required error
    expect(r.issues.some(i => i.code === 'title.required')).toBe(true)
  })
  it('rejects unsupported type', () => {
    const r = prepare({ type: 'video', title: 't', body: 'b', format: 'markdown' })
    expect(r.canPublish).toBe(false)
    expect(r.issues.some(i => i.code === 'input.bad-type')).toBe(true)
  })
})

describe('title rules (conversion.md §2)', () => {
  it('question: appends ？ and counts it in length', () => {
    const r = prepare({ type: 'question', title: '短', body: '说明', format: 'markdown' })
    expect(r.draft.title).toBe('短？')
    expect(r.counts.titleChars).toBe(2)
    // '短？' = 2 chars < 4 → too-short
    expect(r.issues.some(i => i.code === 'title.too-short')).toBe(true)
  })
  it('question: accepts 4-51 chars', () => {
    const r = prepare({ type: 'question', title: '为什么天空是蓝色的？', body: '', format: 'markdown' })
    expect(r.issues.some(i => i.code.startsWith('title.'))).toBe(false)
  })
  it('question: already has ? does not double', () => {
    const r = prepare({ type: 'question', title: '如何学习编程？', body: '', format: 'markdown' })
    expect(r.draft.title.endsWith('？')).toBe(true)
    expect((r.draft.title.match(/[？?]/g) ?? []).length).toBe(1)
  })
  it('pin: 51-char title errors, 50 ok', () => {
    const t50 = '字'.repeat(50)
    const t51 = '字'.repeat(51)
    expect(prepare({ type: 'pin', title: t50, body: '内容', format: 'markdown' }).issues.some(i => i.code === 'title.too-long')).toBe(false)
    expect(prepare({ type: 'pin', title: t51, body: '内容', format: 'markdown' }).issues.some(i => i.code === 'title.too-long')).toBe(true)
  })
  it('article: empty title is required error', () => {
    const r = prepare({ type: 'article', title: '', body: 'x'.repeat(20), format: 'markdown' })
    expect(r.issues.some(i => i.code === 'title.required')).toBe(true)
  })
})

describe('body length limits (conversion.md §3)', () => {
  it('article: rejects <9 chars', () => {
    const r = prepare({ type: 'article', title: '标题', body: '短', format: 'markdown' })
    expect(r.issues.some(i => i.code === 'body.too-short')).toBe(true)
    expect(r.canPublish).toBe(false)
  })
  it('pin: empty body still errors when only images present (publish needs non-empty html)', () => {
    const r = prepare({ type: 'pin', title: '', body: '', format: 'markdown', images: [{ url: 'https://pic1.zhimg.com/x.png' }] })
    expect(r.issues.some(i => i.code === 'body.required')).toBe(true)
    expect(r.canPublish).toBe(false)
  })
  it('pin: rejects empty body without image or linkCard', () => {
    const r = prepare({ type: 'pin', title: '', body: '', format: 'markdown' })
    expect(r.issues.some(i => i.code === 'body.required')).toBe(true)
  })
  it('pin: rejects >2000 chars', () => {
    const r = prepare({ type: 'pin', title: '', body: '长'.repeat(2001), format: 'markdown' })
    expect(r.issues.some(i => i.code === 'body.too-long')).toBe(true)
  })
})

describe('markdown → 知乎 html elements', () => {
  const prep = (body: string) => prepare({ type: 'article', title: 't', body, format: 'markdown' })

  it('paragraphs, empty lines, h2/h3, b/i', () => {
    const r = prep('# 大标题\n\n正文**加粗**和*斜体*。\n\n第二段。')
    expect(r.html).toContain('<h2>大标题</h2>')
    expect(r.html).toContain('<b>加粗</b>')
    expect(r.html).toContain('<i>斜体</i>')
    expect(r.html).toContain('<p>正文')
    expect(r.html).toContain('<p>第二段。</p>')
  })
  it('lists, blockquote, hr', () => {
    const r = prep('- 要点1\n- 要点2\n\n> 引用内容\n\n---')
    expect(r.html).toContain('<ul><li>要点1</li><li>要点2</li></ul>')
    expect(r.html).toContain('<blockquote>引用内容</blockquote>')
    expect(r.html).toContain('<hr />')
  })
  it('ordered list uses ol', () => {
    const r = prep('1. 第一\n2. 第二')
    expect(r.html).toContain('<ol><li>第一</li><li>第二</li></ol>')
  })
  it('code block lang normalized to supported id', () => {
    const r = prep('```python\nprint(1)\n```')
    expect(r.html).toContain('<pre lang="python">print(1)</pre>')
    const r2 = prep('```jsx\nx\n```')
    expect(r2.html).toContain('<pre lang="">x</pre>')
  })
  it('inline code preserved', () => {
    const r = prep('这是`代码`行内')
    expect(r.html).toContain('<code>代码</code>')
  })
  it('deletion line degrades to text', () => {
    const r = prep('正常 ~~删除~~ 文本')
    expect(r.html).toContain('删除')
    expect(r.html).not.toContain('<del>')
    expect(r.issues.some(i => i.code === 'unsupported.del')).toBe(true)
  })
  it('tables get data-draft attrs and only tbody', () => {
    const r = prep('| A | B |\n|---|---|\n| 1 | 2 |')
    expect(r.html).toContain('data-draft-type="table"')
    expect(r.html).toContain('<tbody>')
    expect(r.html).not.toContain('<thead>')
  })
  it('text links keep href, pin uses text-link format', () => {
    const a = prep('[知乎](https://www.zhihu.com)')
    expect(a.html).toContain('href="https://www.zhihu.com"')
    expect(a.html).not.toContain('data-draft-type="text-link"')
    const p = prepare({ type: 'pin', title: '', body: '[知乎](https://www.zhihu.com)', format: 'markdown' })
    expect(p.html).toContain('data-draft-type="text-link"')
  })
  it('unsafe link scheme kept as text + warning', () => {
    const r = prep('[x](javascript:alert(1))')
    expect(r.html).not.toContain('javascript:')
    expect(r.issues.some(i => i.code === 'link.unsafe-url')).toBe(true)
  })
})

describe('formulas (conversion.md §4.11)', () => {
  it('preserves currency, shell variables, unmatched delimiters and surrounding prose', () => {
    for (const body of ['总价是 $5 到 $10 之间，另外 $HOME 也要算。', '完整正文之前有文字，再有未闭合的 $x', '正文里的 $HOME 与 $PATH 保持不变']) {
      const r = prepare({ type: 'article', title: '测试', body, format: 'markdown' })
      expect(r.html).toContain(body)
      expect(r.html).not.toContain('eeimg=')
    }
    const r = prepare({ type: 'article', title: '测试', body: '前面的文字 $x^2$ 中间的文字 $E=mc^2$ 后面的文字', format: 'markdown' })
    for (const part of ['前面的文字', '中间的文字', '后面的文字']) expect(r.html).toContain(part)
    expect(r.html.match(/eeimg="1"/g)).toHaveLength(2)
  })
  it('inline $...$ → eeimg=1, $$...$$ → eeimg=2, no trim', () => {
    const r = prepare({ type: 'article', title: 't', body: '行内 $E=mc^2$ 和块级 $$ x+y $$ 公式', format: 'markdown' })
    expect(r.html).toContain('eeimg="1"')
    expect(r.html).toContain('eeimg="2"')
    // $$ 内容 " x+y " 不 trim，alt 保留首尾空格
    expect(r.html).toContain('alt=" x+y "')
    expect(r.html).toContain('tex=%20x%2By%20')
  })
  it('equation src is zhihu equation url-encoded', () => {
    const r = prepare({ type: 'article', title: 't', body: '$\\sum_i x_i$', format: 'markdown' })
    expect(r.html).toContain('//www.zhihu.com/equation?tex=')
    expect(r.html).toContain('%5Csum')
  })
})

describe('body images resolution', () => {
  it('markdown image placeholder resolves from draft.images by originalUrl match', () => {
    const r = prepare({
      type: 'article', title: 't', format: 'markdown',
      body: '前面\n\n![图](https://example.com/a.png)\n\n后面',
      images: [{ url: 'https://pic1.zhimg.com/v2-up.png', originalUrl: 'https://example.com/a.png', width: 400, height: 300, watermark: true }],
    })
    expect(r.html).toContain('src="https://pic1.zhimg.com/v2-up.png"')
    expect(r.html).toContain('data-rawwidth="400"')
    expect(r.html).toContain('data-watermark="watermark"')
    expect(r.issues.some(i => i.code === 'image.unresolved')).toBe(false)
  })
  it('unresolved body image → error, no publish', () => {
    const r = prepare({
      type: 'article', title: 't', format: 'markdown',
      body: '![x](https://example.com/no-upload.png)',
      images: [],
    })
    expect(r.issues.some(i => i.code === 'image.unresolved')).toBe(true)
    expect(r.canPublish).toBe(false)
  })
  it('pin: body markdown image moved to media area with warning', () => {
    const r = prepare({
      type: 'pin', title: '', format: 'markdown',
      body: '正文 ![](https://example.com/i.png) 尾部',
      images: [{ url: 'https://pic1.zhimg.com/v2-m.png', originalUrl: 'https://example.com/i.png' }],
    })
    expect(r.issues.some(i => i.code === 'pin.body-image-moved')).toBe(true)
    expect(r.html).not.toContain('<img src=')
  })
})

describe('pin exclusivity & settings', () => {
  it('pin: images + linkCard → error', () => {
    const r = prepare({
      type: 'pin', title: '', body: '内容', format: 'markdown',
      images: [{ url: 'https://pic1.zhimg.com/x.png' }],
      linkCard: { url: 'https://www.zhihu.com' },
    })
    expect(r.issues.some(i => i.code === 'pin.media-linkcard-exclusive')).toBe(true)
    expect(r.canPublish).toBe(false)
  })
  it('pin: only linkCard ok', () => {
    const r = prepare({ type: 'pin', title: '', body: '内容', format: 'markdown', linkCard: { url: 'https://www.zhihu.com' } })
    expect(r.canPublish).toBe(true)
  })
  it('article: invalid commentPermission → error', () => {
    const r = prepare({ type: 'article', title: 't', body: 'x'.repeat(20), format: 'markdown', settings: { commentPermission: 'follower_n_days' } })
    expect(r.issues.some(i => i.code === 'comment-permission.invalid')).toBe(true)
  })
  it('pin: commentPermission follower_n_days ok', () => {
    const r = prepare({ type: 'pin', title: '', body: 'x', format: 'markdown', images: [{ url: 'https://pic1.zhimg.com/x.png' }], settings: { commentPermission: 'follower_n_days' } })
    expect(r.issues.some(i => i.code === 'comment-permission.invalid')).toBe(false)
  })
  it('pin: creationStatement must be ai_creation', () => {
    const r = prepare({ type: 'pin', title: '', body: 'x', format: 'markdown', images: [{ url: 'https://pic1.zhimg.com/x.png' }], settings: { creationStatement: 'spoiler' } })
    expect(r.issues.some(i => i.code === 'creation-statement.invalid')).toBe(true)
  })
  it('topics: invalid URL → error; pin topics ignored with warning', () => {
    const bad = prepare({ type: 'article', title: 't', body: 'x'.repeat(20), format: 'markdown', settings: { topics: ['not-a-url'] } })
    expect(bad.issues.some(i => i.code === 'topics.invalid')).toBe(true)
    const pin = prepare({ type: 'pin', title: '', body: 'x', format: 'markdown', images: [{ url: 'https://pic1.zhimg.com/x.png' }], settings: { topics: ['https://www.zhihu.com/topic/1/hot'] } })
    expect(pin.issues.some(i => i.code === 'settings.unsupported-topics')).toBe(true)
  })
})

describe('format=html sanitization', () => {
  it('drops script/iframe/on* and blocks publish', () => {
    const r = prepare({ type: 'article', title: 't', body: '<p>安全</p><script>alert(1)</script><iframe src=x></iframe>', format: 'html' })
    expect(r.html).not.toContain('<script')
    expect(r.html).not.toContain('<iframe')
    expect(r.issues.some(i => i.code === 'html.unsafe-tag' && i.severity === 'error')).toBe(true)
    expect(r.canPublish).toBe(false)
  })
  it('javascript: / file: / data: urls rejected', () => {
    const r = prepare({ type: 'article', title: 't', body: '<p><a href="javascript:alert(1)">x</a></p>', format: 'html' })
    expect(r.html).not.toContain('javascript:')
    expect(r.issues.some(i => i.code === 'html.unsafe-link-url' && i.severity === 'error')).toBe(true)
    const r2 = prepare({ type: 'article', title: 't', body: '<p><a href="file:///etc/passwd">x</a></p>', format: 'html' })
    expect(r2.issues.some(i => i.code === 'html.unsafe-link-url')).toBe(true)
  })
  it('supported tags survive; unsupported tags degrade to text', () => {
    const r = prepare({ type: 'article', title: 't', body: '<p>ok <b>bold</b> <em>x</em></p><div>wrapped</div>', format: 'html' })
    expect(r.html).toContain('<b>bold</b>')
    expect(r.html).toContain('wrapped')
    expect(r.html).not.toContain('<div>')
    expect(r.html).not.toContain('<em>')
  })
  it('pre><code> preserves inner text (does not drop code body)', () => {
    const r = prepare({ type: 'article', title: 't', body: '<pre><code>const x = 1;</code></pre>', format: 'html' })
    expect(r.html).toContain('<pre')
    expect(r.html).toContain('const x = 1;')
    expect(r.html).not.toContain('<code>')
  })
  it('topic URL must be www.zhihu.com domain, not just /topic/ regex', () => {
    const r = prepare({ type: 'article', title: 't', body: 'x'.repeat(20), format: 'markdown', settings: { topics: ['https://evil.com/topic/123/hot'] } })
    expect(r.issues.some(i => i.code === 'topics.invalid' && i.severity === 'error')).toBe(true)
    const ok = prepare({ type: 'article', title: 't', body: 'x'.repeat(20), format: 'markdown', settings: { topics: ['https://www.zhihu.com/topic/123/hot'] } })
    expect(ok.issues.some(i => i.code === 'topics.invalid')).toBe(false)
    // 子域也接受（如 zhuanlan.zhihu.com）
    const sub = prepare({ type: 'article', title: 't', body: 'x'.repeat(20), format: 'markdown', settings: { topics: ['https://zhuanlan.zhihu.com/topic/456/hot'] } })
    expect(sub.issues.some(i => i.code === 'topics.invalid')).toBe(true) // zhuanlan 不是 www.zhihu.com
  })
  it('topic URL rejects http and userinfo', () => {
    const r = prepare({ type: 'article', title: 't', body: 'x'.repeat(20), format: 'markdown', settings: { topics: ['http://www.zhihu.com/topic/123/hot'] } })
    expect(r.issues.some(i => i.code === 'topics.invalid')).toBe(true)
    const r2 = prepare({ type: 'article', title: 't', body: 'x'.repeat(20), format: 'markdown', settings: { topics: ['https://user:pass@www.zhihu.com/topic/123/hot'] } })
    expect(r2.issues.some(i => i.code === 'topics.invalid')).toBe(true)
  })
  it('ring URL must be www.zhihu.com/ring/host/id', () => {
    const ok = prepare({ type: 'pin', title: '', body: 'x', format: 'markdown', images: [{ url: 'https://pic1.zhimg.com/x.png' }], settings: { ring: 'https://www.zhihu.com/ring/host/999' } })
    expect(ok.issues.some(i => i.code === 'ring.invalid')).toBe(false)
    const bad = prepare({ type: 'pin', title: '', body: 'x', format: 'markdown', images: [{ url: 'https://pic1.zhimg.com/x.png' }], settings: { ring: 'https://evil.com/ring/host/999' } })
    expect(bad.issues.some(i => i.code === 'ring.invalid')).toBe(true)
  })
  it('image publish url must be https zhihu domain', () => {
    const r = prepare({ type: 'article', title: 't', format: 'markdown', body: '前\n\n![x](https://example.com/a.png)\n\n后有足够长度内容', images: [{ url: 'https://evil.com/a.png', originalUrl: 'https://example.com/a.png' }] })
    expect(r.issues.some(i => i.code === 'image.unsafe-url' && i.severity === 'error')).toBe(true)
    expect(r.canPublish).toBe(false)
  })
  it('image caption >140 chars → error not silent truncate', () => {
    const longCaption = 'x'.repeat(141)
    const r = prepare({ type: 'article', title: 't', format: 'markdown', body: `![${longCaption}](https://example.com/a.png)`, images: [{ url: 'https://pic1.zhimg.com/a.png', originalUrl: 'https://example.com/a.png' }] })
    expect(r.issues.some(i => i.code === 'image.caption-too-long' && i.severity === 'error')).toBe(true)
  })
  it('data-original-src only for zhihu-domain originals, external original not in publish body', () => {
    const r = prepare({ type: 'article', title: 't', format: 'markdown', body: '前\n\n![x](https://example.com/a.png)\n\n后有足够长度内容', images: [{ url: 'https://pic1.zhimg.com/a.png', originalUrl: 'https://example.com/a.png' }] })
    expect(r.html).toContain('data-original-src=""')
    expect(r.html).not.toContain('data-original-src="https://example.com')
  })
  it('hash_tag in link href is not double-processed', () => {
    const r = prepare({ type: 'pin', title: '', body: '[x](https://example.com/#tag#) 文字', format: 'markdown', images: [{ url: 'https://pic1.zhimg.com/x.png' }] })
    // #tag# inside href should NOT become a hash_tag anchor
    expect(r.html).not.toContain('class="hash_tag"')
    expect(r.html).toContain('href="https://example.com/#tag#"')
  })
  it('counts.images includes article body images', () => {
    const r = prepare({ type: 'article', title: 't', format: 'markdown', body: '前\n\n![x](https://example.com/a.png)\n\n后有足够长度内容', images: [{ url: 'https://pic1.zhimg.com/v2-a.png', originalUrl: 'https://example.com/a.png' }] })
    expect(r.counts.images).toBe(1)
  })
  it('plainTextLength counts entities as single chars, does not strip user whitespace', () => {
    // &amp; decodes to '&' (1 char), not 5. Whitespace kept as 1 char each.
    const r = prepare({ type: 'article', title: 't', body: 'a &amp; b 中间有空格', format: 'html' })
    expect(r.counts.bodyChars).toBe(11) // 'a & b 中间有空格'
    const r2 = prepare({ type: 'article', title: 't', body: 'a &amp; b', format: 'html' })
    expect(r2.counts.bodyChars).toBe(5) // '&' counts as 1 char, not 5
  })
  it('markdown &lt; decodes to < (no double-escape), counts as visible text', () => {
    const r = prepare({ type: 'article', title: 't', body: 'x &lt;tag&gt; y', format: 'markdown' })
    // html 里是 <p>x &lt;tag&gt; y</p>（显示为 <tag>），count 按可见字符
    expect(r.html).toContain('&lt;tag&gt;')
    expect(r.counts.bodyChars).toBe(9) // 'x <tag> y'
    // &amp; → '&' → escape → &amp; (1 char display)
    const r2 = prepare({ type: 'article', title: 't', body: 'a &amp; b', format: 'markdown' })
    expect(r2.html).toContain('&amp;')
    expect(r2.counts.bodyChars).toBe(5) // 'a & b'
  })
  it('img tag in html body resolves via draft.images', () => {
    const r = prepare({
      type: 'article', title: 't', format: 'html',
      body: '<p>这里有足够长的文字内容 <img src="https://example.com/h.png" alt="cap"></p>',
      images: [{ url: 'https://pic1.zhimg.com/v2-h.png', originalUrl: 'https://example.com/h.png' }],
    })
    expect(r.html).toContain(' src="https://pic1.zhimg.com/v2-h.png"')
    expect(r.html).not.toContain(' src="https://example.com/h.png"')
  })
  it('question: sup reference rejected', () => {
    const r = prepare({ type: 'question', title: '问题标题足够长？', body: '<p>引注<sup data-draft-type="reference" data-text="n" data-numero="1">[1]</sup></p>', format: 'html' })
    expect(r.issues.some(i => i.code === 'reference.unsupported' && i.severity === 'error')).toBe(true)
  })
})

describe('pin body rules (§5)', () => {
  it('pin rich text degrades with warnings but keeps content', () => {
    const r = prepare({ type: 'pin', title: '', body: '**粗体** `code` 文本', format: 'markdown', images: [{ url: 'https://pic1.zhimg.com/x.png' }] })
    expect(r.html).not.toContain('<b>')
    expect(r.html).not.toContain('<code>')
    expect(r.html).toContain('粗体')
    expect(r.html).toContain('code')
    expect(r.issues.some(i => i.code === 'pin.unsupported-rich-text')).toBe(true)
  })
  it('pin: #话题# converts to hash_tag anchor, counts topics', () => {
    const r = prepare({ type: 'pin', title: '', body: '今天学习 #知乎# 和 #写作#', format: 'markdown', images: [{ url: 'https://pic1.zhimg.com/x.png' }] })
    expect(r.html).toContain('class="hash_tag"')
    expect(r.html).toContain('#知乎#')
    expect(r.counts.topics).toBe(2)
  })
  it('pin: >10 topics → error', () => {
    const topics = Array.from({ length: 11 }, (_, i) => `#t${i}#`).join(' ')
    const r = prepare({ type: 'pin', title: '', body: topics, format: 'markdown', images: [{ url: 'https://pic1.zhimg.com/x.png' }] })
    expect(r.issues.some(i => i.code === 'topics.too-many')).toBe(true)
  })
})

describe('boundary regressions (sync-content)', () => {
  it('does not extract $..$ inside fenced code block or codespan', () => {
    const r1 = prepare({ type: 'article', title: 't', body: '正文足够长。\n\n```js\nconst a = $x$ + 1\n```', format: 'markdown' })
    expect(r1.html).toContain('const a = $x$ + 1')
    expect(r1.html).not.toContain('eeimg')
    const r2 = prepare({ type: 'article', title: 't', body: '正文 `$x$` 行内', format: 'markdown' })
    expect(r2.html).toContain('<code>$x$</code>')
    expect(r2.html).not.toContain('eeimg')
  })
  it('still extracts formulas from normal text and keeps $$ inner spaces', () => {
    const r = prepare({ type: 'article', title: 't', body: '行内 $E=mc^2$ 与块级 $$ x+y $$ 结束', format: 'markdown' })
    expect(r.html).toContain('eeimg="1"')
    expect(r.html).toContain('eeimg="2"')
    expect(r.html).toContain('alt=" x+y "')
  })
  it('inline raw html <b>/<i>/<a> keeps open/close pair instead of empty shell', () => {
    const r = prepare({ type: 'article', title: 't', body: '前文 <b>bold <i>nested</i></b> 与 <a href="https://a.com">link</a> 后文', format: 'markdown' })
    expect(r.html).toContain('<b>bold <i>nested</i></b>')
    expect(r.html).toContain('<a href="https://a.com">link</a>')
    expect(r.html).not.toContain('<b></b>')
    expect(r.html).not.toContain('</a>link')
  })
  it('unclosed inline tag passes through sanitizer without losing text', () => {
    const r = prepare({ type: 'article', title: 't', body: '前文 <b>未闭合 后文足够长', format: 'markdown' })
    expect(r.html).toContain('未闭合')
    expect(r.issues.some(i => i.severity === 'error')).toBe(false)
  })
  it('body image src with %20 matches originalUrl containing literal space', () => {
    const r = prepare({
      type: 'article', title: 't', format: 'markdown',
      body: '正文足够长。\n\n![截图](my%20file.png)\n\n后续。',
      images: [{ url: 'https://pic1.zhimg.com/v2-a.png', originalUrl: 'my file.png' }],
    })
    expect(r.html).toContain('src="https://pic1.zhimg.com/v2-a.png"')
    expect(r.issues.some(i => i.code === 'image.unresolved')).toBe(false)
  })
  it('uploaded image not referenced in body → warning, publish still allowed', () => {
    const r = prepare({
      type: 'article', title: 't', body: '正文足够长，无图片引用。', format: 'markdown',
      images: [{ url: 'https://pic1.zhimg.com/v2-u.png', originalUrl: 'orphan.png' }],
    })
    expect(r.issues.some(i => i.code === 'image.unused' && i.severity === 'warning')).toBe(true)
    expect(r.canPublish).toBe(true)
  })
  it('pin media-area images do not trigger image.unused warning', () => {
    const r = prepare({ type: 'pin', title: '', body: '内容', format: 'markdown', images: [{ url: 'https://pic1.zhimg.com/x.png' }] })
    expect(r.issues.some(i => i.code === 'image.unused')).toBe(false)
  })
})

describe('buildZhihuPublishRequest', () => {
  const ok = (d: Partial<SyncDraft>): SyncPrepared => {
    const p = prepareZhihuSyncDraft({ type: 'article', title: '标题', body: 'x'.repeat(20), format: 'markdown', ...d })
    if (!p.canPublish) throw new Error('fixture not publishable: ' + JSON.stringify(p.issues))
    return p
  }
  it('article envelope + fields', () => {
    const p = ok({ settings: { commentPermission: 'follower', tableOfContentsEnabled: true, creationStatement: 'ai_creation', topics: ['https://www.zhihu.com/topic/123/hot', 'https://www.zhihu.com/topic/123/hot', 'https://www.zhihu.com/topic/456/hot'] } })
    const req = buildZhihuPublishRequest(p)
    expect(req.type).toBe('article')
    expect(req.confirmed).toBe(true)
    expect(req.content.html).toBe(p.html)
    expect(req.content.comment_permission).toBe('follower')
    expect(req.content.table_of_contents_enabled).toBe(true)
    expect(req.content.creation_statement).toBe('ai_creation')
    expect((req.content.topics as any[]).length).toBe(2) // dedup
    expect((req.content.topics as any[])[0].topic_token).toBe('123')
  })
  it('question envelope', () => {
    const p = ok({ type: 'question', title: '问题标题足够长？', body: '补充说明', settings: { topics: ['https://www.zhihu.com/topic/77/hot'] } })
    const req = buildZhihuPublishRequest(p)
    expect(req.type).toBe('question')
    expect(req.content.title).toBe('问题标题足够长？')
    expect((req.content.topics as any[])[0].topic_token).toBe('77')
    expect(req.content.comment_permission).toBeUndefined()
  })
  it('pin: images win over linkcard; ring extracted', () => {
    const p = ok({
      type: 'pin', title: '', body: '内容', format: 'markdown',
      images: [{ url: 'https://pic1.zhimg.com/x.png' }],
      settings: { ring: 'https://www.zhihu.com/ring/host/999', creationStatement: 'ai_creation' },
    })
    const req = buildZhihuPublishRequest(p)
    expect(req.type).toBe('pin')
    expect((req.content.images as any[])[0].url).toBe('https://pic1.zhimg.com/x.png')
    expect(req.content.linkcard).toBeUndefined()
    expect((req.content.ring as any).ring_id).toBe('999')
    expect(req.content.creation_statement).toBe('ai_creation')
  })
  it('pin: linkcard only', () => {
    const p = ok({ type: 'pin', title: '', body: '内容', format: 'markdown', linkCard: { url: 'https://www.zhihu.com', title: '知乎' } })
    const req = buildZhihuPublishRequest(p)
    expect((req.content.linkcard as any).url).toBe('https://www.zhihu.com')
    expect((req.content.linkcard as any).is_from_forward).toBe(false)
    expect(req.content.images).toBeUndefined()
  })
  it('throws when not canPublish', () => {
    const bad = prepareZhihuSyncDraft({ type: 'article', title: '', body: 'x', format: 'markdown' })
    expect(() => buildZhihuPublishRequest(bad)).toThrow()
  })
})

describe('normalizeCodeLang', () => {
  it('accepts supported ids, rejects others', () => {
    expect(normalizeCodeLang('python')).toBe('python')
    expect(normalizeCodeLang('Python3')).toBe('python3')
    expect(normalizeCodeLang('jsx')).toBe('')
    expect(normalizeCodeLang('raw')).toBe('')
    expect(normalizeCodeLang('')).toBe('')
    expect(normalizeCodeLang(undefined)).toBe('')
  })
})
