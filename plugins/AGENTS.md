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

设置按**功能归属**落位，不再每插件一页：偏好类设置并入宿主设置页的对应分组（`settings.general.item`、`settings.models.footer` 等原生席位），动作类配置留在操作发生处的界面，需要独立导航的管理页才继续注册 `settings.section`。席位生命周期统一由 `slots.inject()` 等待宿主声明并负责卸载。

**合并分组席位**（如 `settings.general.item`、`settings.models.footer`）贡献 `{name, id, order}`：宿主不分组内导航，`label` 不显示，标题与分区由组件自己渲染；owner props 没有 `close` 之类的页面框架参数，组件不消费框架 props。分配表：

| 席位 | id / order |
| --- | --- |
| `settings.models.footer` | `magpie`/100 |
| `settings.section` | `font`/5 |
| 共享栏目「会话管理」 | `auxiliary-model`/55、`session-manager.composer`/60、`session-manager.auto-continue`/62、`session-manager.return`/64、`session-manager.handoff`/66、`session-manager.agent-actions`/68、`current-title`/70、`safe-auto`/80 |

「默认辅助模型」卡片（共享「会话管理」栏目的 `auxiliary-model` 行）是共享基础设施：由 plugin-kit 的 `registerAuxiliaryModelSettings` 在任一辅助功能插件启用时经 root 服务持有，不归属任何业务插件；它也经 root 持有栏目页面本身，任一辅助插件单独启用即创建栏目；卡片随最后一个参与者卸载，辅助功能的设置行不得各自重复注册同一席位 id。

**共享设置栏目是 UI 分组，不是业务归属**：多个插件共用一个设置栏目时，栏目由共享基础设施提供，各参与插件只贡献栏目内的一行。硬约束：共享栏目**不得让独立业务插件依赖某个业务插件充当页面提供者**——任一参与插件单独启用都使用同一页，且**任一参与插件启用即确保栏目存在**，不因别的参与插件缺席而丢失入口；栏目也**不做 `settings.general.item` 回退条目**，避免同一份设置在两处同时出现。

参与「会话管理」共享栏目的插件：`dsh-session-manager`、`dsh-current-title`、`dsh-safe-auto`；表内这一行的 id/order 是栏目内的行标识与顺序，不是宿主分组席位。`dsh-delegation` 不贡献设置行：委派只在创建会话页上按会话选择，全局默认开关已移除（已保存的默认存储值仍按旧语义读取）。栏目随参与者存亡：还有参与者时页面可用，全部卸载后页面随之释放；页面只渲染当前参与插件贡献的行，不残留已卸载插件的行。栏目 slot 名与页面 id 由共享契约单点定义，参与插件之间不互相导入、不互相依赖。`dsh-git-commit` 不贡献自己的栏目行，仅经 `registerAuxiliaryModelSettings` 参与共享的 `auxiliary-model` 行。

守卫不禁止共享栏目的页面注册，但禁止各参与插件各自注册独立页、禁止回到 `plugins.bundle.config` / `plugins.row.config` 旧页，也禁止参与插件之间的业务依赖。

**动作类配置不进设置页**：`dsh-git-commit` 的模型与 fallback 选择内嵌在会话头部提交弹窗（`conversation.session.header.actions`），不再注册任何设置席位。

**有意覆盖原生 cell**：插件自有设置页可以接管宿主原生设置项——`dsh-font` 的字体页（`settings.section` id `font`/order 5）在页在场时向 `settings.general.item` 注册同 id `font-size`、更低 `priority`（-10）的空渲染条目，把原生「字号」行遮蔽掉，避免同一份设置在两处同时出现。原生条目始终留在席位账本里（priority 0），页或插件卸载后立即恢复；没有自有页时不得屏蔽原生项。这属于**有意的 native cell 覆盖**，不是禁用 general 席位：其他插件照常按归属贡献分组行，覆盖只能针对一个原生 cell（复用同一 id、降优先级），不得新增第二行展示同一份设置。

**管理页保留 `settings.section`**：`font`（字体与字号）以及 `web-search-manager`/`zhihu`/`model-hub`/`shortcuts` 这类多供应商凭据、限流或多标签管理界面保留独立分区，`id`、`label`（本地化字符串或 thunk）与 `order` 沿用既有值，owner props 仍为宿主传入的 `close`。凭据设置放在设置页自己的分区里；迁移入口保留 RPC、凭据引用、存储结构和已保存开关，仅做本地读写。

**分区图标**：宿主有独立的 `settings.section.icon` 席位（root 级 list）；每个设置分区对应的图标条目 `id` 与该分区 `id` 相同，owner props 为 `{size, active}`。共享「会话管理」页的图标由 kit 共享注册函数按贡献者注册，多名参与者可注册同一 `id` 的不同 `priority` 条目，席位账本允许多条，宿主每分区只渲染一个。

插件业务设置**不注册到** `plugins.bundle.config` / `plugins.row.config`，也不注册遗留 `dsh-editor.settings.*` 席位；本约束针对设置归属，不是全仓席位禁止名单——合法的非设置贡献与上表之外的新官方席位按其自身归属继续使用。例外：插件页上的**非设置**功能不受影响——`dsh-dev-index` 的 `plugins.bundle.config` 注册的是纯文档浏览器（DocumentationBrowser），保留在插件页并在守卫中豁免。

新增或迁移时运行 `node --test scripts/plugin-settings.test.mjs`、`pnpm test:editor-build` 及相关插件测试；网络搜索另有 `pnpm test:e2e:web-search` 浏览器回归。
