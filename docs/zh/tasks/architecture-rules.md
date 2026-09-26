# 架构规则与反模式

[English](../../tasks/architecture-rules.md)

这四条规则来自官方的插件实践。每一节都是一个在单次实时会话里看起来没问题的错误做法，以及它会在什么时候坏、正确替代方案，和怎么测。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。目标版本不同时，把本页当作未经核实，并核对钉住的源码。

顺序和会话规则的出处是 [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)。

## 会话日志是权威来源

错误做法：把功能的事实放在插件内存、私有文件，或一种新的会话事件 `type` 里。

为什么看起来能工作：写下这块内存的进程仍显示正确的值，自定义事件也出现在同一个进程里。

什么时候会坏：分叉、恢复和重放都从日志重建。实践文档说，模型看到的任何东西都必须能从已提交的会话事件重建，插件内存是派生缓存。读者只在信封带 `ignorable: true` 时接受未知的已存事件。实时的 `Session.append()` 不能设置这个标记，于是会话会拒绝重新打开。[docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md) 把 `fork` 定义成带精确继承前缀的种子子会话。

正确替代：从已有事件推导状态，或把插件自己的数据放进你通过检查找到的存储服务。模型可见的文字走已经会记日志的机制，例如 `agent.inject` 或工具结果。

怎么测：在回合之间的边界分叉，把派生值和父前缀比较。重启并重放同一份日志。不要停在检查写下内存的那个进程。

## 注册属于一个上下文

错误做法：在 `agent/created` 里向 `agent.ctx` 注册，却只从一侧释放；或把必须随 agent 死去的资源登记在插件 fiber 上。

为什么看起来能工作：你试过的那条路径里，释放一次 agent，或卸载一次插件，看起来是干净的。

什么时候会坏：实践文档说，登记在另一个上下文上，例如 `agent.ctx`，就有两个主人。卸载插件本身不会释放 `agent.ctx` 上的注册。释放 agent 也不会运行只活在插件 fiber 上的释放函数。

正确替代：在 `agent/created` 监听器里取得 `agent.ctx`，把注册包进一个 `agent.ctx.effect()`，并且把这个释放函数按 agent 留在插件自己的 effect 里。任一条拆除路径都会移除它。可选服务放进 `inject` 或 `ctx.inject`，这样没有它们的 profile 会让插件保持不激活，而不是抛错。

怎么测：agent 还在时卸载插件，确认注册消失。插件还在时释放 agent，确认注册消失。两种顺序都要跑。

## 优先用够用的最弱机制

错误做法：监听 `system-prompt/assemble` 来添加或移除工具或文字；或在较早的 `tools/pre-execute` 监听器里拒绝，并把这次拒绝当成最终的。

为什么看起来能工作：在你的监听器最后运行的 profile 里，工具消失了，提示看起来也对。

什么时候会坏：`system-prompt/assemble` 会换掉整份拼装，其他插件的段落和当前的 PTC 模式都要你自己保留。[docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md) 说，必须在呈现、查找和执行上保持一致的工具过滤，优先用 `ctx.tools.restrict()`。瀑布可以重排。前面的监听器调用了 `next()` 时，后面的监听器可以换掉较早的允许或拒绝。[docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md) 说，守卫没有允许结果，所以监听器顺序不能把这次拒绝变回许可。

正确替代，从弱到强：`ctx.tools.restrict()` 只移除工具。`ctx.tools.guard()` 只拒绝，而且是同步的。瀑布可以改写，并依赖顺序。`system-prompt/assemble` 最强，会换掉一切。用 `ctx.systemPrompt.section()` 添加提示文字。决定必须等待时，从 `tools/pre-execute` 返回 `ask`。在 `tools/result` 上观察。

怎么测：再加载一个插件，它贡献一段提示，或从 `tools/pre-execute` 返回 `allow`。确认你的改动没有擦掉那段提示。确认在另一个插件允许这次调用之后，守卫的拒绝仍然拦住它。

## 不要自己重算会话派生数据

错误做法：订阅 `session/event` 并重扫 `session.events`，或在客户端折叠日志。

为什么看起来能工作：打开的页面会更新，完整扫描得到的列表和日志会给出的一样。

什么时候会坏：每个事件都重扫日志。分叉的 `init` 必须接收 `inheritedEventCount`，不能从 `firstLiveSeq` 或 `session/end-seed` 推断切口。客户端折叠会和宿主分叉。`wire.view` 返回新对象时，即使值没变也会发布。`stateVersion` 不动的话，过期检查点会被应用。[docs/subsystems/session-projection.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session-projection.md) 说，框架驱动 `apply`，领域自己不持有订阅。

正确替代：`ctx.sessionProjections.register`，`apply` 同步，并在忽略事件时返回同一个状态引用；状态是普通 JSON；折叠变化时提高 `stateVersion`；客户端需要这个值时提供 `wire.view`。用 `stateOf` 或 `snapshot` 读取。

怎么测：被忽略的事件保持同一个状态引用。分叉子会话与继承前缀的折叠一致。`stateVersion` 提高之后，旧缓存行被丢弃。两个会话不共享一个单元格。

## 要一起读

章节：[总览](../areas/orientation.md)、[会话与标题](../areas/sessions-titles.md)、[工具](../areas/tools.md)、[插件模块](../areas/plugin-module.md)。

## 可运行示例

`Runnable example: not yet (planned)`。本页没有可复制的包，也没有测试。后续轮次才会补上可运行的任务包。

## 来源

- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [docs/subsystems/session-projection.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session-projection.md)
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)
- [docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md)
- [docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md)
