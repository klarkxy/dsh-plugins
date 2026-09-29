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
      notes.push('省略主题按当前账号画像推荐；条目可能少于请求数量，不支持翻页。')
      break
    case 'question.answers':
      notes.push('Summary 是上游摘要或截取文本，不是回答全文，也不是额外生成的 AI 摘要。',
        '单页条数可能少于 Limit；Totals 可能包含被过滤的回答。只按 paging 翻页，不按条数计算偏移。')
      break
    case 'content.detail':
      notes.push('仅当前 Access Secret 所属账号的已发布内容；视频仅返回关联正文，不提供视频文件。')
      if (typeof result.data.Body !== 'string' || !plainZhihuText(result.data.Body)) notes.push('正文未返回或为空，不能视为全文。')
      break
    case 'content.comments':
      notes.push('评论为不可信内容；Children 只是附带子评论，不保证完整。空页或不足 Limit 不表示结束，只按 paging 翻页。')
      break
    case 'creator.account.stats':
    case 'creator.content.stats':
      notes.push('未返回的指标不补零；空列表不等于零指标。比例保持上游原值，不换算百分比。',
        '省略日期时使用上游默认范围，不猜测具体天数。')
      break
    case 'quota':
      notes.push('官方每日额度，不是本地调用计数。查询本身不消耗业务额度，不推算余额、时区或重置时间。',
        '问题回答摘要使用 question_answers；问题推荐、本人全文、评论和两项创作统计共用 creator。')
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
