# dsh-plugins

简体中文 / [English](README.md)

这是一个用于收纳轻量 DeepSeek Harness 插件的 pnpm monorepo。`plugins/` 下的每个包都是可以独立安装、测试和发布的 DSH bundle 或原生 Preset。

本 README 同时汇总 klarkxy 已在 npm 公开发布的 DSH 插件，包括在其他仓库维护的包；可浏览的版本见[插件站点](https://klarkxy.github.io/dsh-plugins/)。每次发布新插件时，都应在 `site/catalog.json` 和中英文 README 中补上条目。

## 已发布插件

在别处维护的插件，包名指向 npm；本仓库发布的两个插件，包名指向包内 README，最后一列给出另一个入口。安装方式、宿主兼容性和配置要求见各插件文档。

| 包 | 作用 | 文档 / npm |
| --- | --- | --- |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.zh-CN.md) | DSH 文档：在插件页阅读官方文档；创造模式用原生工具搜索文档、查核插件 npm 元数据。 | [npm](https://www.npmjs.com/package/@klarkxy/dsh-dev-index) |
| [`@klarkxy/dsh-pruner`](plugins/dsh-pruner/README.zh-CN.md) | 代码精简：审查并精简代码，保留现有行为，削减冗余和多余抽象。 | [npm](https://www.npmjs.com/package/@klarkxy/dsh-pruner) |
| [`@klarkxy/dsh-current-title`](https://www.npmjs.com/package/@klarkxy/dsh-current-title) | 自动标题：会话标题跟随最新任务更新，手动命名不被覆盖。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title#readme) |
| [`@klarkxy/dsh-fusion`](https://www.npmjs.com/package/@klarkxy/dsh-fusion) | 副驾协作：常驻副驾与主助手搭配，结果由你确认后采纳。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-fusion#readme) |
| [`@klarkxy/dsh-memory`](https://www.npmjs.com/package/@klarkxy/dsh-memory) | 长期记忆：按作用域记住术语、偏好和近期动态，由 Dream 定期整理。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-memory#readme) |
| [`@klarkxy/dsh-mood`](https://www.npmjs.com/package/@klarkxy/dsh-mood) | 需求记录：由当前代理记录、读取和更新本次任务需求。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-mood#readme) |
| [`@klarkxy/dsh-recap`](https://www.npmjs.com/package/@klarkxy/dsh-recap) | 会话纪要：后台生成纪要，并注入有长度限制的智能体检查点。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-recap#readme) |
| [`@klarkxy/dsh-self-improvement`](https://www.npmjs.com/package/@klarkxy/dsh-self-improvement) | 经验学习：从结果证据总结带适用条件的做法，可选导出为技能。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-self-improvement#readme) |
| [`@klarkxy/dsh-web-search-manager`](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) | 网页搜索：在一个设置页管理搜索服务商和公开页面抓取。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-web-search-manager#readme) |
| [`@klarkxy/dsh-zhihu`](https://www.npmjs.com/package/@klarkxy/dsh-zhihu) | 知乎：知乎搜索、智能体工具、知识库和用量跟踪。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-zhihu#readme) |
| [`dsh-plugin-autoevo`](https://www.npmjs.com/package/dsh-plugin-autoevo) | 发现、审查和安装可复用能力。 | [文档](https://github.com/klarkxy/dsh-plugin-autoevo#readme) |

## 未发布的开发包

| 包 | 作用 | 状态 |
| --- | --- | --- |
| [`@klarkxy/dsh-classmates`](plugins/dsh-classmates/README.zh-CN.md) | 队友角色：配置可复用的队友角色，增强原生 Team 界面。 | 本地 alpha；不参与自动 npm 发布，不收录到插件站。 |

从本地 `dsh-teammates` 目录迁入，详见[迁移记录](docs/classmates-migration.md)。

## 安装

已发布的插件从 npm 安装：

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
dsh plugin --profile web add @klarkxy/dsh-pruner
```

创造模式通过 `dsh-dev-index` 的 `dsh_docs_search`/`dsh_docs_fetch` 在线读取[官方 DSH 文档](https://deepseek-harness.github.io/deepseek-harness/)并核对运行时接口，用 `dsh_plugins_search`/`dsh_plugins_fetch` 在安装前查核插件的 npm 元数据。

## 插件站点

[https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/) 用中英文列出全部插件，每个插件都有独立详情页：按依赖顺序排好的安装命令、包内 README、运行要求和版本记录。站点同时提供 `plugins.json` 与 `llms.txt`，方便工具和智能体读取。

唯一需要手工维护的数据是 `site/catalog.json`：slug、包名、分类、中英文标题与简介、README 路径和源码仓库。版本、日期、依赖、README 和图标在构建时从 npm 与 jsDelivr 读取，所以在其他仓库发布的版本不用在这里提交就会出现。

```bash
pnpm site:build   # 读取线上数据，生成 _site/
pnpm site:test    # 离线渲染测试，也包含在 pnpm check 中
```

`.github/workflows/pages.yml` 在 `main` 每次推送、每次 npm 发布流程结束后以及每天一次构建并部署 `_site/`。npm 或 jsDelivr 不可用时构建失败，线上保留上一次部署。仓库的 Pages 来源需设为 GitHub Actions；旧开发索引地址（如 `/areas/*.html`）会跳转到 DSH 官方文档。

## 开发

需要 Node.js 24+ 与 pnpm 10。

```bash
pnpm install
pnpm check
```

每个包自行维护资源、测试和版本号。原生 Preset 不需要额外运行时插件或构建，仓库根目录本身不是 DSH bundle。

## npm 自动发布

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
