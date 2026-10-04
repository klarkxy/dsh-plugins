# 安全自动（候选版）

自动审核原生沙箱提权请求。当真实的 `write`/`edit`/`bash`/`pwsh` 调用要求把沙箱放宽到 Workspace Write 之外时，由独立的审核模型把关这一次调用；只有审查通过才返回 `allowed-once`。不确定、错误、超时和预算耗尽一律**直接拒绝，不交回下游**。插件不会把会话切成 Full Access，也不会让模型扩大你配置的范围。

[English](README.md) · [单次提权](docs/ADR-0002.md) · [审核模型路由](docs/ADR-0003.md)

> **0.2.0 是破坏性简化。** 0.1.x 的精确规则预检、workspace/shell/escalation 候选名单、`shadow`/`smart`/`unattended` 模式、深度审核阶段和 HTTP 端点均已删除。见[从 0.1.x 迁移](#从-01x-迁移)。

## 安装与启用

```sh
dsh plugin --profile <profile> add @klarkxy/dsh-safe-auto
```

使用源码检出安装：

```sh
pnpm install --frozen-lockfile
pnpm --filter @klarkxy/dsh-safe-auto test
dsh plugin --profile <profile> add ./plugins/dsh-safe-auto
```

bundle 会插入 `dsh-safe-auto` 与 `dsh-safe-auto-ui` 两个 profile 条目。然后打开插件页，选择一个活跃主会话并点击 **启用**。在此之前没有任何自动行为：会话不继承启用状态，重启、切换权限或卸载都会撤销它。

## 工作原理

1. 原生工具调用请求 `sandbox_permissions` 提权（`workspace-write` 或 `danger-full-access`）。
2. 插件绑定当前活跃执行——agent、callId、signal、完整参数、cwd、沙箱策略和最近一条真人消息。
3. 审批请求与该绑定逐项匹配后，由审核模型用固定安全提示词审查一次。
4. `allow` → 仅这一次调用 `allowed-once`。其他任何结果 → `rejected`。明确的拒绝绝不重试或软化。

审核模型只看到完整有界的动作和真人直接意图——看不到对话记录、主代理提示词或工具。结构化裁决分开评估风险、授权和范围：只有低/中风险、至少中等直接授权且单次副作用有界才自动放行。高/严重风险、不确定、畸形裁决、错误和超时一律拒绝。

## 配置

全部可选；不配置时审核模型跟随当前对话。编辑 profile 条目的 `config` 并重载：

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 总开关。`false` 不挂载任何守卫。 |
| `provider` / `model` | *（跟随对话）* | 固定审核路由，用你的 DSH 模型 ID 成对配置。 |
| `reasoningEffort` | *（模型默认）* | 固定路由 advertised 的思考强度。 |
| `reviewerPrompt` | *（无）* | 额外审核约束（≤4096 字符）；只能收紧，不能放宽。 |
| `timeoutMs` | `30000` | 单次审查超时。 |
| `maxInputBytes` | `8192` | 提示词与输入合计的 UTF-8 字节上限。 |
| `outputTokens` | `256` | 审核输出上限。思考模型可能需要更大。 |
| `maxReviewsPerTask` | `20` | 每个真人任务的审查次数上限。 |
| `consecutiveDenials` | `3` | 每个任务内连续非放行结果达到该值后熔断。 |

未知键会直接校验失败，而不是被忽略。审核模型、思考强度和提示词也可以在插件页配置；保存的值覆盖 profile 路由，但永远不覆盖预算。

## 审核模型

**默认：跟随对话。** `provider`/`model` 留空。每次审查从请求会话已接受的请求头解析 provider/model，复用 DSH 已配置的凭据——不需要额外 API key。继承的只有模型路由，不包括历史、提示词、工具或预算。

**固定模型。** 成对设置 `provider` 和 `model`，对话切换模型时审核路由保持不变。路由缺失或非法时直接拒绝，不做静默回退。

## 策略

| 请求 | 结果 |
| --- | --- |
| 绑定的 `write`/`edit`/`bash`/`pwsh` 单次提权，审查通过 | `allowed-once`，仅此一次 |
| 受保护的凭据/安全文件、密钥、危险程序 | 审查前硬拒绝 |
| 高/严重风险、不确定、证据不足 | 拒绝 |
| 未知工具、子代理、嵌套或未绑定请求 | 拒绝 |
| 错误、超时、预算耗尽、授权失效 | 拒绝 |
| 模型明确拒绝 | 拒绝，不重试 |

原生 `approval: never` 仍在任何应答者之前拒绝。不要与其他自动审批应答者叠加使用。

## 从 0.1.x 迁移

- profile 键 `mode`、`workspaceRoots`、`shellCandidates`、`escalationCandidates`、`endpoint`、`apiKeyEnv`、`tokenField`、`fast*`/`deep*` 以及熔断 `sessionBudgetUnits`/`totalDenials` 已删除；仍携带这些键的 profile 会校验失败。0.1.x 的 `approvalReview: true` 加插件页启用，现在就是唯一行为。
- `fastProvider`/`fastModel`/`fastReasoningEffort` 更名为 `provider`/`model`/`reasoningEffort`；`fastOutputTokens` 更名为 `outputTokens`；`fastCallsPerTask` 更名为 `maxReviewsPerTask`。
- 0.1.x 面板保存的设置仍可加载（废弃键会被剥离），但审核路由回退为跟随对话——如果你用过固定模型，请在插件页重新选择。

## 边界与限制

- **不是经过审计的安全边界。** 审核方是语言模型，可能出错，尤其在对抗性上下文中。保留你原本依赖的原生沙箱、隔离和备份。
- **没有人工回退。** 不确定和审核故障直接拒绝而不是委托：审批瀑布链不是已核验的仅人工通道，另一个自动应答者不算人工。重试该操作会重新询问。
- **覆盖范围止于原生单次提权。** 只审核从 `workspace-write` 放宽的 `write`/`edit`/`bash`/`pwsh`。其他工具、MCP、远程执行、子代理调用和常驻权限变更都在自动范围之外。
- **登记内容不锁定，其他插件仍然可信。** 批准的命令可能运行仓库控制的代码；同进程的可信插件仍然可信，卸载插件会移除它的守卫。真正的隔离请使用外部手段并限制凭据与出站。
- **不作任何保证。** 没有 fail-open 选项，没有持久审计数据库，也不承诺绝对安全或节省比例。

## 验证

在本包运行 `npm test`、`npm run build` 和 `npm pack --dry-run`，以及仓库级 `pnpm check`。测试覆盖路由、并发会话、原生流、上限、过期决定、模型服务移除、执行绑定，以及真实 Cordis/ToolRuntime/ApprovalService/LlmRuntime 契约。CI 要求安装 DSH 依赖；离线纯源码运行可跳过原生契约。如果 Windows 沙箱拦截测试运行器的子进程管道，用 `node --test --test-isolation=none test/<file>.test.js` 逐文件运行。

原生契约测试使用受控适配器和夹具会话/工具，证明的是运行时集成，不是真实模型准确率、OS 隔离或已认证的 Web/Headless 验收；这些仍在 [ADR-0002 的清单](docs/ADR-0002.md)中。日志分离评估、结果和最终状态，不含原始命令、提示词或密钥；宿主留存由运维管理。

## 许可证

原创实现基于 [SATA License 2.1](LICENSE)。社区设计启发了本工作；未打包其代码。
