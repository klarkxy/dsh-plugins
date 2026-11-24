import '../tests/legacy-call-policy.ts'
import { mkdtemp, readdir, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createZhihuResearchTool } from './tool-definitions.ts'
import { compileZhihuGlobalFilter } from './operations.ts'
import { executeZhihuStudy, renderZhihuStudy, ZHIHU_GLOBAL_AUTHORITY_LEGEND, zhihuStudyWindow } from './study.ts'
import { STUDY_PAGE_SCRIPT, STUDY_REPORT_DISCLAIMERS, createZhihuStudyReportTool, evaluateStudyFormula, validateZhihuStudyReport, writeZhihuStudyReport } from './study-report.ts'
import { ZHIHU_STUDY_SKILLS } from './study-skill.ts'
import * as studyPlugin from './study-plugin.ts'
import * as toolsPlugin from './tools.ts'
import { createZhihuService } from './index.ts'
import { createZhihuUsageRecorder, type ZhihuUsageTableLike } from './usage.ts'
import type { ZhihuSearchFetcher } from './zhihu-client.ts'

const NOW = Date.parse('2026-11-18T04:00:00Z')
const STUDY_WINDOW = zhihuStudyWindow(NOW, 30)
const FILTER_START = Math.floor(Date.parse(STUDY_WINDOW.start) / 1000)
const INSIDE = Math.floor(NOW / 1000) - 86_400
const OUTSIDE = Math.floor(Date.parse('2026-10-18T12:00:00+08:00') / 1000)

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
    expect(seen[0]?.searchParams.get('Filter')).toBe(`publish_time>=${FILTER_START}`)
    expect(seen[1]?.searchParams.get('SortBy')).toBe(`EditTime:none:(${FILTER_START},)`)
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
    expect(result.window).toMatchObject({ days: 30, basis: 'shanghai_calendar_day', startDate: '2026-10-19', endDate: '2026-11-18' })
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
  const evidenceFor = (mode: string, question: string, items: Array<Record<string, unknown>>, window = mode === 'briefing' ? STUDY_WINDOW : undefined) => ({
    version: 1, phase: 'evidence', finishedReport: false, mode, question,
    stop: { budgetApplied: 2, callsUsed: 2 }, evidence: items, ...(window ? { window } : {}),
  })
  const deepReport = {
    mode: 'deep', title: '空气净化器', question: '怎么选',
    evidence: evidenceFor('deep', '怎么选', [{
      id: 'e1', url: 'https://example.com/spec', excerpts: ['说明书给出的单价是2元，不是面积'],
      authority: '3', authorityMeaning: '高权威', editTime: String(INSIDE), editTimeMeaning: 'last_edit',
    }]),
    sources: [source('e1', { url: 'https://example.com/spec', excerpt: '单价是2元', authority: '3', authorityMeaning: '高权威', editTime: String(INSIDE), editTimeMeaning: 'last_edit' })],
    deep: {
      findings: [{ text: '只能引用说明书里的单价。', sourceIds: ['e1'] }],
      assumptions: [{ text: '房间面积由用户自己填写。' }],
      disputes: [],
      interactive: [{
        id: 'cost', title: '面积除以单价', outputLabel: '试算', outputUnit: '平方米/元', formula: 'area / price',
        inputs: [
          { id: 'area', label: '面积', min: 10, max: 40, step: 1, value: 20, unit: '平方米', provenance: { kind: 'assumption', text: '用户假设的房间面积' } },
          { id: 'price', label: '单价', min: 1, max: 5, step: 1, value: 2, unit: '元', provenance: { kind: 'source', sourceId: 'e1', quote: '单价是2元' } },
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
    hostile.sources[0].excerpt = '单价是2元</script><script>alert(1)</script>'
    hostile.evidence.evidence[0].excerpts = [hostile.sources[0].excerpt]
    const written = await writeZhihuStudyReport(hostile, { workspaceRoot: directory })
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
    const unsourced = structuredClone(deepReport)
    unsourced.deep.interactive[0].inputs[1].max = 100
    unsourced.deep.interactive[0].inputs[1].value = 99
    expect(() => validateZhihuStudyReport(unsourced)).toThrow(/量名、数字和紧挨着的单位/)
    const people = structuredClone(deepReport)
    people.evidence.evidence[0].excerpts = ['说明书给出的单价是2元，不是面积']
    people.sources[0].excerpt = '说明书给出的单价是2元，不是面积'
    people.deep.interactive[0].inputs[1] = { id: 'price', label: '人数', min: 1, max: 5, step: 1, value: 2, unit: '人', provenance: { kind: 'source', sourceId: 'e1', quote: '单价是2元，不是面积' } }
    expect(() => validateZhihuStudyReport(people)).toThrow(/量名、数字和紧挨着的单位/)
    const chapter = structuredClone(deepReport)
    chapter.evidence.evidence[0].excerpts = ['第2章只是序号']
    chapter.sources[0].excerpt = '第2章只是序号'
    chapter.deep.interactive[0].inputs[1].provenance = { kind: 'source', sourceId: 'e1', quote: '第2章只是序号' }
    expect(() => validateZhihuStudyReport(chapter)).toThrow(/量名、数字和紧挨着的单位/)
    const converted = structuredClone(deepReport)
    converted.deep.interactive[0].inputs[1] = {
      id: 'price', label: '单价', min: 0.5, max: 5, step: 0.5, value: 1, unit: '美元',
      provenance: { kind: 'conversion', sourceId: 'e1', quote: '单价是2元', original: 2, originalUnit: '元', factor: 0.5, note: '示例假设汇率，不是摘录里的美元价格' },
    }
    converted.deep.interactive[0].outputUnit = '平方米/美元'
    expect(validateZhihuStudyReport(converted).deep?.interactive[0]?.outputUnit).toBe('平方米/美元')
    const wrongUnit = structuredClone(deepReport)
    wrongUnit.deep.interactive[0].outputUnit = '元'
    expect(() => validateZhihuStudyReport(wrongUnit)).toThrow(/平方米\/元/)
    const missing = structuredClone(deepReport)
    missing.deep.interactive[0].inputs[0].provenance = { kind: 'guess' }
    await expect(writeZhihuStudyReport(missing, { workspaceRoot: directory })).rejects.toThrow(/source、assumption 或 conversion/)
    expect(await readdir(join(directory, 'zhihu-study'))).toHaveLength(1)
  })

  it('rejects an evidence payload, a javascript link, and a single viewpoint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhihu-study-'))
    expect(() => validateZhihuStudyReport({ phase: 'evidence', finishedReport: false, mode: 'deep' })).toThrow(/不是成品报告/)
    const badLink = structuredClone(deepReport)
    badLink.sources[0].url = 'javascript:alert(1)'
    expect(() => validateZhihuStudyReport(badLink)).toThrow(/http/)
    expect(() => validateZhihuStudyReport({
      mode: 'observation', title: '出海', question: '谁在赚钱',
      evidence: evidenceFor('observation', '谁在赚钱', [
        { id: 'one', url: 'https://example.com/one', excerpts: ['2026年11月1日公布了试验数据'] },
        { id: 'two', url: 'https://example.com/two', excerpts: ['2026年11月1日公布了试验数据'] },
      ]),
      sources: [source('one'), source('two')],
      observation: { currentState: [], progress: [], openQuestions: [], viewpoints: [{ id: 'only', text: '只有一说', sourceIds: ['one'] }] },
    })).toThrow(/至少要有两条/)
    expect(await readdir(directory)).toEqual([])
  })

  it('keeps event dates, publication times and missing dates apart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhihu-study-'))
    const report = {
      mode: 'briefing', title: '减肥药', question: '最近进展',
      evidence: evidenceFor('briefing', '最近进展', [
        { id: 'trial', url: 'https://example.com/trial', excerpts: ['2026年11月1日公布了试验数据'], editTime: String(INSIDE), editTimeMeaning: 'publish_or_update' },
        { id: 'nodate', url: 'https://example.com/nodate', excerpts: ['日期没有写清'] },
      ]),
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
    const written = await writeZhihuStudyReport(report, { workspaceRoot: directory })
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
    outside.evidence.evidence[0].excerpts = ['2020年1月1日的旧闻']
    expect(() => validateZhihuStudyReport(outside)).toThrow(/不在取证窗口内/)
    const invented = structuredClone(report)
    invented.briefing.confirmedEvents[0].eventQuote = '下个月'
    expect(() => validateZhihuStudyReport(invented)).toThrow(/摘录/)
    const undatedAsPublication = structuredClone(report)
    undatedAsPublication.briefing.publicationUpdates.push({ id: 'bad', title: '无时间', sourceIds: ['nodate'] })
    expect(() => validateZhihuStudyReport(undatedAsPublication)).toThrow(/不能写入发布或更新/)
  })
})

describe('study routing', () => {
  it('registers three skills that point at the real tools', () => {
    const registered: string[] = []
    const ctx = {
      effect(setup: () => void) { setup() },
      skills: { register(skill: { name: string; content: string }) { registered.push(`${skill.name}:${skill.content}`) } },
    }
    studyPlugin.apply(ctx as unknown as Context)
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
    const filtered = await service.call('global.search', { query: '净化器', searchDb: 'realtime', host: 'example.com', publishTime: 1778494631 }, new AbortController().signal)
    expect(filtered.ok).toBe(true)
    await service.dispose()
  })

  it('keeps skill routes unloaded until skills exists, without blocking the tools', async () => {
    const names: string[] = []
    const skills: string[] = []
    const ctx = new Context()
    const provide = ctx.provide.bind(ctx) as (name: string, value: unknown) => void
    provide('zhihu', { run: async (execute: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) => execute(signal), toolOptions: {} })
    provide('tools', { register(tool: { name: string }) { names.push(tool.name); return () => {} } })
    const toolsFiber = ctx.plugin(toolsPlugin)
    const studyFiber = ctx.plugin(studyPlugin)
    await toolsFiber
    expect(studyFiber.state).toBe(0)
    expect(names).toEqual(expect.arrayContaining(['zhihu_study', 'zhihu_study_report']))
    expect(skills).toEqual([])
    provide('skills', { register(skill: { name: string }) { skills.push(skill.name); return () => {} } })
    await studyFiber
    expect(studyFiber.state).toBe(2)
    expect(skills).toEqual(ZHIHU_STUDY_SKILLS.map(skill => skill.name))
    await ctx.fiber.dispose()
  })
})

describe('study plan and fixed window', () => {
  const client = (seen: URL[] = []) => ({
    fetcher: fetcher(() => ({ Items: [item()], HasMore: false }), seen),
    env: { ZHIHU_ACCESS_TOKEN: 'primarytoken1' }, now: NOW,
  })

  it('finishes three default deep queries and rejects four before any request', async () => {
    const seen: URL[] = []
    const done = await executeZhihuStudy({ mode: 'deep', question: '怎么选', queries: ['甲', '乙', '丙'] }, client(seen))
    expect(seen).toHaveLength(6)
    expect(done.status).not.toBe('budget_exhausted')
    expect(done.stop).toMatchObject({ callsPlanned: 6, callsUsed: 6, budgetApplied: 6, budgetRequested: null })
    const blocked: URL[] = []
    await expect(executeZhihuStudy({ mode: 'deep', question: '怎么选', queries: ['甲', '乙', '丙', '丁'] }, client(blocked))).rejects.toThrow(/超出单次上限/)
    expect(blocked).toHaveLength(0)
  })

  it('keeps the boundary Shanghai day and does not move the window at export', async () => {
    const boundary = Math.floor(Date.parse('2026-10-19T01:00:00+08:00') / 1000)
    const result = await executeZhihuStudy({ mode: 'briefing', question: '最近进展', sources: ['zhihu'] }, {
      ...client(), now: NOW,
      fetcher: fetcher(() => ({ Items: [item({ Title: '边界', EditTime: boundary, ContentText: '2026年10月19日下午公布' })] })),
    })
    expect(result.groups?.publicationOrUpdate).toEqual(['e1'])
    expect(result.evidence[0]?.inWindow).toBe(true)
    const report = {
      mode: 'briefing', title: '近况', question: '最近进展', evidence: result,
      sources: [{ id: 'e1', title: '边界', url: result.evidence[0]!.url, excerpt: '2026年10月19日下午公布', editTime: String(boundary), editTimeMeaning: 'publish_or_update' }],
      briefing: {
        confirmedEvents: [{ id: 'event', title: '公布', sourceIds: ['e1'], eventOn: '2026-10-19', eventQuote: '2026年10月19日' }],
        publicationUpdates: [{ id: 'post', title: '更新', sourceIds: ['e1'] }],
        undated: [], nextChecks: [],
      },
    }
    expect(validateZhihuStudyReport(report).briefing?.windowStart).toBe(result.window?.start)
    expect(zhihuStudyWindow(NOW + 3 * 86_400_000, 30).startDate).not.toBe(result.window?.startDate)
    expect(() => validateZhihuStudyReport({ ...report, briefing: { ...report.briefing, confirmedEvents: [{ id: 'early', title: '更早', sourceIds: ['e1'], eventOn: '2026-10-18', eventQuote: '2026年10月18日' }] } })).toThrow(/不在取证窗口内/)
    const drifted = structuredClone(result)
    drifted.window = { ...result.window!, days: 1, start: '2010-01-01T00:00:00.000Z' }
    expect(() => validateZhihuStudyReport({ ...report, evidence: drifted })).toThrow(/不能互相矛盾/)
    expect(validateZhihuStudyReport(report).briefing?.windowStart).not.toContain('2010')
  })

  it('rejects a source or sourced number that the evidence does not contain', () => {
    const forged = structuredClone({
      mode: 'deep', title: '题', question: '怎么选',
      evidence: { version: 1, phase: 'evidence', finishedReport: false, mode: 'deep', question: '怎么选', stop: { budgetApplied: 1, callsUsed: 1 }, evidence: [] },
      sources: [{ id: 'e9', title: '假', url: 'https://example.com/fake', excerpt: '没检索过' }],
      deep: { findings: [{ text: '假结论', sourceIds: ['e9'] }], assumptions: [], disputes: [], interactive: [] },
    })
    expect(() => validateZhihuStudyReport(forged)).toThrow(/不在这次取证结果里/)
  })

  it('refuses a read-only workspace and a symlinked root before writing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhihu-workspace-'))
    const outside = await mkdtemp(join(tmpdir(), 'zhihu-outside-'))
    await expect(writeZhihuStudyReport({ mode: 'deep' }, { workspaceRoot: directory, readOnly: true })).rejects.toThrow(/只读/)
    expect(await readdir(directory)).toEqual([])
    const link = join(directory, 'linked')
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(writeZhihuStudyReport({ mode: 'deep' }, { workspaceRoot: link })).rejects.toThrow(/符号链接/)
    expect(await readdir(outside)).toEqual([])
    const signal = new AbortController().signal
    for (const policy of [undefined, { workspaceRoot: directory, mode: 'read-only' }, { workspaceRoot: directory, mode: 'mystery' }, { mode: 'workspace-write' }]) {
      const tool = createZhihuStudyReportTool(() => policy)
      await expect(tool.execute({ report: { mode: 'deep' } }, { signal, agent: { session: {} } } as never)).rejects.toThrow(/可写工作区/)
    }
    expect(await readdir(directory)).toEqual(['linked'])
  })
})
