# dsh-plugins

当前工作区适配 DSH **0.2.0-rc.2**，开发基线同时使用 Cordis **4.0.4** 与 Schemastery **3.18.4**。开发依赖统一锁定版本，插件的宿主兼容范围保持开放下界，DSH 宿主包仍为可选 peer。本次源码升级不代表 npm 上的包已更新。

简体中文 / [English](README.md)

这是一个用于收纳轻量 DeepSeek Harness 插件与共享库的 pnpm monorepo。`plugins/` 下的每个包独立测试和发布；DSH bundle 与原生 Preset 通过宿主安装。

本 README 同时汇总 klarkxy 已在 npm 公开发布的 DSH 插件，包括在其他仓库维护的包；可浏览的版本见[插件站点](https://klarkxy.github.io/dsh-plugins/)。预发布包列在中英文 README 中；DSH 插件有 npm `latest` 版本后再加入 `site/catalog.json`。

## 已发布插件

包名指向 npm 或包内 README，最后一列给出另一个入口。安装方式、宿主兼容性和配置要求见各插件文档。已退役的包仍在 npm 保留历史版本。

| 包 | 作用 | 文档 / npm |
| --- | --- | --- |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.zh-CN.md) | DSH 文档：在插件页阅读官方文档；创造模式用原生工具搜索文档、查核插件 npm 元数据。 | [npm](https://www.npmjs.com/package/@klarkxy/dsh-dev-index) |
| [`@klarkxy/dsh-current-title`](https://www.npmjs.com/package/@klarkxy/dsh-current-title) | 自动标题：会话标题跟随最新任务更新，手动命名不被覆盖。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title#readme) |
| [`@klarkxy/dsh-web-search-manager`](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) | 网页搜索：在一个设置页管理搜索服务商和公开页面抓取。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-web-search-manager#readme) |
| [`@klarkxy/dsh-zhihu`](https://www.npmjs.com/package/@klarkxy/dsh-zhihu) | 知乎：知乎搜索、智能体工具、知识库和用量跟踪。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-zhihu#readme) |
| [`@klarkxy/dsh-git-commit`](https://www.npmjs.com/package/@klarkxy/dsh-git-commit) | Git 提交：在对话标题栏提交工作区改动，由模型规划分组并生成提交信息。 | [文档](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-git-commit#readme) |
| [`dsh-plugin-autoevo`](https://www.npmjs.com/package/dsh-plugin-autoevo) | 发现、审查和安装可复用能力。 | [文档](https://github.com/klarkxy/dsh-plugin-autoevo#readme) |
| [`@klarkxy/dsh-safe-auto`](plugins/dsh-safe-auto/README.zh-CN.md) | Safe Auto：沙箱提权由独立审核模型把关，通过才自动放行。 | [npm](https://www.npmjs.com/package/@klarkxy/dsh-safe-auto) |
| [`@klarkxy/dsh-session-manager`](plugins/dsh-session-manager/README.zh-CN.md) | 会话管理：跨工作目录查找会话并读取对话；高级线程操作需要附带的宿主补丁。 | [npm](https://www.npmjs.com/package/@klarkxy/dsh-session-manager) |
| [`@klarkxy/dsh-chatgpt`](plugins/dsh-chatgpt/README.zh-CN.md) | ChatGPT 工具：通过官方本地 Codex 运行时提供搜索、图像生成/编辑与视觉。 | [npm](https://www.npmjs.com/package/@klarkxy/dsh-chatgpt) |
| [`@klarkxy/dsh-grok-build`](plugins/dsh-grok-build/README.zh-CN.md) | Grok Build：通过官方本地 CLI 提供搜索、抓取、图像与视频。 | [npm](https://www.npmjs.com/package/@klarkxy/dsh-grok-build) |
| [`@klarkxy/dsh-minimax-code`](plugins/dsh-minimax-code/README.zh-CN.md) | MiniMax Code：通过官方工具提供媒体生成、转写与理解。 | [npm](https://www.npmjs.com/package/@klarkxy/dsh-minimax-code) |
| [`@klarkxy/dsh-font`](plugins/dsh-font/docs/README.zh-CN.md) | 字体：自定义 Web GUI 的界面字体、代码字体与会话字号。 | [npm](https://www.npmjs.com/package/@klarkxy/dsh-font) |
| [`@klarkxy/dsh-model-hub`](plugins/dsh-model-hub/docs/README.zh-CN.md) | 模型枢纽：编辑已安装插件暴露的模型字段。 | [npm](https://www.npmjs.com/package/@klarkxy/dsh-model-hub) |
| [`@klarkxy/dsh-unrestricted`](plugins/dsh-unrestricted/README.zh-CN.md) | 破限：按破限交付契约回答的会话 Preset，只作用于选用它的会话。 | [npm](https://www.npmjs.com/package/@klarkxy/dsh-unrestricted) |


## 安装

已发布的插件用 DSH 插件管理器安装，包从 npm registry 拉取：

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
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

需要 Node.js 24+（已验证 26；26 尚未 LTS）与 pnpm 10。

```bash
pnpm install
pnpm check
```

每个包自行维护资源、测试和版本号。原生 Preset 不需要额外运行时插件或构建，仓库根目录本身不是 DSH bundle。

## 插件生命周期

包的生命周期不可逆：草稿 → 测试中 → 已发布。完整规则见[发布指南](RELEASING.zh-CN.md)。

<!-- plugin-release-states:start -->
| 包 | 生命周期 | 说明 |
| --- | --- | --- |
| [@klarkxy/dsh-chatgpt](plugins/dsh-chatgpt/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-current-title](plugins/dsh-current-title/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-dev-index](plugins/dsh-dev-index/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-font](plugins/dsh-font/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-git-commit](plugins/dsh-git-commit/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-grok-build](plugins/dsh-grok-build/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-minimax-code](plugins/dsh-minimax-code/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-model-hub](plugins/dsh-model-hub/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-model-route](plugins/dsh-model-route/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-plugin-kit](plugins/dsh-plugin-kit/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-safe-auto](plugins/dsh-safe-auto/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-session-manager](plugins/dsh-session-manager/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-unrestricted](plugins/dsh-unrestricted/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-web-search-manager](plugins/dsh-web-search-manager/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-zhihu](plugins/dsh-zhihu/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
<!-- plugin-release-states:end -->


## 许可证

[SATA License 2.1](LICENSE)

## Editor 公共插件迁移

从 Editor 提取的可独立运行的包现已迁入 `plugins/`，包名、工具行为与持久化设置保持不变；知乎改用包内结构化控件适配，解除私有 UI 依赖。稿纸、校对及应用私有包仍留在 Editor，桌面预装和离线启动方式不变。范围、交接与验收记录见[迁移文档](docs/editor-plugin-migration.md)。
