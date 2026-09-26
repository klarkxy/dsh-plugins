# dsh-plugins

[English documentation](README.md)

这是一个用于收纳轻量 DeepSeek Harness 插件的 pnpm monorepo。`plugins/` 下的每个目录都是可以独立安装、测试和发布的 DSH bundle 或原生 Preset；仓库根目录本身不是插件。

## 插件与 Preset

| 包 | 作用 |
| --- | --- |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.zh-CN.md) | 轻量 skill，把 agent 指到官方 DSH 文档、插件开发技能和运行时检查。 |
| [`@klarkxy/dsh-pruner`](plugins/dsh-pruner/README.zh-CN.md) | 删繁：保持受支持行为，以证据驱动删除和合并概念的原生 Preset。 |

可以从 npm 安装单个插件：

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
dsh plugin --profile web add @klarkxy/dsh-pruner
```

`dsh-dev-index` 不保留文档副本。官方文档在 [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)（简体中文在根路径，英文在 `/en/`）。[https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/) 会跳到那里，旧路径也一样。GitHub Pages 通过 `.github/workflows/pages.yml` 发布 `docs/` 里的跳转页。需要在本仓库的 Settings → Pages 中把来源设为 GitHub Actions，这个 URL 才会提供内容。

## 开发

需要 Node.js 22+ 与 pnpm 10。

```bash
pnpm install
pnpm check
```

每个包自行维护资源、测试和版本号。原生 Preset 的安装方式见对应文档，不需要额外运行时插件或构建。

## npm 自动发布

所有 `plugins/dsh-xxx` 包统一命名为 `@klarkxy/dsh-xxx`，并设置公开 npm registry。`.github/workflows/npm-publish.yml` 在 `main` 更新时检查各包；也可以在 Actions 页面手动运行来重试，不需要推送版本标签。

流程先构建，再按 `npm pack` 的文件清单计算内容指纹，与 npm 已发布包比较。只有内容变更或显式提高版本的包才发布。仅更新仓库文档、索引网站或未进入包的测试文件，不会产生新 npm 版本。版本字段和 CI 自己写入的 `dshRelease.contentHash` 不参与指纹，避免重复发布。

首次发布沿用包内版本；显式指定的更高版本优先。内容改变但版本未提高时，稳定版自动增加 patch，预发布版增加预发布序号。CI 同步 `package.json` 与存在的 `dsh.plugin.json`，完成检查后发布并验证归档，再提交版本写回 `main`。正式版使用 `latest`，预发布使用 `next`。新功能或不兼容改动应手动选择合适的 minor/major，自动 patch 不替代兼容性判断。

发布串行执行，旧提交会跳过，版本写回使用普通快进推送；不会覆盖并发提交。机器人提交不会递归触发工作流。npm 返回的归档完整性必须与本次产物一致才算成功。失败后可在最新 `main` 上重跑；已成功发布且内容未变的包会跳过。

npm 发布后可能先进行扫描。CI 先提交所有变更包，再等待最多 20 分钟，并匿名下载归档校验；超时会明确失败，已被接受的版本不会在重试时重复提交。

仓库 Actions secret `NPM_TOKEN` 用于首次发布。之后可为每个包配置 [Trusted Publisher](https://docs.npmjs.com/trusted-publishers/)：GitHub 用户 `klarkxy`、仓库 `dsh-plugins`、工作流 `npm-publish.yml`、环境名留空，并允许直接发布；绑定后可移除 token。版本回写需要工作流的 `contents: write` 权限，以及允许机器人推送 `main` 的分支规则。

## 许可证

[SATA License 2.1](LICENSE)
