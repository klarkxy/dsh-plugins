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

DuckDuckGo 默认可用，无需密钥。也可以填写 API Key 启用 DeepSeek 搜索、Exa、Brave、博查、Serper、Firecrawl、Tavily、Perplexity 或 You.com。拖拽列表调整顺序，每次搜索使用第一个就绪的服务。其他插件提供的搜索服务（例如知乎）也会出现在同一列表中。

已安装的 ChatGPT、Grok Build、MiniMax 插件也可在这里提供搜索服务，Grok Build 还可提供网页读取。在各插件自己的设置中配置 CLI 路径和登录，再在这里启用与排序。新服务不会自动开启；本地 CLI 可用不代表账号健康。各插件原有独立工具仍可使用。

「请求限制」用于设置结果条数、每次调用的查询数、总超时和网页正文长度上限。

## 读取网页

打开「网页读取」后，选择参与读取的服务，拖拽或用上下方向键调整优先顺序。每次读取使用第一个已配置且可用的服务；其他插件接入的网页读取服务也会出现在列表中，新服务需要手动开启。暂时未加载的服务会保留原有选择和顺序。

原先选中的读取服务会保留为列表中的首项。内置「网页读取」通过免费的 Jina Reader 读取，失败时改为直接请求一次；如果使用宿主或其他插件的服务，则按该服务的方式读取。

也可以开启 **Firecrawl** 读取 Markdown 网页，与 Firecrawl 搜索共用 API Key；搜索与网页读取分别计费。新增服务需要手动加入优先列表。Perplexity 使用 Search API，不生成回答；You.com 返回网页与新闻摘要，不额外请求全文提取。

## 让模型使用

在所用 `agent.cordis.yml` 的插件列表中加入：

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

搜索和网页读取开启时，模型会获得 `web_search` 与 `web_fetch` 工具。

## 限制

- 付费服务可能按次收费；插件的计数不是账单。
- 使用内置 Jina Reader 时，网址会发送给 Jina，请勿读取包含私密令牌的链接。
- Firecrawl 网页读取要求服务返回网页状态码和最终网址，缺失时会报错；正文可能来自服务缓存。读取的网址会发送给所选服务。
- 搜索或网页读取请求失败时，不会自动换用列表中的其他服务。
- 取消与超时会请求当前服务停止，并等待其完成清理。忽略取消的第三方服务可能延迟结果返回和插件卸载；插件无法强制终止 DSH 进程内运行的代码。

## 许可证

[SATA License 2.1](../LICENSE)
