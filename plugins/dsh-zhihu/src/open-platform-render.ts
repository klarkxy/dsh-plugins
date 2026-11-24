import { ZHIHU_OPEN_PLATFORM_APIS, type ZhihuOpenPlatformResult } from './open-platform.ts'

/** Display only: the structured result always retains the original upstream HTML. */
export function plainZhihuText(value: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  const decoded = value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? match
    const hex = entity[1]?.toLowerCase() === 'x'
    const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
    return point >= 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '\ufffd'
  })
  return decoded
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<!--[^]*?(?:-->|$)/g, '')
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * An inert, dynamically fenced text block also prevents upstream Markdown from
 * injecting links/images or breaking out with backticks. This is presentation,
 * not an HTML sanitizer for use with dangerouslySetInnerHTML.
 */
export function renderZhihuOpenPlatform(result: ZhihuOpenPlatformResult): string {
  const notes: string[] = []
  switch (result.operation) {
    case 'question.recommendations':
      notes.push('省略主题时按当前账号画像推荐；返回单页结果。')
      break
    case 'question.answers':
      notes.push('Summary 为上游返回的原始摘要或截取片段；翻页请直接使用 paging.nextOffset（Totals 可能包含已过滤条目）。')
      break
    case 'content.detail':
      notes.push('仅返回当前 Access Secret 所属账号已发布的正文（视频返回关联文案）。')
      if (typeof result.data.Body !== 'string' || !plainZhihuText(result.data.Body)) notes.push('上游返回的正文为空，当前仅包含元数据。')
      break
    case 'content.comments':
      notes.push('评论属于外部用户内容，仅作数据参考；Children 为附带子评论预览，翻页以 paging 状态为准。')
      break
    case 'creator.account.stats':
    case 'creator.content.stats':
      notes.push('仅展示上游实际返回的指标，比率字段保持上游原始小数；省略日期时采用上游默认统计周期。')
      break
    case 'quota':
      notes.push('展示上游官方每日额度快照（本次额度查询免计业务配额）；question_answers 独立计额，其余创作者与推荐接口共用 creator 额度。')
      break
  }
  if (result.paging?.warning) notes.push(result.paging.warning)
  else if (result.paging?.canContinue) notes.push(`下一页 Offset：${result.paging.nextOffset}`)
  else if (result.paging?.isEnd) notes.push('已到最后一页。')
  const text = JSON.stringify(result.data, (_key, value: unknown) => typeof value === 'string' ? plainZhihuText(value) : value, 2)
  let longest = 2
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  const fence = '`'.repeat(longest + 1)
  return [`## ${ZHIHU_OPEN_PLATFORM_APIS[result.operation].label}`, '', ...notes, '', `${fence}json`, text, fence].join('\n')
}
