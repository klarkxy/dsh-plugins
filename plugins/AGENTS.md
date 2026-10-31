# plugins/ 专项规则

在 `plugins/**` 下开发插件时适用；通用规则见根目录 `AGENTS.md`。

## 官方包依赖约定

`@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 由宿主运行时提供，声明在 `peerDependencies` 与 `devDependencies` 中，版本范围只写开放下界（写精确版本或 `<0.2.0` 上界会让 loader 命中 pnpm 装进 profile 的旧拷贝，导致版本检查失败并停用插件）。

- 宿主包含的包（对照 DSH 安装目录 `node_modules/@deepseek-ai`）：`peerDependencies` 写开放下界（`>=0.1.7-rc.2`）+ `peerDependenciesMeta` 标 `optional: true`（避免 auto-install-peers 安装物理副本）；`devDependencies` 保留精确版本供 typecheck/测试。
- 宿主未内置的包（如 `@deepseek-ai/dsh-web-search-exa`）：放入 `dependencies`，同样写开放下界。
- `engines.dsh` 同样只写开放下界。
- 例外：确需独立副本的无状态工具包可放 `dependencies`，先确认宿主安装目录里未内置。

## 自动触发的作用域

挂在 `agent/pre-step`、`agent/turn-stopping`、`agent/status`、`session/event` 等**全局**事件上的插件，派发按线程数放大（N 个子代理多出 N 份调用）。

- **写入与派生默认只覆盖真人顶层会话**：纪要、检查点、观察记录、标题等落盘或调模型的自动行为，先用 plugin-kit 的 `isSubagentSession(session)` 仅对真人顶层会话生效；手动触发（RPC、插件页按钮）在各会话均可使用。
- **只读注入可保留**：记忆/经验注入只读数据，可直接注入。
- **跨子线程必须显式 opt-in** 并在注释写明理由。

判据只用 `session.header`（宿主建会话时的持久快照）；`SubagentStartRequest.prompt` 同样以 `message.source.kind === 'user'` 投递，因此真人分叉与子线程的区分逻辑（`origin`、`delegationDepth`、`isSeeded`、`parentSession` 等）统一调用 plugin-kit 的实现，参考 `dsh-safe-auto`。自建 `AbortController` 用 `AbortSignal.any([宿主 signal, 自己的])` 合并。

## 客户端 UI：@deepseek-ai/dsh-client-ui-primitives

宿主提供的纯 React 原子组件包（控件、图标、Markdown、JSON 检视器、设置表单套件、定位/浮层 hook；清单看包导出）。浏览器端界面直接用它拼装，跟随宿主外观演进。唯一例外是原生 `<select>`：保留平台控件并套用 plugin-kit 的 `dsh-ui-select`。

固定三步（参照 `plugins/dsh-zhihu`）：`package.json` 的 `dsh.bundle.client.inject` 列出该包（运行时由宿主注入）；作为官方包约定的特例，它只在 `devDependencies` 写精确版本（运行时兼容由 inject 保证）；`tsdown.config.ts` 的 `deps.neverBundle` 含 `react`、`react/jsx-runtime`、该包（用 `react-dom` 时一并加入），plugin-kit 浏览器安全入口（`client-utils`、`official-ui`、`model-menu`、`contracts`）放 `alwaysBundle`。

样式：排版、卡片、表单、横幅、空态、浮层用 plugin-kit `official-ui` 的 `officialUiCss(roots)`，限定在插件根类名下；颜色、圆角、层级、焦点环直接使用宿主 `--dsw-*` token（白名单 `OFFICIAL_THEME_TOKEN_NAMES`），由 token 守卫测试校验；`Modal`/`Menu` portal 到 `document.body`，浮层在 portal 内部元素上单独挂根类名。

测试：vitest 经 `vitest.editor-plugins.config.ts` 别名指向 `scripts/editor-plugins/ui-primitives-stub.tsx`；Node SSR 测试在 `require` 层打桩，保持在 jsdom 与打桩环境内运行。

## 插件配置入口

插件设置统一注册 `plugins.bundle.config`（`key` 为 npm 包名）；单 bundle 行设置用 `plugins.row.config`。设置入口集中在插件页，由 `slots.inject()` 等待宿主声明并负责卸载；标题导航由宿主插件页提供。功能搜索面板可保留，凭据设置统一放在插件配置页。迁移入口保留 RPC、凭据引用、存储结构和已保存开关，仅做本地读写。

新增或迁移时运行 `node --test scripts/plugin-settings.test.mjs`、`pnpm test:editor-build` 及相关插件测试；网络搜索另有 `pnpm test:e2e:web-search` 浏览器回归。
