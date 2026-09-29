import { describe, expect, it } from 'vitest'
import { formatTitle, localMonthDay, parseModelTitle, resolveTitleLocale } from './output.ts'

describe('title output', () => {
  it('accepts the fixed type vocabulary and formats the local date', () => {
    const parsed = parseModelTitle('{"type":"fix","summary":"登录回调失败"}', 5, 10)
    expect(formatTitle(parsed, 'zh', new Date(2026, 8, 3, 12))).toBe('0903 | 修复 | 登录回调失败')
    expect(formatTitle(parsed, 'en', new Date(2026, 8, 3, 12))).toBe('0903 | Fix | 登录回调失败')
    expect(localMonthDay(new Date(2026, 0, 9, 12))).toBe('0109')
  })

  it('accepts fenced JSON, extra keys, unknown types, and a plain title line', () => {
    expect(parseModelTitle('```json\n{"type":"fix","summary":"登录"}\n```', 5, 10)).toEqual({ type: 'fix', summary: '登录' })
    expect(parseModelTitle('{"type":"other","summary":"任务"}', 5, 10)).toEqual({ type: 'discuss', summary: '任务' })
    expect(parseModelTitle('{"type":"test","summary":"标题测试","extra":true}', 5, 10)).toEqual({ type: 'test', summary: '标题测试' })
    expect(parseModelTitle('登录回调失败', 5, 10)).toEqual({ type: 'discuss', summary: '登录回调失败' })
    expect(() => parseModelTitle('{"type":"fix","summary":"   "}', 5, 10)).toThrow(/empty summary/)
  })

  it('normalizes one line and caps CJK code points', () => {
    const parsed = parseModelTitle(
      JSON.stringify({ type: 'feature', summary: '**实现**\n一个很长很长的功能摘要' }),
      5,
      6,
    )
    expect(parsed.summary).toBe('实现一个很长')
    expect(parsed.summary).not.toMatch(/[\n*]/u)
  })

  it('caps non-CJK summaries by words', () => {
    const parsed = parseModelTitle(
      JSON.stringify({ type: 'optimize', summary: 'improve the provider routing performance today' }),
      4,
      10,
    )
    expect(parsed.summary).toBe('improve the provider routing')
  })

  it('resolves explicit, preferred, and message-derived locales', () => {
    expect(resolveTitleLocale('zh', ['fix login'])).toBe('zh')
    expect(resolveTitleLocale('auto', ['修复登录'], 'en-US')).toBe('en')
    expect(resolveTitleLocale('auto', ['修复登录'])).toBe('zh')
    expect(resolveTitleLocale('auto', ['fix login'])).toBe('en')
  })
})
