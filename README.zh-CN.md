# dsh-plugins

简体中文 / [English](README.md)

这是一个用于收纳轻量 DeepSeek Harness 插件与共享库的 pnpm monorepo。`plugins/` 下的每个包独立测试和发布；DSH bundle 与原生 Preset 通过宿主安装。

本 README 同时汇总 klarkxy 已在 npm 公开发布的 DSH 插件，包括在其他仓库维护的包；可浏览的版本见[插件站点](https://klarkxy.github.io/dsh-plugins/)。预发布包列在中英文 README 中；DSH 插件有 npm `latest` 版本后再加入 `site/catalog.json`。

## 已发布插件

包名指向 npm 或包内 README，最后一列给出另一个入口。安装方式、宿主兼容性和配置要求见各插件文档。已退役的包仍在 npm 保留历史版本。

| 包 | 作用 | 文档 / npm |
| --- | --- | --- |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.zh-CN.md) | DSH 文档：在插件页阅读官方文档；创造模式用原生工具搜索文档、查核插件 npm 元数据。 | [npm](https://www.npmjs.com/package/@klarkxy/dsh-dev-index) |
| [`@klarkxy/dsh-pruner`](https://www.npmjs.com/package/@klarkxy/dsh-pruner) | 本地已退役，npm 保留历史版本。 | [npm](https://www.npmjs.com/package/@klarkxy/dsh-pruner) |
| [`@klarkxy/dsh-current-title`](https://www.npmjs.com/package/@klarkxy/dsh-current-title) | 自动标题：会话标题跟随最新任务更新，手动命名不被覆盖。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title#readme) |
| [`@klarkxy/dsh-fusion`](https://www.npmjs.com/package/@klarkxy/dsh-fusion) | 本地已退役，保留历史记录；新任务使用 Classmates 角色与原生委派。 | [迁移](plugins/dsh-classmates/docs/fusion-migration.md) |
| [`@klarkxy/dsh-mood`](https://www.npmjs.com/package/@klarkxy/dsh-mood) | 本地已退役，npm 保留历史版本。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/078b69632ddf054a404fcb81c2543dc8887e2acc/plugins/dsh-mood#readme) |
| [`@klarkxy/dsh-recap`](https://www.npmjs.com/package/@klarkxy/dsh-recap) | 本地已退役，npm 保留历史版本。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/078b69632ddf054a404fcb81c2543dc8887e2acc/plugins/dsh-recap#readme) |
| [`@klarkxy/dsh-web-search-manager`](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) | 网页搜索：在一个设置页管理搜索服务商和公开页面抓取。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-web-search-manager#readme) |
| [`@klarkxy/dsh-zhihu`](https://www.npmjs.com/package/@klarkxy/dsh-zhihu) | 知乎：知乎搜索、智能体工具、知识库和用量跟踪。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-zhihu#readme) |
| [`@klarkxy/dsh-git-commit`](https://www.npmjs.com/package/@klarkxy/dsh-git-commit) | Git 提交：在对话标题栏提交工作区改动，由模型规划分组并生成提交信息。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-git-commit#readme) |
| [`dsh-plugin-autoevo`](https://www.npmjs.com/package/dsh-plugin-autoevo) | 发现、审查和安装可复用能力。 | [文档](https://github.com/klarkxy/dsh-plugin-autoevo#readme) |

## 预发布包（`next`）

| 包 | 作用 | 状态 |
| --- | --- | --- |
| [`@klarkxy/dsh-classmates`](plugins/dsh-classmates/README.zh-CN.md) | 队友角色：为原生委派维护角色和模型用途配置。 | `next` 候选版；不收录到稳定插件目录。 |
| [`@klarkxy/dsh-safe-auto`](plugins/dsh-safe-auto/README.zh-CN.md) | Safe Auto：沙箱提权由独立审核模型把关，通过才自动放行。 | npm 发布候选版；插件站 catalog 只收录稳定版。 |
| [`@klarkxy/dsh-blueprint`](plugins/dsh-blueprint/README.zh-CN.md) | Blueprint：把一套插件组合分享成带确切版本的蓝图码。 | npm 预览版；插件站 catalog 只收录稳定版。 |
| [`@klarkxy/dsh-font`](plugins/dsh-font/docs/README.zh-CN.md) | 字体：自定义 Web GUI 的界面字体、代码字体与会话字号。 | `next` 候选版；不收录到稳定插件目录。 |
| [`@klarkxy/dsh-model-hub`](plugins/dsh-model-hub/docs/README.zh-CN.md) | 模型枢纽：编辑已安装插件暴露的模型字段。 | `next` 候选版。 |
| [`@klarkxy/dsh-session-manager`](plugins/dsh-session-manager/README.zh-CN.md) | 会话管理：跨工作目录查找会话并读取对话。 | `next` 候选版；高级线程操作需要附带的宿主补丁。 |

从本地 `dsh-teammates` 目录迁入，详见[迁移记录](docs/classmates-migration.md)。

## 安装

已发布的插件用 DSH 插件管理器安装，包从 npm registry 拉取：

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
dsh plugin --profile web add @klarkxy/dsh-pruner
```

把 `web` 换成你的 profile 名，安装后重启该 profile。每个插件在[插件站点](https://klarkxy.github.io/dsh-plugins/)的详情页都有一份按依赖顺序排好的安装命令。

创造模式通过 `dsh-dev-index` 的 `dsh_docs_search`/`dsh_docs_fetch` 在线读取[官方 DSH 文档](https://deepseek-harness.github.io/deepseek-harness/)并核对运行时接口，用 `dsh_plugins_search`/`dsh_plugins_fetch` 在安装前查核插件的 npm 元数据。

## 插件站点

[https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/) 用中英文列出全部插件，每个插件都有独立详情页：按依赖顺序排好的安装命令、包内 README、运行要求和版本记录。站点同时提供 `plugins.json` 与 `llms.txt`，方便工具和智能体读取。

唯一需要手工维护的数据是 `site/catalog.json`：slug、包名、分类、中英文标题与简介、README 路径和源码仓库。版本、日期、依赖、README 和图标在构建时从 npm registry 与经过完整性校验的 npm 发布包读取，所以在其他仓库发布的版本不用在这里提交就会出现。

```bash
pnpm site:build   # 读取线上数据，生成 _site/
pnpm site:test    # 离线渲染测试，也包含在 pnpm check 中
```

`.github/workflows/pages.yml` 在 `main` 每次推送、每次 npm 发布流程结束后以及每天一次构建并部署 `_site/`。npm 不可用或发布包校验失败时构建失败，线上保留上一次部署。仓库的 Pages 来源需设为 GitHub Actions；旧开发索引地址（如 `/areas/*.html`）会跳转到 DSH 官方文档。

## 开发

需要 Node.js 24+ 与 pnpm 10。

```bash
pnpm install
pnpm check
```

每个包自行维护资源、测试和版本号。原生 Preset 不需要额外运行时插件或构建，仓库根目录本身不是 DSH bundle。

## npm 自动发布

`scripts/npm-release-holds.json` 记录尚待验收的包。暂缓名单同时用于生成发布计划和执行发布，旧计划也不能绕过。解除某个包前，须检查最终打包内容、通过相关测试，并在目标 DSH 宿主验收新行为（包括打包进去的工作区依赖）。私有开发包继续参与构建与测试。

`plugins/dsh-xxx` 包统一命名为 `@klarkxy/dsh-xxx`，公开包设置公开 npm registry；标记 `private: true` 的开发包参与检查，但不参与自动发布。`.github/workflows/npm-publish.yml` 在 `main` 更新时检查各包，也可以在 Actions 页面手动运行来重试，不需要推送版本标签。

流程先构建，再按 `npm pack` 的文件清单计算内容指纹并与 npm 已发布包比较，只有内容变更或显式提高版本的包才发布。仅更新仓库文档、索引网站或未进入包的测试文件，不会产生新 npm 版本；版本字段和 CI 自己写入的 `dshRelease.contentHash` 不参与指纹，避免重复发布。

首次发布沿用包内版本，显式指定的更高版本优先。内容改变但版本未提高时，稳定版自动增加 patch，预发布版增加预发布序号。CI 同步 `package.json` 与存在的 `dsh.plugin.json`，完成检查后发布并验证归档，再提交版本写回 `main`；正式版使用 `latest`，预发布使用 `next`。新功能或不兼容改动应手动选择合适的 minor/major，自动 patch 不替代兼容性判断。

发布串行执行：旧提交会跳过，版本写回使用普通快进推送，不覆盖并发提交。机器人提交不会递归触发工作流；只有 registry 归档完整性与本次产物一致才算成功。失败后可在最新 `main` 上重跑，已成功发布且内容未变的包会跳过。

npm 发布后可能先进行扫描，因此 CI 先提交所有变更包，再等待最多 20 分钟并匿名下载归档校验；超时会明确失败，已被接受的版本不会在重试时重复提交。

仓库 Actions secret `NPM_TOKEN` 用于首次发布。之后可为每个包配置 [Trusted Publisher](https://docs.npmjs.com/trusted-publishers/)：GitHub 用户 `klarkxy`、仓库 `dsh-plugins`、工作流 `npm-publish.yml`、环境名留空，并允许直接发布；绑定后可移除 token。版本回写需要工作流的 `contents: write` 权限，以及允许机器人推送 `main` 的分支规则。

## 许可证

[SATA License 2.1](LICENSE)

## Editor 公共插件迁移

从 Editor 提取的可独立运行的包现已迁入 `plugins/`，包名、工具行为与持久化设置保持不变；知乎改用包内结构化控件适配，解除私有 UI 依赖。稿纸、校对及应用私有包仍留在 Editor，桌面预装和离线启动方式不变。范围、交接与验收记录见[迁移文档](docs/editor-plugin-migration.md)。
