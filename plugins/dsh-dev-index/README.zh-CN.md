# DSH 文档

[简体中文](README.zh-CN.md) | [English](README.md)

**运行环境**：Node `^22.19.0 || >=24.0.0`、DSH `>=0.1.7-rc.2`。文档阅读器是 DSH Web 客户端；四个只读工具和创造模式指引运行在宿主里。

不离开 DSH 就能读到官方文档：插件页内嵌官方文档站，创造模式另外拿到四个原生只读工具——`dsh_docs_search` 和 `dsh_docs_fetch` 检索文档，`dsh_plugins_search` 和 `dsh_plugins_fetch` 查核插件的 npm 元数据。安装和卸载插件始终由官方插件管理器负责，本插件不安装任何东西。

在正在运行的 DSH 里，同一段指引要求创造模式使用只读的 `cordis_inspect_list` 和 `cordis_inspect_query` 核对运行时接口。环境自己的工具与审批策略仍然适用。

给人读的文档在[官方站点](https://deepseek-harness.github.io/deepseek-harness/)（简体中文在根路径，英文在 `/en/`）。智能体先读官方 [llms.txt](https://deepseek-harness.github.io/deepseek-harness/llms.txt) 索引，再按需读取原始 Markdown 页面。站点对应当前发布的版本。查特定版本的文档、源码和类型声明时，只有目标版本与 `master` 一致才用 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 `master`，否则使用对应的 `dsh-v*` 标签，不混用版本。

插件不再附带或依赖镜像索引。[klarkxy Pages 站点](https://klarkxy.github.io/dsh-plugins/) 现在是 klarkxy 的 DSH 插件目录，旧索引地址会跳转到官方站点。

## 在插件页阅读

在 DSH Web 打开 **插件 → DSH 文档**，页面会在内嵌的阅读面板里显示官方 GitHub Pages 文档：默认按 DSH 界面语言打开中文或英文首页，可用 **中文 / English** 切换语言，**返回文档首页** 重新载入当前语言首页，工具栏还可以在独立标签页打开该站点。内嵌页面没有显示时，面板会给出“在浏览器中打开”和“重试”。

## 创造模式指引

宿主插件在会话使用 `cordis` 预设（创造模式）时加入一段系统提示，要求智能体选择 API 前先调用 `dsh_docs_search` 和 `dsh_docs_fetch` 阅读官方文档，安装或依赖某个插件前先调用 `dsh_plugins_search` 和 `dsh_plugins_fetch` 核实元数据。其他预设不注入额外提示。四个只读工具都注册在宿主工具表中，仍受宿主工具策略约束。本插件不注册 Skill。

- `dsh_docs_search({ query: "插件", language: "zh" })` 在线读取官方 `llms.txt`，搜索标题、分类和路径。这是目录搜索，不是全文搜索；没有命中不代表正文不含相关内容，可以改用更宽泛的中文或英文关键词。
- `dsh_docs_fetch({ id: "develop/basic/tool.md" })` 读取搜索结果中的文档 ID。结果包含来源、获取时间、内容修订值和 `nextOffset`。长文用该偏移量和相同的 `revision` 继续读取；正文更新时需要从头重读。默认每次返回 12,000 字符，上限 16,000。
- `dsh_plugins_search({ query: "记忆" })` 查找候选插件。默认 `catalog` 数据源搜索 klarkxy 维护的中英文插件目录；`source: "npm"` 用 npm 的 `dsh-plugin` 关键词做更宽的发现。两个源都不是全量目录，命中结果只是候选，不代表兼容性已验证。
- `dsh_plugins_fetch({ package: "@klarkxy/dsh-memory", version: "latest" })` 按确切包名读取 npm 注册表元数据：dist-tags、按发布时间排序的版本列表，以及选定版本的组合包声明、DSH／Node 版本要求、依赖和弃用说明。`version` 可填精确版本或标签，不接受范围。

插件注册表工具是只读元数据查询：不下载、不安装、不执行任何代码，声明的 engines 范围也不是运行时兼容性证明。从 GitHub 安装的插件没有注册表元数据，直接用官方插件管理器以 `github:owner/repo#commit` 安装，并自行审阅其 `package.json`。

## 边界与限制

文档请求由插件宿主执行，沿用 DSH 已有的 HTTP 代理策略，不执行命令，也不调用 `web_fetch`。只读取固定官方索引列出的 Markdown：拒绝任意 URL 和跳转，保留 TLS 证书校验。单次请求超时为 20 秒，单篇文档上限为 2 MiB。

内存缓存有效期为五分钟，最多保存 32 页、8 MiB。传入 `refresh: true` 可立即刷新。过期数据必须成功刷新后才能使用；请求失败会报告错误，不会静默返回旧副本。停用插件会取消请求并清空缓存。无需随包分发文档快照、维护持久索引或部署 MCP 服务。

官网对应当前发布的文档，不一定与本机 DSH 版本一致。仍需使用 `cordis_inspect_list` 和 `cordis_inspect_query` 核对运行时接口；版本不一致时查对应官方 `dsh-v*` 源码标签。两个工具不提供历史标签读取。

官方 DSH 不读取 `dsh.plugin.json`。本仓库其他 bundle 用这个文件做本地发现，所以这里也保留。加载器认的是 `package.json` 里的 `dsh.bundle.patch`。

## 从 npm 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
```

npm 包包含已构建的 `lib/`。

## 从 GitHub 安装

```sh
dsh plugin --profile web add "github:klarkxy/dsh-plugins#path:/plugins/dsh-dev-index"
```

Git 安装会运行 `prepare` 来构建 `lib/`。pnpm 在允许之前会拦住这个脚本，DSH 0.1.7-rc.2 的 CLI 会打印出要写进 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 里 `allowBuilds` 的确切包名：

```yaml
allowBuilds:
  '@klarkxy/dsh-dev-index': true
```

然后再执行一次 add：该许可会在本机执行这个包的构建。需要固定插件来源时请钉住 commit。

`@deepseek-ai/dsh-system-prompt` 和 `@deepseek-ai/dsh-agent-preset-registry` 的 peer 范围会对照正在运行的 `dsh` 版本检查。本包要求 DSH `>=0.1.7-rc.2`；加载器不强制 `engines.dsh`。

## 从本仓库安装

```bash
pnpm install
pnpm --filter @klarkxy/dsh-dev-index build
dsh plugin --profile web add ./plugins/dsh-dev-index
```

安装后重启该 profile，或让 HMR 应用新 bundle。然后：

```bash
dsh --profile web --dump-config
```

组合结果里应有 `dsh-dev-index` 这一行。新建创造模式会话即可自动收到文档指引。

没有配置项：补丁只插入插件，不设置任何键。

## 许可证

[SATA License 2.1](LICENSE)

## 卸载

```bash
dsh plugin --profile web remove @klarkxy/dsh-dev-index
```
