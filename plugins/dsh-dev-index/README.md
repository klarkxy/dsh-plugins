# DSH 文档

<!-- release-state-note -->

简体中文 / [English](README.en.md)

在 DeepSeek Harness 内直接浏览官方开发文档；Creator 模式下，智能体还会获得两个只读工具，用于检索文档与安装前核对插件信息。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
```

将 `web` 替换为你的配置档（profile）名称，安装后重启配置档。

## 使用

### 插件页文档浏览

打开「**插件 → DSH 文档**」，即可在 DSH 内直接阅读 [DeepSeek Harness 官方文档站](https://deepseek-harness.github.io/deepseek-harness/)，支持右上角切换中文 / English、返回文档首页或在浏览器中打开。

### 智能体工具（仅 Creator 模式）

Creator 模式下，智能体自动获得以下只读工具；其他模式不会向会话注册这两个工具：

| 工具 | 主要能力 |
| --- | --- |
| `dsh_docs` | 按标题、分类或路径搜索官方文档索引（`search`），并按返回的文档 ID 分段读取正文（`fetch`）。 |
| `dsh_plugins` | 从 klarkxy 目录、npm 或 GitHub 搜索插件候选（`search`），读取指定包的 npm 元数据与版本（`fetch_npm`），或读取 GitHub 仓库元数据并将分支解析为可锁定的 commit spec（`fetch_github`）。 |

同一模式下，系统提示还会引导智能体优先通过 `dsh_docs` 核对官方 API，并配合 `cordis_inspect_list` 与 `cordis_inspect_query` 查验运行时接口合约。

## 主要限制

- 两个工具仅在 Creator 模式下提供，且严格只读；插件的安装与卸载仍需由用户通过 DSH 插件管理器完成。
- 官方文档站跟随最新发布版本，内容可能与你本地运行的 DSH 存在差异。
- npm 与 GitHub 元数据仅反映包或仓库的声明信息，不构成运行时兼容性证明；使用前请核对宿主版本与依赖要求。
- GitHub 查询优先复用本机已登录的 `gh` CLI，未登录时仓库搜索与元数据读取回退到匿名 GitHub API（受匿名每小时配额限制），插件本身不保存任何 GitHub 凭据；按 `dsh.plugin.json` 清单进行代码搜索（`github-code`）必须先登录 `gh` CLI。
- 取消最后一个使用 `gh` CLI 的请求时，会等待该检查停止；卸载插件时会等待进行中的 GitHub 请求与 CLI 进程退出。

## 从 GitHub 安装

```sh
dsh plugin --profile web add "github:klarkxy/dsh-plugins#path:/plugins/dsh-dev-index"
```

从 GitHub 安装会在本机执行构建，pnpm 会先提示需要允许构建脚本。将以下配置写入 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 后，再次执行安装命令：

```yaml
allowBuilds:
  '@klarkxy/dsh-dev-index': true
```

## 许可证

[SATA License 2.1](LICENSE)
