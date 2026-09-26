# 工具

[English](../../areas/tools.md)

模型可见的工具通过 `defineTool` 声明，并用 `ctx.tools.register` 注册。`execute` 只返回 schema 规定的 JSON 值。允许、拒绝和询问写在 `tools/pre-execute` 等事件上，不要写进工具正文。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

`@deepseek-ai/dsh-tools` 提供 `ctx.tools`，也就是 agent 循环用来分发的注册表。注册一个工具，就足以让它的 schema 进入系统提示的拼装。模型看到每个被允许的工具的名字、描述和参数 schema。按 agent 的限制可以收窄这组工具。

## 它在哪里

- 第一个工具：[docs/user/develop/basic/tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/tool.md)
- 编写参考：[docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md)
- 包：[packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)
- 子系统：[docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md)
- 生成的名字：[docs/tool-catalog.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/tool-catalog.md)

`defineTool` 从 `@deepseek-ai/dsh-tools` 导出。

## 约定

插件注入 `tools`，并在 `apply` 里注册。插件 fiber 被释放时，工具会取消注册。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))
}
```

必填字段是 `name`、`description`、`parameters`，以及 `output.schema` 加上 `output.render`。`DefineToolOptions` 上写明的可选字段包括 `output.presentationMeta`、`deferLoading`、`timeoutMs`、`isConcurrencySafe`、`execute`、`projectContent`、`finalizeContent`、`presentCall` 和 `presentResult`。

食谱里的规则：

- `defineTool` 在 `execute` 之前校验模型参数。在 `execute` 内部，参数符合 schema。DSL 表达不了的约束要自己检查。
- `execute` 返回一个规范的 JSON 值。注册表校验它，再传给 `output.render`。不要从函数体返回内容块。
- 抛出或非法值会变成错误结果。基础设施故障用抛出。成功的领域结果放进规范值。
- 尊重 `exec.signal`。身份字段（`callId`、`name`、`arguments`、`agent`、`token`、`signal`）保持不可变。
- `output.presentationMeta(args, value)` 派生可重放的卡片 JSON。核心把它持久化在 `tool/result` 上。
- `agent.inject({ content, source: { kind: 'plugin', plugin: '<name>' } })` 追加下一次模型请求能看到的持久上下文。它不会唤醒空闲的 agent。

策略事件，按流水线顺序：

| 事件或方法 | 作用 |
| --- | --- |
| `tools/pre-execute` | 允许、拒绝或询问。 |
| `ctx.tools.guard(guard)` | 在 pre-execute 之后单调拒绝。后面的监听器不能撤销它。 |
| `tools/execute` | 环绕分发，包括截止时间和重试。 |
| `tools/post-execute` | 替换内容或值、阻断，或附上上下文。 |
| `tools/result` | 观察最终结果。 |

按 agent 收窄用 `ctx.tools.restrict(filter)`、`ctx.tools.get(name, scope)` 和 `ctx.tools.schemas(scope)`。

包 README 里的注册表配置：`mode` 是 `native`、`ptc` 或 `both`（默认 `native`）；`maxParallelSubCalls` 默认 10。在 `ptc` 或 `both` 下，可见工具也会作为 `await tools.<name>(args)` 暴露在生成的 `run_code` SDK 里。agent 可以用 `presentAs` 覆盖呈现方式。

后台工作在生产者配置放行 `run_in_background` 之后，使用 `ctx.jobs.start({ kind, label, owner: exec.agent, run })`。成功的后台分支返回带类型的句柄，例如 `{ kind: 'background', jobId }`。一旦 `ctx.jobs.start()` 公布了 id，取消就属于这个任务（`job_kill`、所有者释放、服务拆卸），不再属于外层的 `exec.signal`。

## 插件作者怎么用

- 注入 `tools`。用 `defineTool` 注册。策略留在上面的事件里。
- 选一个可能已经存在的名字之前，先读 `docs/tool-catalog.md`。
- 长时间运行的工具，跟随 `dsh-tool-bash` 和 jobs 运行时，不要让 `execute` 一直阻塞到进程退出。
- PTC 模式不能靠解析渲染器的散文来找回一个 id。把 id 放进规范值。

## 来源

- [docs/user/develop/basic/tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/tool.md)
- [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md)
- [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)
- [docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md)
- [docs/tool-catalog.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/tool-catalog.md)
