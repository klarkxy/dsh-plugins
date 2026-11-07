# 知乎

<!-- release-state-note -->

[English](../README.md)

把知乎交给模型当调研信源：站内搜索、全网搜索、热榜、知乎直答、知识库、问题发现和创作数据。`zhihu_sync` 工具还可以保存、校验文章、提问或想法草稿并上传配图。每次请求只用你自己的知乎 Access Secret，返回内容作为调研参考资料。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

把 `web` 换成你的 profile 名，重启 DSH Web。请使用完整的 scoped 包名 `@klarkxy/dsh-zhihu`（无 scope 的 `dsh-zhihu` 属于其他维护者）。

## 使用

打开「设置 → 知乎」，在「设置」页签中填写 Access Secret。其他页签：

- **统计**：本机记录的每日调用、失败和结果条数；
- **官方用量**：知乎返回的剩余免费额度；
- **知识库**：上传并检索参考文件；
- **测试**：手动执行各类搜索和查询，展开直答的思考过程，查看或复制结构化返回数据。

安装网页搜索插件后，「知乎全网搜索」也会出现在它的服务列表中。

## 草稿与配图

在「设置 → 知乎 → 设置」页签填写发布用 App Key 和 App Secret，可从[知乎同步助手](https://www.zhihu.com/playground/zhihu-publisher)申请；它们与检索 Access Secret 分开配置。知乎的授权说明也可以整段粘进 App Secret 输入框（包含 `ZHIHU_OPENAPI_APP_KEY:"…"` 与 `ZHIHU_OPENAPI_APP_SECRET:"…"` 两项），插件会自动提取并仅保存这两项凭据。`zhihu_sync` 工具随后可让模型保存、列出、读取并校验文章、提问或想法草稿，并为其上传配图；草稿在重启 DSH 后仍可继续处理。插件负责草稿准备与校验，正式发布请在知乎完成。

## 让模型使用

以下模型工具默认在 Agent 预设中启用：

| 工具 | 用途 |
| --- | --- |
| `zhihu_search`、`zhihu_global_search`、`zhihu_hot_list` | 知乎站内搜索、全网搜索、热榜 |
| `zhihu_ask` | 基于知乎内容的直答 |
| `zhihu_knowledge_search` | 检索知识库 |
| `zhihu_question_recommendations`、`zhihu_question_answers` | 发现问题、读取回答摘要 |
| `zhihu_user_content_detail`、`zhihu_user_content_comments` | 读取自己已发布的内容及评论 |
| `zhihu_creator_account_stats`、`zhihu_creator_content_stats` | 自己的创作数据 |
| `zhihu_quota` | 查询官方额度 |
| `zhihu_sync` | 保存、列出、读取并校验草稿，上传配图 |

站内搜索和全网搜索无匹配内容时返回空列表；服务提供原因说明时会一并显示。

## 费用保护

检索与创作查询默认只用知乎的免费额度：每次请求前先查官方额度，确认有剩余免费额度才发送。另外每天（北京时间）最多 100 次请求。两项都可在插件配置中修改：

```yaml
config:
  allowPaid: false
  dailyCallLimit: 100
```

仅在你主动将 `allowPaid` 设为 `true` 时才启用付费调用。

## 限制

- 同一账号下的其他客户端可能在两次额度检查之间消耗免费额度。
- 知识库文件保存在知乎云端，单个文件最大 20 MB；草稿配图同样上传至知乎。
- 草稿支持文章、提问和想法。图片支持 JPEG、PNG、GIF、WebP、BMP（GIF 最大 15 MB，其他格式最大 30 MB；HEIC/AVIF 请先转换为上述格式再上传）。
- 草稿与图片操作使用知乎提供的发布授权，独立于搜索额度与付费搜索开关。
- 每次请求单次执行，由调用方按需决定是否重试。
- 功能范围涵盖调研检索、知识库、创作统计与草稿准备；草稿发布、OAuth 账号切换、充值与钱包查询请在知乎端操作。

## 许可证

[SATA License 2.1](../LICENSE)
