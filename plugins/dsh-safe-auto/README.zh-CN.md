# 安全自动（候选版）

在明确登记的范围内自动审核并批准单次原生沙箱提权，**审批模型默认跟随当前对话，也能单独指定 provider/model，或继续使用独立 HTTP 端点**。复用 DSH 原生工具循环、模型适配器和审批服务；不会把整个会话切成 Full Access，模型只能缩小规则给定的权限范围。

[English](README.md) · [预检](docs/ADR-0001.md) · [单次提权](docs/ADR-0002.md) · [审批模型路由](docs/ADR-0003.md)

## 安装与默认配置

在仓库检查通过后，向一次性测试 profile 安装本地包：

```sh
pnpm install --frozen-lockfile
pnpm --filter @klarkxy/dsh-safe-auto test
dsh plugin --profile web add ./plugins/dsh-safe-auto
```

PR 不等于 npm 已发布。bundle 会插入 `dsh-safe-auto` 条目，通过 profile 补丁机制配置它的 `config`：

```yaml
mode: shadow
workspaceRoots:
  - /absolute/canonical/project
shellCandidates:
  - git status --short
# 模型字段不填，默认跟随本对话。
```

工作区必须是规范绝对路径，与会话 cwd 和沙箱 root 完全相同。授权范围、候选命令、提权名单和预算仍通过 profile 配置，严格校验且修改后重载插件。

## 插件页启停与独立代审批

**你做什么。** 在插件页 **替我审批** 区块选择活跃主会话并点击 **启用**。停用只关闭代审批，不修改会话原生权限。启用保留 **Workspace Write + ask**，不注册官方 Full Access Auto。打开页面、刷新、保存模型配置都不会自动启用会话。子会话、重启及 UI Host 卸载不继承启用状态。

**插件做什么。** 新增 `approvalReview: true`（默认为 `false`），或在插件页审核模式选择 **独立模型替我审批** 并保存。这一模式参考 `dsh-approval-review@0.5.1` 的独立应答者原理，不要求 POSIX 精确候选命令；可以审核 Windows 原生 `pwsh` 以及 `bash/write/edit` 发出的真实单次沙箱提权请求。仅绑定当前工具执行的真实请求，不依据自由文本、同名 callId 或旧日志批准；启用独立审批时，未知工具、远程、嵌套、子代理、不完整参数及无法绑定当前执行的请求均拒绝。模型无工具，仅收到完整有界动作、当前直接用户意图和附加约束。

模型必须提供结构化风险、用户授权、有界范围和理由；只有低/中风险、至少中等直接授权且范围有界才可能自动批准。高/严重风险、不确定、证据不足的未知脚本、非法结果、模型错误、超时、预算不足及授权失效均直接拒绝；明确拒绝绝不回退给其他应答者。默认快速 64 token 可能不足以生成结构化结果，可通过 profile 调整预算；截断时不会放行。

此模式是对原生审批链的显式委托，不是任意操作授权；`approval: never` 仍在链前拒绝。插件页固定显示「无法自动判断时 → 直接拒绝」，该策略不可修改也不保存，因为尚未核验 DSH 的仅人工审批通道。调用 waterfall `next()` 可能到达其他自动应答者，不等于人工回退。独立审批的非允许结果不委托下游。旧版精确规则兼容行为不变。本次源码修改不会自动卸载已安装插件或发布新版本。

## 审核模型设置

新版 bundle 包含核心与 UI Host 两个条目；设置和会话操作统一位于插件页，不替换输入框原生权限菜单。启用操作使用宿主预设，不走官方 Full Access 的 `registerAuto()`；原生 `approval: never` 仍不可绕过。

在插件页 **安全自动设置** 中选择快速/深度审核模型、各自思考强度及最多 4096 字符的额外审核提示词。模型目录和档位来自宿主；快速模型为空表示跟随本会话，深审为空表示关闭。选新模型清空旧档位，未列出的已保存配置不会被静默替换。原生模型不支持指定档位时失败关闭。提示词只能增加审核条件，不能替换固定安全规则或扩大授权。保存不调用模型、不改变会话权限、不重置预算；会使未完成的旧授权失效。思考模型若需要更高输出预算，请在 profile 调整 `fastOutputTokens/deepOutputTokens`。HTTP 模式面板只读，仍保留 profile 配置，不支持原生思考档位。

UI Host 条目 `dsh-safe-auto-ui` 使用 `storageDomain` 持久保存审核偏好，覆盖同名 profile 模型字段；不保存会话授权。启用状态仅属于当前活跃会话对象：切回原生选项、外部权限变更、重启或 UI Host 卸载都会关闭自动审核，分叉及子会话不继承。UI 接管后，旧版 profile 的 smart/unattended 不会自动启用未选择的会话；单独加载核心 Host 条目时保留旧配置模式。卸载 Client 后原生权限控件恢复。

## 审批模型可以单独设置

### 默认：跟随当前对话

`endpoint`、`fastProvider`、`fastModel` 均留空。每次需要模型审核时，读取请求会话已经接受的 `requestHeader().config` 的 provider/model；尚无请求 header 才使用同一 Agent 的 options。存在但不完整的 header 不会偷偷回退。对话下一轮接受了新模型，后续审核随之更新；不同会话不会共用一个全局模型选择。

直接复用 DSH 对应 provider 的适配器和凭据，**不用再填一遍 API Key**。只继承模型路由，不继承聊天历史、主 Agent 提示词、工具权限、回放状态、思考档位或输出预算。审批仍是独立、无工具的模型请求，使用自身的提示和成本上限。需要大量推理 token 的模型可能要提高审批输出上限；无法支持的参数应失败关闭，不能丢掉限制后执行。

### 独立指定 DSH 模型

在同一插件配置中成对设置，填写 DSH 已配置的实际 provider/model ID：

```yaml
fastProvider: your-review-provider
fastModel: your-small-review-model
```

可以和对话完全不同；对话切换模型不会影响这个固定审批模型。清空两项恢复跟随。provider 不存在、模型不可用、凭据错误等在独立审批模式中直接拒绝；旧版精确规则模式保留原有人工或拒绝行为，**不静默改用对话模型或其他服务**。

可选深审也可单独指定，包括主审批模型继续跟随对话的情况：

```yaml
deepProvider: your-deep-review-provider
deepModel: your-deep-review-model
```

只有快速审核返回 `review` 才调用深审。两项均为空表示不开启深审，不会默认再调用一次对话模型。独立审批模式中不确定直接拒绝；旧版精确规则模式仍是 Smart 回人工、无人值守拒绝。原生路由的 provider/model 必须成对填写。

### 保留独立 HTTP 端点

RC2 的配置继续有效：

```yaml
endpoint: https://your-trusted-gateway.example/v1/chat/completions
fastModel: your-http-review-model
# deepModel: your-http-deep-model
apiKeyEnv: DSH_SAFE_AUTO_API_KEY
```

这是完整 OpenAI-compatible Chat Completions URL，可接兼容 lapp 网关。此模式不要填写 `fastProvider/deepProvider`；与原生路由混填会报错。只有 HTTP 模式读取上述 API Key 环境变量。仅允许 HTTPS 或 loopback HTTP，拒绝重定向、URL 凭据、查询参数和 fragment。恢复跟随时要同时清空 endpoint 和 HTTP fastModel，不能只删 endpoint。

普通预检和单次提权都使用这套选择。每次审核固定两阶段路由；审核期间模型变化会作废自动放行结果，最终 guard 再次核对。模型服务失效不会导致安全 guard 一并卸载。切换模型不重置预算；已经明确拒绝的操作也不会因为换模型或用户意图变化被改成可再次争取放行。普通模型预检也会在审查前绑定动作、工作区、沙箱策略和直接用户意图，并在下游策略结束后的最终 guard 中拒绝过期授权。

## 默认行为与单次提权

以下为 `approvalReview: false` 的旧版精确规则兼容行为，不是独立审批的回退策略。启用独立审批时，未知或未绑定请求、不允许的结果、错误、超时、预算耗尽及授权失效均拒绝，不回人工或下游审批链。

`off` 不安装策略。`shadow` 只观察，不保护执行；**登记了普通候选命令后，即使没有独立 endpoint，也可能使用对话模型产生审核费用**。提权在 Shadow 中仍交原生审批，不自动审查或批准。安装时候选列表默认全空，不自动产生审核请求。

`smart` 对普通工作区 `read/read_image/write/edit` 做零模型检查，保留其他原生策略；受保护凭据、安全配置和部分危险命令硬拒绝。未知情况交人工。`unattended` 可以批准符合条件的单次提权，但不确定和其他审批需求均拒绝。

`escalationCandidates` 与 `shellCandidates` 独立，普通命令候选不授予沙箱外权限，默认 `[]`。例如：

```yaml
escalationCandidates:
  - tool: write
    cwd: /absolute/canonical/project
    mode: danger-full-access
    filePath: /absolute/other-project/notes.txt
  - tool: edit
    cwd: /absolute/canonical/project
    mode: danger-full-access
    filePath: /absolute/other-project/notes.txt
  - tool: bash
    cwd: /absolute/canonical/project
    mode: danger-full-access
    command: git status --short
escalationApprovalTtlMs: 30000
escalationMaxTimeoutMs: 30000
```

每条规则只有 tool/cwd/mode 和 filePath 或 command 四项，不允许前缀、通配符或整个目录授权。原生 DSH 使用 `sandbox_permissions: danger-full-access` 加 justification，不是 Codex 的 require_escalated。当前只支持 Workspace Write 到单次 Full Access。文件目标要是规范绝对路径且父目录已存在；链接、硬链接写入、受保护/系统目标及未知参数不自动放行。write/edit 分别登记；完整有界内容交给 Reviewer，超长或命中敏感检测时不截断后批准。

**Bash 自动提权要求没有 jobs 服务**、可确认的沙箱 shell、不请求后台、显式正数 timeoutMs 且不超过配置上限，workdir 不变。加载 jobs 的 DSH 可能把超时前台任务转后台；这种组合仍走人工或无人值守拒绝，不会偷偷关闭 jobs。超时和一次性批准不能证明所有派生进程都已经退出。

只在匹配的原生 approval/request 内返回 allowed-once，由原生工具消费，不自行执行或修改会话权限。批准绑定 opaque token、异步上下文、Agent、callId、signal、完整参数、cwd、权限模式、直接用户意图和文件状态。并发相同 callId 不能互借；每次执行只消费一次，无跨调用批准缓存。审批 TTL 是决定新鲜度，不是进程 TTL、撤销或回滚；操作副作用不会自动撤销。详见 [ADR-0002](docs/ADR-0002.md)。

**原生 approval: never 优先拒绝所有审批。** 启用自动提权时，原生服务仍需设为 ask，即使插件模式是 unattended。ask 表示分发给审批者，不代表一定有人在线。缺少原生审批服务时不提权；普通放行调用 `next()`，保留下游的拒绝与提示。不要叠加官方 Auto、Autogate 或其他自动 answerer；旧版规则模式的人工 fallback 假定下游是原生人工通道，启用独立审批时不使用该回退。

## 成本与隐私

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| `timeoutMs`、`maxInputBytes` | `8000`、`8192` | 每阶段超时与提示／输入合计 UTF-8 上限 |
| `fastOutputTokens`、`deepOutputTokens` | `64`、`256` | 原生 `maxTokens` 或 HTTP 输出上限 |
| `tokenField` | `max_tokens` | 仅 HTTP 模式，可选 `max_completion_tokens` |
| `fastCallsPerTask`、`deepCallsPerTask` | `20`、`3` | 每个直接用户任务的逻辑审核预留次数 |
| `sessionBudgetUnits` | `100000` | 提示字节数 + 输出上限 + 每阶段 1024 预留 |
| `consecutiveDenials`、`totalDenials` | `3`、`20` | 单任务／单会话的非允许审核熔断 |

快速返回 allow/review/deny，深审返回 allow/ask/deny。错误 JSON、额外字段、工具调用、缺失 finish 和截断不能批准；原生 reasoning 内容也受响应大小限制。插件不主动做传输/语义重试；宿主适配器或中间件可能有自身传输策略，预留计数是逻辑审核请求，不是所有底层 HTTP 尝试。

仅发送动作和最近直接人类文本，不发送完整历史、主 Agent 推理或工具结果。justification 不是授权。敏感检测是启发式；选定或跟随远端 provider 会发送这些有界输入，文件提权包含内容。固定配置失效时不偷偷更换数据目的地。

普通预检和提权共享网络前原子预算，失败不退额。sessionBudgetUnits 默认 100000，按提示 UTF-8 字节数 + 输出上限 + 1024 预留，不是精确账单或主 Agent 总成本。原生缓存计数按 DSH 的互斥计量合并。新用户消息只重置任务计数，换模型不重置；重载/重启仍会重置内存计数。熔断停止的是审核，不是整个 Agent 循环。

## 验证与剩余范围

运行 npm test、npm run build（JavaScript 语法检查与浏览器 bundle 构建，不是 TypeScript typecheck）、npm pack --dry-run 和全仓 pnpm check。测试包括路由/并发/失效/取消，以及真实 DSH LlmRuntime、ToolRuntime、ApprovalService 和受控适配器集成。CI 必须运行真实 DSH tests；缺依赖的离线本地环境可以明确跳过。Windows 上显式跳过 POSIX 专用文件授权与提权用例，并验证失败关闭行为，原生模型路由测试仍运行。若 Windows 沙箱阻止测试运行器创建子进程管道，可逐文件执行 `node --test --test-isolation=none test/<file>.test.js`。

受控模型和 fixture 的 session/tool/policy 不是在线模型准确率、OS 沙箱或 authenticated Web/Headless 验收。剩余清单在 [ADR-0002](docs/ADR-0002.md)。日志区分 assessment、escalation 和实际 result，不记录原始命令/提示/Key，留存由宿主管理。

## 边界与限制

- **不是经过审计的安全边界。** 精确规则路径（本地 POSIX/native 工具候选）和独立审批模式（含 Windows 原生提权）都只是候选实现，未经独立安全审计。先用 `shadow`，并保留你原本依赖的原生沙箱、隔离与备份。
- **人工审批不是独立审核的回退。** 它只存在于旧版规则模式或未启用独立审批时。
- **精确规则不等于更细的 OS 沙箱。** DSH workspace-write 只约束文件效果，不是网络隔离或全面敏感读取防护；单次 Full Access 确实移除该次 DSH 文件沙箱。
- **精确规则模式不扩大授权名单。** `approvalReview: false` 时，候选列表为空不产生模型自动批准，Windows 文件自动放行和 PowerShell 精确规则提权仍不支持。独立审批模式需明确保存选择并启用会话，适用范围见上节。
- **覆盖范围止于原生单次提权。** PTC/MCP、远程、子代理模型提权和 `grep/glob` 仍在自动放行范围之外，read-only 到 workspace-write 的放宽同样未纳入。精确规则模式仍排除 PowerShell 和复杂 Shell；独立审批模式可以审查原生 Shell 提权，但缺少决定性脚本证据直接拒绝。
- **登记内容不被固定，同进程插件仍受信任。** 测试、构建、安装和 Git hooks 可运行任意代码，命令登记不固定其未来内容；卸载策略会一并移除其 guard。可信同进程插件、工具和执行提供方仍属于信任基础。路径重查不能消除 TOCTOU；无人值守需额外隔离凭据与网络。
- **不承诺任何保证。** 没有失败放行选项，不提供独立只读探针或 Codex 全功能等价保证；没有持久化预算/审计库、跨调用批准缓存或 PI probe，也不承诺绝对安全或固定节省比例。

## 许可证

原始实现使用 [SATA License 2.1](LICENSE)，参考社区设计但未直接复制其代码。
