# 网页搜索

<!-- release-state-note -->

[English](../README.md)

在一个设置页里选择由哪个服务回答模型的网络搜索、设置请求限制，并让模型读取公开网页。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

把 `web` 换成你的 profile 名，重启 DSH Web 后打开「插件 → 网页搜索」。

## 配置搜索

DuckDuckGo 默认可用，无需密钥。也可以填写 API Key 启用 DeepSeek 搜索、Exa、Brave、博查、Serper、Firecrawl 或 Tavily。拖拽列表调整顺序，每次搜索使用第一个就绪的服务。其他插件提供的搜索服务（例如知乎）也会出现在同一列表中。

「请求限制」用于设置结果条数、每次调用的查询数、总超时和网页正文长度上限。

## 读取网页

打开「网页读取」后，模型可以读取公开网页。默认通过免费的 Jina Reader 读取，失败时改为直接请求一次。

## 让模型使用

在所用 `agent.cordis.yml` 的插件列表中加入：

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

搜索和网页读取开启时，模型会获得 `web_search` 与 `web_fetch` 工具。

## 限制

- 付费服务可能按次收费；插件的计数不是账单。
- 读取网页时，网址会发送给 Jina，请勿读取包含私密令牌的链接。
- 搜索失败时不会自动换用其他服务。

## 许可证

[SATA License 2.1](../LICENSE)
