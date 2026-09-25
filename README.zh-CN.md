# dsh-plugins

[English documentation](README.md)

这是一个用于收纳轻量 DeepSeek Harness 插件的 pnpm monorepo。`plugins/` 下的每个目录都是可以独立安装、测试和发布的 DSH bundle 或原生 Preset；仓库根目录本身不是插件。

## 插件与 Preset

| 包 | 作用 |
| --- | --- |
| [`dsh-current-title`](plugins/dsh-current-title/README.zh-CN.md) | 用 `MMDD | 本地化类型 | 摘要` 让会话标题持续反映当前任务。 |
| [`dsh-dev-index`](plugins/dsh-dev-index/README.zh-CN.md) | 为做 DSH 二次开发的 agent 索引 DeepSeek Harness 的功能与扩展点。 |
| [`dsh-pruner`](plugins/dsh-pruner/README.zh-CN.md) | 删繁：保持受支持行为，以证据驱动删除和合并概念的原生 Preset。 |

标题插件可以直接从 GitHub 仓库的指定子目录安装单个插件：

```sh
dsh plugin --profile web add "github:klarkxy/dsh-plugins#path:/plugins/dsh-current-title"
```

Git 源码安装需要一次性加入 pnpm 构建白名单；具体 profile 配置和平台说明请查看插件文档。

给 agent 的开发索引在 [https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/)（`llms.txt`、`index.json`、`meta.json`，以及每个主题一篇 markdown）。本仓库的 `docs/` 是唯一副本。`docs/meta.json` 用 `officialTag` 和 `officialCommit` 记录这些页面所描述的 DeepSeek Harness 修订。`dsh-dev-index` 插件不携带这些页面。它的 skill 让 agent 去拉取站点；Pages 没有响应时，回退到 `main` 上的原始文件 `https://raw.githubusercontent.com/klarkxy/dsh-plugins/main/docs/`。每日更新步骤在 [docs/REFRESH.md](docs/REFRESH.md)。需要在本仓库的 Settings → Pages 中把来源设为 GitHub Actions。工作流是 `.github/workflows/pages.yml`。这个设置打开之前，站点 URL 不会提供内容。本树进入 `main` 之后，原始文件 URL 仍然可以访问。

## 开发

需要 Node.js 22+ 与 pnpm 10。

```bash
pnpm install
pnpm check
```

每个包自行维护资源、测试和版本号。原生 Preset 的安装方式见对应文档，不需要额外运行时插件或构建。

## 许可证

[SATA License 2.1](LICENSE)
