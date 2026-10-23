# AGENTS.md

本仓库是 klarkxy 的 DSH 插件 monorepo，托管插件发布站 <https://klarkxy.github.io/dsh-plugins/>。

专项规则按需加载：在 `plugins/**` 下开发插件时遵循 `plugins/AGENTS.md`（官方包依赖、自动触发作用域、客户端 UI、配置入口）；改动 `site/**` 时遵循 `site/AGENTS.md`（站点结构、catalog 规则、渲染与部署）。

## 排查问题的顺序

功能异常时**先怀疑本仓库的插件代码**：查相关插件源码、配置、依赖声明和最近改动（`git log` / `git diff`），排除后再对照 ZCode、DSH 运行时和第三方插件。没有本仓库证据不写「官方的问题」式结论。

## 文档

文档只写给用户看，代码本身就是开发文档。

- **README 只回答四件事**：做什么、怎么装、怎么用、主要限制。不写 RPC、内部 API、存储路径、schema、主题 token、缓存大小、兼容层、实现流程、错误码或迁移细节。共享库（plugin-kit、model-route）只写一段用途，注明参考源码和类型声明。
- **不新增开发者文档**：ADR、调研、迁移说明、任务计划、验收报告、截图说明不进仓库；设计理由写进代码注释、提交信息或 PR；临时记录放 `.scratch/`，用完删除。
- **只写用户实际用得到的能力**：先在代码里找到工具注册、RPC 或界面入口再写；内部映射、预留路径、计划功能不算（例：知乎的 PDF/PPT 路径映射无入口，不能写成可用功能）。依赖宿主能力的功能写明条件（例：会话管理的自由聊天、删除、原会话重试需宿主支持）。
- **不写会过时的内容**：DSH 版本号、插件数量、日期、预发布通道、「已验证某版本」。最低版本以 `package.json` 的 `engines` 为准；外部 CLI 版本限制以代码检查为准。
- **中英文成对维护**：结构一致、内容对应。中文 README 位置（`docs/README.zh-CN.md` 或 `README.zh-CN.md`）以包的 `files` 和 catalog 为准，不搬动。
- **一处简介改了，几处一起改**：`package.json` `description`、`locale/zh.json` / `en.json` `meta`、`site/catalog.json` `summary`、根 README 插件表格、包内 README。
- **测试固定的内容**：每个包的 `README.md` 保留 `<!-- release-state-note -->`；根 README 生命周期表只由 `pnpm release:docs` 生成；`plugins/dsh-dev-index/tests/bundle.test.ts` 要求双语 README 含 `allowBuilds` 示例、官方文档地址和 `cordis_inspect_list`；`dsh-unrestricted` 的 `NOTICE.md` 必须随包发布。
- **锁定的交付目录**：`host-patches/thread-management/` 由 `delivery-sha256.json` 锁定，改动须同步更新校验记录。
- 只改 README、`docs/` 等包内文档不触发 npm 发布，npm 文档随下次代码发布更新。

## 日常维护

- **改插件功能**：同步中英文 README；简介变化按「文档」一节同步各处；增删模型工具核对 README 工具表与代码注册一致。
- **新增插件**：`scripts/plugin-release-states.json` 登记 `draft`；备齐双语 README（带状态标记）、`LICENSE`、`locale/zh.json` / `en.json` 并列全 `files`；`homepage` 指向站点详情页；npm 有 `latest` 后再加入 catalog 和根 README 表格。
- **移除插件源码**：清单条目设 `retired: true`，保留阶段和发布凭据；从 catalog 和根 README 表格移除。
- **删除包内文件**：同步检查 `files`、测试文件清单、`plugin-release-states.json` 的 `evidence` 引用；`publication` 不可改。

定期核对：catalog 与 npm 一致（`klarkxy` 名下带 `latest` 且维护中的 DSH 插件都收录，`dsh-plugin-autoevo` 已封存不收，核对用 `dsh-dev-index`）；README 与代码一致（以源码为准）；过时内容（`rg -n -g "README*.md" -e "-rc\." -e "-alpha\." -e "预发布" -e "已验证" README.md README.zh-CN.md plugins`，代码里的外部 CLI 版本检查和 `NOTICE.md` 署名版本不算过时）；死链与失效引用。

验证按需选择：

```bash
pnpm release:docs        # 改了生命周期清单或包列表后同步根 README
pnpm release:check       # 生命周期、文档标记与发布脚本回归
pnpm site:test           # 改了 catalog 或 site/
pnpm --filter <包名> test  # 改了哪个包就测哪个包
pnpm pack:check          # 改了 files 或包内文件
git diff --check
pnpm check               # 较大改动时全仓检查
```

已知坑：Windows 沙箱的 `EPERM`、临时目录 `git init` 权限错通常是沙箱问题，沙箱外重跑，别为此改测试；`pnpm check` 并行时 `dsh-safe-auto` 的 `test/control.test.js`「unanswered confirmation expires…」偶发计时失败，先单独重跑该包，再用 `pnpm --workspace-concurrency=1 --filter "{plugins/*}" test` 补跑；脚本写文件保持 LF、UTF-8 无 BOM（仓库无 `.gitattributes`，CRLF 警告可忽略）；PowerShell 开头的 `InitializeDefaultDrives` 报错是环境噪声。

提交、推送、npm 发布和站点部署都需用户明确授权；本地清理和文档修改不等于授权。

## 参考源码（只读镜像）

- `H:\Refernece\ZCode`：ZCode 完整源码（写本节时 v3.14.3），与 DSH 同族，回答「DSH 实际怎么做」。查会话与子代理生命周期、插件与 hook 派发、RPC 与存储、客户端 UI 与主题 token。入口：`apps/zcode-cli/`（Agent CLI 与运行时）、`packages/{server,services,client,rpc,shared}`（宿主核心）、`packages/ui`、`packages/web`。
- `H:\Refernece\codex`：OpenAI Codex CLI 源码（写本节时 `c0c230e673`），异族同类，回答「同类产品怎么设计」；设计 hook、沙箱、子代理、记忆等机制时对照取舍，不把它的语义当 DSH 的语义。入口：`codex-rs/core`（Agent 主循环）、`cli`/`tui`、`app-server` + `app-server-protocol`、`hooks`/`plugin`/`core-plugins`、`sandboxing`/`windows-sandbox-rs`/`execpolicy`、`protocol`/`rollout`/`thread-store`、`skills`、`codex-cli/`、`sdk/`、`docs/`。

共用规则：**只读**（不修改、不格式化、不跑构建、不写临时文件）；先读源码再下结论，结论给具体路径（如 `packages/services/...ts`），不写「应该是」「大概是」；镜像会过时，与 DSH 运行时冲突以运行时为准（Codex 结论以引用 commit 为准，跨版本先 `git log`）；不整段搬运代码（均为 Apache-2.0 带 NOTICE，引用保留署名与许可）。

## 与 npm 发布的关系

完整规则见 `RELEASING.zh-CN.md`，日常只需记住三条：生命周期 `draft` → `testing` → `published` 不可逆，`publication` 凭据不可改；首次发布须手动工作流 `first_release` 或 `plan --first-release` 明确选择；改清单后跑 `pnpm release:docs` + `pnpm release:check`，移除源码设 `retired: true`。只改 `site/`、根 README 或未打包测试不触发发布；暂缓/封存（`scripts/npm-release-holds.json`）和迁移冻结（`scripts/editor-plugin-migration.json`）不得绕过。
