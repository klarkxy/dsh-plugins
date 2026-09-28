# @klarkxy/dsh-zhihu

DSH 知乎搜索、直答、知识库与用量插件。

[English](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/README.md)

## 安装

需要 Node.js ≥22、DSH `0.1.7-rc.2`，无需构建本仓库。安装：

```sh
npm install @klarkxy/dsh-zhihu
```

然后加载：

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

重启 DSH Web，从「插件」打开「知乎（@klarkxy/dsh-zhihu）」填写 Access Secret（DSH 凭据 `ZHIHU_ACCESS_TOKEN`）。请使用完整 scoped 包名；无 scope 的 `dsh-zhihu` 属于其他维护者。

模型需要使用知乎工具时，在所用 `agent.cordis.yml` 的插件列表加入：

```yaml
- name: '@klarkxy/dsh-zhihu/tools'
```

## 使用

DSH Web 提供搜索、设置、用量与知识库视图。在「插件 → 知乎（@klarkxy/dsh-zhihu）」配置、查看用量、管理知识库和搜索；模型工具随插件一同提供。

启用 tools 入口后，模型可使用十一个工具：

- `zhihu_search`：知乎站内搜索，拉取社区证据；结果仅作社区/读者反馈参考，不构成 canon，也不直接写入项目文件。
- `zhihu_global_search`：知乎开放平台全网搜索，检索站外公开网页资料；仅作参考。
- `zhihu_hot_list`：拉取知乎热榜，了解当前社区热点；仅作题材与热点参考。
- `zhihu_ask`：调用知乎直答（OpenAI 兼容的 AI 问答），基于知乎社区内容生成综合回答；适合考据与背景调研。
- `zhihu_knowledge_search`：检索知乎知识库（RAG 片段），默认只查公开库；在知乎网页端上传过个人资料后可加个人/订阅召回范围。

新增的六个问题发现与创作工具**全部只使用当前 Access Secret**，不接受 OAuth 凭据，也不切换到其他用户。创作全文、评论和统计只覆盖本人已发布内容，不能借此获取他人回答全文；视频仅返回关联正文，不提供视频文件。

| 工具 | 服务 RPC | 官方额度分类 |
| --- | --- | --- |
| `zhihu_question_recommendations` | `question.recommendations` | `creator` |
| `zhihu_question_answers` | `question.answers` | `question_answers` |
| `zhihu_content_detail` | `content.detail` | `creator` |
| `zhihu_content_comments` | `content.comments` | `creator` |
| `zhihu_creator_account_stats` | `creator.account.stats` | `creator` |
| `zhihu_creator_content_stats` | `creator.content.stats` | `creator` |

- 问题推荐：省略 `query` 按画像推荐，传入非空主题则按主题推荐；空白字符串无效。`count` 默认 5，范围 1–20，不支持分页。
- 问题回答：`questionUrl` 须为 `https://www.zhihu.com/question/{id}`。`Summary` 是上游摘要或截取文本，不是全文，也不是额外生成的 AI 摘要。
- 全文、评论和单篇统计：`contentUrl` 支持回答、`zhuanlan.zhihu.com/p/{id}` 专栏文章、想法和视频链接。`Body` 为空或缺失不能视为全文。
- 回答和评论每次只读一页；`limit` 默认 20，范围 1–50。模型工具的 `offset` 用十进制字符串，默认 `"0"`；客户端函数和 RPC 也接受安全整数。仅在 `paging.canContinue=true` 时把 `paging.nextOffset` 传给下一次调用；缺失、无效或未递增时停止。不能因短页或空页停止，也不能按本页条数或 `Totals` 推算偏移。评论排序 `order` 支持 `score`（默认）、`reverse`、`ascending`，附带子评论不保证完整。
- 账号统计的 `contentType` 支持 `all`（默认）、`answer`、`article`、`pin`、`zvideo`。两种统计的 `startDate`、`endDate` 均为 `YYYY-MM-DD`，须成对提供，结束日期不得早于开始日期；同时省略则使用上游默认范围。缺失指标不补零，比例保持原值，不换算百分比。

新增工具与 RPC 返回 `{ version, data, paging? }`。`data` 保留上游字段（含原始 HTML），超过 JavaScript 安全整数范围的整数用十进制字符串返回。工具文本展示会清洗并转义正文、摘要和评论中的 HTML；其他调用方展示 `data` 时仍需将其视为不可信内容。业务码 `30003` 单独返回 `RISK_CONTROL` / RPC `risk-control` 并提示不要立即重试，与频率或额度限制（`30001`、`30002`、HTTP 429）区分；不自动重试。

用量按日计数（调用次数、失败次数与成功调用返回的条目数），视图默认展示最近 30 天，最多可查 90 天。新增的可选 `quotas` 字段按官方额度分类累计本地调用；旧记录可继续读取，不推算历史分类。这些计数包含本地校验失败，不代表官方剩余额度或计费消耗。知识库上传单文件上限 20 MB。

可查询站内、全网、热榜、直答和公开知识库。上传的参考文件保存在知乎云端，请勿上传未发表手稿。

同一 profile 还安装 [@klarkxy/dsh-web-search-manager](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) 时，本插件会向网络搜索注册「知乎全网搜索」后端。在网络搜索设置中启用它，即可让通用网络搜索工具使用知乎的全网搜索能力，并共用「知乎资料」中配置的 Access Secret。专用知乎工具仍可独立使用。

## 开发

接口见 [contracts](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/src/contracts.ts) 与 [tools](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/src/tools.ts)。

[发布维护](https://github.com/klarkxy/dsh-plugins/blob/main/docs/editor-plugin-migration.md) · [许可证](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/LICENSE)

客户端接收宿主提供的结构化控件，缺失时使用原生 HTML 控件。构建和使用本包不依赖应用私有 UI 包；已有工具名、凭据引用、RPC 入口和存储标识保持兼容。六个接口按 [zhihu-search PR #4](https://github.com/klarkxy/zhihu-search/pull/4) 同步，核对基线为上游 main `62fd3ce`、本仓库 main `ca189a2`。
