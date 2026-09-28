# Safe Auto（候选版）

[English / 完整配置表](README.md) · [单次提权](docs/ADR-0002.md) · [审批模型路由](docs/ADR-0003.md)

复用 DSH 原生工具循环、模型适配器和审批服务。**审批模型默认跟随当前对话，也能单独指定 provider/model，或继续使用独立 HTTP 端点。** 在明确登记的范围内，可以自动审核并批准单次沙箱提权，但不会把整个会话切成 Full Access。模型只能缩小规则给定的权限范围。

仍为本地 POSIX/native 工具候选版，未经独立安全审计。保留原生沙箱、人工审批、备份和外层隔离，不宣称兼容所有工具或平台。

## 安装与默认配置

在仓库检查通过后，向一次性测试 profile 安装本地包：

```sh
pnpm install --frozen-lockfile
pnpm --filter @klarkxy/dsh-safe-auto test
dsh plugin --profile web add ./plugins/dsh-safe-auto
```

PR 不等于 npm 已发布。在 bundle 插入的 `dsh-safe-auto` 条目中配置 `config`：

```yaml
mode: shadow
workspaceRoots:
  - /absolute/canonical/project
shellCandidates:
  - git status --short
# 模型字段不填，默认跟随本对话。
```

另行选择原生 Workspace Write；工作区必须是规范绝对路径，与会话 cwd 和沙箱 root 完全相同。配置严格校验，修改后重载插件。**目前通过 profile 配置，未提供图形化模型选择器或自动设置表单。**

## 审批模型可以单独设置

### 默认：跟随当前对话

`endpoint`、`fastProvider`、`fastModel` 均留空。每次需要模型审核时，读取请求会话已经接受的 `requestHeader().config` 的 provider/model；尚无请求 header 才使用同一 Agent 的 options。存在但不完整的 header 不会偷偷回退。对话下一轮接受了新模型，后续审核随之更新；不同会话不会共用一个全局模型选择。

直接复用 DSH 对应 provider 的适配器和凭据，**不用再填一遍 API Key**。只继承模型路由，不继承聊天历史、主 Agent 提示词、工具权限、回放状态、思考档位或输出预算。审批仍是独立、无工具的模型请求，使用自身的提示和成本上限。需要大量推理 token 的模型可能要提高审批输出上限；无法支持的参数应失败关闭，不能丢掉限制后执行。

### 独立指定 DSH 模型

在同一插件配置中成对设置：

```yaml
fastProvider: your-review-provider
fastModel: your-small-review-model
```

填写 DSH 已配置的实际 provider/model ID。可以和对话完全不同；对话切换模型不会影响这个固定审批模型。清空两项恢复跟随。provider 不存在、模型不可用、凭据错误等会回人工或拒绝，**不静默改用对话模型或其他服务**。

可选深审也可单独指定，包括主审批模型继续跟随对话的情况：

```yaml
deepProvider: your-deep-review-provider
deepModel: your-deep-review-model
```

只有快速审核返回 `review` 才调用深审。两项均为空表示不开启深审，不会默认再调用一次对话模型。不确定时 Smart 回人工，无人值守拒绝。原生路由的 provider/model 必须成对填写。

### 保留独立 HTTP 端点

RC2 的配置继续有效：

```yaml
endpoint: https://your-trusted-gateway.example/v1/chat/completions
fastModel: your-http-review-model
# deepModel: your-http-deep-model
apiKeyEnv: DSH_SAFE_AUTO_API_KEY
```

这是完整 OpenAI-compatible Chat Completions URL，可接兼容 lapp 网关。此模式不要填写 `fastProvider/deepProvider`；与原生路由混填会报错。只有 HTTP 模式读取上述 API Key 环境变量。仅允许 HTTPS 或 loopback HTTP，拒绝重定向、URL 凭据、查询参数和 fragment。恢复跟随时要同时清空 endpoint 和 HTTP fastModel，不能只删 endpoint。

普通预检和单次提权都使用这套选择。一次审核固定两阶段路由；审核期间模型变化会作废自动放行结果，最终 guard 再次核对。模型服务失效不会导致安全 guard 一并卸载。切换模型不重置预算；已经明确拒绝的操作也不会因为换模型被改成可再次争取放行。

## 默认行为与单次提权

`off` 不安装策略。`shadow` 只观察，不保护执行；**登记了普通候选命令后，即使没有独立 endpoint，也可能使用对话模型产生审核费用**。提权在 Shadow 中仍交原生审批，不自动审查或批准。安装时候选列表默认全空，不自动产生审核请求。

`smart` 对普通工作区 `read/read_image/write/edit` 做零模型检查，保留其他原生策略；受保护凭据、安全配置和部分危险命令硬拒绝。未知情况交人工。`unattended` 可以批准符合条件的单次提权，但不确定和其他审批需求均拒绝。

`escalationCandidates` 与 `shellCandidates` 独立，普通命令候选不授予沙箱外权限。例如：

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

**原生 approval: never 优先拒绝所有审批。** 启用自动提权时，原生服务仍需设为 ask，即使插件模式是 unattended。ask 表示分发给审批者，不代表一定有人在线。缺少原生审批服务时不提权。不要叠加官方 Auto、Autogate 或其他自动 answerer，人工 fallback 假定下游是原生人工通道。

## 成本、隐私与安全边界

默认快速/深审输出上限 64/256 tokens，分别写入原生 maxTokens 或 HTTP 参数；每个直接用户任务最多 20/3 次；每阶段超时 8000ms，输入上限 8192 字节；连续 3 次或每会话累计 20 次非允许审核触发熔断。快速返回 allow/review/deny，深审返回 allow/ask/deny。错误 JSON、额外字段、工具调用、缺失 finish 和截断不能批准；原生 reasoning 内容也受响应大小限制。

普通预检和提权共享网络前原子预算，失败不退额。sessionBudgetUnits 默认 100000，按提示 UTF-8 字节数 + 输出上限 + 1024 预留，不是精确账单或主 Agent 总成本。原生缓存计数按 DSH 的互斥计量合并。插件不主动进行传输/语义重试；宿主适配器或中间件可能有自身传输策略，预留计数是逻辑审核请求，不是所有底层 HTTP 尝试。新用户消息只重置任务计数，换模型不重置；重载/重启仍会重置内存计数。

仅发送动作和最近直接人类文本，不发送完整历史、主 Agent 推理或工具结果。justification 不是授权。敏感检测是启发式；选定或跟随远端 provider 会发送这些有界输入，文件提权包含内容。固定配置失效时不偷偷更换数据目的地。

DSH workspace-write 只约束文件效果，不是网络隔离或全面敏感读取防护。单次 Full Access 确实移除该次 DSH 文件沙箱；精确规则不等于 OS 仅放开一个文件。路径重查不能消除 TOCTOU。测试、构建、安装和 Git hooks 可运行任意代码，命令登记不固定其未来内容。无人值守需额外隔离凭据与网络。可信同进程插件、工具和执行提供方仍属于信任基础。

## 验证与剩余范围

运行 npm test、npm run build（JavaScript 语法检查，不是 TypeScript typecheck）、npm pack --dry-run 和全仓 pnpm check。测试包括路由/并发/失效/取消，以及真实 DSH LlmRuntime、ToolRuntime、ApprovalService 和受控适配器集成。CI 必须运行真实 DSH tests；缺依赖的离线本地环境可以明确跳过。

受控模型和 fixture 的 session/tool/policy 不是在线模型准确率、OS 沙箱或 authenticated Web/Headless 验收。剩余清单在 ADR-0002。日志区分 assessment、escalation 和实际 result，不记录原始命令/提示/Key，留存由宿主管理。

PowerShell、PTC/MCP、远程、复杂 Shell、子代理模型提权和 read-only 到 workspace-write 仍未纳入自动放行。没有持久化预算/审计库、跨调用批准缓存、PI probe 或图形化模型选择器。不承诺绝对安全或固定节省比例。

## 许可证

原始实现使用 [SATA License 2.1](LICENSE)，参考社区设计但未直接复制其代码。
