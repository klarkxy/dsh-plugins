# DSH 文档

<!-- release-state-note -->

[English](README.md)

不离开 DSH 就能阅读 DeepSeek Harness 官方文档；创造模式还会获得查文档、在安装前核对插件信息的工具。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
```

把 `web` 换成你的 profile 名，安装后重启 profile。

## 使用

- 「插件 → DSH 文档」会在 DSH 内显示[官方文档站](https://deepseek-harness.github.io/deepseek-harness/)，可切换中文 / English。
- 创造模式下，智能体获得四个只读工具：`dsh_docs_search` 和 `dsh_docs_fetch` 用于查找和阅读官方文档，`dsh_plugins_search` 和 `dsh_plugins_fetch` 用于在安装前查看插件的 npm 信息。创造模式还会被提醒用 `cordis_inspect_list` 和 `cordis_inspect_query` 核对运行时接口。

## 限制

- 这些工具只读，不会安装任何东西；安装仍由 DSH 插件管理器负责。
- 官网对应最新发布的 DSH，可能与你正在使用的版本不同。
- npm 元数据不能证明插件与你的 DSH 兼容。

## 从 GitHub 安装

```sh
dsh plugin --profile web add "github:klarkxy/dsh-plugins#path:/plugins/dsh-dev-index"
```

从 GitHub 安装会在本机构建插件，pnpm 会先要求你允许。把下面内容加入 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 后再执行一次安装命令：

```yaml
allowBuilds:
  '@klarkxy/dsh-dev-index': true
```

## 许可证

[SATA License 2.1](LICENSE)
