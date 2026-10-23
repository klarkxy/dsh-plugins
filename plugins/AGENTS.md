# plugins/ 专项规则

在 `plugins/**` 下开发插件时适用；通用规则见根目录 `AGENTS.md`。

## 官方包依赖约定

`@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 由宿主运行时提供，**永不进 `dependencies`**，任何字段不写死精确版本或 `<0.2.0` 这类上界——写死会让 loader 命中 pnpm 装进 profile 的旧拷贝，版本检查失败直接禁用插件。

- 宿主包含的包（对照 DSH 安装目录 `node_modules/@deepseek-ai`）：`peerDependencies` 写开放下界（`>=0.1.7-rc.2`）+ `peerDependenciesMeta` 标 `optional: true`（防 auto-install-peers 装物理副本）；`devDependencies` 保留精确版本供 typecheck/测试。
- 宿主不含的包（如 `@deepseek-ai/dsh-web-search-exa`）：留 `dependencies`，同样开放下界。
- `engines.dsh` 也只写开放下界。
- 例外：确需独立副本的无状态工具包可进 `dependencies`，先确认宿主安装目录里没有。

## 自动触发的作用域

挂在 `agent/pre-step`、`agent/turn-stopping`、`agent/status`、`session/event` 等**全局**事件上的插件，派发按线程数放大（N 个子代理多出 N 份调用）。

- **写入与派生默认只覆盖真人顶层会话**：纪要、检查点、观察记录、标题等落盘或调模型的自动行为，先用 plugin-kit 的 `isSubagentSession(session)` 排除子线程；手动触发（RPC、插件页按钮）不受限。
- **只读注入可保留**：记忆/经验注入不写盘不调模型。
- **跨子线程必须显式 opt-in** 并在注释写明理由。

判据只用 `session.header`（宿主建会话时的持久快照），不推断消息作者；**不要用 `message.source.kind === 'user'` 判断真人**——`SubagentStartRequest.prompt` 就是作为子线程的 user 消息投递，与真人输入无法区分。真人分叉与子线程的区分逻辑（`origin`、`delegationDepth`、`isSeeded`、`parentSession` 等）以 plugin-kit 实现为准，不要各插件各抄一份；`dsh-safe-auto` 是落地样例。自建 `AbortController` 用 `AbortSignal.any([宿主 signal, 自己的])` 合并。

## 客户端 UI：@deepseek-ai/dsh-client-ui-primitives

宿主提供的纯 React 原子组件包（控件、图标、Markdown、JSON 检视器、设置表单套件、定位/浮层 hook；清单看包导出）。浏览器端界面用它拼装，不重画宿主控件，抄一份换肤就掉队。唯一例外是原生 `<select>`：官方没有，保留平台控件套 plugin-kit 的 `dsh-ui-select`。

固定三步（照抄 `plugins/dsh-zhihu`）：`package.json` 的 `dsh.bundle.client.inject` 列出该包（运行时宿主注入）；它是官方包约定的例外——不进 `dependencies`/`peerDependencies`，只在 `devDependencies` 写精确版本（兼容由 inject 保证）；`tsdown.config.ts` 的 `deps.neverBundle` 含 `react`、`react/jsx-runtime`、该包（用 `react-dom` 时加它），plugin-kit 浏览器安全入口（`client-utils`、`official-ui`、`model-menu`、`contracts`）放 `alwaysBundle`。

样式：排版、卡片、表单、横幅、空态、浮层用 plugin-kit `official-ui` 的 `officialUiCss(roots)`，限定在插件根类名下；颜色、圆角、层级、焦点环直接写宿主 `--dsw-*` token（白名单 `OFFICIAL_THEME_TOKEN_NAMES`），不起别名、不带回落——写错静默丢样式，token 守卫测试会拦；`Modal`/`Menu` portal 到 `document.body`，浮层要在 portal 内部元素上单独挂根类名。

测试：vitest 经 `vitest.editor-plugins.config.ts` 别名指向 `scripts/editor-plugins/ui-primitives-stub.tsx`；Node SSR 测试在 `require` 层打桩；不要为跑通测试引入真实组件包或 jsdom 以外环境。

## 插件配置入口

插件设置统一注册 `plugins.bundle.config`（`key` 为 npm 包名）；单 bundle 行设置用 `plugins.row.config`。不注册 `settings.section`、`settings.plugins.tab` 或旧的 `dsh-editor.settings.*`，插件页未声明时不回退全局设置。`slots.inject()` 等宿主声明并负责卸载；标题导航由宿主插件页提供。功能搜索面板可保留，但不重复提供凭据设置。迁移入口保留 RPC、凭据引用、存储结构和已保存开关，不触发模型调用。

新增或迁移时运行 `node --test scripts/plugin-settings.test.mjs`、`pnpm test:editor-build` 及相关插件测试；网络搜索另有 `pnpm test:e2e:web-search` 浏览器回归。
