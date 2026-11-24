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
按三步完成研究与导出：
1. 调用 zhihu_study 采集有预算的检索证据（phase 固定为 evidence，finishedReport 固定为 false）。单次研究在同一次调用内完成，上限 6 次上游检索；原始证据仅使用站内、全网及可选知识库来源，仅在免费额度内执行，并在 windowDays ≤ 30 的范围内请求。
2. 基于返回的 evidence 综合分析，如实呈现检索 status：failed、budget_exhausted、insufficient_sources、insufficient_dates、cancelled 或 partial 需说明具体原因与未覆盖范围；empty 表示上游成功检索但命中为零。
3. 在可写工作区下调用 zhihu_study_report，原样附带本次返回的 evidence，将 report.md、report.json 与可打开的 report.html 导出到会话工作区的 zhihu-study 目录。

出处与数值规范：
- 所有来源编号、链接、摘录、作者、赞同数及权威字段均逐字源自本次 evidence；摘录为片段预览。
- 标为 source 的数值须在对应引文中同时包含量名、数字与紧邻单位；估算值与区间标为 assumption，单位换算标为 conversion 并写明原文数值、系数与量纲说明（例如 20 平方米 ÷ 2 元 = 10 平方米/元）。
- 全网 AuthorityLevel 的 1–4 对应官方低/中/高/超高四档；知乎站内的 AuthorityLevel 与 RankingScore 仅在上游返回时原样保留。
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

调用 zhihu_study（mode 设为 deep），默认检索知乎与全网。传入 2 到 3 条子问题时，双来源合计 4 到 6 次请求，正好落在单次上限内；若同时加入知识库或扩展为 4 条子问题，保持子问题数 × 来源数不超过 6。全网检索沿用现有 global_search。

综合撰写时，将每条发现与争议关联到对应 evidence 编号；仅在 coverage.multiAngle 为 true 时表述为多角度研究。所有性能、价格、寿命等参数均须明确标注来自摘录引文（source）或作为 assumption 列出。随后调用 zhihu_study_report 原样附带本次 evidence，并将返回的 html 路径提供给用户。`,
  },
  {
    name: 'zhihu-observation',
    description: '整理一个话题的现状、进展和并列观点，每条观点追到原文，并标明这只是检索样本。',
    whenToUse: '用户想了解某个话题的多方观点并逐条对照原文出处时使用。',
    source: 'runtime',
    invocation: { modelInvocable: true, userInvocable: true },
    content: `# 知乎观察

${SHARED}

调用 zhihu_study（mode 设为 observation），默认检索知乎与全网。当知乎命中少于两条时，如实依据返回的 insufficient_sources 或 empty 说明样本有限。

报告中的现状、进展和观点须附带 sourceIds，至少包含两条观点及两个独立来源；作者与赞同数仅在证据返回时展示，并明确标注结论基于本次检索样本。`,
  },
  {
    name: 'zhihu-recent-briefing',
    description: '按滚动近 30 天整理动态，合并重复，分开事件日期和发布或更新时间，缺日期单独标出。',
    whenToUse: '用户要某个主题最近大约 30 天的动态，并要区分发布时间、更新时间和事件时间时使用。',
    source: 'runtime',
    invocation: { modelInvocable: true, userInvocable: true },
    content: `# 近况速览

${SHARED}

调用 zhihu_study（mode 设为 briefing），窗口为当前时间倒推的滚动近 30 天（windowDays ≤ 30）。全网检索使用 SearchDB realtime 与 publish_time 过滤，知乎站内结合 EditTime 辅助解释，两类时间戳均表示发布或编辑时间。

写入报告时，将重复标题与日期合并整理；confirmedEvents 仅收录摘录引文中逐字出现日期的事件，groups.publicationOrUpdate 归入 publicationUpdates，缺日期或窗口外条目归入 undated。仅在请求传入 since 时标注相对新增。`,
  },
]
