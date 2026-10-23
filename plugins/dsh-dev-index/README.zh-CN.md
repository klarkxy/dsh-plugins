# DSH 文档

<!-- release-state-note -->

[English](README.md)

不离开 DSH 就能阅读 DeepSeek Harness 官方文档；创造模式还会获得查文档、安装前核对插件的工具。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
```

把 `web` 换成你的 profile 名，安装后重启 profile。

## 使用

- 「插件 → DSH 文档」在 DSH 内显示[官方文档站](https://deepseek-harness.github.io/deepseek-harness/)，可切换中文 / English。
- 创造模式下，智能体获得五个只读工具：`dsh_docs_search` 和 `dsh_docs_fetch` 用于查找和阅读官方文档；`dsh_plugins_search` 和 `dsh_plugins_fetch` 用于在安装前查看插件的 npm 信息（搜索源可选 catalog、npm 或 GitHub 仓库）；`dsh_github_fetch` 用于查看 GitHub 插件仓库的元数据并把分支解析成可锁定的 commit。创造模式还会被提醒用 `cordis_inspect_list` 和 `cordis_inspect_query` 核对运行时接口。

## 限制

- 这些工具只读，不安装任何东西；安装仍由 DSH 插件管理器负责。
- 官网对应最新发布的 DSH，可能与你正在使用的版本不同。
- npm 元数据不能证明插件与你的 DSH 兼容。
- GitHub 数据来自本机已登录的 gh CLI 或匿名 API（匿名额度有限，约每小时几十次请求）；插件不保存任何 GitHub 凭据。按 `dsh.plugin.json` 清单的代码搜索仅在 gh 已登录时可用。
- 取消最后一个使用 GitHub CLI 检查的请求时，会等待该检查停止；卸载插件会等待正在进行的 GitHub 请求和 CLI 进程结束。

## 从 GitHub 安装

```sh
dsh plugin --profile web add "github:klarkxy/dsh-plugins#path:/plugins/dsh-dev-index"
```

从 GitHub 安装会在本机构建插件，pnpm 会先要求你允许。把下面内容加入 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 后，再执行一次安装命令：

```yaml
allowBuilds:
  '@klarkxy/dsh-dev-index': true
```

## 许可证

[SATA License 2.1](LICENSE)
