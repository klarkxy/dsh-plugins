# 网页搜索

<!-- release-state-note -->

简体中文 / [English](README.en.md)

在一个设置页里集中编排多源联网搜索与网页读取服务、管理 API Key 与请求限制，并通过 `ctx.web` 为模型的 `web_search` 与 `web_fetch` 工具提供多源并发融合与链式回退能力。

## 演示

![网页搜索设置：多源融合 / 主备降级 / 单源切换、读取链式回退与计费授权](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/pr23-web-search-manager.gif)

## 下载量

[![npm 每日下载量趋势](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/downloads-web-search-manager.svg)](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager)

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

把 `web` 换成你的 profile 名，安装后重启 DSH Web，再打开「设置 → 网页搜索」。更新插件后同样需要重启 profile，以加载新版搜索代码。

## 使用

### 搜索（`web-search` 页签）

- **三种调度模式**（即时生效）：
  - **多源融合**（默认）：并发调用排序靠前的免计费搜索源，自动剥离追踪参数归一化网址，并通过加权倒数排名融合（RRF）去重重排、合并更完整的长短摘要与发布时间；同类 DeepSeek 搜索源自动去重，不重复消耗检索请求。
  - **主备降级**：按列表顺位依次请求，当前源报错或不可用时自动切换到下一个允许参与的后备源。
  - **单源**：仅请求顺位第一且就绪的单一搜索源，不做跨源并发或回退。
- **计费安全护栏**：免按次工具费的搜索源（如内置 **DuckDuckGo**、宿主 **DeepSeek Search API** 与 **DeepSeek 搜索**）默认可参与多源融合或主备回退；按次或按积分计费的服务以及未声明计费类型的第三方插件源，需在对应条目上单独勾选「允许参与多源并发／回退（可能产生按次费用）」后才会加入扇出或后备链。若未勾选的按次计费源被排在第一位，则仅单独调用该首选源。
- **内置搜索后端**：
  - **DuckDuckGo**：无需注册或 API Key，开箱即用。
  - **需配置 Key 的内置后端**：支持 **DeepSeek 搜索**（与模型设置共用 Key）、**Exa**、**Brave**、**博查**、**Serper**、**Firecrawl**、**Tavily**、**Perplexity**、**You.com**、**Linkup** 与 **智谱**，填写对应 API Key 并保存后即可使用。
    - **Perplexity**：调用 Search API 直接返回网页来源，不生成回答。
    - **You.com**：直接返回网页与新闻摘要，不额外提取全文。
    - **Linkup**：使用 `fast` 检索，仅返回来源，不生成回答也不启用 `deep` 检索。
    - **Tavily**：固定使用 `basic` 检索，不自动升级搜索深度。
    - **智谱**：固定使用基础搜索（`search_std`），查询超过 70 个字符会在本地拒绝而不会截短发出。
- **宿主与其他插件服务**：宿主内置搜索服务与其他插件注册的搜索服务（例如知乎全网搜索）会出现在同一列表中，开启开关后即可参与排序。搜索开启时可点击「测试连接（可能计费）」验证连通性。

### 网页读取（`web-fetch` 页签）

- **两种读取模式**（即时生效）：
  - **链式回退**（默认）：按优先级顺位尝试读取服务；当上游抛出网络或跨域重定向错误、返回非成功状态码或正文为空时，自动回退到下一个允许参与的服务。
  - **单源**：仅使用顺位第一且就绪的读取服务。
- **内置与宿主读取服务**：
  - **Jina Reader** 与 **网页读取**：免费通过匿名 Jina Reader 提取公开网页 Markdown，失败时回退本机 HTTP 直连；无需 API Key。
  - **Firecrawl**：读取网页 Markdown，与 Firecrawl 搜索共用同一 API Key（搜索与网页读取分别计费，参与链式回退需单独勾选授权）。
  - **内网与本机地址保护**：针对 `localhost`、回环地址、局域网私有网段及内网域名，调度器会自动跳过云端抓取服务（如 DeepSeek Fetch API、Jina Reader、Firecrawl），仅使用本机 HTTP 直连读取。

### 请求限制（`设置` 页签）

- 可设置**每条查询结果上限**（1–20，默认 10）、**每次调用查询上限**（1–10，默认 10）、**多源并发上限**（2–5，默认 3）、**请求超时（毫秒）**（1000–120000）以及**正文字符上限**（1000–200000）。
- 开关切换、模式选择、计费授权勾选与排序修改立即生效；新输入的 API Key 与请求限制需点击「保存」生效。

## 让模型使用

标准会话预设已挂载官方 `tool-web` 时，本插件接管 `ctx.web` 后即可直接生效。若自定义 `agent.cordis.yml` 未挂载 `tool-web`，可在插件列表中加入：

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

当搜索或网页读取处于开启且存在可用后端的状态时，模型会分别获得 `web_search` 与 `web_fetch` 工具。

## 主要限制

- 付费服务可能按次或按积分收费，开启「允许参与多源并发／回退」后每次搜索或回退会向对应服务发起真实请求，实际消耗与账单以各服务商账户为准。
- 云端网页读取服务（如 DeepSeek Fetch API、Jina Reader 与 Firecrawl）会将所请求的公开网址发送到对应服务端，请勿用于包含私密访问令牌的链接。
- Firecrawl 网页读取要求服务返回网页状态码与最终网址，返回的 Markdown 正文可能来自服务缓存。
- 取消与超时会向所有活跃后端发出中止信号并等待其完成清理。若第三方服务忽略中止信号，可能延迟结果返回或插件卸载，DSH 进程内的代码通过协作方式停止。

## 许可证

[SATA License 2.1](LICENSE)
