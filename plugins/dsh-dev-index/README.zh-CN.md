# dsh-dev-index

[English documentation](README.md)

插件页嵌入 DSH 官方文档供人阅读；创造模式会收到一段简短指引，在开发 DSH 插件前查阅官方资料。

在正在运行的 DSH 里，这段指引要求创造模式使用只读的 `cordis_inspect_list` 和 `cordis_inspect_query` 核对接口。环境自己的工具与审批策略仍然适用。

给人读的文档在[官方站点](https://deepseek-harness.github.io/deepseek-harness/)（简体中文在根路径，英文在 `/en/`）。智能体先读官方 [llms.txt](https://deepseek-harness.github.io/deepseek-harness/llms.txt) 索引，再按需读取原始 Markdown 页面。站点对应最近发布的版本。查特定版本的文档、源码和类型声明时，只有目标版本与 `master` 一致才用 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 `master`，否则使用对应的 `dsh-v*` 标签，不混用版本。

本仓库的 `docs/` 保留一份固定修订的阅读索引，对应 `docs/meta.json` 记录的源码。目前已发布的 [klarkxy Pages 地址](https://klarkxy.github.io/dsh-plugins/) 会跳转到官方站点；阅读器直接打开官方站点，因此不依赖内嵌跳转。

## 在插件页阅读

在 DSH Web 打开 **插件 → DSH 开发索引**，即可在页面中浏览官方 GitHub Pages 文档。阅读器按 DSH 界面语言打开中文或英文首页，也能手动切换语言、返回文档首页，或在独立标签页中打开。如果内嵌页面未显示，使用“在浏览器中打开”。

## 创造模式指引

宿主插件在会话使用 `cordis` 预设（创造模式）时加入一段系统提示，要求智能体先调用 `dsh_docs_search`，再调用 `dsh_docs_fetch` 阅读正文，随后选择 API。其他预设不注入额外提示。两个只读工具注册在宿主工具表中，仍受宿主工具策略约束。本插件不再注册 Skill。

- `dsh_docs_search({ query: "插件", language: "zh" })` 在线读取官方 `llms.txt`，搜索标题、分类和路径。这是目录搜索，不是全文搜索；没有命中不代表正文不含相关内容，可以改用更宽泛的中文或英文关键词。
- `dsh_docs_fetch({ id: "develop/basic/tool.md" })` 读取搜索结果中的文档 ID。结果包含来源、获取时间、内容修订值和 `nextOffset`。长文用该偏移量和相同的 `revision` 继续读取；正文更新时需要从头重读。默认每次返回 12,000 字符，上限 16,000。

请求由插件宿主执行，沿用 DSH 已有的 HTTP 代理策略，不执行命令，也不调用 `web_fetch`。只读取固定官方索引列出的 Markdown，拒绝任意 URL 和跳转，保留 TLS 证书校验。单次请求超时为 20 秒，单篇文档上限为 2 MiB。

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

Git 安装会运行 `prepare` 来构建 `lib/`。pnpm 在允许之前会拦住这个脚本。DSH 0.1.7-rc.2 的 CLI 会要求把打印出的包名写进 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds`：

```yaml
allowBuilds:
  '@klarkxy/dsh-dev-index': true
```

然后再执行一次 add。该许可会在本机执行这个包的构建。需要固定插件来源时请钉住 commit。

`@deepseek-ai/dsh-system-prompt` 和 `@deepseek-ai/dsh-agent-preset-registry` 的 peer 范围会对照正在运行的 `dsh` 版本检查。本包要求 DSH `>=0.1.7-rc.2 <0.2.0`；加载器不强制 `engines.dsh`。

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

没有配置项。补丁只插入插件，不设置键。

## 许可证

[SATA License 2.1](LICENSE)

## 卸载

```bash
dsh plugin --profile web remove @klarkxy/dsh-dev-index
```
