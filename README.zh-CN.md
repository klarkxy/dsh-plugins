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

开发索引同时发布在 [https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/)（`index.json`、`llms.txt`，以及每个主题一篇 markdown）。需要在本仓库的 Settings → Pages 中把来源设为 GitHub Actions。工作流是 `.github/workflows/pages.yml`。这个设置打开之前，站点 URL 不会提供内容。已安装的插件仍然带有同一份离线文件。

## 开发

需要 Node.js 22+ 与 pnpm 10。

```bash
pnpm install
pnpm check
```

每个包自行维护资源、测试和版本号。原生 Preset 的安装方式见对应文档，不需要额外运行时插件或构建。

## 许可证

[SATA License 2.1](LICENSE)
