# Hook bridges

中文：这一组不是通用的原生 hook API。它把已有的 Claude Code 或 Codex `hooks.json` 命令钩子接到 Harness 的拦截点上。`{"continue": false}` 会被记录，但不会停止运行。

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

The hooks group runs command hooks written for Claude Code or Codex during a Harness agent run. Each integration supports only the command-hook subset documented by its source tool. `@deepseek-ai/dsh-hook-protocol` is the shared engine. Deployments do not configure it directly.

## Where it lives

- Group: [packages/hooks/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/README.md)
- Claude Code bridge: [packages/hooks/hooks-claude-code/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/hooks-claude-code/README.md)
- Codex bridge: [packages/hooks/hooks-codex/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/hooks-codex/README.md)
- Shared library: [packages/hooks/hook-protocol/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/hook-protocol/README.md)

Exhaustive config fields are in `docs/config-catalog.md` under the anchors for `@deepseek-ai/dsh-hooks-claude-code` and `@deepseek-ai/dsh-hooks-codex`.

## Contract

Both plugins require `configPath`. Other documented keys:

| Package | Keys |
| --- | --- |
| `@deepseek-ai/dsh-hooks-claude-code` | `configPath`, `pluginRoot`, `projectDir`, `defaultTimeoutMs`, `stderrSummaryMaxChars` |
| `@deepseek-ai/dsh-hooks-codex` | `configPath`, `model`, `defaultTimeoutMs`, `stderrSummaryMaxChars` |

Claude Code events the bridge documents:

| Event | Effect the README describes |
| --- | --- |
| `SessionStart` | Attach context. |
| `UserPromptSubmit` | Block the prompt, or attach context. |
| `PreToolUse` | Block the tool, or ask for approval. |
| `PostToolUse` | Block the result with feedback, or attach context. |
| `Stop` | Force another step with a reason. |
| `SubagentStart` | Attach context, in-process only. |
| `SubagentStop` | Observe only. It cannot block or add context. |

Codex events the bridge documents: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop`. The Codex README does not list an ask outcome for `PreToolUse`.

Documented model-visible outcomes include: a denied tool as `Error: blocked by PreToolUse hook`; a post-tool block as `blocked by PostToolUse hook`; a blocking `Stop` as steering `continue: blocked by Stop hook`; a blocked prompt discarded so the turn ends as `blocked`. Context is attached as source-attributed messages where the event allows it. A blocking `Stop` forces another model turn via `steer()`.

Both bridges' limitations sections state that `{"continue": false}` is logged and does not halt the run.

The Claude bridge README maps events onto harness interception points: `SessionStart` adds context through `agent/created`; `UserPromptSubmit` and `PreToolUse` are waterfalls on `agent/pre-step` and `tools/pre-execute`; `PostToolUse` is a waterfall on `tools/post-execute`; `Stop` is a serial listener on `agent/turn-stopping` whose blocking result calls `steer()`; subagent events emit on `subagent/start` and `subagent/end`. The same README also says `SessionStart`, `SubagentStart`, and `SubagentStop` run detached, so `SessionStart` context can miss the first request. Read the limitations section before relying on a hook to block the opening turn.

A plugin that needs its own policy should listen to those harness events, or use `tools/pre-execute`, rather than inventing a third hook file format. See [Tools](tools.md).

## How a plugin author uses it

- To reuse an existing `hooks.json`, insert the matching bridge row and set `configPath`. Do not rewrite the foreign file into Cordis YAML.
- To enforce a new policy inside Harness, register a `tools/pre-execute` or `agent/pre-step` listener in your plugin. Do not add an undocumented event name to `hooks.json` and expect the bridge to run it.
- Treat hook commands as code execution on the host. They are not a sandbox boundary.

## Sources

- [packages/hooks/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/README.md)
- [packages/hooks/hooks-claude-code/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/hooks-claude-code/README.md)
- [packages/hooks/hooks-codex/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/hooks-codex/README.md)
- [packages/hooks/hook-protocol/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/hooks/hook-protocol/README.md)
