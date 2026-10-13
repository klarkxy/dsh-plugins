# Safe Auto 与 Session Manager 发布复审（2026-10-13）

日期与时区：2026-10-13，Asia/Shanghai。范围为本次工作区的 `@klarkxy/dsh-safe-auto`、`@klarkxy/dsh-session-manager` 及其本仓库共享依赖。

下述各节保留转正前的复审快照；后续正式版准备与新变更见文末补录。当前源码状态始终以 [发布状态清单](../plugin-release-states.json) 为准。

结论：两份独立源码复审未发现可确认、可复现的新增发布阻断；全仓检查及最终归档检查通过。结合维护者本轮对两个插件测试完成的明确确认，登记当前内容为 `ready`。本记录不代表已发布到 npm，也不改变预发布渠道。

## 人工确认与证据边界

维护者在本轮直接确认：“OK，safe-auto和session已经可以宣告测试完成可以发布了。你再审核一下。”该确认作为当前候选内容的人工验收签认。本次代理补充源码、测试、最终包和依赖复核；没有将此前的测试结果冒充为本轮重新执行的全部真实宿主场景。

- Safe Auto：目标宿主最终人工签认来自维护者上述确认。本轮重新运行原生宿主契约测试；未重新执行全部真实审核模型、操作系统提权及 Desktop 场景。历史 ADR 中“待 live-profile 验收”的状态由本轮人工签认补录收口，不据此宣称新增了逐场景运行日志。
- Session Manager：保留 [2026-10-12 验收](session-manager-2026-10-12.md)，并复核 [2026-10-13 隔离 Web 验收记录](../../.artifacts/session-manager-web-20261013/acceptance.json)。后者确实从解出的归档加载插件，在两个隔离配置中运行了各 6 个宿主案例，并通过真实模型完成 list/search/read/read、当前标题匹配、内容标记及签名续读；浏览器错误为 0。本轮核对下列 6 个归档文件均与该记录一致。更广的 UI 人工验收完成结论采用维护者确认。
- 宿主基线为工作区锁定的官方 DSH 包；版本以 [既有验收环境记录](../../.artifacts/session-manager-web-20261013/acceptance.json) 的 `environment.dshVersion` 及工作区官方包元数据为准。测试 Node 为 26.10.0。宿主契约先参考只读 ZCode 镜像，再对照工作区固定官方包；未修改日常宿主配置。

## 最终归档

使用仓库 `packReviewed` / `packRelease` 路径重新生成发布归档，检查文件清单、SATA 许可证、main/types/exports/安装补丁入口、依赖替换及测试/临时文件排除。所有断言通过。原始逐文件散列见 [归档复核输出](../../.scratch/release-review-20261013-pack.json)，复核程序见 [本次归档检查脚本](../../.scratch/release-review-pack.mjs)；两者为本地辅助产物，本记录保存关键结果。

| 包 | 当前候选版本 | 文件数 | acceptedContentHash |
| --- | --- | --- | --- |
| `@klarkxy/dsh-safe-auto` | `0.2.0-rc.3` | 31 | `e44dad31651e282a2cd20fe235c83fa2bef39af96eb410151151fadf62abb5ba` |
| `@klarkxy/dsh-session-manager` | `0.1.0-rc.1` | 14 | `defdc665da5d1fa5ec402ba0ae76bce14149280d1cb6204ba948cdbb667523c0` |
| `@klarkxy/dsh-plugin-kit` | `0.3.0` | 33 | `b2ac92650f02fbfbd1f8a5cff876be8494abbf4e93fc736ae0c531590ea6e01a` |
| `@klarkxy/dsh-model-route` | `0.2.0` | 23 | `974b1532eefd681a03a3d0fd409d336c643ff517bc8ddafbd75387ca5c5872dd` |

本轮生成的归档 SHA256：

- Safe Auto：`eef778892800ee7661fce60ae245e210782414c52d46eabb248db0f250cfe707`。
- Session Manager：`24c9ca8f2da2366ad953a89530f5297eb858ce9c1929101f905f933c9a97a992`。

验收指纹与整个 tgz 的散列用途不同；发布时解析的工作区依赖版本及版本写回会影响归档散列。这里不声称新 tgz 与历史宿主使用的 tgz 整体一致。

Session Manager 与 2026-10-13 宿主验收逐文件比对结果：

| 归档内路径 | SHA256 | 结果 |
| --- | --- | --- |
| `lib/index.js` | `5a9da54089b36078a9b4c97904d3f11e0d14a28f2c799f1f91cf5ce8e99dbd62` | 一致 |
| `lib/client.js` | `b966f25a8b2e15c68b33a3a40626641211c6a4b473ae095e2f3ab0a0ce375ae2` | 一致 |
| `lib/client.inner.cjs` | `bd2e2245264ebe71b8cb7e2464e9b98130ed720dbea8b6eec4d65460687bc6a0` | 一致 |
| `cordis.patch.yml` | `382a568b04b4178d92ab1e27c4655a7121e77e9a76d213b5b4ae08de64329fd1` | 一致 |
| `README.md` | `cc61f33f1c2c5711824a9b7bba9c6a93531175bec7e94ea5ae7fe0f6c648cbab` | 一致 |
| `README.zh-CN.md` | `ea9741be9f50539e5c13301a327a7a4f5dc4f40901eb89bbb06cc0130b5bf99e` | 一致 |

两个共享库均保持 `ready`，本次重算指纹与 [整改验收记录](shared-libraries-remediation-2026-10-12.md) 和状态清单完全一致。检查包括打包的工作区 devDependency；未只按运行时 dependency 判断发布闭包。Safe Auto 的发布 manifest 将 kit 解析为 0.3.0。官方宿主依赖维持可选 peer 与开放下界。

## 本轮执行的验证

`pnpm check` 完整退出码为 0，覆盖 release:check、site:test、build、test:editor-build、typecheck、test、pack:check。原始输出见 [全仓检查日志](../../.scratch/release-review-20261013-check.log)。

| 检查 | 结果 |
| --- | --- |
| 发布脚本测试 | 54/54 通过 |
| 插件站离线测试 | 13/13 通过 |
| Editor 构建契约 | 17/17 通过 |
| Safe Auto | 296/296 通过，0 跳过；包含实际官方 Cordis/ToolRuntime 契约测试 |
| Session Manager | 93/93 通过，15 个测试文件 |
| plugin-kit | 74/74 通过 |
| model-route | 51/51 通过 |
| 全仓构建、类型检查、包检查 | 通过 |
| 本轮最终归档、入口、依赖及指纹检查 | 通过 |

登记 `ready` 后，已执行 `pnpm release:docs` 同步双语状态表，再执行 `pnpm release:check`：54/54 通过，0 失败、0 跳过。`pnpm release:status` 确认两个插件和两个共享库均具备登记层面的发布资格；该状态输出本身不替代前述最终归档指纹复核。

全仓日志包含 pnpm 旧配置字段提示，以及 model-route 测试环境的 React SSR/attachEvent 输出；对应测试均通过。另有一个与本次两个插件无关的 git-commit 测试跳过。以上不包装为零警告运行。

Windows 沙箱拒绝捕获 npm 子进程管道后，经正常权限审批重试相同命令完成。Safe Auto 也曾因 Node/pnpm 调用附带重定向和额外命令而硬拒绝；核对规则后，单一字面调用正常进入审批与执行，未放宽安全规则。

## 独立源码复审

Safe Auto 重点核对 [审批执行绑定](../../plugins/dsh-safe-auto/src/index.js)、[严格参数面](../../plugins/dsh-safe-auto/src/approval-review.js)、[路径解析](../../plugins/dsh-safe-auto/src/review-paths.js)、[可信运行时证明](../../plugins/dsh-safe-auto/src/host-runtime.js)、设置持久化/版本冲突和旧请求失效，以及共享库的真人与子线程分类。未确认审批绕过、跨执行复用或新增发布阻断。

Session Manager 重点核对 [搜索、范围及快照](../../plugins/dsh-session-manager/src/query.ts)、[可选参数与模式约束](../../plugins/dsh-session-manager/src/tools.ts)、[临时目录分配](../../plugins/dsh-session-manager/src/temporary-directory.ts)、[临时工作区交接](../../plugins/dsh-session-manager/src/temporary-workspace.ts)、复制快捷键、原生右键菜单、RPC 封装及宿主能力检测。未发现可确认、可复现的新增发布阻断。

两份子审查均为只读源码审查；全仓测试和打包由主线统一执行。

## 发布边界

- Session Manager 的真实删除、重试等扩展动作仍依赖文档明确要求的宿主能力；临时目录跨重启/卸载保留，V5 回退 V4 需要备份。这些是既有交付边界，本次不宣称重新验收 patched-host 迁移。
- 本次仅登记以上两个功能包为 `ready`，不扩展到其他尚待验收插件。
- 当前两个 RC 版本均已被 npm 占用；发生内容变化时必须使用新版本，发布脚本可递增 RC 序号。改为稳定版需要按版本策略选择目标版本及 `latest` 渠道，`ready` 本身不会去掉 RC 后缀。
- 发布工作流文件的读取被本会话自动审批以 `PROTECTED_PATH` 拒绝，本轮未复核该文件；已复核仓库发布状态、打包及版本选择脚本。
- 未执行版本修改、npm 发布、Git 提交/推送或日常宿主安装/配置变更。正式发布仍须重新核对当前指纹、依赖和发布资格。

## 后续补录：正式版准备

维护者随后要求“直接改成正式版吧”。按已有 RC 的目标版本转正：Safe Auto `0.2.0-rc.3 → 0.2.0`，Session Manager `0.1.0-rc.1 → 0.1.0`。同步两个 package manifest、Safe Auto 的 `dsh.plugin.json` 及两个插件的双语安装说明；旧 ADR、宿主补丁交付及上述候选包验收数据保留历史值。锁文件不记录这两个 workspace importer 自身版本，无须改动。

2026-10-13 11:48（Asia/Shanghai）通过 npm 元数据工具和精确版本 endpoint 双重核对：[Safe Auto 0.2.0](https://registry.npmjs.org/@klarkxy%2Fdsh-safe-auto/0.2.0)、[Session Manager 0.1.0](https://registry.npmjs.org/@klarkxy%2Fdsh-session-manager/0.1.0) 均返回未发布，HTTP 查询为 404。此时线上标签仍是 Safe Auto `latest=0.1.0-rc.3`、`next=0.2.0-rc.3`；Session Manager `latest=next=0.1.0-rc.1`。本地版本选择函数对这两个稳定版本选择 `latest`，尚未修改任何 npm 标签。

转正时发现 Safe Auto 有独立进行的审批弹窗展示改动，当前状态已降为 `testing`。最终包相对前述复审快照，除版本清单外变化为 `lib/client.js` 及两份 README；本次保留该待验收状态，不将原来的 `ready` 或指纹套用到新 UI。版本号转正不等于新 UI 已通过发布验收。

使用 [正式版归档检查脚本](../../.scratch/stable-release-review-20261013.mjs) 重新打包，版本一致性、包入口、许可证与 `latest` 渠道断言通过，退出码 0。[本地结果](../../.scratch/stable-release-review-20261013.json) 的关键数据如下：

| 包 | 正式目标版本 | 文件数 | 本轮内容指纹 | 状态 |
| --- | --- | --- | --- | --- |
| `@klarkxy/dsh-safe-auto` | `0.2.0` | 31 | `ed2a293c945269408bbf4222cb35bb64a3f6ee07774ad46f75501d72a9fec4ee` | `testing`，仅为当前归档计算值，未登记验收 |
| `@klarkxy/dsh-session-manager` | `0.1.0` | 14 | `7f502d97e45585d2d445394967c1daa2d01134bc0acc13f0370fcb498d807ee0` | 完成本节文档差异复核后恢复 `ready` |

正式目标归档 SHA256：Safe Auto 为 `ea8d63c273d7f070d2f2a924b7a1f24e75867fedf1659426d6d6b77331cdf22e`；Session Manager 为 `210cd813078796b784f1b44d16442eb1337527713496dd33ce90ccc14c584ef4`。

Session Manager 的逐文件断言确认：文件清单不变，除版本清单外仅两份 README 变化，差异为安装命令从 `@next` 改成 `@0.1.0` 并注明 npm 发布后适用。其余所有打包文件散列与前述复审一致，因此 `lib/index.js`、`lib/client.js`、`lib/client.inner.cjs`、`cordis.patch.yml` 仍与已执行的目标宿主验收一致。两份 README 的旧散列作为历史证据保留，不声称新版文档与旧宿主归档一致。运行代码与行为未变，沿用前述 93 项测试和实际宿主证据，本次不重复功能测试；完成最终包和文档复核后登记新的验收指纹。

本次只准备正式版本，未执行 npm 发布、Git 提交/推送或日常宿主安装；根目录 npm 收录表及站点 catalog 保持线上事实。

后续登记验证：`pnpm release:docs` 成功；`pnpm release:check` 54/54 通过、0 失败、0 跳过；相关文件 `git diff --check` 通过（仅现有 LF/CRLF 提示）。归档脚本和发布测试首次受 Windows 沙箱子进程管道限制而报 `EPERM`，同一命令经正常提权后通过；未调整安全规则。未重跑全仓构建或功能测试。

## 后续补录：Session Manager 图标

维护者随后要求补绘 Session Manager 图标。将原有线框文件图案改为与本仓库一致的 36px 蓝色／青绿色双会话气泡，并在 package manifest 顶层补上 `"icon": "./icon.svg"`；原有 `files` 白名单已经包含图标。版本仍为 `0.1.0`，无运行代码改动。

[静态检查](../../.scratch/session-icon-static-check-20261013.mjs) 通过：SVG XML 可解析、viewBox 正确、渐变引用有效、图标路径存在且已列入包文件。`pnpm release:docs` 已同步当前状态。浏览器截图与最终归档检查脚本在启动 Chromium 时被沙箱以 `spawn EPERM` 拒绝；同一命令提权请求的人工确认超时（`HUMAN_APPROVAL_EXPIRED`），未获准执行，未绕过。没有生成浏览器截图，也未完成新图标的最终包指纹或当前日常宿主显示验收。

因包内容已变化，Session Manager 保持 `testing`，移除的是当前状态中的旧指纹，前文历史记录保留。恢复 `ready` 前仍须完成图标展示及最终归档复核，不能把此前 `7f502d97…` 指纹用于新图标包。

本轮 `pnpm release:check` 的文档一致性检查通过，随后的 6 个测试文件均因子进程启动 `EPERM` 未运行，命令退出 1；不能沿用前一次 54/54 作为图标变更后的本轮通过结果。
