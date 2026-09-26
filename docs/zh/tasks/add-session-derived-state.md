# 添加会话派生状态

[English](../../tasks/add-session-derived-state.md)

值从对话派生，并且必须熬过重放、恢复和分叉时，用这个任务。会话日志是权威来源。插件内存是缓存。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。目标版本不同时，把本页当作未经核实，并核对钉住的源码。

## 什么时候用

客户端或后来的宿主代码需要日志里已经记下的当前值：一份列表、一个计数、折叠后的标题输入。[packages/session/session-projection/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-projection/README.md) 说，客户端需要这个值、又不想重放原始日志时，用 `ctx.sessionProjections`。没有客户端要读的纯宿主记账可以不用它，或者不写 `wire`，让单元只留在宿主。

## 怎么选

[packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md) 第一条：会话日志是唯一的权威来源。分叉、恢复和重放都从日志推导。第三条：不要自己订阅、重扫或写 DOM。性能一节说，从日志派生的按会话状态放进 `ctx.sessionProjections` 单元，不要订阅 `session/event` 再重扫 `session.events`。

[docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session)） 说，`Session` 是只追加的日志。`ctx.sessions.create(id, { seed })` 用来重放或分叉。`fork(source, boundary?)` 复制一段必须结束在未闭合回合之外的前缀，子会话拿到精确的 `inheritedEventCount`。这段前缀就是分支。不要另造第二份历史存储。

| 需求 | 机制 | 为什么是它 |
| --- | --- | --- |
| 已提交事件的当前值 | 用同步的 `apply` 调用 `ctx.sessionProjections.register` | 注册表驱动每条已提交事件。忽略事件时 `apply` 返回同一个状态引用，未变化的状态不会给下游增加工作。 |
| 客户端必须显示它 | `wire.view` 加 `viewSchema` | 实践文档说，值到达客户端时已经算好。客户端不折叠。 |
| 只在宿主折叠 | 省略 `wire` | 包说明说，没有 `wire` 的单元只留在宿主。用 `stateOf(session, key)` 读。 |
| 更快的冷启动 | 挂上 `dsh-session-projection-cache`，字段或折叠语义变化时提高 `stateVersion` | [packages/session/session-projection-cache/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-projection-cache/README.md) 说，版本对不上就不会当成当前结果来用。 |
| 为插件内存新增事件类型 | 不要 | 实践文档说，读者只在信封带 `ignorable: true` 时接受未知的已存事件，而实时的 `Session.append()` 不能设置这个标记，于是会话会拒绝重新打开。 |
| 标题 | `ctx.sessionTitle.register` | 那是单一提供者，写在[会话与标题](../areas/sessions-titles.md)，不是通用投影。 |

`init(header, inheritedEventCount)` 必须使用分叉继承的切口。投影说明说，不要从 `firstLiveSeq` 或 `session/end-seed` 推断这个切口。状态必须是普通 JSON。同一个键配上不同的 `stateVersion` 会抛错。相同版本的登记者共享单元格。单元表是进程级的，所以任意 agent preset 登记的键会出现在每个会话快照里。隔离的是按会话的单元格，不是键。读 `stateOf(session, key)` 或 `snapshot(session)`。不要在会话之间共享一个可变对象。

注册是调用方 fiber 上的 effect。最后一次卸载会移除这个键和它缓存的单元格。可选的贡献者用 `ctx.inject(['sessionProjections'], ...)`，这样没有注册表的 profile 会保持不激活。

## 要一起读

章节：[会话与标题](../areas/sessions-titles.md)、[插件模块](../areas/plugin-module.md)、[界面插槽](../areas/ui-slots.md)。

钉住提交上的官方文件：

- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [packages/session/session-projection/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-projection/README.md)
- [docs/subsystems/session-projection.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session-projection.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session-projection)）
- [docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session)）
- [packages/session/session-projection-cache/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-projection-cache/README.md)

## 事前检查

- 把目标 DSH 版本和 `meta.json` 比较。
- 在 DSH 里面，注册之前确认 `sessionProjections` 已挂载。在 DSH 外面，读目标提交上的包说明，并把实时注册表标成未经核实。
- 写明你要折叠的已有事件。不要新增事件 `type`。
- 客户端要显示这个值时，现在就计划 `wire.view`。事后在客户端重扫是错误的补救。

## 验证清单

- 同一份日志的重放，产生和实时会话相同的值。
- 在回合之间的边界分叉，并带上文档写明的 `inheritedEventCount`，结果与该前缀的折叠一致。`fork` 会拒绝未闭合的回合，而不是悄悄裁掉。
- 重启后的恢复与实时值一致。`stateVersion` 提高之后，旧检查点被丢弃，而不是被应用。
- 两个会话不共享单元格状态。快照里有某个键，并不能说明这个功能在该会话里运行过。要读值。
- 被忽略的事件返回同一个状态引用（`Object.is`）。客户端值没变时，对象形式的 `wire.view` 复用它的引用。
- 卸载后，后续快照里没有这个键。
- 写明哪些行你跑过，哪些仍未经核实。

## 常见失败

- 把列表放在插件上的 `Map` 里，启动时再写回去。分叉和重放永远看不见它。
- 订阅 `session/event`，并在每个事件上扫描 `session.events`。
- 在客户端折叠。宿主视图才是契约。
- 从 `firstLiveSeq` 推断分叉切口。
- 折叠变了却不提高 `stateVersion`，于是过期检查点又被当成事实。
- 追加自定义事件类型。会话可能拒绝重新打开。

## 可运行示例

`Runnable example: not yet (planned)`。本页没有可复制的包，也没有测试。后续轮次才会补上可运行的任务包。

## 来源

- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [packages/session/session-projection/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-projection/README.md)
- [docs/subsystems/session-projection.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session-projection.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session-projection)）
- [docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session)）
- [packages/session/session-projection-cache/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-projection-cache/README.md)
