# 知乎

<!-- release-state-note -->

[English](../README.md)

把知乎交给模型当调研信源：站内搜索、全网搜索、热榜、知乎直答、知识库、问题发现和创作数据。每次请求只用你自己的知乎 Access Secret；结果是参考资料，不是定论。

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
- **测试**：手动执行各类搜索和查询。

安装网页搜索插件后，「知乎全网搜索」也会出现在它的服务列表中。

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

## 费用保护

默认只用知乎的免费额度：每次请求前先查官方额度，额度不足就不发送。另外每天（北京时间）最多 100 次请求。两项都可在插件配置中修改：

```yaml
config:
  allowPaid: false
  dailyCallLimit: 100
```

只有你自己把 `allowPaid` 设为 `true` 才允许付费调用。

## 限制

- 不能保证绝对零费用：同一账号的其他客户端可能先用掉免费额度。
- 上传的文件保存在知乎云端，请勿上传未发表手稿；单个文件最大 20 MB。
- 所有请求都不会自动重试。
- 不提供 OAuth 账号切换、充值或钱包查询。

## 许可证

[SATA License 2.1](../LICENSE)
