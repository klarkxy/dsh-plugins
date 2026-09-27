# DSH Safe Auto（候选版）

[English / 完整配置表](README.md) · [预检设计](docs/ADR-0001.md) · [单次提权设计与验收](docs/ADR-0002.md)

复用 DSH 原生工具循环、沙箱和审批服务的安全预检插件。**现在支持在明确登记的范围内，自动审核并批准单次沙箱提权；不把整个会话切成 Full Access。** 模型只能缩小规则给定的范围，不能自行扩大权限。

当前面向本地 POSIX/native 工具，仍是未经独立安全审计的候选版，不宣称适用于所有工具、平台或 PTC 工作流。

## 默认行为

安装默认 `shadow`，没有登记命令和 reviewer 时不产生额外模型调用。Shadow 不保护执行，只保留原生行为；普通候选命令可以进行影子审核，提权则直接留给原生审批，不自动审查或批准。

`smart` 下，登记工作区内的普通 `read/read_image/write/edit` 经过确定性路径检查后交回现有策略，不调用模型。受保护的凭据、安全配置和部分危险命令硬拒绝。完整精确匹配的普通 Shell 命令才可进入 reviewer；未知情况交原生人工审批。

单次提权使用独立的 `escalationCandidates`，**普通 `shellCandidates` 不能授予沙箱外执行权限**。匹配的原生 `bash/write/edit` 提权，在 `approval/request` 阶段才调用 reviewer，允许后返回一次 `allowed-once`；显式拒绝不重试，不交另一审批插件再次争取放行。

`unattended` 也可以批准符合条件的单次提权，但所有不确定、错误和其余审批需求均拒绝，不转人工。取消、身份不符或审核期间授权/参数变化，不会自动批准。

## 接入与配置

在仓库检查通过后，向一次性测试 profile 安装本地包：

```sh
pnpm install --frozen-lockfile
pnpm --filter @klarkxy/dsh-safe-auto test
dsh plugin --profile web add ./plugins/dsh-safe-auto
```

PR 不代表 npm 已发布。配置 bundle 插入的 `dsh-safe-auto` 条目，其 `config` 示例为：

```yaml
mode: shadow
workspaceRoots:
  - /absolute/canonical/project
shellCandidates:
  - git status --short
endpoint: https://your-trusted-gateway.example/v1/chat/completions
fastModel: your-fast-model
# deepModel: your-deep-model
apiKeyEnv: DSH_SAFE_AUTO_API_KEY
```

API Key 只从指定环境变量读取。端点是完整的 OpenAI-compatible Chat Completions URL，可接兼容 lapp 网关；此版不读取原生 DSH provider 路由。仅 HTTPS 或 loopback HTTP，拒绝重定向、URL 凭据、查询参数和 fragment。配置严格校验，修改后需要重载插件，尚无独立设置页面。

工作区必须是已登记的规范绝对路径，并与会话 cwd、原生沙箱 root 完全一致。需要另行选择原生 **Workspace Write**，插件不会修改权限档。

## 开启单次提权

默认 `escalationCandidates: []`。在同一 `config` 中加入明确规则，验证后再切换 `smart` 或 `unattended`：

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
  # bash 自动提权还须满足下文的前台执行条件。
  - tool: bash
    cwd: /absolute/canonical/project
    mode: danger-full-access
    command: git status --short
escalationApprovalTtlMs: 30000
escalationMaxTimeoutMs: 30000
```

每条规则只有 `tool/cwd/mode` 和 `filePath` 或 `command` 四个字段。不支持前缀、通配符、整个目录授权或自动更换目标。原生 DSH 使用 `sandbox_permissions: danger-full-access` 加 `justification`，不是 Codex 的 `require_escalated`。本候选版只实现从 Workspace Write 到单次 Full Access，不实现 read-only 到 workspace-write 的自动放宽。

**文件提权：** 目标必须是精确绝对路径，父目录已存在且规范。符号链接、硬链接写入、受保护/系统目标和未知参数不自动放行。`write` 与 `edit` 必须分别登记。完整的有界文件内容及修改参数会交给 reviewer，超长或命中敏感内容检查时拒绝，不截断后继续批准。

**Bash 提权：** 自动审批要求当前没有 `jobs` 服务，能确认 shell 具备沙箱能力，`run_in_background` 为 false 或省略，并显式提供正数 `timeoutMs` 且不超过配置上限。`workdir` 只能省略或等于登记 cwd。DSH 在加载 jobs 时可能把超时的前台命令转成后台，所以仅写 `run_in_background: false` 不够。常见的 jobs-enabled profile 中，这类请求仍走人工，或在无人值守下拒绝；插件不偷偷关闭 jobs。原生命令超时也不等于证明所有自行派生的子进程都已退出。

批准绑定当前执行的 opaque token、异步执行上下文、Agent、callId、signal、完整参数、工作目录、权限模式、直接用户意图及文件状态。只有匹配的原生审批能消费一次；相同 callId 的并发调用不能借用许可。普通预检不会预先批准提权，也不重复调用 reviewer。

`escalationApprovalTtlMs` 是自动审批决定的新鲜度限制，**不是进程运行时长、事后撤销权限或回滚副作用的保证**。过期后 Smart 交人工、无人值守拒绝。会话的默认权限始终不变。

## 原生审批策略与组合

**原生 `approval: never` 在所有 answerer 之前直接拒绝，包括本插件。** 要用自动提权，原生审批服务必须保留 `ask`；即使本插件是 `unattended` 也是如此。这里的 `ask` 意味着分发给审批者，审批者可以是插件，不要求一定有人在线。没有原生审批服务时不能提权。

现有其他策略的 deny/ask 会保留；非本次提权的审批不会被自动回答。不要与官方 experimental Auto、Autogate 或其他自动审批插件叠加，否则原生人工 fallback 可能被另一个模型自动回答。可信同进程插件、工具注册、profile 和执行提供方仍属于可信计算基础。

## 安全与成本的实际边界

DSH `workspace-write` 是文件效果策略，**不是网络出口隔离，也不阻止所有敏感读取**。获准的 `danger-full-access` 调用确实没有 DSH 文件沙箱限制；规则只限定审批资格，并未给操作系统增加“只开放这个文件”的细粒度边界。路径重查减少陈旧决定，但不能消除 TOCTOU。无人值守应放在无宿主凭据、限制网络的隔离环境。

测试、构建、安装依赖和 Git hooks 可能执行任意代码，不默认视为安全。精确登记命令不代表底层脚本未来不会变化。Reviewer 仅接收动作和最近直接人类文本，不传整段历史、工具输出或主 Agent 推理；justification 不能替代用户授权。敏感信息检测是启发式，不能识别所有密钥。配置远端 reviewer 意味着同意发送这些有界输入，提权文件操作包含内容。

快速/深审分别输出 `allow/review/deny` 和 `allow/ask/deny`，只有快速层返回 review 才调用可选深审。默认输出上限 64/256 tokens，真实写入请求；每个人类任务最多 20/3 次；连续 3 次不通过或每会话累计 20 次后停止继续模型审核。普通预检和提权共享预算，网络前原子预留，失败不退额，不做传输或语义重试。

`sessionBudgetUnits` 默认 100000，按输入 UTF-8 字节数 + 输出上限 + 1024 预留，不是精确账单或金额上限，也不包含主 Agent 消耗。默认每阶段超时 8000ms，合并输入上限 8192 字节。新用户消息只重置每任务计数；重载/重启会重置全部内存预算。熔断不等于停止整个 Agent 循环。

## 验证与日志

日志区分 assessment、单次 escalation 审批及实际 result，不记录原始命令、用户提示或 Key。审批日志包含来源、权限变化及绑定摘要；DSH 另外保存原生 asked/decided 审计对。日志留存由宿主管理，未实现防篡改持久化数据库。

自动测试包含故障/并发/绕过、真实 loopback HTTP，以及真实 Cordis、ToolRuntime、ApprovalService 和 `approveEscalation` 的组合。集成测试在临时目录写入工作区外的 fixture 文件，并验证批准不继承、原生 never 优先和审计配对；其 session、沙箱策略和工具体仍是 fixtures，**不是实际操作系统隔离验收**。缺依赖的本地离线环境允许跳过真实 DSH 测试，CI 必须运行。

尚未完成实际 Web/Headless 登录 profile、真实操作系统沙箱、在线模型准确率及攻击语料验收。PowerShell、PTC/MCP、远程、复杂 Shell、子代理模型提权未纳入自动放行范围。详见 [ADR-0002 验收清单](docs/ADR-0002.md)，不承诺绝对安全或固定 token 节省比例。

## 许可证

原始实现使用仓库的 [SATA License 2.1](LICENSE)，参考了社区设计但没有直接复制其代码。
