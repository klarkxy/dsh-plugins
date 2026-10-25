/**
 * 知乎同步内容转换与校验（确定性实现；规则来源见下，未复制上游代码）。
 *
 * 规则来源（只读镜像 H:\Reference\zhihu-sync-full_v0.1.4，MIT / author zhihu）：
 *   zhihu-sync/zhihu-validate/reference/conversion.md  — 标题/正文/媒体/链接卡片/公式/表格
 *   zhihu-sync/zhihu-validate/reference/config.md      — topics/目录/创作声明/评论权限/圈子
 *   zhihu-sync/zhihu-validate/reference/code-languages.md — <pre lang> 语言 ID 表
 *   zhihu-sync/zhihu-publish/reference/publish-{article,question,pin}.md — 发布字段
 *
 * 分层：
 *   prepareZhihuSyncDraft(input)   规范化 SyncDraft → 知乎适配 html + issues + counts
 *   buildZhihuPublishRequest(prepared)  SyncPrepared → publish OpenAPI request envelope
 *
 * 必须遵守的硬约束（不静默丢内容）：
 *   - 标题/正文超限 → error issue，不截断、不自动精简（conversion.md §1.3）。
 *   - question 标题结尾无问号自动补「？」且计入长度（§2.1）。
 *   - 图片必须已上传：SyncImage.url 是发布 URL；originalUrl 仅用于按出现顺序匹配
 *     正文图片引用与预览层展示，永不写入发布 body。正文图片无法解析 → error。
 *   - 公式 LaTeX 移除 $/$$ 定界符后【不 trim】；alt 与 src?tex= 来自同一串（§4.11）。
 *   - 想法正文仅纯文本段落、text-link、hash_tag（#话题名#，≤10）；富文本降级+warning。
 *   - 想法独立图片（media 区）与 linkCard 互斥；两者并存 → error（§5.3/5.4）。
 *   - HTML 输入经 parse5 白名单消毒：script/iframe/object/embed/svg/style、on*、
 *     javascript:|vbscript:|file:|data: URL → error，危险节点不进入输出。
 *   - JSON 序列化只发生一次（发布请求体），body 不预转义。
 */
import { lexer, type Token, type Tokens } from 'marked'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import {
  SYNC_ARTICLE_COMMENT_PERMISSIONS,
  SYNC_ARTICLE_CREATION_STATEMENTS,
  SYNC_PIN_COMMENT_PERMISSIONS,
  type SyncCommentPermission,
  type SyncCreationStatement,
  type SyncDraft,
  type SyncImage,
  type SyncIssue,
  type SyncLinkCard,
  type SyncPrepared,
} from './sync-types.ts'

export const SYNC_LIMITS = {
  questionTitleMin: 4,
  questionTitleMax: 51,
  pinTitleMax: 50,
  articleTitleMax: 100,
  articleBodyMin: 9,
  articleBodyMax: 100_000,
  pinBodyMax: 2_000,
  pinImagesMax: 18,
  pinTopicsMax: 10,
  articleTopicsMax: 3,
  questionTopicsMax: 5,
  captionMax: 140,
} as const

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const escapeAttr = escapeHtml

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 纯文本计数（conversion.md §3「按纯文本计，不含 HTML 标签」）：
 * 用 parse5 把 html 解析为文本节点再拼接 —— 解码 &amp; / &lt; 等实体，
 * 不去除用户正文中的正常空白（空格/换行仍算一个字符，按码点计）。
 * 内部占位符（公式/图片）先剔除再计数，不计入用户正文。
 */
function plainTextLength(html: string): number {
  const cleaned = html.replace(/ZHIHUIMG\d+PLACEHOLDER/g, '').replace(/ZHIHUFORMULA\d+PLACEHOLDER/g, '')
  const frag = parseFragment(cleaned)
  let text = ''
  const walk = (nodes: DefaultTreeAdapterMap['childNode'][]) => {
    for (const n of nodes) {
      if (n.nodeName === '#text') text += (n as DefaultTreeAdapterMap['textNode']).value
      else walk((n as { childNodes?: DefaultTreeAdapterMap['childNode'][] }).childNodes ?? [])
    }
  }
  walk(frag.childNodes as DefaultTreeAdapterMap['childNode'][])
  return [...text].length
}

// ---------------------------------------------------------------------------
// 支持语言 ID（code-languages.md 全表按 id 录入；未列出 → lang=""。jsx/raw 不支持）
// ---------------------------------------------------------------------------

const SUPPORTED_LANGS = new Set([
  'abap','abnf','actionscript','ada','adl','agda','ahk','alloy','antlr','apacheconf','apl',
  'applescript','arduino','as','as3','asciidoc','aspectj','asy','at','autoit','awk','basemake',
  'bash','bat','bbcode','bc','befunge','bib','blitzbasic','blitzmax','bnf','boo','boogie',
  'brainfuck','bro','bugs','c','c++','c#','ca65','cadl','camkes','cbmbas','ceylon','cfengine3',
  'cfm','cfs','chai','chapel','cheetah','cirru','clay','clojure','clojurescript','cmake','cobol',
  'cobolfree','coffee-script','common-lisp','componentpascal','console','control','coq','cpp',
  'cpp-objdump','cpsa','crmsh','croc','cryptol','csharp','csound','csound-document',
  'csound-score','css','cuda','cython','d','d-objdump','darcs','dart','debcontrol','debian',
  'delphi','dg','diff','django','docker','dpatch','dtd','duel','dylan','dylan-console',
  'dylanlid','ebnf','ecl','eiffel','elixir','elm','emacslisp','erb','erl','erlang','evoque',
  'factor','fancy','fantom','felix','fortran','foxpro','fsharp','gas','genshi','glsl','gnuplot',
  'go','golo','gooddata-cl','gosu','groff','groovy','gst','haml','handlebars','haskell','haxeml',
  'html','httpd','hy','idl','idris','igor','inform6','inform7','ini','io','ioke','irb','jade',
  'java','js','json','julia','jvm','kal','kconfig','koka','kotlin','lagda','lasso','lhs','lidr',
  'lighty','lisp','live-script','llvm','logos','logtalk','lua','make','mako','mason','mask',
  'matlab','md','minid','modelica','modula2','monkey','moocode','moon','mscgen','mupad','mxml',
  'mysql','nasm','newlisp','nginx','nim','nit','nixos','nsis','numpy','objdump-c','objdump-cpp',
  'objdump-d','objdump-nasm','objective-c','objective-j','ocaml','octave','odin','ooc','opa',
  'openedge','pacmanconf','pan','pawn','perl','php','pig','pike','pkgconfig','plpgsql',
  'postscript','powershell','prolog','properties','protobuf','psql','puppet','py','pycon',
  'pypylog','pytb','python','python3','qbasic','r','rake','rb','rbcon','rebol','red','redcode',
  'registry','resources','robotframework','rq','rql','rst','rts','rust','sass','scala','scaml',
  'scheme','scilab','scss','sh','shell','smarty','snobol','sourceslist','sp','sparql','sql',
  'squidconf','sre','stan','swift','swig','systemverilog','tads3','tap','tcl','tcsh','tea',
  'termcap','terminfo','terraform','text','textile','thrift','todotxt','trac-wiki','treetop',
  'ts','turtle','twig','urbiscript','v','vala','vb.net','vctreestatus','velocity','verilog',
  'vgl','vhdl','vim','x10','xml','xquery','xslt','xtend','xul+mozpreproc','yaml','yaml+jinja',
  'zephir',
])

/** lang ID 归一化：不在支持表 → ''。 */
export function normalizeCodeLang(raw: string | undefined | null): string {
  if (!raw) return ''
  const id = raw.trim().toLowerCase()
  return SUPPORTED_LANGS.has(id) ? id : ''
}

function latexToEquationImg(latex: string, block: boolean): string {
  // 不 trim LaTeX；alt 与 src?tex= 用同一串（§4.11）。
  return `<img eeimg="${block ? 2 : 1}" src="//www.zhihu.com/equation?tex=${encodeURIComponent(latex)}" alt="${escapeAttr(latex)}" />`
}

// ---------------------------------------------------------------------------
// 转换上下文
// ---------------------------------------------------------------------------

type ImageRef = {
  /** 用户在 draft.body 中给出的图片来源（本地路径或 URL，可能是相对形式）。 */
  src: string
  caption: string
  /** 匹配到的已上传 SyncImage（由 prepare 阶段按顺序匹配填充）。 */
  resolved?: SyncImage
}

type Placeholders = ReturnType<typeof makePlaceholders>

type Ctx = {
  issues: SyncIssue[]
  type: SyncDraft['type']
  pinMode: boolean
  /** 正文图片引用，按出现顺序；与 draft.images（已上传清单）一一对应。 */
  bodyImages: ImageRef[]
  /** 公式按文本 token 顺序收集（extractFormulas 在 inlineToHtml 的 text 分支内调用）。 */
  formulas: { block: boolean; latex: string }[]
  ph: Placeholders
}

const error = (ctx: Ctx, code: string, message: string) =>
  ctx.issues.push({ severity: 'error', code, message })
const warning = (ctx: Ctx, code: string, message: string) =>
  ctx.issues.push({ severity: 'warning', code, message })

// ---------------------------------------------------------------------------
// Markdown → 知乎 HTML（marked token 树驱动，不用正则解析 HTML）
// ---------------------------------------------------------------------------

/** 每次 prepare 生成唯一占位前缀，避免与用户正文碰撞。 */
function makePlaceholders(): { img: (i: number) => string; formula: (i: number) => string } {
  const prefix = `ZHIHU_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_`
  return {
    img: (i: number) => `${prefix}IMG${i}`,
    formula: (i: number) => `${prefix}FORMULA${i}`,
  }
}

const VOID_RAW_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'])

/** 行内 raw HTML 开标签 → 在 token 流中找匹配 </tag>，把整段 raw 交给 parse5 消毒。
 *  marked 会把 <b>x</b> 拆成独立 html token，单独 sanitize 会得到空壳 <b></b>。
 *  返回整段 raw；找不到闭合标签或自闭合/void 时只返回当前 token raw。 */
function rawHtmlRun(tokens: Token[], start: number): { raw: string; next: number } {
  const first = (tokens[start] as Tokens.HTML).raw ?? ''
  const m = first.match(/^<([a-zA-Z][a-zA-Z0-9-]*)\b/)
  if (!m || /\/>$/.test(first) || VOID_RAW_TAGS.has(m[1].toLowerCase())) {
    return { raw: first, next: start + 1 }
  }
  const tag = m[1].toLowerCase()
  const closeRe = new RegExp(`^</${tag}\\s*>`, 'i')
  for (let i = start + 1; i < tokens.length; i++) {
    const t = tokens[i] as Tokens.Generic
    if (t.type === 'html' && closeRe.test(t.raw ?? '')) {
      return { raw: tokens.slice(start, i + 1).map(x => (x as Tokens.Generic).raw ?? '').join(''), next: i + 1 }
    }
    if (t.type !== 'html' && t.type !== 'text' && t.type !== 'escape') break
  }
  return { raw: first, next: start + 1 }
}

function inlineToHtml(tokens: Token[] | undefined, ctx: Ctx): string {
  if (!tokens?.length) return ''
  let out = ''
  for (let ti = 0; ti < tokens.length; ti++) {
    const t = tokens[ti]
    switch (t.type) {
      case 'text': {
        const tok = t as Tokens.Text
        // marked 的 text token 可能有嵌套 tokens；先 decode HTML 实体再 escape，
        // 避免 &lt; → &amp;lt; 双转义（CommonMark 语义：实体按可见字符处理）。
        // 公式只在纯文本 token 上提取（marked 已隔离 code/html），
        // extractFormulas 返回的占位符原样输出，prepare 末尾统一恢复为 equation img。
        if (tok.tokens?.length) {
          out += inlineToHtml(tok.tokens, ctx)
        } else {
          const base = ctx.formulas.length
          const extracted = extractFormulas(decodeEntities(tok.text), { ...ctx.ph, formula: index => ctx.ph.formula(base + index) })
          ctx.formulas.push(...extracted.formulas)
          out += escapeHtml(extracted.text)
        }
        break
      }
      case 'escape': out += escapeHtml((t as Tokens.Escape).text); break
      case 'strong': {
        if (ctx.pinMode) {
          warning(ctx, 'pin.unsupported-rich-text', '想法正文不支持加粗，已降级为纯文本。')
          out += inlineToHtml((t as Tokens.Strong).tokens, ctx)
        } else out += `<b>${inlineToHtml((t as Tokens.Strong).tokens, ctx)}</b>`
        break
      }
      case 'em': {
        if (ctx.pinMode) {
          warning(ctx, 'pin.unsupported-rich-text', '想法正文不支持斜体，已降级为纯文本。')
          out += inlineToHtml((t as Tokens.Em).tokens, ctx)
        } else out += `<i>${inlineToHtml((t as Tokens.Em).tokens, ctx)}</i>`
        break
      }
      case 'codespan': {
        if (ctx.pinMode) {
          warning(ctx, 'pin.unsupported-rich-text', '想法正文不支持行内代码，已降级为纯文本。')
          out += escapeHtml((t as Tokens.Codespan).text)
        } else out += `<code>${escapeHtml((t as Tokens.Codespan).text)}</code>`
        break
      }
      case 'del': {
        // 知乎正文无删除线能力：降级为文本（不静默丢内容）。
        warning(ctx, 'unsupported.del', '删除线不受支持，已降级为纯文本。')
        out += inlineToHtml((t as Tokens.Del).tokens, ctx)
        break
      }
      case 'link': {
        const link = t as Tokens.Link
        const inner = inlineToHtml(link.tokens, ctx)
        const innerText = inner.replace(/<[^>]*>/g, '')
        const href = (link.href ?? '').trim()
        if (href.startsWith('#')) { out += inner; break } // 页内锚点：保留文字
        if (!isAbsoluteHttpUrl(href)) {
          warning(ctx, 'link.unsafe-url', `链接地址不受支持，已保留为纯文本：${href || '(空)'}。`)
          out += inner
          break
        }
        if (ctx.pinMode) {
          // 想法 text-link（conversion.md §5.1）。
          out += `<a href="${escapeAttr(href)}" data-insert-way="force" data-draft-node="inline" data-draft-type="text-link" data-draft-title="${escapeAttr(innerText || href)}">${inner}</a>`
        } else {
          // 文章/提问文字链接（§4.10）。
          out += `<a href="${escapeAttr(href)}" data-draft-title="${escapeAttr(innerText || href)}">${inner}</a>`
        }
        break
      }
      case 'image': {
        const img = t as Tokens.Image
        const idx = ctx.bodyImages.length
        ctx.bodyImages.push({ src: (img.href ?? '').trim(), caption: img.text ?? '' })
        out += ctx.ph.img(idx)
        break
      }
      case 'br': out += '<br>'; break
      case 'html': {
        // 行内原始 HTML：marked 会把 <b>x</b> 拆成独立 token，需先按 raw 重组
        // 完整片段再交 parse5 消毒（不手写 regex 解析内部结构）。
        const run = rawHtmlRun(tokens, ti)
        ti = run.next - 1
        const raw = run.raw.trim()
        if (raw) out += sanitizeInlineHtml(raw, ctx)
        break
      }
      default: {
        const anyT = t as Tokens.Generic
        if (anyT.tokens?.length) out += inlineToHtml(anyT.tokens, ctx)
        else if (typeof anyT.text === 'string') out += escapeHtml(anyT.text)
        else if (typeof anyT.raw === 'string') out += escapeHtml(anyT.raw)
      }
    }
  }
  return out
}

function blockToHtml(tokens: Token[] | undefined, ctx: Ctx): string {
  if (!tokens?.length) return ''
  let out = ''
  for (const t of tokens) {
    switch (t.type) {
      case 'space': break
      case 'paragraph': {
        const inner = inlineToHtml((t as Tokens.Paragraph).tokens, ctx)
        out += inner.trim() ? `<p>${inner}</p>` : '<p><br></p>'
        break
      }
      case 'heading': {
        const h = t as Tokens.Heading
        const inner = inlineToHtml(h.tokens, ctx)
        if (ctx.pinMode) {
          warning(ctx, 'pin.unsupported-rich-text', '想法正文不支持标题，已降级为段落文本。')
          if (inner.trim()) out += `<p>${inner}</p>`
        } else {
          // 知乎标题只到 h3；更深降级为 h3（§4.2：h2/h3）。
          const level = h.depth <= 2 ? 2 : 3
          out += `<h${level}>${inner}</h${level}>`
        }
        break
      }
      case 'hr': out += '<hr />'; break
      case 'code': {
        const code = t as Tokens.Code
        if (ctx.pinMode) {
          warning(ctx, 'pin.unsupported-rich-text', '想法正文不支持代码块，已降级为文本。')
          out += `<p>${escapeHtml(code.text.trimEnd())}</p>`
        } else {
          out += `<pre lang="${normalizeCodeLang(code.lang)}">${escapeHtml(code.text.replace(/\n$/, ''))}</pre>`
        }
        break
      }
      case 'blockquote': {
        const inner = blockToHtml((t as Tokens.Blockquote).tokens, ctx)
        if (ctx.pinMode) {
          warning(ctx, 'pin.unsupported-rich-text', '想法正文不支持引用块，已降级为文本。')
          const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          if (text) out += `<p>${escapeHtml(text)}</p>`
        } else {
          // 多段引用以 <br> 连接（§4.5）。
          const flattened = inner.replace(/<\/p>\s*<p>/g, '<br>').replace(/^<p>/, '').replace(/<\/p>$/, '')
          out += `<blockquote>${flattened}</blockquote>`
        }
        break
      }
      case 'list': {
        const list = t as Tokens.List
        if (ctx.pinMode) {
          warning(ctx, 'pin.unsupported-rich-text', '想法正文不支持列表，已降级为段落文本。')
          for (const item of list.items) {
            const inner = inlineToHtml(item.tokens, ctx)
            if (inner.trim()) out += `<p>${inner}</p>`
          }
          break
        }
        const tag = list.ordered ? 'ol' : 'ul'
        const items = list.items.map(item => `<li>${inlineToHtml(item.tokens, ctx)}</li>`).join('')
        out += `<${tag}>${items}</${tag}>`
        break
      }
      case 'table': {
        const table = t as Tokens.Table
        if (ctx.pinMode) {
          warning(ctx, 'pin.unsupported-rich-text', '想法正文不支持表格，已降级为文本。')
          const text = table.raw.replace(/<[^>]+>/g, ' ').replace(/[|:-]+/g, ' ').replace(/\s+/g, ' ').trim()
          if (text) out += `<p>${escapeHtml(text)}</p>`
          break
        }
        const head = table.header.map(c => `<th>${inlineToHtml(c.tokens, ctx)}</th>`).join('')
        const rows = table.rows.map(r => `<tr>${r.map(c => `<td>${inlineToHtml(c.tokens, ctx)}</td>`).join('')}</tr>`).join('')
        out += `<table data-draft-node="block" data-draft-type="table" data-size="normal" data-row-style="normal"><tbody><tr>${head}</tr>${rows}</tbody></table>`
        break
      }
      case 'html': {
        // 块级原始 HTML：统一走 parse5 消毒（同 format='html'），
        // 不做快速 img/br 提取（那样会绕过 on*/unsafe-url 检测）。
        const raw = ((t as Tokens.HTML).text ?? (t as Tokens.HTML).raw ?? '')
        if (raw.trim()) out += sanitizeInputHtml(raw, ctx)
        break
      }
      default: {
        const anyT = t as Tokens.Generic
        if (anyT.tokens?.length) {
          const inner = blockToHtml(anyT.tokens, ctx)
          if (inner.trim()) out += inner
        } else if (typeof anyT.raw === 'string' && anyT.raw.trim()) {
          out += `<p>${escapeHtml(anyT.raw.trim())}</p>`
        }
      }
    }
  }
  return out
}

/**
 * 提取 $...$ / $$...$$ 公式（marked 无内建数学扩展，预扫描后在输出中恢复）。
 * 移除定界符后保留内侧全部字符（含首尾空白）——不 trim。
 * 货币场景保真：`$5`、`$10` 这类 $ 紧跟数字的当普通文字，不当公式定界。
 * $$...$$ 始终以 $$ 开头，不受单 $ 货币规则影响。
 */
function extractFormulas(text: string, ph: Placeholders): { text: string; formulas: { block: boolean; latex: string }[] } {
  const formulas: { block: boolean; latex: string }[] = []
  let out = ''
  let i = 0
  while (i < text.length) {
    const dollar = text.indexOf('$', i)
    if (dollar < 0) { out += text.slice(i); break }
    // \$ 转义不算定界符。
    if (dollar > 0 && text[dollar - 1] === '\\') { out += text.slice(i, dollar + 1); i = dollar + 1; continue }
    const isDouble = text[dollar + 1] === '$'
    const openLen = isDouble ? 2 : 1
    // 货币/变量保真：单 $ 紧跟数字 → 价格（$5）；紧跟两个大写字母 → 环境变量
    // （$HOME、$PATH）。$E=mc^2$ 不受影响（E 后是 =）。
    const afterOpen = text.slice(dollar + openLen, dollar + openLen + 2)
    if (!isDouble && (/\d/.test(afterOpen[0] ?? '') || /^[A-Z][A-Z]/.test(afterOpen))) {
      out += text.slice(i, dollar + 1); i = dollar + 1; continue
    }
    const close = text.indexOf(isDouble ? '$$' : '$', dollar + openLen)
    if (close < 0) { out += text.slice(i); break }
    const latex = text.slice(dollar + openLen, close)
    if (!latex) { out += text.slice(i, close + openLen); i = close + openLen; continue }
    // 货币尾保真：单 $ 闭定界后紧跟数字（如 $x$5 实为价格片段）→ 整个当普通文字。
    if (!isDouble && /\d/.test(text[close + openLen] ?? '')) {
      out += text.slice(i, close + openLen); i = close + openLen; continue
    }
    formulas.push({ block: isDouble, latex })
    out += text.slice(i, dollar) + ph.formula(formulas.length - 1)
    i = close + openLen
  }
  return { text: out, formulas }
}

// ---------------------------------------------------------------------------
// 想法正文（纯文本段落 + text-link + hash_tag）
// ---------------------------------------------------------------------------

/**
 * 扫描纯文本里的 #话题名#，转成 hash_tag <a>。
 * 用 parse5 遍历 DOM 树，只在文本节点内做替换——不触碰属性值，
 * 不会在已有 <a> 内嵌套 <a>，不会双转义。
 */
function injectPinHashTags(html: string): { html: string; count: number } {
  const frag = parseFragment(html)
  let count = 0
  const walk = (parent: { childNodes: P5AnyNode[] }) => {
    for (let i = 0; i < parent.childNodes.length; i++) {
      const node = parent.childNodes[i]
      if (node.nodeName === '#text') {
        const text = (node as DefaultTreeAdapterMap['textNode']).value
        if (!text.includes('#')) continue
        // 文本节点内 #xxx# → 拆分：话题部分变 anchor，其余保留为文本。
        const parts: P5AnyNode[] = []
        let last = 0
        text.replace(/#([^#\n<>]{1,200})#/g, (whole, name: string, offset: number) => {
          if (offset > last) {
            parts.push({ nodeName: '#text', value: text.slice(last, offset), parentNode: null, nextNode: null, prevNode: null } as unknown as P5AnyNode)
          }
          const topic = `#${name}#`
          const anchor = {
            nodeName: 'a', tagName: 'a', attrs: [
              { name: 'class', value: 'hash_tag' },
              { name: 'data-topic-name', value: topic },
            ],
            childNodes: [{ nodeName: '#text', value: topic }],
            namespaceURI: 'http://www.w3.org/1999/xhtml',
          } as unknown as P5Element
          parts.push(anchor as P5AnyNode)
          count += 1
          last = offset + whole.length
          return whole
        })
        if (count > 0 && parts.length) {
          if (last < text.length) parts.push({ nodeName: '#text', value: text.slice(last), parentNode: null, nextNode: null, prevNode: null } as unknown as P5AnyNode)
          parent.childNodes.splice(i, 1, ...parts)
          i += parts.length - 1
        }
        continue
      }
      // 递归进入子节点，但不进入已生成的 hash_tag anchor（避免嵌套 a）。
      const tag = (node as P5Element).tagName?.toLowerCase()
      if (tag === 'a') continue
      if ('childNodes' in node) walk(node as { childNodes: P5AnyNode[] })
    }
  }
  walk(frag as unknown as { childNodes: P5AnyNode[] })
  // serialize 返回包含 entity 的 HTML；对文本节点中的 # 已处理，
  // 对 hash_tag 的文本内容（#话题名#）保持原样。
  const serialized = frag.childNodes.map(c => serializeNode(c)).join('')
  return { html: serialized, count }
}

function serializeNode(node: P5AnyNode): string {
  if (node.nodeName === '#text') {
    return escapeHtml((node as DefaultTreeAdapterMap['textNode']).value)
  }
  const el = node as P5Element
  const tag = el.tagName?.toLowerCase()
  if (!tag) return ''
  if (VOID_TAGS.has(tag)) {
    const attrs = (el.attrs ?? []).map(a => `${a.name}="${escapeAttr(a.value)}"`).join(' ')
    return `<${tag}${attrs ? ' ' + attrs : ''} />`
  }
  const attrs = (el.attrs ?? []).map(a => `${a.name}="${escapeAttr(a.value)}"`).join(' ')
  const inner = (el.childNodes ?? []).map(c => serializeNode(c)).join('')
  return `<${tag}${attrs ? ' ' + attrs : ''}>${inner}</${tag}>`
}

// ---------------------------------------------------------------------------
// 正文图片与上传结果的匹配
// ---------------------------------------------------------------------------

/**
 * 把 draft.body 中的图片引用按出现顺序与 draft.images 中的 SyncImage 匹配。
 * 匹配键：SyncImage.originalUrl 等于引用 src（允许 file:// 归一化差异）；
 * 若未提供 originalUrl，则按顺序消费。无法匹配到已上传 URL → error。
 */
function resolveBodyImages(ctx: Ctx, draft: SyncDraft) {
  const uploaded = draft.images ?? []
  const unused = new Set<number>(uploaded.map((_, i) => i))
  const normalize = (v: string) => {
    let s = v.trim().replace(/^file:\/\//i, '').replace(/\\/g, '/')
    // 图片 src 与 originalUrl 可能在 %20 等编码形式上不一致；
    // 仅在解码无歧义（往返一致）时归一，避免 %25 → % 这类单向下沉。
    try { if (encodeURIComponent(decodeURIComponent(s)) === s) s = decodeURIComponent(s) } catch { /* keep raw */ }
    return s.toLowerCase()
  }
  for (const ref of ctx.bodyImages) {
    let matched = -1
    for (const i of unused) {
      const img = uploaded[i]
      if (img.originalUrl && normalize(img.originalUrl) === normalize(ref.src)) { matched = i; break }
    }
    if (matched < 0) {
      // 顺序回退：仍按声明顺序取第一个未用条目；其 originalUrl 必须等于引用 src 或为空。
      for (const i of unused) {
        const img = uploaded[i]
        if (!img.originalUrl || normalize(img.originalUrl) === normalize(ref.src)) { matched = i; break }
      }
    }
    if (matched < 0) {
      error(ctx, 'image.unresolved', `正文图片未找到对应的上传结果：${ref.src || '(空 src)'}。请先上传图片后再保存/发布。`)
      continue
    }
    unused.delete(matched)
    ref.resolved = uploaded[matched]
  }
  // 声明了上传结果但正文未引用：不静默丢弃，提示用户检查。
  // pin 的 images 属于独立媒体区（不经正文引用），跳过此检查。
  if (!ctx.pinMode) {
    for (const i of unused) {
      warning(ctx, 'image.unused', `已上传图片未在正文中引用：${uploaded[i].originalUrl || uploaded[i].url}。`)
    }
  }
}

/** 知乎域白名单（与媒体 owner 一致）：^([a-z0-9-]+\.)*(zhimg\.com|zhihu\.com)$ */
const ZHIHU_DOMAIN_RE = /^([a-z0-9-]+\.)*(zhimg\.com|zhihu\.com)$/i
function isZhihuImageUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.username && !u.password && ZHIHU_DOMAIN_RE.test(u.hostname)
  } catch { return false }
}

function renderBodyImage(ref: ImageRef, ctx: Ctx): string {
  const img = ref.resolved
  if (!img?.url) return ''
  if (!isZhihuImageUrl(img.url)) {
    error(ctx, 'image.unsafe-url', `图片发布 URL 不是 HTTPS 知乎图片域：${img.url}。`)
    return ''
  }
  const caption = ref.caption || ''
  if (caption.length > SYNC_LIMITS.captionMax) {
    error(ctx, 'image.caption-too-long', `图片注释超过 ${SYNC_LIMITS.captionMax} 字，请缩短后重试。`)
    return ''
  }
  const attrs: string[] = [`src="${escapeAttr(img.url)}"`]
  attrs.push(`data-caption="${escapeAttr(caption)}"`)
  const w = img.width ?? 0
  attrs.push(`data-size="${w > 0 && w < 343 ? 'small' : 'normal'}"`)
  if (img.width !== undefined) attrs.push(`data-rawwidth="${img.width}"`)
  if (img.height !== undefined) attrs.push(`data-rawheight="${img.height}"`)
  if (img.watermark) attrs.push('data-watermark="watermark"')
  // data-original-src 只保留知乎域地址；外部原始链接只用于预览匹配，不写入发布 body。
  if (img.originalUrl && isZhihuImageUrl(img.originalUrl)) {
    attrs.push(`data-original-src="${escapeAttr(img.originalUrl)}"`)
  } else {
    attrs.push('data-original-src=""')
  }
  attrs.push('data-watermark-src=""', 'data-private-watermark-src=""')
  return `<img ${attrs.join(' ')} />`
}

// ---------------------------------------------------------------------------
// HTML 输入消毒（format='html'，parse5 解析；不用正则充当 HTML 解析器）
// ---------------------------------------------------------------------------

type P5Element = DefaultTreeAdapterMap['element']
type P5AnyNode = DefaultTreeAdapterMap['childNode']

const SAFE_TAGS = new Set([
  'p', 'br', 'h2', 'h3', 'b', 'i', 'ol', 'ul', 'li', 'blockquote', 'hr',
  'pre', 'code', 'sup', 'img', 'a', 'table', 'tbody', 'tr', 'th', 'td',
])
const DANGEROUS_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'svg', 'style', 'link', 'meta', 'base',
  'form', 'input', 'button', 'select', 'textarea', 'option', 'video', 'audio',
  'source', 'track', 'noscript', 'template', 'frame', 'frameset', 'applet',
])
const VOID_TAGS = new Set(['br', 'hr', 'img'])
const DANGEROUS_URL = /^\s*(javascript|vbscript|file|data):/i

function attr(el: P5Element, name: string): string {
  return el.attrs?.find(a => a.name.toLowerCase() === name)?.value ?? ''
}

function sanitizeAnchorAttrs(el: P5Element, ctx: Ctx): { ok: boolean; html: string } {
  const dataAttrs = Object.fromEntries((el.attrs ?? []).map(a => [a.name, a.value]))
  const isLinkCard = dataAttrs['data-draft-type'] === 'link-card' && dataAttrs['data-draft-node'] === 'block'
  const isTextLink = dataAttrs['data-draft-type'] === 'text-link'
  const isHashTag = (dataAttrs['class'] ?? '').split(/\s+/).includes('hash_tag') || (dataAttrs['class'] ?? '').includes('zed-topic')
  const href = (dataAttrs['href'] ?? '').trim()
  if (!href || !isAbsoluteHttpUrl(href) || DANGEROUS_URL.test(href)) {
    error(ctx, 'html.unsafe-link-url', `链接地址不受支持，已拒绝：${href || '(空)'}`)
    return { ok: false, html: '' }
  }
  let attrs = `href="${escapeAttr(href)}"`
  if (isHashTag) {
    const topicName = dataAttrs['data-topic-name'] ?? ''
    attrs = `class="hash_tag" href="${escapeAttr(href)}" data-topic-name="${escapeAttr(topicName)}"`
    const topicId = dataAttrs['data-topic-id']
    if (topicId) attrs += ` data-topic-id="${escapeAttr(topicId)}"`
    return { ok: true, html: `<a ${attrs}>{INNER}</a>` }
  }
  if (isLinkCard) {
    attrs += ` data-draft-node="block" data-draft-type="link-card" data-draft-title="${escapeAttr(dataAttrs['data-draft-title'] ?? '')}" data-draft-cover="${escapeAttr(dataAttrs['data-draft-cover'] ?? '')}"`
    if (dataAttrs['data-content-type']) attrs += ` data-content-type="${escapeAttr(dataAttrs['data-content-type'])}"`
    if (dataAttrs['data-content-id']) attrs += ` data-content-id="${escapeAttr(dataAttrs['data-content-id'])}"`
    return { ok: true, html: `<a ${attrs}>{INNER}</a>` }
  }
  if (isTextLink || ctx.pinMode) {
    attrs += ` data-insert-way="force" data-draft-node="inline" data-draft-type="text-link" data-draft-title="${escapeAttr(dataAttrs['data-draft-title'] ?? '')}"`
    return { ok: true, html: `<a ${attrs}>{INNER}</a>` }
  }
  const title = dataAttrs['data-draft-title']
  if (title) attrs += ` data-draft-title="${escapeAttr(title)}"`
  return { ok: true, html: `<a ${attrs}>{INNER}</a>` }
}

function sanitizeImg(el: P5Element, ctx: Ctx): string {
  const eeimg = attr(el, 'eeimg')
  const src = (attr(el, 'src') ?? '').trim()
  if (DANGEROUS_URL.test(src)) {
    error(ctx, 'html.unsafe-img-url', `图片地址不受支持，已拒绝：${src || '(空)'}`)
    return ''
  }
  if (eeimg === '1' || eeimg === '2') {
    // 公式图片：src 必须是知乎 equation 地址或占位。
    if (!/^(https?:)?\/\/www\.zhihu\.com\/equation\?/i.test(src) && src) {
      warning(ctx, 'formula.invalid-src', '公式图片地址异常，已重建。')
      const latex = attr(el, 'alt')
      return latexToEquationImg(latex, eeimg === '2')
    }
    const alt = attr(el, 'alt')
    return `<img eeimg="${eeimg}" src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />`
  }
  // 内容图片：src 必须能匹配已上传结果（originalUrl 或 url）。
  const idx = ctx.bodyImages.length
  ctx.bodyImages.push({ src, caption: attr(el, 'data-caption') || attr(el, 'alt') || '' })
  return ctx.ph.img(idx)
}

function sanitizeSup(el: P5Element, ctx: Ctx): { wrapper: [string, string] | null } {
  // 注释（仅文章；提问不支持）。属性：data-text / data-url / data-numero + 固定两值。
  if (attr(el, 'data-draft-type') !== 'reference') {
    warning(ctx, 'unsupported.sup', '非注释语义的 <sup> 已降级为文本。')
    return { wrapper: null }
  }
  if (ctx.type !== 'article') {
    error(ctx, 'reference.unsupported', '提问与想法不支持注释（<sup data-draft-type="reference">）。')
    return { wrapper: null }
  }
  const text = attr(el, 'data-text')
  const url = attr(el, 'data-url')
  if (!text && !url) {
    error(ctx, 'reference.empty', '注释需要 data-text 或 data-url 至少一项非空。')
    return { wrapper: null }
  }
  if (url && !isAbsoluteHttpUrl(url)) {
    error(ctx, 'reference.bad-url', `注释 data-url 不是合法链接：${url}`)
    return { wrapper: null }
  }
  const numero = attr(el, 'data-numero')
  const attrs = `data-text="${escapeAttr(text)}" data-url="${escapeAttr(url)}" data-draft-node="inline" data-draft-type="reference" data-numero="${escapeAttr(numero)}"`
  return { wrapper: [`<sup ${attrs}>`, '</sup>'] }
}

function sanitizeNode(node: P5AnyNode, ctx: Ctx): string {
  if (node.nodeName === '#text') {
    return escapeHtml((node as DefaultTreeAdapterMap['textNode']).value)
  }
  if (node.nodeName === '#comment' || node.nodeName === '#documentType') return ''
  const el = node as P5Element
  const tag = (el.tagName ?? '').toLowerCase()
  if (!tag) return ''
  if (DANGEROUS_TAGS.has(tag)) {
    error(ctx, 'html.unsafe-tag', `危险标签已移除且阻止发布：<${tag}>`)
    return ''
  }
  const children = (el.childNodes ?? []) as P5AnyNode[]
  const inner = () => children.map(c => sanitizeNode(c, ctx)).join('')
  if (!SAFE_TAGS.has(tag)) {
    // 不危险但不受支持：剥掉标签保留子内容（div/span/font/p→文本流）。
    warning(ctx, 'html.unsupported-tag', `不支持的标签 <${tag}> 已降级为纯文本。`)
    return inner()
  }
  switch (tag) {
    case 'a': {
      const r = sanitizeAnchorAttrs(el, ctx)
      if (!r.ok) return '' // 危险链接：丢弃整个锚（文本也含在锚内，不静默透传危险目标）。
      return r.html.replace('{INNER}', inner())
    }
    case 'img': return sanitizeImg(el, ctx)
    case 'sup': {
      const r = sanitizeSup(el, ctx)
      if (!r.wrapper) return inner()
      return r.wrapper[0] + inner() + r.wrapper[1]
    }
    case 'pre': {
      const lang = normalizeCodeLang(attr(el, 'lang'))
      // <pre><code>text</code></pre>：code 是知乎不支持的包装，取内部纯文本；
      // 不能只看直接子文本节点（那样 <pre><code>body</code></pre> 会丢掉全部正文）。
      const collectText = (nodes: DefaultTreeAdapterMap['childNode'][]): string =>
        nodes.map(n => n.nodeName === '#text'
          ? (n as DefaultTreeAdapterMap['textNode']).value
          : collectText((n as { childNodes?: DefaultTreeAdapterMap['childNode'][] }).childNodes ?? [])).join('')
      const text = collectText(children)
      return `<pre lang="${lang}">${escapeHtml(text)}</pre>`
    }
    case 'table': {
      return `<table data-draft-node="block" data-draft-type="table" data-size="normal" data-row-style="normal">${inner()}</table>`
    }
    case 'thead': case 'tfoot': {
      // 输出只允许 tbody（§4.12）：thead/tfoot 行并入主流。
      warning(ctx, 'table.unsupported-section', `<${tag}> 已并入 tbody。`)
      return inner()
    }
    case 'hr': return '<hr />'
    case 'br': return '<br>'
    case 'code': {
      const text = inner()
      if (ctx.pinMode) { warning(ctx, 'pin.unsupported-rich-text', '想法正文不支持行内代码，已降级为文本。'); return text }
      return `<code>${text}</code>`
    }
    case 'b': case 'i': {
      const content = inner()
      if (ctx.pinMode) { warning(ctx, 'pin.unsupported-rich-text', `想法正文不支持 <${tag}>，已降级为文本。`); return content }
      return `<${tag}>${content}</${tag}>`
    }
    case 'h2': case 'h3': {
      const content = inner()
      if (ctx.pinMode) { warning(ctx, 'pin.unsupported-rich-text', '想法正文不支持标题，已降级为文本。'); return `<p>${content}</p>` }
      return `<${tag}>${content}</${tag}>`
    }
    case 'ol': case 'ul': case 'li': case 'p': case 'blockquote': case 'tbody': case 'tr': case 'th': case 'td': {
      if (ctx.pinMode && tag !== 'p') {
        warning(ctx, 'pin.unsupported-rich-text', `想法正文不支持 <${tag}>，已降级为文本。`)
        return inner()
      }
      return `<${tag}>${inner()}</${tag}>`
    }
    default:
      return inner()
  }
}

function sanitizeInputHtml(body: string, ctx: Ctx): string {
  const frag = parseFragment(body)
  return (frag.childNodes as P5AnyNode[]).map(c => sanitizeNode(c, ctx)).join('')
}

/** 行内原始 HTML 消毒：与 format='html' 走同一 parse5 路径，
 *  但只返回内联内容（不包 <p>），供 markdown 行内 html token 使用。 */
function sanitizeInlineHtml(raw: string, ctx: Ctx): string {
  const frag = parseFragment(raw)
  return (frag.childNodes as P5AnyNode[]).map(c => sanitizeNode(c, ctx)).join('')
}

/** 用 parse5 把 HTML 实体解码为可见字符（&lt; → <）。 */
function decodeEntities(text: string): string {
  const frag = parseFragment(text)
  let out = ''
  const walk = (nodes: DefaultTreeAdapterMap['childNode'][]) => {
    for (const n of nodes) {
      if (n.nodeName === '#text') out += (n as DefaultTreeAdapterMap['textNode']).value
      else walk((n as { childNodes?: DefaultTreeAdapterMap['childNode'][] }).childNodes ?? [])
    }
  }
  walk(frag.childNodes as DefaultTreeAdapterMap['childNode'][])
  return out
}

// ---------------------------------------------------------------------------
// 规范化输入草稿
// ---------------------------------------------------------------------------

function normalizeDraft(input: unknown, issues: SyncIssue[]): SyncDraft {
  if (!isRecord(input)) {
    issues.push({ severity: 'error', code: 'input.invalid', message: '草稿输入必须是对象。' })
    return { type: 'article', title: '', body: '', format: 'markdown' }
  }
  const type = (['article', 'question', 'pin'].includes(String(input.type))
    ? input.type
    : 'article') as SyncDraft['type']
  if (input.type !== undefined && input.type !== type) {
    issues.push({ severity: 'error', code: 'input.bad-type', message: `不支持的内容形态：${String(input.type)}。` })
  }
  const format: SyncDraft['format'] = input.format === 'html' ? 'html' : 'markdown'
  const draft: SyncDraft = {
    type,
    title: typeof input.title === 'string' ? input.title : '',
    body: typeof input.body === 'string' ? input.body : '',
    format,
  }
  if (input.images !== undefined) {
    if (!Array.isArray(input.images)) {
      issues.push({ severity: 'error', code: 'input.bad-images', message: 'images 必须是数组。' })
    } else {
      draft.images = input.images
        .filter((i): i is SyncImage => isRecord(i))
        .map(i => ({
          url: typeof i.url === 'string' ? i.url : '',
          originalUrl: typeof i.originalUrl === 'string' ? i.originalUrl : undefined,
          width: typeof i.width === 'number' && Number.isFinite(i.width) ? i.width : undefined,
          height: typeof i.height === 'number' && Number.isFinite(i.height) ? i.height : undefined,
          watermark: i.watermark === true,
          mediaId: typeof i.mediaId === 'string' ? i.mediaId : undefined,
        }))
        .filter(i => i.url || i.originalUrl)
    }
  }
  if (input.linkCard !== undefined && input.linkCard !== null) {
    if (isRecord(input.linkCard) && typeof input.linkCard.url === 'string' && input.linkCard.url.trim()) {
      const lc = input.linkCard
      const lcUrl = lc.url as string
      draft.linkCard = {
        url: lcUrl.trim(),
        title: typeof lc.title === 'string' ? lc.title : undefined,
        cover: typeof lc.cover === 'string' ? lc.cover : undefined,
        contentType: typeof lc.contentType === 'string' ? lc.contentType : undefined,
        contentId: typeof lc.contentId === 'string' ? lc.contentId : undefined,
        isFromForward: lc.isFromForward === true ? true : undefined,
      }
    } else {
      issues.push({ severity: 'warning', code: 'input.bad-linkcard', message: 'linkCard 缺少有效 url，已忽略。' })
    }
    // linkCard.url 是外部链接：只需 http(s) + 无 userinfo（与正文 <a> 同策略）；
    // linkCard.cover 是图片：需 https + 知乎图片域（与媒体同策略）。
    if (draft.linkCard) {
      if (!isAbsoluteHttpUrl(draft.linkCard.url)) {
        issues.push({ severity: 'error', code: 'linkcard.url-unsafe', message: `linkCard.url 必须是 http(s) 链接：${draft.linkCard.url}` })
      }
      if (draft.linkCard.cover && !isZhihuImageUrl(draft.linkCard.cover)) {
        issues.push({ severity: 'error', code: 'linkcard.cover-unsafe', message: `linkCard.cover 必须是 HTTPS 知乎图片域链接：${draft.linkCard.cover}` })
      }
    }
  }
  if (input.settings !== undefined && input.settings !== null) {
    if (!isRecord(input.settings)) {
      issues.push({ severity: 'warning', code: 'input.bad-settings', message: 'settings 必须是对象，已忽略。' })
    } else {
      const s = input.settings
      const settings: NonNullable<SyncDraft['settings']> = {}
      if (s.commentPermission !== undefined) settings.commentPermission = String(s.commentPermission) as SyncCommentPermission
      if (s.tableOfContentsEnabled !== undefined) settings.tableOfContentsEnabled = s.tableOfContentsEnabled === true
      if (s.creationStatement !== undefined) settings.creationStatement = String(s.creationStatement) as SyncCreationStatement
      if (Array.isArray(s.topics)) settings.topics = s.topics.filter((t): t is string => typeof t === 'string' && !!t.trim()).map(t => t.trim())
      if (typeof s.ring === 'string' && s.ring.trim()) settings.ring = s.ring.trim()
      if (Object.keys(settings).length) draft.settings = settings
    }
  }
  return draft
}

// ---------------------------------------------------------------------------
// prepareZhihuSyncDraft
// ---------------------------------------------------------------------------

export function prepareZhihuSyncDraft(input: unknown): SyncPrepared {
  const issues: SyncIssue[] = []
  const draft = normalizeDraft(input, issues)
  const ph = makePlaceholders()
  const ctx: Ctx = { issues, type: draft.type, pinMode: draft.type === 'pin', bodyImages: [], formulas: [], ph }

  // ---- 标题（§2）：question 自动补「？」并计入长度 ----
  let title = draft.title
  if (draft.type === 'question') {
    title = title.trimEnd()
    if (title && !/[？?]\s*$/.test(title)) title += '？'
    draft.title = title
  }
  const titleChars = [...draft.title].length
  if (/\n/.test(draft.title)) error(ctx, 'title.multiline', '标题禁止换行。')
  if (draft.type === 'question') {
    if (titleChars === 0) error(ctx, 'title.required', '提问标题必填。')
    if (titleChars > 0 && titleChars < SYNC_LIMITS.questionTitleMin) {
      error(ctx, 'title.too-short', `提问标题 4～51 字（含结尾问号），当前 ${titleChars} 字。`)
    }
    if (titleChars > SYNC_LIMITS.questionTitleMax) {
      error(ctx, 'title.too-long', `提问标题 4～51 字（含结尾问号），当前 ${titleChars} 字。`)
    }
    const questionMarks = (draft.title.match(/[？?]/g) ?? []).length
    if (questionMarks > 1) {
      warning(ctx, 'title.multi-question', '标题含多个问号，请确认只表达一个明确问题。')
    }
  } else if (draft.type === 'pin') {
    if (titleChars > SYNC_LIMITS.pinTitleMax) {
      error(ctx, 'title.too-long', `想法标题最多 ${SYNC_LIMITS.pinTitleMax} 字，当前 ${titleChars} 字。`)
    }
  } else {
    if (titleChars === 0) error(ctx, 'title.required', '文章标题必填。')
    if (titleChars > SYNC_LIMITS.articleTitleMax) {
      error(ctx, 'title.too-long', `文章标题最多 ${SYNC_LIMITS.articleTitleMax} 字，当前 ${titleChars} 字。`)
    }
  }

  // ---- 正文转换 ----
  // markdown：先 lexer 再逐 text token 提取公式——code/codespan/html token
  // 不参与，避免 ```$x$``` 与行内代码里的 $ 被误判为公式定界符。
  let html = ''
  if (draft.format === 'markdown') {
    const tokens = lexer(draft.body) as Token[]
    html = blockToHtml(tokens, ctx)
  } else {
    html = sanitizeInputHtml(draft.body, ctx)
  }

  // 恢复公式占位符（前缀含 prepare 内随机成分，不会与正文碰撞）。
  // 占位符在 escapeHtml 之后仍是纯字母数字下划线，不会被转义破坏。
  const formulaPrefix = ph.formula(0).replace(/0$/, '')
  const formulaRe = new RegExp(`${formulaPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)`, 'g')
  html = html.replace(formulaRe, (_, idx: string) => {
    const f = ctx.formulas[Number(idx)]
    return f ? latexToEquationImg(f.latex, f.block) : ''
  })

  // 想法：纯文本扫描 #话题# → hash_tag；文章/提问不处理话题语法。
  let pinTopicCount = 0
  if (draft.type === 'pin') {
    const injected = injectPinHashTags(html)
    html = injected.html
    pinTopicCount = injected.count
    if (pinTopicCount > SYNC_LIMITS.pinTopicsMax) {
      error(ctx, 'topics.too-many', `想法话题最多 ${SYNC_LIMITS.pinTopicsMax} 个，当前 ${pinTopicCount} 个。`)
    }
  }

  // 正文图片：按出现顺序匹配上传结果。
  resolveBodyImages(ctx, draft)
  const imgPrefix = ph.img(0).replace(/0$/, '')
  const imgRe = new RegExp(`${imgPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)`, 'g')
  html = html.replace(imgRe, (_, idx: string) => {
    // 想法正文不支持内嵌图片（§5.3）：只从 body 中移除占位符，不渲染 img 标签；
    // 已上传的媒体由下方移入独立 media 区。
    if (ctx.pinMode) return ''
    return renderBodyImage(ctx.bodyImages[Number(idx)], ctx)
  })

  // 想法：draft.images 全部属于独立媒体区（正文里出现的图片 markdown 不合法）。
  if (draft.type === 'pin' && ctx.bodyImages.length) {
    // pin 正文图片引用不进入 body；把它们移到独立媒体区（顺序在已有 images 之后）。
    const stray = ctx.bodyImages.filter(r => r.resolved?.url)
    if (stray.length) {
      warning(ctx, 'pin.body-image-moved', '想法正文不支持内嵌图片，已将正文图片移入独立媒体区。')
      draft.images = [...(draft.images ?? []).filter(i => !stray.some(r => r.resolved === i)), ...stray.map(r => r.resolved!)]
    }
  }

  // ---- 正文长度 ----
  const bodyChars = plainTextLength(html)
  if (draft.type === 'article') {
    if (bodyChars < SYNC_LIMITS.articleBodyMin) {
      error(ctx, 'body.too-short', `文章正文至少 ${SYNC_LIMITS.articleBodyMin} 字（纯文本），当前 ${bodyChars} 字。`)
    }
    if (bodyChars > SYNC_LIMITS.articleBodyMax) {
      error(ctx, 'body.too-long', `文章正文最多 ${SYNC_LIMITS.articleBodyMax} 字（纯文本），当前 ${bodyChars} 字。`)
    }
  } else if (draft.type === 'pin') {
    if (bodyChars > SYNC_LIMITS.pinBodyMax) {
      error(ctx, 'body.too-long', `想法正文最多 ${SYNC_LIMITS.pinBodyMax} 字（纯文本），当前 ${bodyChars} 字。`)
    }
    const hasContent = bodyChars > 0 || (draft.images?.length ?? 0) > 0 || !!draft.linkCard
    if (!hasContent) error(ctx, 'body.required', '想法正文、图片或链接卡片至少需要一项有效内容。')
    // publish-pin.md：content.html 必须非空（validate 允许空正文仅当有媒体/卡片）。
    else if (bodyChars === 0) error(ctx, 'body.required', '想法正文不能为空，请补充正文内容。')
  }

  // ---- 想法互斥：独立图片 vs linkCard（publish-pin.md：同时存在即拒绝发布）----
  const pinImages = draft.type === 'pin' ? (draft.images ?? []).filter(i => i.url) : []
  if (draft.type === 'pin') {
    // pin 独立媒体图也必须是 HTTPS 知乎域（预览/发布都会请求）。
    for (const img of pinImages) {
      if (!isZhihuImageUrl(img.url)) {
        error(ctx, 'image.unsafe-url', `独立图片发布 URL 不是 HTTPS 知乎图片域：${img.url}。`)
      }
    }
    if (pinImages.length > SYNC_LIMITS.pinImagesMax) {
      error(ctx, 'images.too-many', `想法独立图片最多 ${SYNC_LIMITS.pinImagesMax} 张，当前 ${pinImages.length} 张。`)
    }
    if (pinImages.length && draft.linkCard) {
      error(ctx, 'pin.media-linkcard-exclusive', '单条想法不支持同时包含独立图片与链接卡片。')
    }
  }

  // ---- 发布设置校验（不修改 draft.settings；错误只进 issues）----
  validateSettings(draft, issues, pinImages.length)

  return {
    draft,
    html,
    issues,
    canPublish: !issues.some(i => i.severity === 'error'),
    counts: {
      titleChars,
      bodyChars,
      images: draft.type === 'pin' ? pinImages.length : ctx.bodyImages.length,
      topics: draft.type === 'pin' ? pinTopicCount : (draft.settings?.topics?.length ?? 0),
    },
  }
}

function validateSettings(draft: SyncDraft, issues: SyncIssue[], pinImageCount: number) {
  const ctx: Ctx = { issues, type: draft.type, pinMode: draft.type === 'pin', bodyImages: [], formulas: [], ph: { img: () => '', formula: () => '' } }
  const s = draft.settings ?? {}

  // 形态-设置项支持矩阵（config.md §7 / publish-*.md）。
  if (draft.type === 'question') {
    for (const [key, label] of [
      ['commentPermission', '评论权限'],
      ['creationStatement', '创作声明'],
      ['tableOfContentsEnabled', '目录'],
      ['ring', '圈子'],
    ] as const) {
      if (s[key as keyof typeof s] !== undefined) warning(ctx, `settings.unsupported-${key}`, `提问不支持${label}配置，发布时将忽略。`)
    }
  }
  if (draft.type === 'article') {
    if (s.ring !== undefined) warning(ctx, 'settings.unsupported-ring', '文章不支持圈子配置，发布时将忽略。')
  }
  if (s.topics?.length) {
    if (draft.type === 'pin') {
      warning(ctx, 'settings.unsupported-topics', '想法话题属于正文（#话题名#），不使用 settings.topics，发布时将忽略。')
    } else {
      const max = draft.type === 'article' ? SYNC_LIMITS.articleTopicsMax : SYNC_LIMITS.questionTopicsMax
      const valid = s.topics.filter(t => strictZhihuUrl(t, /^\/topic\/(\d+)(?:\/|$)/))
      if (valid.length !== s.topics.length) {
        error(ctx, 'topics.invalid', '话题必须是知乎话题链接（https://www.zhihu.com/topic/{token}/...）。')
      }
      if (s.topics.length > max) {
        error(ctx, 'topics.too-many', `${draft.type === 'article' ? '文章' : '提问'}话题最多 ${max} 个，当前 ${s.topics.length} 个。`)
      }
    }
  }
  if (s.commentPermission !== undefined && draft.type !== 'question') {
    const allowed: readonly string[] = draft.type === 'pin' ? SYNC_PIN_COMMENT_PERMISSIONS : SYNC_ARTICLE_COMMENT_PERMISSIONS
    if (!allowed.includes(s.commentPermission)) {
      error(ctx, 'comment-permission.invalid', `当前形态不支持的评论权限：${String(s.commentPermission)}。`)
    }
  }
  if (s.creationStatement !== undefined) {
    if (draft.type === 'pin') {
      if (s.creationStatement !== 'ai_creation') {
        error(ctx, 'creation-statement.invalid', `想法仅支持 ai_creation 创作声明，当前：${String(s.creationStatement)}。`)
      }
    } else if (draft.type === 'article') {
      if (!(SYNC_ARTICLE_CREATION_STATEMENTS as readonly string[]).includes(String(s.creationStatement))) {
        error(ctx, 'creation-statement.invalid', `不支持的创作声明：${String(s.creationStatement)}。`)
      }
    }
  }
  if (s.ring !== undefined && draft.type === 'pin') {
    if (!strictZhihuUrl(s.ring, /^\/ring\/host\/(\d+)(?:\/|$)/)) {
      error(ctx, 'ring.invalid', '圈子必须是知乎圈子链接（https://www.zhihu.com/ring/host/{id}）。')
    }
  }
  void pinImageCount
}

// ---------------------------------------------------------------------------
// buildZhihuPublishRequest（publish-*.md 字段映射；不二次校验内容字段）
// ---------------------------------------------------------------------------

export type ZhihuPublishRequest = {
  type: SyncDraft['type']
  confirmed: true
  confirm_note: string
  content: Record<string, unknown>
}

export function buildZhihuPublishRequest(prepared: unknown): ZhihuPublishRequest {
  if (!isRecord(prepared) || prepared.canPublish !== true || !isRecord(prepared.draft)) {
    throw new Error('buildZhihuPublishRequest: 需要 prepareZhihuSyncDraft 返回且 canPublish 为 true 的结果。')
  }
  const draft = prepared.draft as unknown as SyncDraft
  const html = typeof prepared.html === 'string' ? prepared.html : ''
  const s = draft.settings ?? {}
  const base = { type: draft.type, confirmed: true as const, confirm_note: 'confirmed by user after local preview' }

  if (draft.type === 'article') {
    const content: Record<string, unknown> = {
      title: draft.title,
      html,
      comment_permission: s.commentPermission ?? 'all',
      table_of_contents_enabled: s.tableOfContentsEnabled ?? false,
    }
    if (s.creationStatement) content.creation_statement = s.creationStatement
    const topics = extractTopicTokens(s.topics ?? [], SYNC_LIMITS.articleTopicsMax)
    if (topics.length) content.topics = topics
    return { ...base, content }
  }

  if (draft.type === 'question') {
    const content: Record<string, unknown> = { title: draft.title, html }
    const topics = extractTopicTokens(s.topics ?? [], SYNC_LIMITS.questionTopicsMax)
    if (topics.length) content.topics = topics
    return { ...base, content }
  }

  // pin：publish 要求 content.html 非空（publish-pin.md 前置校验）。
  const content: Record<string, unknown> = {
    title: draft.title,
    html,
    comment_permission: s.commentPermission ?? 'all',
  }
  const images = (draft.images ?? []).filter(i => typeof i.url === 'string' && i.url)
  if (images.length) {
    // publish-pin.md：images[].url 优先水印 URL 再原图 URL——SyncImage.url 已按此约定填充。
    content.images = images.map(i => ({ url: i.url }))
  } else if (draft.linkCard) {
    const lc = draft.linkCard
    content.linkcard = {
      data_content_type: lc.contentType ?? 'common_url',
      data_content_id: lc.contentId ?? '0',
      url: lc.url,
      data_draft_title: lc.title ?? '',
      data_draft_cover: lc.cover ?? '',
      is_from_forward: lc.isFromForward ?? false,
    }
  }
  if (s.creationStatement === 'ai_creation') content.creation_statement = 'ai_creation'
  const ring = extractRingId(s.ring)
  if (ring) content.ring = ring
  return { ...base, content }
}

function strictZhihuUrl(raw: string, pathRe: RegExp): string | '' {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return ''
    if (u.hostname !== 'www.zhihu.com') return ''
    const m = u.pathname.match(pathRe)
    return m?.[1] ?? ''
  } catch { return '' }
}

function extractTopicTokens(urls: string[], max: number): { topic_id: string; topic_token: string; topic_name: string }[] {
  const out: { topic_id: string; topic_token: string; topic_name: string }[] = []
  const seen = new Set<string>()
  for (const u of urls) {
    const token = strictZhihuUrl(String(u), /^\/topic\/(\d+)(?:\/|$)/)
    if (!token || seen.has(token)) continue
    seen.add(token)
    out.push({ topic_id: '', topic_token: token, topic_name: '' })
    if (out.length >= max) break
  }
  return out
}

function extractRingId(url: string | undefined): { ring_id: string; ring_name: string } | undefined {
  if (!url) return undefined
  const id = strictZhihuUrl(url, /^\/ring\/host\/(\d+)(?:\/|$)/)
  return id ? { ring_id: id, ring_name: '' } : undefined
}
