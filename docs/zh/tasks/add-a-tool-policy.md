# 添加工具执行策略

[English](../../tasks/add-a-tool-policy.md)

已有的工具调用需要被隐藏、拒绝、批准或观察时用这个任务。不要把这个决定写进工具的 `execute`。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。目标版本不同时，把本页当作未经核实，并核对钉住的源码。

## 什么时候用

另一个插件或随发行的工具已经在做这件事。你要收窄谁能调用、拦住一次调用、问一个人，或记下结果。[docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md) 给出了 `tools/pre-execute` 上的权限门，并说这条瀑布是可以重排的策略层。

## 怎么选

[packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md) 把机制从弱到强排开：`ctx.tools.restrict()` 只能移除工具；`ctx.tools.guard()` 只能拒绝；瀑布监听器能改写决定，并且依赖注册顺序；`system-prompt/assemble` 会换掉整份拼装。用够用的最弱机制，并保留其他插件的贡献。

[docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md) 和 [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md) 里的流水线是固定的：先 `tools/pre-execute`，再单调守卫，再 `tools/execute`，再 `tools/post-execute`，最后 `tools/result`。

| 需求 | 机制 | 为什么是它 |
| --- | --- | --- |
| 对一个 agent 隐藏工具，包括它的 schema | 在该 agent 的上下文上调用 `ctx.tools.restrict()` | 它只能移除工具，呈现、查找和执行保持一致。 |
| 无论后面谁监听都要拒绝 | `ctx.tools.guard()` | 守卫是同步的，没有允许结果，后面的监听器不能撤销拒绝。它不能等待。 |
| 要拒绝，但插件之间的顺序可能有关 | `tools/pre-execute` 返回 `{ kind: 'deny', reason }` | 瀑布可以重排。不调用 `next()` 就返回会短路。前面的监听器调用了 `next()` 时，后面的监听器可以换掉决定。 |
| 要问一个人，因此必须等待 | `tools/pre-execute` 返回 `{ kind: 'ask', reason }` | `ask` 只有在审批返回 `allowed-once` 之后才继续。其余结果都拒绝。缺少审批支持时，`ask` 会变成拒绝。 |
| 在分发前停下，又不给出策略拒绝文案 | `tools/pre-execute` 返回 `{ kind: 'cancel' }` | `cancel` 选择规范的分发前取消结果。 |
| 只看最终结果，不改它 | `tools/result` | 结果是冻结的。监听器失败会被接住。 |
| 替换内容或值，或用反馈阻断 | `tools/post-execute` | 只有必须变换时才用。观察属于 `tools/result`。 |

[docs/subsystems/approval.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/approval.md) 说 `allowed-once` 只批准被问到的那一次动作。下一次返回 `ask` 会再问。不要把一次审批当成会话模式。`ApprovalPolicy` 为 `never` 时不提示就拒绝。

为一个 agent 登记的守卫属于 `agent.ctx`，释放函数也要留在插件 effect 里。实践文档说，卸载插件本身不会释放 `agent.ctx` 上的注册。见[架构规则与反模式](architecture-rules.md)。

## 要一起读

章节：[工具](../areas/tools.md)、[设置、审批与权限预设](../areas/settings-approval.md)、[插件模块](../areas/plugin-module.md)。

钉住提交上的官方文件：

- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)
- [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md)
- [docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md)
- [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [docs/subsystems/approval.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/approval.md)

## 事前检查

- 把目标 DSH 版本和 `meta.json` 比较。
- 在 DSH 里面，对 `tools/pre-execute` 查 `Event`，确认分发模式之后再依赖 `next()`。在 DSH 外面，把这项检查标成未经核实。
- 写明已经挂载的其他策略插件。瀑布决定依赖顺序。
- 决定必须等待时，不要用 `ctx.tools.guard`。实践文档说守卫是同步的。

## 验证清单

- 拒绝真的拦住了：`execute` 不运行，模型能看到拒绝理由。
- 审批会重复：两次返回 `ask` 的调用各自等待 `allowed-once`。一次批准不会跳过下一次。
- 取消会停下：`{ kind: 'cancel' }` 不运行 `execute`。已经在跑的函数体仍然遵守 `exec.signal`。
- 卸载时清掉监听器。释放插件后，确认守卫或瀑布监听器消失。如果登记在 `agent.ctx` 上，还要在插件仍加载时释放 agent，以及在 agent 仍在时卸载插件。两条拆除路径都必须移除注册。
- 多个策略插件不会悄悄互相覆盖。后面的 `tools/pre-execute` 监听器即使返回 `allow`，也不能撤销 `ctx.tools.guard` 的拒绝。前面的瀑布监听器调用了 `next()` 时，后面的瀑布监听器可以换掉决定。记下你观察到的顺序。
- `tools/result` 不改变规范值。变换属于 `tools/post-execute`。
- 写明哪些行你跑过，哪些仍未经核实。

## 常见失败

- 在较早的瀑布监听器里返回 `deny`，就以为后面的插件不能改。这正是 `guard` 的用途。
- 在守卫里返回 `ask`，或在守卫里等待。守卫的返回类型是 `string | undefined`，它不问人。
- 把审批提示藏在 `execute` 里。调用那时已经过了策略。
- 把 `allowed-once` 当成粘住的权限模式。
- 监听 `system-prompt/assemble` 来移除工具。那会换掉整份拼装，丢掉其他插件的贡献。用 `restrict`。
- 忘记 `agent.ctx` 注册的第二个释放函数，于是卸载插件后策略还在。

## 可运行示例

`Runnable example: not yet (planned)`。本页没有可复制的包，也没有测试。后续轮次才会补上可运行的任务包。

## 来源

- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)
- [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md)
- [docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md)
- [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [docs/subsystems/approval.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/approval.md)
