# AGENTS.md

本仓库是 klarkxy 的 DSH 插件 monorepo，同时托管插件发布站 <https://klarkxy.github.io/dsh-plugins/>。

## 排查问题的顺序

遇到行为异常、报错或功能不工作时，**先怀疑并排查本仓库的插件代码**，而不是先去查官方宿主或第三方插件的问题。本仓库的插件、共享库和配置是变量最多、最常改动的部分，大概率是问题来源：

- 先检查本仓库相关插件的源码、配置、依赖声明和最近改动（`git log` / `git diff`），确认是否由我们的代码或发布内容引起。
- 排除本仓库原因后，再去对照 ZCode 源码、DSH 运行时和第三方插件找宿主侧原因。
- 不要一上来就把问题归因为宿主 bug 或第三方插件缺陷；没有本仓库证据支撑时不写「官方的问题」式的结论。

## 文档

文档只写给用户看，代码本身就是开发文档。

- **README 只回答四件事**：它做什么、怎么安装、怎么使用、主要限制。不写 RPC、内部 API、存储路径、schema、主题 token、缓存大小、兼容层、实现流程、错误码或迁移细节。共享库（plugin-kit、model-route）只写一段用途，并说明开发者请参考源码和类型声明。
- **不新增开发者文档**：ADR、调研、迁移说明、任务计划、验收报告和截图说明都不进仓库。设计理由写在代码注释、提交信息或 PR 里；临时记录放 `.scratch/`，用完删除。
- **只写用户实际用得到的能力**：先在代码里找到对应的工具注册、RPC 或界面入口再写。内部映射、预留路径和计划中的功能不算能力。例如知乎调用策略里有 PDF/PPT 路径映射，但没有任何工具或界面，就不能写成可用功能。依赖宿主能力的功能要写明条件，例如会话管理的自由聊天、删除和原会话重试需要宿主支持。
- **不写会过时的数字和状态**：DSH 版本号、插件数量、日期、预发布通道和「已验证某版本」这类内容很快就会失效。最低版本以 `package.json` 的 `engines` 为准，文档里需要提到时必须与它一致。外部 CLI 的版本限制以代码里的检查为准。
- **中英文成对维护**：两种语言结构一致、内容对应。中文 README 有的包在 `docs/README.zh-CN.md`，有的在 `README.zh-CN.md`，以包的 `files` 和 catalog 为准，不要随意搬位置。
- **一处简介改了，其他几处一起改**：功能变化时，同步 `package.json` 的 `description`、`locale/zh.json` / `locale/en.json` 的 `meta`、`site/catalog.json` 的 `summary`、根目录两个 README 的插件表格，以及包内 README。
- **测试固定的内容**：每个包的 `README.md` 必须保留 `<!-- release-state-note -->`。根 README 的生命周期表格只由 `pnpm release:docs` 生成，不要手改。`plugins/dsh-dev-index/tests/bundle.test.ts` 要求两种语言的 README 包含 GitHub 安装的 `allowBuilds` 示例、官方文档地址和 `cordis_inspect_list`。`dsh-unrestricted` 的 `NOTICE.md` 是署名与许可文件，必须随包发布。
- **锁定的交付目录**：`host-patches/thread-management/` 里的文件（包括 README）由 `delivery-sha256.json` 锁定校验值。不要单独修改；确需更改时，同时更新校验记录。
- 只改 README、`docs/` 等包内文档不会触发 npm 发布，npm 上的文档会在下次代码发布时一起更新。

## 日常维护

### 常见改动清单

- **改插件功能**：同步更新该包的中英文 README；简介变化时按「文档」一节同步其他几处。新增或删除模型工具时，核对 README 里的工具表与代码中的注册一致。
- **新增插件**：在 `scripts/plugin-release-states.json` 登记为 `draft`；准备中英文 README（带状态标记）、`LICENSE`、`locale/zh.json` / `locale/en.json`，并在 `files` 中列全；`homepage` 指向站点详情页。npm 有 `latest` 版本后，再加入 `site/catalog.json` 和根 README 的插件表格。
- **移除插件源码**：清单条目改为 `retired: true`，保留阶段和发布凭据；从 catalog 和根 README 插件表格中移除。
- **删除包内文件**：同时检查 `package.json` 的 `files`、测试里的文件清单，以及 `scripts/plugin-release-states.json` 中可选的 `evidence` 引用；校验器会检查引用的文件是否存在，不能改动 `publication`。

### 定期核对

- catalog 与 npm 是否一致：在 `klarkxy` 名下、带 `latest` 标签且仍维护的 DSH 插件都应收录。`dsh-plugin-autoevo` 已封存，不再收录；插件发现与信息核对使用 `dsh-dev-index`。
- README 描述与代码是否一致：工具名、页签、设置项、默认值和限制都以源码为准。
- 有没有过时的版本号、数量、日期或通道说明，例如 `rg -n -g "README*.md" -e "-rc\." -e "-alpha\." -e "预发布" -e "已验证" README.md README.zh-CN.md plugins`。命中后人工判断：代码里检查的外部 CLI 最低版本（如 ChatGPT 插件要求的 Codex 版本）不算过时，`NOTICE.md` 里的版本属于署名来源，也不算过时。
- 有没有死链，以及引用已删除文件的地方。

### 验证

按改动范围选择检查，不必每次全跑：

```bash
pnpm release:docs        # 改了生命周期清单或包列表后同步根 README
pnpm release:check       # 生命周期、文档标记与发布脚本回归
pnpm site:test           # 改了 catalog 或 site/
pnpm --filter <包名> test  # 改了哪个包就测哪个包
pnpm pack:check          # 改了 files 或包内文件
git diff --check
pnpm check               # 较大改动时全仓检查
```

### 已知坑

- Windows 沙箱里出现 `EPERM`，或在临时目录里 `git init` 报 `Permission denied`，通常是沙箱权限问题，不是代码问题。先在沙箱外重跑，不要为此改测试。
- `pnpm check` 并行跑全部测试时，`dsh-safe-auto` 的 `test/control.test.js`「unanswered confirmation expires…」偶尔因计时失败。先单独重跑该包；单独通过时，用 `pnpm --workspace-concurrency=1 --filter "{plugins/*}" test` 补跑剩余测试。
- 脚本写文件时保持 LF 和 UTF-8（无 BOM）；仓库没有 `.gitattributes`，Git 显示的 CRLF 警告可以忽略。
- PowerShell 输出开头的 `InitializeDefaultDrives` 报错只是环境噪声。

提交、推送、npm 发布和站点部署都需要用户明确授权；本地清理和文档修改不等于获得了这些授权。

## 核心参考：ZCode 源码

`H:\Refernece\ZCode`（本地镜像，写本节时为 v3.14.3）是 ZCode AI 编程工作台的完整源码，与 DSH 宿主同族。设计或调试插件行为时**先读它的源码再下结论**，不要凭记忆或想象编造宿主 API、事件语义和生命周期。

- **只读**：不修改、不格式化其中的文件，也不在 ZCode 目录里跑构建或写临时文件。
- 查什么：会话与子代理生命周期、插件与 hook 派发语义、RPC 与存储结构、客户端 UI 与主题 token。入口地图：`apps/zcode-cli/` 是 Agent CLI 与运行时，`packages/{server,services,client,rpc,shared}` 是宿主核心，`packages/ui`、`packages/web` 是界面层。
- 下结论时给出具体源码路径作为依据（如 `packages/services/...ts`），不写"应该是""大概是"式的断言。
- 镜像会过时：与 DSH 实际运行时行为冲突时，以 DSH 安装目录的运行时为准，并记录差异。
- 不要整段搬运代码进本仓库；ZCode 是 Apache-2.0 且带 `NOTICE.md`，确需引用时保留署名与许可证说明。

## 对照参考：Codex 源码

`H:\Refernece\codex`（本地镜像，写本节时为 `c0c230e673`，2026-10-06）是 OpenAI Codex CLI 的完整源码（github.com/openai/codex），与 DSH 不同族但同类的编程 harness。ZCode 是同族宿主、回答"DSH 实际怎么做"；Codex 是异族对照、回答"同类产品怎么设计"，设计插件的 hook、沙箱、子代理、记忆等机制时用它对照取舍，不把它的语义当成 DSH 的语义。

- **只读**：不修改、不格式化其中的文件，也不在 codex 目录里跑构建或写临时文件。
- 查什么：Windows 沙箱与命令审批、hook 与插件机制、AGENTS.md 加载语义、skills、子代理与多代理协作、会话持久化。入口地图：`codex-rs/core` 是 Agent 主循环，`codex-rs/cli`、`codex-rs/tui` 是命令行与终端 UI，`codex-rs/app-server` + `app-server-protocol` 是客户端/IDE 通信协议，`codex-rs/hooks`、`plugin`、`core-plugins` 是 hook 与插件，`codex-rs/skills` 是 skills，`codex-rs/sandboxing`、`windows-sandbox-rs`、`execpolicy` 是沙箱与审批策略，`codex-rs/protocol`、`rollout`、`thread-store` 是协议与会话存储，`codex-cli/` 是 npm 发布的 Node 包装层，`sdk/{typescript,python}` 是 SDK，`docs/` 有 agents_md、config、sandbox、skills、execpolicy 等设计文档。
- 下结论时给出具体源码路径作为依据（如 `codex-rs/core/src/...rs`），不写"应该是""大概是"式的断言。
- 镜像会过时：结论以引用时的 commit 为准，跨版本引用前先 `git log` 确认相关文件没变。
- 不要整段搬运代码进本仓库；Codex 是 Apache-2.0 且带 `NOTICE`，确需引用时保留署名与许可证说明。

## 插件站点

站点由 `site/` 生成，输出到 `_site/`（不提交）。旧开发索引和根目录 `docs/` 已移除，不要恢复。

| 文件 | 职责 |
| --- | --- |
| `site/catalog.json` | 唯一手工维护的数据 |
| `site/render.mjs` | 纯渲染：catalog + npm 数据 → 文件内容，不做 I/O |
| `site/build.mjs` | 从 npm registry 拉数据，校验发布包并写入 `_site/` |
| `site/npm.mjs` | 校验并在内存中读取 npm 发布包，不落盘解包 |
| `site/assets/` | 样式与脚本；脚本只做渐进增强，页面无 JS 也要可用 |
| `site/site.test.mjs` | 离线测试，包含在 `pnpm check` |

### 新增、修改或下线插件

只改 `site/catalog.json`，并同步根目录 `README.md` 与 `README.zh-CN.md` 的插件表格。

- 只收录已发布到 npm、带 `latest` 标签的 DSH 插件。未发布的包会让构建失败；非 DSH 包不收录。
- `slug`：小写字母、数字和连字符，通常是包名去掉作用域和 `dsh-` 前缀。已发布的 slug 是公开 URL，不要改名。
- `category` 必须是 `categories` 里的 id；`kind` 只能是 `preset`、`plugin`、`service`。
- `title`、`summary` 必须同时有 `zh` 和 `en`。简介一句话，从用户角度说它做什么，不写实现细节或宣传语。
- `readme.zh` / `readme.en` 写包内实际存在的路径（相对包根目录）。某个语言没有 README 时仍填预期路径，构建会警告并回退到另一种语言。
- `repository` 为 `https://github.com/<owner>/<repo>`；`directory` 是包在仓库中的子目录，仓库根目录即包时填 `""`。
- 不要把版本、日期、依赖、图标写进 catalog，这些在构建时从 npm 读取。插件依赖根据 `dependencies` / `peerDependencies` 中同样在 catalog 里的包自动推导。详情页的安装命令只包含插件本身，加上 catalog 内未标 `optional` 的必需 `peerDependencies`：`dsh plugin add` 就是转发给 pnpm，`dependencies` 会随插件一起装上，profile 又设了 `autoInstallPeers: false`，所以只有必需 peer 需要显式补装。给依赖加安装命令前，先确认它真的不会被自动安装。

### 修改渲染

- README 里的原始 HTML 不原样输出，只保留 `<img>` 和 `<br>`；链接和图片地址只允许 `http(s)`、`mailto`、锚点和相对路径。不要放宽这条规则。
- 改链接改写、依赖推导或页面结构时，在 `site/site.test.mjs` 补测试。测试要离线运行，不访问网络。
- 首页和详情页都是中文在根路径、英文在 `en/` 下，两种语言的页面结构保持一致；新增文案要同时加到 `render.mjs` 的 `T.zh` 和 `T.en`。
- 视觉方向：蓝墨色配冷色纸底，只有安装命令那一行做强调。不要引入外部字体、CDN 脚本或统计代码。

### 验证

```bash
pnpm site:test                                     # 离线渲染测试
pnpm site:build                                    # 拉取线上数据生成 _site/
node site/build.mjs --save-snapshot .scratch/snap.json   # 保存数据快照
node site/build.mjs --snapshot .scratch/snap.json        # 用快照离线重建
pnpm check                                         # 全仓检查
```

改动页面后在本地起静态服务预览 `_site/`，桌面和手机宽度都要看；站点部署在 `/dsh-plugins/` 子路径下，页面内链接必须用相对路径（404 页除外）。快照和预览文件放在 `.scratch/`，用完删除。

### 部署

`.github/workflows/pages.yml` 在推送 `main`、`Publish npm plugins` 工作流结束后，以及每天 01:17 UTC 运行 `site:test` 和 `site:build`，再部署 `_site/`。拉取失败时构建直接失败，线上保留上一版，不要为了让构建通过而吞掉网络错误或改用过期数据。

## 与 npm 发布的关系

`scripts/plugin-release-states.json` 记录所有 `plugins/*` 包的不可逆生命周期：`draft`（草稿）→ `testing`（测试中）→ `published`（已发布）。已发布包的修复、测试、README 调整和升版都保持已发布；禁止为维护降级，也不再把人工验收指纹绑定到生命周期。`publication` 保存不可改写的历史 npm 发布凭据。完整规则见 `RELEASING.zh-CN.md`。

正常自动发布只选择已发布的公开包。测试中包首次发布须通过手动工作流的 `first_release` 或 `plan --first-release NAME ...` 明确选择；草稿不能首次发布。首次发布在 npm 归档下载与完整性验证成功后才登记已发布。首次发布失败不提前晋级；部分成功逐包保存在发布产物中，重试可恢复，不能撤销已成功的发布事实。

每次更新仍检查测试、最终归档、依赖和当前计划内容。计划自动记录包与依赖闭包的内容指纹，源码或依赖变化会拒绝旧计划；不要求每次修改重新人工晋级。私有开发包参加检查但不发布；测试中的私有开发依赖可以随使用方构建验收，私有运行依赖不能进入公开包。新的公开依赖须已发布，或同批被明确选定首次发布。

`scripts/npm-release-holds.json` 独立表示暂缓或封存，迁移冻结继续由 `scripts/editor-plugin-migration.json` 管理；二者都不降低生命周期。解除暂缓仍须核对其原因及最终包、相关测试和目标宿主行为。不要通过旧计划或改私有标记绕过限制。

修改清单后运行 `pnpm release:docs` 和 `pnpm release:check`。本地检查与已提交清单比较；发布 CI 以本次推送前提交为基准，拒绝阶段倒退、删除历史条目或改写发布凭据。移除废弃包源码时，在原清单条目设置 `retired: true` 并保留阶段和历史发布凭据；该条目不再参与工作区、状态表或发布，不增加新的生命周期阶段。`pnpm release:status` 显示生命周期及发布资格，不代表当前版本已经通过检查。只改 `site/`、根 README 或未打包测试不会触发发布。未发布包不加入站点 catalog；插件 `homepage` 仍指向对应详情页。

## 官方包依赖约定

`@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 包由宿主运行时提供，**永远不要放进 `dependencies`**，也不要在任何字段写死精确版本或 `<0.2.0` 这类上界。写死版本会让 pnpm 把旧版官方包装进 profile 的 node_modules，宿主 loader 解析内置插件行时命中旧拷贝、版本检查不通过直接禁用（0.1.7→0.2.0 升级时 storage-domain 被禁用、workspaceController 全线 pending 就是这么炸的）。

- 宿主包含的包（对照 DSH 安装目录 `node_modules/@deepseek-ai`）：`peerDependencies` 写开放下界（`>=0.1.7-rc.2`，loader 只按这个范围对运行时版本做兼容检查），并在 `peerDependenciesMeta` 标 `optional: true`，防止 pnpm auto-install-peers 把物理副本装进 profile；`devDependencies` 保留精确版本供本地 typecheck/测试。
- 宿主不包含的包（如 `@deepseek-ai/dsh-web-search-exa`）：留在 `dependencies`，同样用开放下界，不写死。
- `engines.dsh` 也只写开放下界。
- 例外：确实需要独立副本的无状态工具包可以进 `dependencies`（官方文档允许的口径），但先确认它不在宿主安装目录里。

## 自动触发的作用域

插件挂在 `agent/pre-step`、`agent/turn-stopping`、`agent/status`、`session/event` 这类**全局**事件上时，一次派发会按线程数放大：主控分出 N 个子代理，辅助调用就多出 N 份。因此：

- **写入与派生默认只覆盖真人直接驱动的顶层会话。** 纪要、检查点、观察记录、经验摘录、标题这类会落盘或调模型的自动行为，先用 plugin-kit 的 `isSubagentSession(session)` 排除子线程，再做其余判断。用户手动触发的同名操作（RPC、插件页按钮）不受此限。
- **只读注入可以保留。** 记忆、经验注入不写盘也不调模型，子线程读到的是真人会话产生的知识，按需保留即可。
- **要跨子线程必须显式 opt-in**，在代码注释里写明理由，不要靠沉默默认。

判据只能用 `session.header`：`isSubagentSession` 优先认 `origin === 'subagent'` / `delegationDepth > 0`，仅有 `parentSession` 的旧会话仍排除。原生真人分叉也保存 `parentSession` 表示历史继承；只有明确 `isSeeded === true`、派发深度为零或由原生宿主省略、无子代理来源且分类为普通/自由聊天（普通分类可以省略）的持久头才认作真人分叉。DSH `0.2.0-rc.2` 原生真人分叉省略深度，带补丁的宿主可显式保存零；未知来源、分类或无效深度仍按旧 parent 判据排除。这些都是宿主创建会话时快照的持久数据（`@deepseek-ai/dsh-agent` 的 `CreateAgentOptions.meta`），不推断消息作者。**不要用 `message.source.kind === 'user'` 判断是不是真人**——官方 `SubagentStartRequest.prompt` 的定义就是「作为子线程的 user 消息投递」，主控派的任务在子线程里和真人输入无法区分。

调用生命周期跟着工作走：自建 `AbortController` 时用 `AbortSignal.any([宿主 signal, 自己的])` 合并，不要另起一个与工作步骤无关的后台调用。

判据在 plugin-kit 里，不要每个插件各抄一份。`dsh-safe-auto` 是最早的落地样例。

## 客户端 UI：@deepseek-ai/dsh-client-ui-primitives

宿主提供的纯 React 原子组件包（控件、图标、Markdown、JSON 检视器，不依赖 cordis）。功能插件的浏览器端界面用它拼装，不重画宿主已有的控件：`Button`、`Input`、`Checkbox`、`Switch`、`Tag`、`Pill`、`SegmentedTabs`、`Menu`、`Modal`、`Tooltip`、`Toast`、`DisclosureRow`、`StateDot`、`PathLabel`、设置表单套件，以及 `useAnchoredPosition`、`useDismissOnOutsidePointer`、`useModalLayer` 等 hook。几何、焦点环、状态和本地化都由宿主掌握，抄一份就会在下次换肤时掉队。原生 `<select>` 是唯一例外：官方组件里没有它，保留平台控件并套用 plugin-kit 契约的 `dsh-ui-select` 即可。

声明与打包是固定的三步，新插件照抄现有插件（如 `plugins/dsh-zhihu`）：

- `package.json` 的 `dsh.bundle.client.inject` 里列出 `@deepseek-ai/dsh-client-ui-primitives`，运行时由宿主注入，插件不带物理副本。
- 它是「官方包依赖约定」的例外：**不进 `dependencies`，也不进 `peerDependencies`**，只在 `devDependencies` 写精确版本供本地 typecheck/测试（它的版本兼容由 inject 机制保证，不走 loader 的 peer 范围检查）。
- `tsdown.config.ts` 的 `deps.neverBundle` 必须包含 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`（用到 `react-dom` 时一并加入）；`@klarkxy/dsh-plugin-kit` 的浏览器安全入口（`client-utils`、`official-ui`、`model-menu`、`contracts`）放 `alwaysBundle`。

样式与布局：

- 排版、卡片、表单、横幅、空态、浮层用 `@klarkxy/dsh-plugin-kit/official-ui` 的 `officialUiCss(roots)`，样式限定在插件自己的根类名下，两个插件可挂同名类互不影响。
- 颜色、圆角、层级、焦点环直接写宿主 `--dsw-*` token（白名单即 `OFFICIAL_THEME_TOKEN_NAMES`），不另起私有别名、不带字面量回落；写错 token 不报错而是静默丢样式，token 守卫测试会拦截白名单外的引用。
- `Modal` 和 `Menu` 会 portal 到 `document.body`，脱离插件子树，portal 出来的浮层要在 portal 内部的元素上单独挂根类名才有样式。

测试：vitest 用 `vitest.editor-plugins.config.ts` 里的别名把该包指到 `scripts/editor-plugins/ui-primitives-stub.tsx`；Node SSR 测试（如 dsh-safe-auto）在 `require` 层打桩。不要为了在测试里跑通而引入真实组件包或 jsdom 之外的渲染环境。

## 插件配置入口

插件自己的设置统一注册到 `plugins.bundle.config`，`key` 必须为 npm 包名；某个 bundle 行自己的设置使用 `plugins.row.config`。不要注册 `settings.section`、`settings.plugins.tab` 或旧的 `dsh-editor.settings.*`，也不要在插件页未声明时回退到全局设置。`slots.inject()` 等待宿主声明并负责卸载回收；标题与导航由宿主插件页提供。功能性搜索面板可以保留，但不要在那里重复提供凭据设置。迁移入口时保留 RPC、凭据引用、存储结构和已保存的开关，不触发模型调用。

新增或迁移配置入口时运行 `node --test scripts/plugin-settings.test.mjs`、`pnpm test:editor-build` 和相关插件测试；网络搜索还提供通过真实注册入口挂载的 `pnpm test:e2e:web-search` 浏览器回归。
