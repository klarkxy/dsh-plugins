# 知乎

<!-- release-state-note -->

简体中文 / [English](README.en.md)

把知乎接入 DeepSeek Harness 作为调研信源与草稿工具：支持站内/全网搜索、热榜、知乎直答、知识库、问题推荐与创作统计，并支持保存、校验草稿与上传配图。每次请求仅使用你自己的知乎凭据，返回内容仅供调研参考。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

把 `web` 换成你的 profile 名并重启 DSH Web。请务必使用完整的 scoped 包名 `@klarkxy/dsh-zhihu`（无 scope 的 `dsh-zhihu` 属于其他维护者）。

## 使用

打开「设置 → 知乎」，页面包含五个页签：

- **设置**：填写检索与账号查询用的 `Access Secret`、草稿同步用的发布助手 `App Key` / `App Secret`，并查看当前调用保护状态。
- **统计**：查看本机记录的每日调用次数、失败次数与返回结果条数。
- **官方用量**：查询知乎开放平台返回的各接口剩余免费额度。
- **知识库**：查看知乎知识库并上传参考资料（单文件最大 20 MB），供模型检索引用；文件会上传至知乎云端，请勿上传未发表手稿。
- **测试**：手动执行站内搜索、全网搜索、知乎热榜、知识库检索、知乎直答（可展开思考过程）以及问题推荐、回答摘要、本人创作详情/评论和创作数据，并支持检查或复制结构化返回数据。

同时安装网页搜索插件（`@klarkxy/dsh-web-search-manager`）后，「知乎全网搜索」也会出现在其搜索后端列表中。

## 草稿与配图

- 在「设置 → 知乎 → 设置」中填写发布助手凭据，可从[知乎同步助手](https://www.zhihu.com/playground/zhihu-publisher)获取；它们与检索用的 `Access Secret` 互相独立。
- 支持将知乎提供的整段授权说明直接粘贴进 `App Secret` 输入框（包含 `ZHIHU_OPENAPI_APP_KEY:"…"` 与 `ZHIHU_OPENAPI_APP_SECRET:"…"` 两项），插件会自动提取并仅保存这两项凭据（可点击「保存两项」一次写入）。
- 配置后，`zhihu_sync` 工具可保存、列出、读取并校验文章（`article`）、提问（`question`）或想法（`pin`）草稿，并上传草稿配图；草稿在重启 DSH 后仍保留。插件仅负责草稿准备、校验与配图上传，正式发布请在知乎端完成。

## 让模型使用

以下模型工具默认在 Agent 预设中启用：

| 工具 | 操作与用途 |
| --- | --- |
| `zhihu_research` | 单次检索：`search`（站内搜索）、`global_search`（全网搜索，可选 `SearchDB` 与结构化 `host` / `publishTime` 过滤）、`hot_list`（知乎热榜）、`ask`（知乎直答）、`knowledge_search`（知识库检索） |
| `zhihu_study` | 有预算的取证：`deep`（深度研究）、`observation`（知乎观察）、`briefing`（近况速览）。只返回证据，不是成品报告 |
| `zhihu_study_report` | 把宿主综合后的结构写成 `report.md`、`report.json` 和可打开的单文件 `report.html` |
| `zhihu_account` | 账号与创作：`question_recommendations`（问题推荐）、`question_answers`（回答摘要，非全文）、`content_detail`（本人创作全文）、`content_comments`（本人创作评论）、`creator_account_stats`（账号创作数据）、`creator_content_stats`（单篇创作数据）、`quota`（官方每日免费额度） |
| `zhihu_sync` | 草稿与配图：`list`（列出草稿）、`get`（读取草稿）、`save`（保存/更新草稿）、`prepare`（校验草稿）、`upload_image`（上传配图） |

站内搜索与全网搜索无匹配结果时返回空列表；上游提供说明原因时会一并展示。

宿主若提供 skills 服务，还会注册三条路由：`zhihu-deep-research`、`zhihu-observation`、`zhihu-recent-briefing`。它们只说明何时取证、如何综合、何时导出；检索和写文件仍由上面的工具完成。

## 深度研究、知乎观察、近况速览

这三项没有单独的官方接口，也不是三段提示词。插件用已经接入的站内搜索、全网搜索和可选知识库检索组合成有上限的取证，再由宿主综合，最后导出本地报告。知乎直答不作为原始来源。实现是独立编写的，不包含官方 skill、渲染脚本或版式。

### 入口

1. 调用 `zhihu_study`。`deep` 应自行传入 2 到 4 条拆解后的 `queries`；省略时只检索原问题，并在结果里标明没有拆解。`observation` 默认同时查知乎和全网。`briefing` 默认从当前时间倒推 30 个滚动日，全网使用 `SearchDB=realtime` 和 `publish_time` 过滤，知乎使用 `EditTime` 范围过滤。
2. 阅读返回的 `phase: "evidence"`。`finishedReport` 恒为 `false`。
3. 由宿主写成报告结构，调用 `zhihu_study_report`，并传入用户能够打开的绝对 `directory`。
4. 把返回的 `html` 路径交给用户。同目录还有 `report.md` 和 `report.json`。页面不加载外部资源。

### 输入和输出

`zhihu_study` 接收 `mode`、`question`，以及可选的 `queries`、`sources`、`maxCalls`、`windowDays`、`since`。知识库只有在 `sources` 显式包含 `knowledge` 时才会检索。返回状态、调用计划、失败、证据摘录、局限和给宿主的综合约束。

`zhihu_study_report` 接收综合后的 `report`。深度研究可以带交互块；知乎观察要有至少两条追到不同来源的观点；近况要分开已确认事件、发布或更新、日期不确定。校验失败时不写文件。

### 费用和边界

每次上游请求仍先查询该接口的官方免费额度，沿用本地北京时间日记账、未知映射拒绝、显式 `allowPaid` 和不自动重试。研究工具不能接收付费开关或凭据，也不能把 `maxCalls` 提高到 6 以上，或把 `windowDays` 提高到 30 以上。一次研究会按计划发出多次请求，因此可能消耗多次额度；额度以当时官方返回为准，插件不写死试用次数或价格。全网 `Filter` 只接受结构化的站点和发布时间，不接受原始表达式，也不能把 `zhihu.com` 当作站点。

失败、预算用尽、来源不足、缺日期和取消都会以独立状态返回。它们不是空结果。`empty` 只表示上游成功返回了零条。

### 采样、日期和宿主职责

返回条目是摘录，不是全文，也不是该主题的完整样本。`HasMore` 为真时也没有公开的翻页参数。知乎观察的样本不能写成知乎全体用户的共识；作者和赞同数只在上游实际返回时保留。

全网 `AuthorityLevel` 为 `1`、`2`、`3`、`4` 时才标注低、中、高、超高。知乎站内的 `AuthorityLevel` 和 `RankingScore` 只保留上游原值，不套用这四档说明，也不补造分数。

全网 `EditTime` 是最后编辑时间，知乎 `EditTime` 是发布或更新时间。两者都不是事件发生时间。`publish_time` 过滤同样不是事件发生证明。缺时间、无法解析或互相冲突的条目不会进入已确认时间线。事件日期必须能在来源摘录里找到，否则只能放在日期不确定一节。

交互滑杆的每个数字都必须带回来源编号或明确假设。插件不提供默认风量、价格或寿命，也不计算未声明的公式。宿主负责结论、并列解释和影响；导出工具负责校验、转义和写文件。自动化测试覆盖的是这些契约，不是模型综合质量。

## 费用保护

- 检索与开放平台查询默认仅使用知乎官方免费额度：每次请求前都会预查对应接口的剩余免费额度，确认仍有额度才会发出请求（不另设本地每日次数上限）。
- 付费调用默认关闭，仅当你自己在插件配置中将 `allowPaid` 设为 `true`（或通过环境变量显式开启）时才允许：

```yaml
config:
  allowPaid: false
```

未确认官方计费规则的能力即使开启 `allowPaid` 也仅允许使用已确认的免费额度。

## 主要限制

- 同一知乎账号下的其他客户端可能在两次官方额度检查之间消耗免费额度；本机统计不等于官方账单。
- 知识库上传文件存储在知乎云端，经设置页上传单文件上限为 20 MB；草稿配图同样上传至知乎。
- 草稿仅支持文章、提问与想法；图片仅支持 JPEG、PNG、GIF、WebP 与 BMP（GIF 上限 15 MB，其他格式上限 30 MB；不内置转码，HEIC/AVIF 请先转换格式后再上传）。
- 草稿与配图使用发布助手凭据，独立于搜索额度与 `allowPaid` 开关；模型工具仅支持保存、校验草稿与上传配图，不能直接发布。
- 每次请求单次执行，不做自动重试。
- 仅使用当前 `Access Secret` 访问对应账号，不支持 OAuth 账号切换、余额充值、钱包查询，也不包含在 DSH 内直接发布草稿。

## 许可证

[SATA License 2.1](LICENSE)
