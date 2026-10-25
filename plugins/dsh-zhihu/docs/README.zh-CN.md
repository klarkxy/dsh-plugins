# 知乎

<!-- release-state-note -->

[English](../README.md)

把知乎交给模型当调研信源：站内搜索、全网搜索、热榜、知乎直答、知识库、问题发现和创作数据。`zhihu_sync` 工具还可以保存、校验文章、提问或想法草稿并上传配图；实际发布需要人工在预览界面确认。每次请求只用你自己的知乎 Access Secret；结果是参考资料，不是定论。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

把 `web` 换成你的 profile 名，重启 DSH Web。请使用完整的 scoped 包名；无 scope 的 `dsh-zhihu` 属于其他维护者。

## 使用

打开「插件 → 知乎」，在「设置」中填写 Access Secret。其他页签：

- **统计**：本机记录的每日调用、失败和结果条数；
- **官方用量**：知乎返回的剩余免费额度；
- **知识库**：上传并检索参考文件；
- **测试**：手动执行各类搜索和查询，展开直答的思考过程，查看或复制结构化返回数据。

安装网页搜索插件后，「知乎全网搜索」也会出现在它的服务列表中。

## 草稿与配图

在「插件 → 知乎 → 设置」填写发布用 App Key 和 App Secret，可从[知乎同步助手](https://www.zhihu.com/playground/zhihu-publisher)申请；它们与检索 Access Secret 分开配置。`zhihu_sync` 工具随后可让模型保存、列出、读取并校验文章、提问或想法草稿，并为其上传配图；草稿在重启 DSH 后仍可继续处理。发布本身不对模型开放，需要人工在预览界面确认。

## 让模型使用

以下模型工具默认启用，无需修改 Agent 预设：

| 工具 | 用途 |
| --- | --- |
| `zhihu_search`、`zhihu_global_search`、`zhihu_hot_list` | 知乎站内搜索、全网搜索、热榜 |
| `zhihu_ask` | 基于知乎内容的直答 |
| `zhihu_knowledge_search` | 检索知识库 |
| `zhihu_question_recommendations`、`zhihu_question_answers` | 发现问题、读取回答摘要 |
| `zhihu_user_content_detail`、`zhihu_user_content_comments` | 读取自己已发布的内容及评论 |
| `zhihu_creator_account_stats`、`zhihu_creator_content_stats` | 自己的创作数据 |
| `zhihu_quota` | 查询官方额度 |
| `zhihu_sync` | 保存、列出、读取并校验草稿，上传配图；发布需人工在预览界面确认 |

## 费用保护

检索与创作查询默认只用知乎的免费额度：每次请求前先查官方额度，额度不足就不发送。另外每天（北京时间）最多 100 次请求。两项都可在插件配置中修改：

```yaml
config:
  allowPaid: false
  dailyCallLimit: 100
```

只有你自己把 `allowPaid` 设为 `true` 才允许付费调用。

## 限制

- 不能保证绝对零费用：同一账号的其他客户端可能先用掉免费额度。
- 知识库文件保存在知乎云端，单个文件最大 20 MB；草稿配图也会上传到知乎。
- 草稿支持文章、提问和想法，不支持回答或视频。图片支持 JPEG、PNG、GIF、WebP、BMP；GIF 最大 15 MB，其他图片最大 30 MB。HEIC/AVIF 请先转换格式。
- 草稿与图片操作使用知乎提供的发布授权；搜索额度与付费搜索开关不控制它们。
- 所有请求都不会自动重试。
- 不提供 OAuth 账号切换、充值或钱包查询。

## 许可证

[SATA License 2.1](../LICENSE)
