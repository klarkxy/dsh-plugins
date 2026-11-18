/** Host-facing routes for the three study workflows. The tools do the retrieval and file export. */
export type ZhihuStudySkill = {
  name: string
  description: string
  whenToUse: string
  content: string
  source: 'runtime'
  invocation: { modelInvocable: true; userInvocable: true }
}

const SHARED = `
这些流程没有单独的官方研究接口。先调用 zhihu_study 取证，再由你综合，最后调用 zhihu_study_report 写入 report.md、report.json 和可打开的 report.html。

zhihu_study 的 phase 固定是 evidence，finishedReport 固定是 false。status 为 failed、budget_exhausted、insufficient_sources、insufficient_dates、cancelled 或 partial 时，必须说明失败、未执行的检索、缺日期或样本不足。不能把这些状态写成“没有资料”或已完成研究。empty 只表示上游成功返回了零条。

不要调用 zhihu_research 的 ask 充当原始来源。不要传 allowPaid、token 或密钥。一次 zhihu_study 最多 6 次上游检索；省略 maxCalls 时按计划调用，计划超过 6 次会在请求前拒绝。不要把同一次研究拆成多次调用累加。windowDays 最大是 30。每次上游请求仍走原有免费额度预查、北京时间日记录、未知映射拒绝和不自动重试。

导出时把同一次返回的 evidence 原样放进 zhihu_study_report。来源编号、链接、摘录、作者、赞同数和权威字段必须来自该结果。标为 source 的交互数字必须出现在对应摘录里；范围和解释可以是假设，但要写成 assumption。只读工作区会拒绝写文件。报告写在会话工作区的 zhihu-study 目录，不接受任意绝对路径。

摘录不是全文。全网 AuthorityLevel 只有 1、2、3、4 才有低/中/高/超高的官方含义。知乎站内的 AuthorityLevel 和 RankingScore 只在上游实际返回时保留，不套用那四档说明。HasMore 为真也没有公开翻页参数。
`.trim()

export const ZHIHU_STUDY_SKILLS: readonly ZhihuStudySkill[] = [
  {
    name: 'zhihu-deep-research',
    description: '把复杂问题拆开，用知乎和全网的有限检索做有出处的结论；数字要有来源或明确假设，并可导出本地交互报告。',
    whenToUse: '用户要把一个复杂问题拆开对照资料，或在有出处的数字上做可交互测算时使用。',
    source: 'runtime',
    invocation: { modelInvocable: true, userInvocable: true },
    content: `# 深度研究

${SHARED}

调用 zhihu_study，mode 为 deep。默认来源是知乎和全网。2 条子问题是 4 次调用，3 条是 6 次，都在单次上限内。不要一次提交 4 条，除非只保留一个来源。加入知识库后，子问题和来源相乘不能超过 6。全网检索使用现有 global_search，不新增端点。

你负责综合：发现和争议指向取证编号。没有 multiAngle 时，不要声称已经做过多角度研究。性能、价格、寿命要么能在摘录里找到对应数字，要么写成 assumption。插件不提供默认 CADR 或五年费用。

然后调用 zhihu_study_report，带上这次 evidence。把返回的 html 路径交给用户。`,
  },
  {
    name: 'zhihu-observation',
    description: '整理一个话题的现状、进展和并列观点，每条观点追到原文，并标明这只是检索样本。',
    whenToUse: '用户想知道各方怎么看一个话题，并要对照原文而不是一个全民结论时使用。',
    source: 'runtime',
    invocation: { modelInvocable: true, userInvocable: true },
    content: `# 知乎观察

${SHARED}

调用 zhihu_study，mode 为 observation。默认检索知乎和全网。知乎条目不足两条时 status 会是 insufficient_sources 或 empty，不要补写成共识。

报告里的现状、进展和观点都要有 sourceIds。至少两个观点、至少两个不同来源。作者和赞同数只使用证据里实际出现的字段。导出的页面会固定写明这是样本而不是知乎全体用户的看法。`,
  },
  {
    name: 'zhihu-recent-briefing',
    description: '按滚动近 30 天整理动态，合并重复，分开事件日期和发布或更新时间，缺日期单独标出。',
    whenToUse: '用户要某个主题最近大约 30 天的动态，并要区分发布时间、更新时间和事件时间时使用。',
    source: 'runtime',
    invocation: { modelInvocable: true, userInvocable: true },
    content: `# 近况速览

${SHARED}

调用 zhihu_study，mode 为 briefing。默认窗口是从当前时间倒推的 30 个滚动日，不能加大。全网调用使用 SearchDB realtime 和 publish_time 过滤，然后用知乎 EditTime 做解释。这两处时间都不是事件发生时间。

groups.publicationOrUpdate 只是窗口内的条目时间。groups.undated 和 outsideWindow 不能写进已确认事件。没有 since 时不要声称哪些是相对上次阅读的新增。

写入报告时，confirmedEvents 的日期必须能在来源摘录里逐字找到；对不上就放进 undated。相同标题和日期要合并后再提交。`,
  },
]
