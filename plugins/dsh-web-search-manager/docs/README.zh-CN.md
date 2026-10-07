# @klarkxy/dsh-web-search-manager

在一个设置页里挑选用哪个服务回答模型的网络搜索、设定每次请求的上限，并让模型读取公开网页。

[English](../README.md)

需要 Node.js ≥22、DSH `0.2.0-rc.2`，无需构建本仓库。

## 安装

把已发布包装进目标 profile：

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

把 `web` 换成你的 profile 名。重启 DSH Web，打开「插件 → 网页搜索」。卸载用 `dsh plugin --profile web remove @klarkxy/dsh-web-search-manager`。

## 配置搜索

设置页分两个标签页：「搜索服务」管理供应商，「请求限制」设置请求限额。默认开启 DuckDuckGo，无需密钥。需要其它后端时在设置中开启并填写凭据；一个可用后端即可。拖拽列表调整顺序，每次请求由顺序中第一个就绪的后端处理。缺密钥的后端直接跳过，失败也不会自动换家。

列表区分本地「可用 / 暂不可用」、是否参与排序（开关），以及仅在真正提供服务时出现的「当前使用」。可用表示本地 `available()` 或凭据状态，不是一次已计费的连通验证。已保存但尚未注册的 id 会留在原位并标为「未加载，保留选择」，直到你关掉它的开关；普通搜索开关、排序和 Key/限制保存不会删掉这些选择，清空顺序也不会把 DuckDuckGo 加回来。

管理器从当前 profile 的 `ctx.web` 发现搜索和抓取服务，包括官方插件和自定义插件在管理器启动前后注册的服务。新发现的服务不会自动加入已启用的搜索顺序。页面在可见时大约每三秒刷新注册和本地可用性，隐藏或卸载后停止。外部服务的配置和凭据仍在所属插件中维护。若提供安全的 `configurationUrl`（HTTPS、同宿主 `/…` 路径或 `#…` 片段），本页给出「打开配置」链接；否则显示配置所属插件名称，未知所属时提示到该服务的插件中配置。本页不会根据 id 或 owner 猜测宿主路由，也不重复编辑其凭据。

内置适配器也走原生注册。如果启动时尚无官方 DeepSeek/HTTP 服务，补充适配器使用 `deepseek-managed` / `http-managed`，让官方服务稍后也能正常注册。旧版内置适配器的选择和端点只在内存中迁移，不发送请求、不写存储；下次用户保存时才持久化。旧 id 已由原生服务占用时使用它自己的设置，原管理器端点原样保留，但不转交给原生服务。

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

「网页读取」可单独开启，并选择当前已注册的抓取服务。同名服务优先沿用宿主或其他插件已注册的实例与配置。宿主已有 `http` 时沿用其读取方式；只有未注册 `http` 时，本插件才补充原有 Jina 优先适配器。该适配器优先匿名请求 `https://r.jina.ai/<目标 URL>`，返回 Reader 的文本/Markdown；HTTP 错误（含 429）、Reader 超时、网络失败、空内容或无效响应时，回退一次到原有 HTTP 直连读取。此回退只作用于网页读取，不改变搜索后端的选择。无需注册 Jina、配置 API Key 或计费设置，也不增加依赖。

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

供应商插件直接调用 `ctx.web.registerSearchProvider(provider)` 或 `ctx.web.registerFetchProvider(provider)`，无需依赖或调用 `webSearchManager`。`available()` 只检查本地状态；请求须传递取消信号，供应商自行读取自己的配置和凭据。可在供应商对象上添加可选的 `dshWebManagement` 展示元数据（`label`、`description`、`billing`、`configurationOwner`、`credentialHint`、`pricing`、HTTPS `pricingUrl`、显式 `configurationUrl` 等）。`configurationUrl` 是唯一的配置链接，允许 HTTPS、同宿主 `/…` 路径或 `#…` 片段；不要期待本页根据 `id` 或 `configurationOwner` 猜测路由。`credentialHint` 只作展示。不提供元数据也会被发现，列表使用供应商 id。供应商自己的介绍和费用优先；相同 id 的静态说明不会覆盖自定义/原生服务。无费用元数据时显示未提供，不会称为免费或已核对。元数据不携带凭据值。旧的管理器 factory 注册方法保留为兼容入口，新插件走原生注册。

```ts
const provider = {
  id: 'my-search',
  dshWebManagement: {
    id: 'my-search', label: 'My search', description: 'Custom search service',
    billing: 'request', configurationOwner: '@example/my-plugin',
    configurationUrl: '/plugins/my-plugin',
  },
  available: () => locallyConfigured(),
  search: (request, signal) => searchWithOwnConfiguration(request, signal),
}
ctx.web.registerSearchProvider(provider)
```

DSH 0.2.0-rc.2 尚无公开注册表枚举及动态选择接口，本包将兼容逻辑集中在 `web-registry.ts`：观察宿主实际 Map、管理可用性、临时接管选择，卸载时恢复实例和原有配置/环境选择。不匹配的宿主结构会明确报错，避免遗漏已注册服务。供应商的本地可用性变化可发出本仓库扩展事件 `web/provider-availability-updated`（参数：`search`/`fetch`、id）；它不是官方 DSH 事件。状态刷新和每次执行也会重新检查 `available()`。保存迁移后的适配器 id 后，降级管理器需要重新选择旧路由；凭据引用和旧端点键仍保留。

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
- 管理器运行期间使用已保存的选择；卸载后恢复宿主原有配置和环境变量的选择。
- 设置保存失败时，受管联网会暂停，成功保存后恢复。

[发布维护](../../PUBLISHING.md) · [许可证](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/LICENSE)
