# @klarkxy/dsh-web-search-manager

在一个设置页里挑选用哪个服务回答模型的网络搜索、设定每次请求的上限，并让模型读取公开网页。

[English](../README.md)

需要 Node.js ≥22、DSH `0.1.7-rc.2`，无需构建本仓库。

## 安装

把已发布包装进目标 profile：

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

把 `web` 换成你的 profile 名。重启 DSH Web，打开「插件 → 网页搜索」。卸载用 `dsh plugin --profile web remove @klarkxy/dsh-web-search-manager`。

## 配置搜索

设置页分两个标签页：「搜索服务」管理供应商，「请求限制」设置请求限额。默认开启 DuckDuckGo，无需密钥。需要其它后端时在设置中开启并填写凭据；一个可用后端即可。拖拽列表调整顺序，每次请求由顺序中第一个就绪的后端处理。缺密钥的后端直接跳过，失败也不会自动换家。

内置搜索后端：

- **DuckDuckGo**：无需注册、无需密钥，默认后端，免费。
- **DeepSeek 搜索**：与模型设置共用 DeepSeek API Key（`DEEPSEEK_API_KEY`），可能在模型费用外产生额外搜索费用。
- **Exa**：独立 Search API，需要单独的 Key（`DSH_EDITOR_WEB_EXA_API_KEY`）。Exa 供应商已声明为本插件的运行时依赖。
- **Brave**：Brave Search API，需要 `DSH_EDITOR_WEB_BRAVE_API_KEY`。
- **博查**：中文网页搜索 API，需要 `DSH_EDITOR_WEB_BOCHA_API_KEY`。
- **Serper**：Google 结果 Search API，需要 `DSH_EDITOR_WEB_SERPER_API_KEY`。
- **Firecrawl**：网页搜索与提取 API，需要 `DSH_EDITOR_WEB_FIRECRAWL_API_KEY`。
- **Tavily**：Search API，固定 basic 检索深度，不自动升级；需要 `DSH_EDITOR_WEB_TAVILY_API_KEY`。适配器已并入本插件，原独立的 `dsh-web-search-tavily` 包已退役。

## 读取公开网页

开启搜索也会启用公开网页读取。内置 `http` 路由优先匿名请求 `https://r.jina.ai/<目标 URL>`，返回 Reader 的文本/Markdown；HTTP 错误（含 429）、Reader 超时、网络失败、空内容或无效响应时，回退一次到原有 HTTP 直连读取。此回退只作用于网页读取，不改变搜索后端的选择。无需注册 Jina、配置 API Key 或计费设置，也不增加依赖。

请求不附带 Cookie 或授权头。IP 字面量、明显的本地主机名、带用户名密码的 URL，以及已经带 Reader 前缀的地址跳过 Jina，继续受原 HTTP 读取器的策略约束。两个阶段复用同一套 HTTP 传输，Reader 阶段最多使用 `timeoutMs` 的一半且不超过 15 秒，为直连回退留出时间。用户取消、关闭联网或总超时到期时直接停止，不再发起回退。结果保留请求的目标 URL，不把 Reader 代理地址当作来源。

## 请求限制

请求限制包括每条查询的结果上限（`maxResults`）、每次工具调用的查询上限（`maxQueries`）、整个请求的总超时（`timeoutMs`）和网页正文字符上限（`maxFetchChars`）。每次 HTTP 响应仍受 5 MB 字节上限约束。连接测试发送固定查询，不发送作品内容，可能产生一次调用费用。

## 模型工具

模型需要使用这些工具时，在所用 `agent.cordis.yml` 的插件列表加入：

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

加入后，模型获得 `@deepseek-ai/dsh-tool-web` 的官方 `web_search` 与 `web_fetch` 工具，仅在搜索与网页读取开启时挂载。

## 扩展与开发

复用 DSH 的 `ctx.web`。扩展供应商可参照[管理接口](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/contracts.ts)、[内置注册](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/builtins.ts)和 [Tavily 适配器](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/tavily.ts)。须传递取消信号；`available()` 只检查本地状态，不发送网络请求。扩展后端可在注册描述中提供 `pricing`、HTTPS `pricingUrl`；共用凭据时可提供 `credentialHint`，由后端维护自己的设置页文案。

在仓库根运行：

```sh
pnpm --filter @klarkxy/dsh-web-search-manager typecheck
pnpm --filter @klarkxy/dsh-web-search-manager test
pnpm --filter @klarkxy/dsh-web-search-manager build
```

测试使用模拟凭据和响应，不产生搜索费用。

## 边界与限制

- 只配置可信 HTTPS 端点，密钥会发送到该地址。
- 凭据由 DSH 存储保存，落盘保护取决于其后端配置。
- 用量计数是调用尝试，不等于账单或消费上限。
- 目标 URL 会发送给第三方服务 Jina，请勿提交含私密令牌或其它敏感信息的 URL。
- 关闭受管后端会取消其请求，但不能阻止其它插件自行联网。
- 搜索结果是外部资料，不授权修改稿件。
- 若部署环境的供应商覆盖与设置页的选择冲突，移除冲突的覆盖配置。
- 设置保存失败时，受管联网会暂停，成功保存后恢复。

[发布维护](../../PUBLISHING.md) · [许可证](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/LICENSE)
