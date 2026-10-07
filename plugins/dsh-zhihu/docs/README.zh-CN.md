# @klarkxy/dsh-zhihu

把知乎交给模型当调研信源：站内搜索、全网搜索、热榜、直答和公开知识库，外加问题发现、创作数据与用量统计。每次请求都只用你自己的知乎 Access Secret，取回的内容是给模型参考的资料，不是定论。

[English](../README.md)

需要 Node.js ≥22、DSH `0.1.7-rc.2`，无需构建本仓库。

## 安装

把已发布包装进目标 profile：

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

把 `web` 换成你的 profile 名。重启 DSH Web，从「插件」打开「知乎（@klarkxy/dsh-zhihu）」填写 Access Secret（DSH 凭据 `ZHIHU_ACCESS_TOKEN`）。请使用完整 scoped 包名；无 scope 的 `dsh-zhihu` 属于其他维护者。卸载用 `dsh plugin --profile web remove @klarkxy/dsh-zhihu`。

## 使用

「插件 → 知乎（@klarkxy/dsh-zhihu）」下有设置、统计、官方用量、知识库和「测试」分区。「测试」通过一个功能选择框统一选择搜索、问题与创作查询，按所选功能显示对应参数和结果，覆盖问题推荐、回答摘要、本人已发布内容及评论、账号和单篇创作统计。「统计」展示本机记录的每日调用、失败和结果条数；独立的「官方用量」页签在打开时和手动刷新时查询全部官方额度项，以图表和数值展示，不显示原始 JSON。知乎未返回的总量或已用量不自行推算，不同接口类别的数据也不相加。「测试」只保留业务查询，均需手动点击。所有请求都不会自动重试或翻页。原有模型工具和共享 RPC 仍可使用。

## 模型工具

模型需要使用知乎工具时，在所用 `agent.cordis.yml` 的插件列表加入：

```yaml
- name: '@klarkxy/dsh-zhihu/tools'
```

加入后，模型可使用十二个工具。原有五个工具保持兼容：

- `zhihu_search`：知乎站内搜索，拉取社区证据；结果仅作社区/读者反馈参考，不构成 canon，也不直接写入项目文件。
- `zhihu_global_search`：知乎开放平台全网搜索，检索站外公开网页资料；仅作参考。
- `zhihu_hot_list`：拉取知乎热榜，了解当前社区热点；仅作题材与热点参考。
- `zhihu_ask`：调用知乎直答（OpenAI 兼容的 AI 问答），基于知乎社区内容生成综合回答；适合考据与背景调研。
- `zhihu_knowledge_search`：检索知乎知识库（RAG 片段），默认只查公开库；在知乎网页端上传过个人资料后可加个人/订阅召回范围。

### 问题发现与创作能力

对齐 [zhihu-search PR #4](https://github.com/klarkxy/zhihu-search/pull/4) 和主库 `main` 的 `62fd3ce5c5761dd217094280390b394e4eb77ed2`（2026-09-28）。以下新增接口**只使用当前 Access Secret**，不接受 OAuth 身份切换，模型参数中不暴露密钥。

| 模型工具 | `/zhihu` 上的 RPC 端点 | 参数 | 官方额度分类 |
| --- | --- | --- | --- |
| `zhihu_question_recommendations` | `question.recommendations` | 可选 `query`；`count` 1–20，默认 5 | `creator` |
| `zhihu_question_answers` | `question.answers` | `questionUrl`；`offset`、`limit` | `question_answers` |
| `zhihu_user_content_detail` | `content.detail` | `contentUrl` | `creator` |
| `zhihu_user_content_comments` | `content.comments` | `contentUrl`；`offset`、`limit`；`order` 为 `score`（默认）、`reverse`、`ascending` | `creator` |
| `zhihu_creator_account_stats` | `creator.account.stats` | `contentType` 为 `all`（默认）、`answer`、`article`、`pin`、`zvideo`；成对日期 | `creator` |
| `zhihu_creator_content_stats` | `creator.content.stats` | `contentUrl`；成对日期 | `creator` |
| `zhihu_quota` | `quota` | 可选 `apiIds` 数组，省略或 `[]` 查全部 | 不消耗业务额度 |

RPC 还接受主库风格的下划线别名：`question_recommendations`、`question_answers`、`content_detail`、`content_comments`、`creator_account_stats`、`creator_content_stats`，以及 `user_content_detail` / `user_content_comments`。参数名仍使用表中的 camelCase。

省略 `query` 才按当前账号画像推荐；显式空字符串或纯空白主题会被拒绝。推荐不分页。`questionUrl` 必须是 HTTPS `www.zhihu.com/question/{id}` 问题链接。`contentUrl` 仅支持知乎回答、专栏文章、想法或视频链接；创作接口仅查询当前账号已发布的内容，视频仅返回关联正文，不返回视频文件。

分页工具的 `offset` 使用非负 Int64 **十进制字符串**，默认 `"0"`；RPC 也接受 JavaScript 安全整数。`limit` 为 1–50 的整数，默认 20。每次只取一页，只有 `paging.canContinue=true` 才原样使用其 `nextOffset` 继续。空页或条目不足不能视为结束；`NextOffset` 缺失、无效、未前进或为不安全的数值时，返回警告并停止翻页，不按条目数补偏移。`Totals` 可能包含被过滤的回答；`Summary` 是上游摘要/截取文本，不是全文，也不是额外生成的 AI 摘要。评论附带的 `Children` 不保证完整。

统计日期 `startDate` / `endDate` 必须同时提供或同时省略，格式为有效公历 `YYYY-MM-DD`，结束日期不得早于开始日期。省略时采用上游默认范围，不自行指定天数。缺失指标不补零，比例不换算百分比。新增结果包含 `version`、`operation`、`data`、可选 `quotaId` 与安全分页信息 `paging`。结构化 `data` 保留上游字段及原始 HTML；工具展示清洗 HTML 后放入不会执行的文本代码块。缺少或为空的 `Body` 不能视为全文。

### 官方额度与本地用量

`zhihu_quota` 调用 `GET /api/v1/quota`，是官方剩余额度的唯一来源。`apiIds` 白名单为 `global_search`、`zhihu_search`、`hot_list`、`question_answers`、`zhida_openai`、`tools`、`knowledge`、`user_data`、`creator`；重复项按首次出现顺序去重。额度查询本身不记录业务调用事件，失败时也不计入。不会用本地计数预测余额或推算额度重置时间，也不自动重试。

本地用量仍按日计数（调用次数、失败次数与成功调用返回的条目数），视图默认展示最近 30 天，最多可查 90 天。新增业务工具与 RPC 每次调用只记录一次事件，并带有额度分类；本地计数不是账单，也不是官方余额。存储标识保持不变。知识库上传单文件上限仍为 20 MB。

业务错误保留上游消息与错误码，即使 HTTP 状态为失败。RPC 的 `error.details` 可包含 `status`、`upstreamCode`、`retryAfter`（秒）和 `retryable`。`30001` / `30002` 为频率或额度限制；**`30003` 为风控拒绝，不是普通限流**，会提示不要立即重试。所有请求均不自动重试；超时和取消覆盖响应正文读取，而不只是等待响应头。

## 与网络搜索联动

同一 profile 提供 `ctx.web` 时，本插件直接向宿主注册「知乎全网搜索」，无需安装搜索管理器。安装 [@klarkxy/dsh-web-search-manager](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) 后，管理器会自动发现它，可在那里启用并排序。Access Secret 仍在「知乎资料」中配置，每次请求由知乎插件读取，凭据变更会刷新本地可用状态。专用知乎工具仍可独立使用。

## 边界与限制

- 可查询站内、全网、热榜、直答和公开知识库。
- 上传的参考文件保存在知乎云端，请勿上传未发表手稿。
- 此次同步不代表主库的全部 CLI/MCP 能力都已移植；OAuth 身份管理、PDF/PPT 任务等不在本次范围。
- 客户端接收宿主提供的结构化控件，缺失时使用原生 HTML 控件。构建和使用本包不依赖应用私有 UI 包。
- 原有 Agent 工具、凭据、RPC 合同和存储标识保持兼容，上述能力为增量扩展。

## 开发

接口见 [contracts](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/src/contracts.ts)、[tools](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/src/tools.ts) 与 [开放平台客户端](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/src/open-platform.ts)。七个新增接口覆盖六个问题发现/创作端点及官方额度。

```sh
pnpm --filter @klarkxy/dsh-zhihu typecheck
pnpm --filter @klarkxy/dsh-zhihu test
pnpm --filter @klarkxy/dsh-zhihu build
```

[发布维护](../../PUBLISHING.md) · [许可证](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/LICENSE)
