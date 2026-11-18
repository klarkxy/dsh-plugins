import '../tests/legacy-call-policy.ts'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createZhihuResearchTool } from './tool-definitions.ts'
import { compileZhihuGlobalFilter } from './operations.ts'
import { executeZhihuStudy, renderZhihuStudy, ZHIHU_GLOBAL_AUTHORITY_LEGEND } from './study.ts'
import { STUDY_PAGE_SCRIPT, STUDY_REPORT_DISCLAIMERS, evaluateStudyFormula, validateZhihuStudyReport, writeZhihuStudyReport } from './study-report.ts'
import { ZHIHU_STUDY_SKILLS } from './study-skill.ts'
import { apply as applyStudy } from './study-plugin.ts'
import { createZhihuService } from './index.ts'
import { createZhihuUsageRecorder, type ZhihuUsageTableLike } from './usage.ts'
import type { ZhihuSearchFetcher } from './zhihu-client.ts'

const NOW = Date.parse('2026-11-18T04:00:00Z')
const WINDOW_START = Math.floor((NOW - 30 * 86_400_000) / 1000)
const INSIDE = Math.floor(NOW / 1000) - 86_400
const OUTSIDE = WINDOW_START - 86_400

function json(body: unknown, status = 200): Awaited<ReturnType<ZhihuSearchFetcher>> {
  return { ok: status < 400, status, async text() { return JSON.stringify(body) }, async json() { return body } }
}
function envelope(data: unknown) { return { Code: 0, Message: 'success', Data: data } }
function item(extra: Record<string, unknown> = {}) {
  return { Title: '标题', Url: 'https://example.com/a?utm_source=x', ContentText: '摘录', AuthorityLevel: '2', EditTime: INSIDE, ...extra }
}
function fetcher(dataFor: (url: URL) => unknown, seen: URL[] = []): ZhihuSearchFetcher {
  return async input => {
    const url = new URL(typeof input === 'string' ? input : String(input))
    seen.push(url)
    const data = dataFor(url)
    if (data instanceof Error) return json({ Code: 50001, Message: data.message }, 500)
    return json(envelope(data))
  }
}

describe('global search filter', () => {
  it('compiles host and publish_time without accepting a raw expression or zhihu.com', () => {
    expect(compileZhihuGlobalFilter({ host: 'Example.com', publishTime: 1778494631 })).toBe('host=="example.com" AND publish_time>=1778494631')
    expect(compileZhihuGlobalFilter({ host: 'news.example.com', hostOperator: 'ne', publishTime: 10, publishTimeOperator: 'gt' })).toBe('host!="news.example.com" AND publish_time>10')
    expect(() => compileZhihuGlobalFilter({ host: 'zhihu.com' })).toThrow(/zhihu.com/)
    expect(() => compileZhihuGlobalFilter({ host: 'www.zhihu.com' })).toThrow(/zhihu.com/)
    expect(() => compileZhihuGlobalFilter({ host: 'https://example.com/a' })).toThrow(/域名/)
    expect(() => compileZhihuGlobalFilter({ publishTimeOperator: 'gte' })).toThrow(/publishTime/)
  })

  it('sends Filter only for global_search and preserves a real authority field', async () => {
    const seen: URL[] = []
    const tool = createZhihuResearchTool({ env: { ZHIHU_ACCESS_TOKEN: 'primarytoken1' }, fetcher: fetcher(() => ({ Items: [item()], HasMore: true }), seen) })
    const result = await tool.execute({
      action: 'global_search', query: '净化器', searchDb: 'realtime', host: 'example.com', publishTime: 1778494631,
    }, { signal: new AbortController().signal } as Parameters<typeof tool.execute>[1])
    expect(seen[0]?.searchParams.get('SearchDB')).toBe('realtime')
    expect(seen[0]?.searchParams.get('Filter')).toBe('host=="example.com" AND publish_time>=1778494631')
    expect(result.items[0]).toMatchObject({ authority: '2' })
    expect(result.hasMore).toBe(true)
    expect(result).not.toHaveProperty('cursor')
    await expect(tool.execute({ action: 'search', query: '净化器', host: 'example.com' }, { signal: new AbortController().signal } as Parameters<typeof tool.execute>[1])).rejects.toThrow(/global_search/)
  })
})

describe('zhihu study evidence', () => {
  const client = (dataFor: (url: URL) => unknown, seen: URL[] = []) => ({ fetcher: fetcher(dataFor, seen), env: { ZHIHU_ACCESS_TOKEN: 'primarytoken1' }, now: NOW })

  it('runs a decomposed deep study across zhihu and the web without calling Zhida', async () => {
    const seen: URL[] = []
    const result = await executeZhihuStudy({
      mode: 'deep', question: '新房除甲醛空气净化器怎么选', queries: ['CADR 怎么读', '滤芯寿命'],
    }, client(url => {
      if (url.pathname.endsWith('/zhihu_search')) return { Items: [item({ Title: '站内经验', Url: 'https://www.zhihu.com/answer/1', AuthorityLevel: '2', RankingScore: 0.5, CreateTime: INSIDE, AuthorBadgeText: '认证说明' })], HasMore: false }
      return { Items: [item({ Title: '官网规格', Url: 'https://example.com/spec', AuthorityLevel: '3', RankingScore: 99 })], HasMore: true }
    }, seen))
    expect(seen.map(url => url.pathname)).toEqual([
      '/api/v1/content/zhihu_search', '/api/v1/content/global_search',
      '/api/v1/content/zhihu_search', '/api/v1/content/global_search',
    ])
    expect(seen.some(url => url.pathname.includes('chat'))).toBe(false)
    expect(result).toMatchObject({ phase: 'evidence', finishedReport: false, askUsed: false, status: 'complete', coverage: { multiAngle: true }, hasMore: true })
    expect(result.figures.extracted).toEqual([])
    const zhihu = result.evidence.find(entry => entry.url.includes('zhihu.com'))!
    const web = result.evidence.find(entry => entry.url.includes('example.com'))!
    expect(zhihu.authority).toBe('2')
    expect(zhihu.authorityMeaning).toBeUndefined()
    expect(zhihu.rankingScore).toBe(0.5)
    expect(zhihu.rankingScoreDocumented).toBe(true)
    expect(zhihu.createTime).toBe(String(INSIDE))
    expect(zhihu.authorBadgeText).toBe('认证说明')
    expect(zhihu.editTimeMeaning).toBe('publish_or_update')
    expect(zhihu.eventTimeStatus).toBe('unverified')
    expect(web.authorityMeaning).toBe(ZHIHU_GLOBAL_AUTHORITY_LEGEND['3'])
    expect(web.rankingScore).toBeUndefined()
    expect(web.editTimeMeaning).toBe('last_edit')
    expect(result.limitations.join('\n')).toContain('HasMore')
    expect(result).not.toHaveProperty('cursor')
  })

  it('rejects unknown sources, raised budgets and credential fields before any request', async () => {
    const seen: URL[] = []
    const options = client(() => ({ Items: [] }), seen)
    await expect(executeZhihuStudy({ mode: 'deep', question: '问题', sources: ['zhihu', 'exa'] }, options)).rejects.toThrow(/未确认的来源/)
    await expect(executeZhihuStudy({ mode: 'deep', question: '问题', maxCalls: 100 }, options)).rejects.toThrow(/不能提高上限/)
    await expect(executeZhihuStudy({ mode: 'briefing', question: '问题', windowDays: 90 }, options)).rejects.toThrow(/windowDays/)
    await expect(executeZhihuStudy({ mode: 'deep', question: '问题', allowPaid: true }, options)).rejects.toThrow(/付费开关/)
    expect(seen).toHaveLength(0)
  })

  it('keeps an upstream failure distinct from an empty success', async () => {
    const failed = await executeZhihuStudy({ mode: 'observation', question: '谁在赚钱' }, client(url => {
      if (url.pathname.endsWith('/zhihu_search')) throw new Error('上游不可用')
      throw new Error('全网不可用')
    }))
    expect(failed.status).toBe('failed')
    expect(failed.evidence).toEqual([])
    expect(failed.failures).toHaveLength(2)
    expect(failed.failures.every(failure => failure.retried === false)).toBe(true)
    const failedText = renderZhihuStudy(failed)
    expect(failedText).toContain('检索失败')
    expect(failedText).not.toContain('上游没有返回条目')
    const empty = await executeZhihuStudy({ mode: 'observation', question: '谁在赚钱', sources: ['zhihu'] }, client(() => ({ Items: [], EmptyReason: '没有匹配' })))
    expect(empty.status).toBe('empty')
    expect(empty.failures).toEqual([])
    expect(renderZhihuStudy(empty)).toContain('上游没有返回条目')
  })

  it('does not treat one Zhihu hit, or a partial outage, as a full set of viewpoints', async () => {
    const thin = await executeZhihuStudy({ mode: 'observation', question: '谁在赚钱' }, client(url => url.pathname.endsWith('/zhihu_search')
      ? { Items: [item({ Url: 'https://www.zhihu.com/answer/1' })] }
      : { Items: [] }))
    expect(thin.status).toBe('insufficient_sources')
    expect(thin.sample).toMatchObject({ zhihu: 1, notPopulation: true })
    expect(renderZhihuStudy(thin)).toContain('来源不足')
    const partial = await executeZhihuStudy({ mode: 'observation', question: '谁在赚钱' }, client(url => {
      if (url.pathname.endsWith('/zhihu_search')) return { Items: [item({ Url: 'https://www.zhihu.com/answer/1' }), item({ Title: '另一说', Url: 'https://www.zhihu.com/answer/2' })] }
      throw new Error('全网超时')
    }))
    expect(partial.status).toBe('partial')
    expect(partial.evidence).toHaveLength(2)
    expect(renderZhihuStudy(partial)).toContain('失败')
    expect(renderZhihuStudy(partial)).not.toContain('上游没有返回条目')
  })

  it('stops at the budget and merges duplicate urls in a 30-day briefing', async () => {
    const seen: URL[] = []
    const result = await executeZhihuStudy({
      mode: 'briefing', question: '减肥药进展', queries: ['司美格鲁肽', 'GLP-1'], maxCalls: 2,
    }, client(url => ({
      Items: [
        item({ Title: '同一篇', Url: 'https://news.example.com/a?utm_medium=openapi', ContentText: '窗口内更新' }),
        item({ Title: '同一篇', Url: 'https://news.example.com/a', ContentText: '另一摘录' }),
        item({ Title: '旧闻', Url: 'https://news.example.com/old', EditTime: OUTSIDE }),
        item({ Title: '无日期', Url: 'https://news.example.com/undated', EditTime: undefined }),
        item({ Title: '坏时间', Url: 'https://news.example.com/bad', EditTime: '昨天' }),
      ],
      HasMore: false,
    }), seen))
    expect(seen).toHaveLength(2)
    expect(seen[0]?.pathname).toBe('/api/v1/content/global_search')
    expect(seen[0]?.searchParams.get('SearchDB')).toBe('realtime')
    expect(seen[0]?.searchParams.get('Filter')).toBe(`publish_time>=${WINDOW_START}`)
    expect(seen[1]?.searchParams.get('SortBy')).toBe(`EditTime:none:(${WINDOW_START},)`)
    expect(result.status).toBe('budget_exhausted')
    expect(result.stop.callsPlanned).toBe(4)
    expect(result.calls.filter(call => call.state === 'skipped')).toHaveLength(2)
    expect(renderZhihuStudy(result)).toContain('预算用尽')
    const merged = result.evidence.find(entry => entry.url.startsWith('https://news.example.com/a'))!
    expect(merged.excerpts).toEqual(['窗口内更新', '另一摘录'])
    expect(merged.sourceConflict).toBe(true)
    expect(merged.passedPublishFilter).toBe(true)
    expect(merged.eventTimeStatus).toBe('unverified')
    expect(result.groups).toEqual({
      publicationOrUpdate: [merged.id],
      outsideWindow: [result.evidence.find(entry => entry.title === '旧闻')!.id],
      undated: [
        result.evidence.find(entry => entry.title === '无日期')!.id,
        result.evidence.find(entry => entry.title === '坏时间')!.id,
      ],
    })
    expect(result.window).toMatchObject({ days: 30, basis: 'rolling_hours' })
    expect(result.evidence.find(entry => entry.title === '无日期')?.votes).toBeUndefined()
  })

  it('leaves an all-undated briefing out of the confirmed timeline', async () => {
    const result = await executeZhihuStudy({ mode: 'briefing', question: '减肥药进展', sources: ['zhihu'] }, client(() => ({
      Items: [item({ EditTime: undefined, VoteUpCount: undefined })],
    })))
    expect(result.status).toBe('insufficient_dates')
    expect(result.groups?.publicationOrUpdate).toEqual([])
    expect(result.groups?.undated).toHaveLength(1)
    expect(renderZhihuStudy(result)).toContain('窗口内缺少可核实时间')
    expect(renderZhihuStudy(result)).not.toContain('上游没有返回条目')
  })
})

describe('local study report', () => {
  const source = (id: string, extra: Record<string, unknown> = {}) => ({
    id, title: `来源${id}`, url: `https://example.com/${id}`, excerpt: '2026年11月1日公布了试验数据', ...extra,
  })
  const deepReport = {
    mode: 'deep', title: '空气净化器', question: '怎么选',
    sources: [source('spec', { excerpt: '标称风量见说明书', authority: '3', authorityMeaning: '高权威', editTime: String(INSIDE), editTimeMeaning: 'last_edit' })],
    deep: {
      findings: [{ text: '只能引用说明书里的风量。', sourceIds: ['spec'] }],
      assumptions: [{ text: '房间面积由用户自己填写。' }],
      disputes: [],
      interactive: [{
        id: 'cost', title: '面积乘以假设电价', outputLabel: '试算', outputUnit: '元', formula: 'area * price',
        inputs: [
          { id: 'area', label: '面积', min: 10, max: 40, step: 1, value: 20, unit: '平方米', provenance: { kind: 'assumption', text: '用户假设的房间面积' } },
          { id: 'price', label: '单价', min: 1, max: 5, step: 1, value: 2, unit: '元', provenance: { kind: 'source', sourceId: 'spec' } },
        ],
      }],
    },
  }

  it('evaluates only declared arithmetic', () => {
    expect(evaluateStudyFormula('area * price', { area: 20, price: 2 })).toBe(40)
    expect(() => evaluateStudyFormula('area * process.exit()', { area: 1 })).toThrow()
    const sandbox: { result?: number | null } = {}
    runInNewContext(`${STUDY_PAGE_SCRIPT}\nresult = zhihuStudyEvaluate('area * price', { area: 20, price: 2 })`, sandbox)
    expect(sandbox.result).toBe(40)
    expect(STUDY_PAGE_SCRIPT).not.toMatch(/\beval\b|\bFunction\b|fetch\(|XMLHttpRequest/)
  })

  it('writes an escaped interactive file and rejects unsourced numbers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhihu-study-'))
    const hostile = structuredClone(deepReport)
    hostile.title = '</title><script>alert(1)</script>'
    hostile.sources[0].title = '<img src=x onerror=alert(1)>'
    hostile.sources[0].excerpt = '</script><script>alert(1)</script>'
    const written = await writeZhihuStudyReport(directory, hostile, { now: NOW })
    const html = await readFile(written.html, 'utf8')
    expect(html.match(/<script/g)).toHaveLength(2)
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<img')
    expect(html).toContain('https://example.com/spec')
    expect(html).toContain(STUDY_REPORT_DISCLAIMERS.deep)
    expect(html).toContain('type="range"')
    expect(html).toContain('假设：用户假设的房间面积')
    expect(html).toContain("default-src 'none'")
    expect((await readdir(written.directory)).sort()).toEqual(['report.html', 'report.json', 'report.md'])
    const missing = structuredClone(deepReport)
    missing.deep.interactive[0].inputs[0].provenance = { kind: 'guess' }
    await expect(writeZhihuStudyReport(directory, missing, { now: NOW })).rejects.toThrow(/source 或 assumption|不能识别的字段/)
    expect((await readdir(directory)).filter(name => name.startsWith('zhihu-study-'))).toHaveLength(1)
  })

  it('rejects an evidence payload, a javascript link, and a single viewpoint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhihu-study-'))
    expect(() => validateZhihuStudyReport({ phase: 'evidence', finishedReport: false, mode: 'deep' })).toThrow(/不是成品报告/)
    const badLink = structuredClone(deepReport)
    badLink.sources[0].url = 'javascript:alert(1)'
    expect(() => validateZhihuStudyReport(badLink)).toThrow(/http/)
    expect(() => validateZhihuStudyReport({
      mode: 'observation', title: '出海', question: '谁在赚钱',
      sources: [source('one'), source('two')],
      observation: { currentState: [], progress: [], openQuestions: [], viewpoints: [{ id: 'only', text: '只有一说', sourceIds: ['one'] }] },
    })).toThrow(/至少要有两条/)
    expect(await readdir(directory)).toEqual([])
  })

  it('keeps event dates, publication times and missing dates apart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhihu-study-'))
    const report = {
      mode: 'briefing', title: '减肥药', question: '最近进展',
      sources: [
        source('trial', { excerpt: '2026年11月1日公布了试验数据', editTime: String(INSIDE), editTimeMeaning: 'publish_or_update' }),
        source('nodate', { excerpt: '日期没有写清', url: 'https://example.com/nodate' }),
      ],
      briefing: {
        confirmedEvents: [{ id: 'trial-event', title: '试验数据公布', sourceIds: ['trial'], eventOn: '2026-11-01', eventQuote: '2026年11月1日' }],
        publicationUpdates: [{ id: 'trial-post', title: '文章更新', sourceIds: ['trial'] }],
        undated: [{ id: 'missing', title: '日期不确定的转述', sourceIds: ['nodate'] }],
        nextChecks: [{ text: '核对原始公告。' }],
      },
    }
    const written = await writeZhihuStudyReport(directory, report, { now: NOW })
    const html = await readFile(written.html, 'utf8')
    const markdown = await readFile(written.markdown, 'utf8')
    expect(html).toContain(STUDY_REPORT_DISCLAIMERS.briefing)
    expect(html).toContain('2026-11-01')
    expect(html).toContain('日期不确定')
    expect(markdown).toContain('不是事件发生')
    const outside = structuredClone(report)
    outside.briefing.confirmedEvents[0].eventOn = '2020-01-01'
    outside.briefing.confirmedEvents[0].eventQuote = '2020年1月1日'
    outside.sources[0].excerpt = '2020年1月1日的旧闻'
    expect(() => validateZhihuStudyReport(outside, { now: NOW })).toThrow(/不在滚动窗口内/)
    const invented = structuredClone(report)
    invented.briefing.confirmedEvents[0].eventQuote = '下个月'
    expect(() => validateZhihuStudyReport(invented, { now: NOW })).toThrow(/摘录/)
    const undatedAsPublication = structuredClone(report)
    undatedAsPublication.briefing.publicationUpdates.push({ id: 'bad', title: '无时间', sourceIds: ['nodate'] })
    expect(() => validateZhihuStudyReport(undatedAsPublication, { now: NOW })).toThrow(/不能写入发布或更新/)
  })
})

describe('study routing', () => {
  it('registers three skills that point at the real tools', () => {
    const registered: string[] = []
    const ctx = {
      effect(setup: () => void) { setup() },
      skills: { register(skill: { name: string; content: string }) { registered.push(`${skill.name}:${skill.content}`) } },
    }
    applyStudy(ctx as unknown as Context)
    expect(registered.map(item => item.split(':')[0])).toEqual(ZHIHU_STUDY_SKILLS.map(skill => skill.name))
    expect(registered.join('\n')).toContain('zhihu_study')
    expect(registered.join('\n')).toContain('zhihu_study_report')
    expect(registered.join('\n')).not.toContain('developer-cdn.zhihu.com')
  })

  it('serves evidence through the service without marking it finished', async () => {
    const rows = new Map<string, ReturnType<ZhihuUsageTableLike['get']>>()
    const service = createZhihuService({
      fetcher: fetcher(() => ({ Items: [], EmptyReason: '没有匹配' })),
      env: { ZHIHU_ACCESS_TOKEN: 'fixture-token-only' },
    }, createZhihuUsageRecorder({ get: key => rows.get(key), async put(key, value) { rows.set(key, value) } }))
    const result = await service.call('study', { mode: 'deep', question: '问题', sources: ['zhihu'] }, new AbortController().signal)
    expect(result).toMatchObject({ ok: true, value: { phase: 'evidence', finishedReport: false, status: 'empty' } })
    await service.dispose()
  })
})
