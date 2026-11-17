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
| `zhihu_research` | 调研检索：`search`（站内搜索）、`global_search`（全网搜索）、`hot_list`（知乎热榜）、`ask`（知乎直答）、`knowledge_search`（知识库检索） |
| `zhihu_account` | 账号与创作：`question_recommendations`（问题推荐）、`question_answers`（回答摘要，非全文）、`content_detail`（本人创作全文）、`content_comments`（本人创作评论）、`creator_account_stats`（账号创作数据）、`creator_content_stats`（单篇创作数据）、`quota`（官方每日免费额度） |
| `zhihu_sync` | 草稿与配图：`list`（列出草稿）、`get`（读取草稿）、`save`（保存/更新草稿）、`prepare`（校验草稿）、`upload_image`（上传配图） |

站内搜索与全网搜索无匹配结果时返回空列表；上游提供说明原因时会一并展示。

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
