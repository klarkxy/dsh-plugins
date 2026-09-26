# Hook 桥接

[English](../../areas/hooks.md)

这一组不是通用的原生 hook API。它把已有的 Claude Code 或 Codex `hooks.json` 命令钩子接到 Harness 的拦截点上。`{"continue": false}` 会被记录，但不会停止运行。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

hooks 这一组在 Harness 的 agent 运行期间，执行为 Claude Code 或 Codex 编写的命令钩子。每个集成只支持其来源工具所记录的命令钩子子集。`@deepseek-ai/dsh-hook-protocol` 是共享引擎。部署不直接配置它。

## 它在哪里

- 分组：[packages/hooks/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/README.md)
- Claude Code 桥接：[packages/hooks/hooks-claude-code/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/hooks-claude-code/README.md)
- Codex 桥接：[packages/hooks/hooks-codex/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/hooks-codex/README.md)
- 共享库：[packages/hooks/hook-protocol/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/hook-protocol/README.md)

完整的配置字段在 `docs/config-catalog.md` 里，锚点是 `@deepseek-ai/dsh-hooks-claude-code` 和 `@deepseek-ai/dsh-hooks-codex`。

## 约定

两个插件都要求 `configPath`。其他写明的键：

| 包 | 键 |
| --- | --- |
| `@deepseek-ai/dsh-hooks-claude-code` | `configPath`、`pluginRoot`、`projectDir`、`defaultTimeoutMs`、`stderrSummaryMaxChars` |
| `@deepseek-ai/dsh-hooks-codex` | `configPath`、`model`、`defaultTimeoutMs`、`stderrSummaryMaxChars` |

桥接文档里的 Claude Code 事件：

| 事件 | README 描述的效果 |
| --- | --- |
| `SessionStart` | 附上上下文。 |
| `UserPromptSubmit` | 阻断提示，或附上上下文。 |
| `PreToolUse` | 阻断工具，或请求审批。 |
| `PostToolUse` | 用反馈阻断结果，或附上上下文。 |
| `Stop` | 带着理由强制再走一步。 |
| `SubagentStart` | 附上上下文，仅进程内。 |
| `SubagentStop` | 只观察。它不能阻断，也不能添加上下文。 |

桥接文档里的 Codex 事件：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse` 和 `Stop`。Codex README 没有为 `PreToolUse` 列出询问结果。

写明的、模型可见的结果包括：被拒绝的工具是 `Error: blocked by PreToolUse hook`；工具后阻断是 `blocked by PostToolUse hook`；阻断性的 `Stop` 是转向 `continue: blocked by Stop hook`；被阻断的提示被丢弃，于是这一轮以 `blocked` 结束。在事件允许的地方，上下文作为带来源标记的消息附上。阻断性的 `Stop` 通过 `steer()` 强制再进行一轮模型。

两座桥的限制一节都写明：`{"continue": false}` 会被记录，并且不会停止运行。

Claude 桥的 README 把事件映射到 harness 的拦截点：`SessionStart` 通过 `agent/created` 添加上下文；`UserPromptSubmit` 和 `PreToolUse` 是 `agent/pre-step` 和 `tools/pre-execute` 上的 waterfall；`PostToolUse` 是 `tools/post-execute` 上的 waterfall；`Stop` 是 `agent/turn-stopping` 上的串行监听器，其阻断结果调用 `steer()`；子代理事件在 `subagent/start` 和 `subagent/end` 上发出。同一份 README 还说 `SessionStart`、`SubagentStart` 和 `SubagentStop` 是分离运行的，因此 `SessionStart` 的上下文可能错过第一个请求。在依赖钩子去阻断开场回合之前，先读限制一节。

插件需要自己的策略时，应该监听那些 harness 事件，或使用 `tools/pre-execute`，而不是发明第三种钩子文件格式。见[工具](tools.md)。

## 插件作者怎么用

- 要复用已有的 `hooks.json`，插入匹配的桥接行并设置 `configPath`。不要把外来文件改写成 Cordis YAML。
- 要在 Harness 内部强制一条新策略，在你的插件里注册 `tools/pre-execute` 或 `agent/pre-step` 监听器。不要往 `hooks.json` 里加一个没有文档的事件名，然后指望桥接去运行它。
- 把钩子命令当作在宿主上执行代码。它们不是沙箱边界。

## 来源

- [packages/hooks/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/README.md)
- [packages/hooks/hooks-claude-code/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/hooks-claude-code/README.md)
- [packages/hooks/hooks-codex/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/hooks-codex/README.md)
- [packages/hooks/hook-protocol/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/hook-protocol/README.md)
