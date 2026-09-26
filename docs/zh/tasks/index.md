# 任务索引

[English](../../tasks/index.md)

先选一个任务，再读它链到的章节。章节页仍是参考层。这些步骤对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。目标版本不同时，把每一页都当作未经核实，并核对钉住的源码和类型声明。不要悄悄换成另一版。

在正在运行的 DSH 里，优先用官方技能 `cordis-plugin-development` 和 `cordis_inspect_query` 确认实际挂载了什么。在 DSH 之外，不要假设这些工具存在。Context7（`/deepseek-ai/deepseek-harness`）跟随 master，只作为散落示例的次要来源。

选择机制之前先读[架构规则与反模式](architecture-rules.md)。

| 任务 | 什么时候用 |
| --- | --- |
| [添加工具](add-a-tool.md) | 模型必须按名字调用一项新能力。 |
| [添加工具执行策略](add-a-tool-policy.md) | 已有调用需要被隐藏、拒绝、询问或观察。 |
| [添加设置界面](add-a-settings-ui.md) | 人要修改会留在 profile 补丁里的插件配置。 |
| [添加界面面板](add-a-ui-panel.md) | 人要在 Harness 网页界面里看到一块内容。 |
| [添加会话派生状态](add-session-derived-state.md) | 值必须跟着会话日志走，重放、恢复和分叉都一致。 |
| [实现或替换提供者](implement-or-replace-a-provider.md) | 某条缝需要新后端，或必须换掉随发行的后端。 |

`Runnable example: not yet (planned)`。本索引没有任务包。后续轮次才会补上可运行示例和测试。

## 来源

- [packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
