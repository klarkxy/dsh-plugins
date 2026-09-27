# DSH Safe Auto（候选版）

[完整配置与测试说明](README.md) · [架构决策与验收清单](docs/ADR-0001.md)

复用 DSH 官方工具循环、沙箱及人工审批的保守型前置策略。**不会把会话改成 Full Access，也不会自动批准沙箱提权。** 第一版面向本地 POSIX 文件系统和 native 工具模式，不承诺兼容全部工具、平台或 PTC 工作流。

## 默认行为

安装后默认 `shadow`，未配置 reviewer 时不产生额外模型调用。Shadow 只观察，不保护执行。切换 `smart` 后，已登记工作区的普通 `read/read_image/write/edit` 经过路径检查后交还原生策略，不调用模型；受保护的凭据、权限配置和部分危险命令硬拒绝；其他未知或有歧义的动作保留人工审批。

只有管理员明确登记的**完整、精确匹配的简单 Shell 命令**可以进入独立小模型审核。不使用命令前缀白名单，不将 `npm test`、构建或安装依赖自动视为安全。小模型可输出 `allow/review/deny`；只有 `review` 才可能调用可选的深审模型。模型无工具权限，不能扩大确定性策略给出的范围。

`unattended` 遇到不确定、预算耗尽或审批需求直接拒绝。超时、错误 JSON、输出截断、取消、模型错误均不自动放行。没有匹配规则就不能依赖模型“自由判断后通过”。

## 接入

在仓库安装依赖、执行测试后，可向一次性测试 profile 安装本地包：

```sh
pnpm install --frozen-lockfile
pnpm --filter @klarkxy/dsh-safe-auto test
dsh plugin --profile web add ./plugins/dsh-safe-auto
```

此 PR 不等于 npm 已发布。配置 bundle 插入的 `dsh-safe-auto` profile 条目，例如其配置内容为：

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

API Key 从所指定的环境变量读取。模型通过完整 OpenAI-compatible Chat Completions URL 调用，可接兼容的 lapp 网关；此版不直接读取 DSH provider 路由。配置有严格校验，修改后需重新加载插件；尚无独立设置页面。工作区路径必须是登记过的规范绝对路径，并与会话 cwd 和沙箱 root 一致。需要另行选择原生 Workspace Write，本插件不修改权限档。

## 安全和成本的实际边界

DSH 的 `workspace-write` 限制文件效果，**不是网络隔离**。测试脚本可能执行任意代码，普通源码里也可能藏有密钥。管理员登记命令是明确授予候选能力，并不证明其底层脚本未来不变。必须保留原生沙箱，实际无人值守应放在无宿主凭据、限制网络出口的隔离环境。

输入只含选定动作和最近的直接人类文本，不传整段历史、工具结果或主 Agent 推理。敏感模式检测是启发式，不能识别所有密钥；配置远端 reviewer 意味着同意把这些有限输入发给它。超长输入拒绝，不静默截断。

默认快速/深审输出上限分别为 64/256 tokens，并真实写入请求；每个人类任务最多 20/3 次，连续 3 次不通过或累计 20 次后停止继续模型审核。预算在网络请求前原子预留，并发不会重复透支，失败不退额，不做语义重试。

`sessionBudgetUnits` 是“输入 UTF-8 字节数 + 输出上限 + 1024”的保守计量，不是精确账单 token 或金额上限；供应商仍须遵守输出限制。主 Agent 的 token 不在本插件控制范围内。预算暂存内存，插件重载/进程重启会重置；尚无持久化预算。

不自动放行 `grep/glob`、`run_code`/PTC、MCP、PowerShell、远程执行、复杂 Shell、符号链接和越界路径。不要与其他自动审批插件叠加使用。可信同进程插件、profile、文件系统和执行提供方仍属于可信计算基础。

日志区分策略判断与实际工具结果，不记录原始提示、命令或密钥。日志留存由宿主负责。测试包含故障、绕过与真实 Cordis/ToolRuntime 接口验证，但真实 Web/Headless 登录、操作系统沙箱及在线模型准确率还需要部署验收。此候选版没有经过独立安全审计，不承诺绝对安全或某个 token 节省比例。
