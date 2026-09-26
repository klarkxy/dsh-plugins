# Add a tool

[中文](../zh/tasks/add-a-tool.md)

Use this task when the model must call a new capability by name. A tool is that model-facing action. Policy, settings, and panels are other tasks.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`). If the target version differs, treat this page as unverified and check the pinned source.

## When to use it

The product needs a function the model invokes with a name, a description, and a parameter schema. Registration on `ctx.tools` is enough for the schema to enter system-prompt assembly. [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md) maps "Built-in tools" to `ctx.tools.register()`.

## How to choose

Read [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md) before copying a neighbor. `defineTool` is the typed helper. The cookbook also accepts a raw JSON-Schema `ToolDefinition` at `ctx.tools.register()`, which is how MCP-sourced tools arrive. Prefer `defineTool` for a plugin you author.

Choose a different mechanism when the model is not calling a function:

- An external server that already exposes tools is a configuration-only MCP bundle, not a second client. See [MCP servers](../areas/mcp.md).
- Instructions the model should read, with no side effect of their own, are a skill. See [Skills](../areas/skills.md).
- Allow, deny, cancel, and ask do not belong in `execute`. That is [Add a tool execution policy](add-a-tool-policy.md). [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md) says to prefer not to build deployment policy into the tool.
- A value the user edits is [Add a settings UI](add-a-settings-ui.md). A view the user sees is [Add a UI panel](add-a-ui-panel.md).

`execute` returns one canonical JSON value. The registry validates it and passes it to `output.render`. Do not return content blocks from the body. Honor `exec.signal`. `agent.inject` appends context the next request sees and does not wake an idle agent. Long-running work uses `ctx.jobs.start` after the producer gates `run_in_background`; once the id is published, cancellation belongs to the job, not the outer `exec.signal`. Those rules are in the adding-a-tool guide and the [tools area](../areas/tools.md).

## Read together

Area pages: [Tools](../areas/tools.md), [Plugin module](../areas/plugin-module.md), [Plugin manager and live inspection](../areas/plugin-manager-inspect.md), [MCP servers](../areas/mcp.md).

Official files at the pinned commit:

- [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md)
- [docs/user/develop/basic/tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/tool.md)
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)
- [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)

## Pre-checks

- Compare the target DSH version with `meta.json`. A mismatch means this page is unverified for that version.
- Inside DSH, load `cordis-plugin-development` and query `Tool` with `cordis_inspect_query` before inventing a name. Outside DSH, read `docs/tool-catalog.md` at the target commit and mark the name check unverified.
- Confirm the plugin injects `tools`. A missing service leaves the plugin pending.
- Read [Architecture rules and anti-patterns](architecture-rules.md). Do not listen to `system-prompt/assemble` to publish the schema. Registration already does that.

## Verification checklist

- The model-visible schema contains the name, description, and parameters you declared, and no extra tool of the same name from another plugin.
- Valid arguments reach `execute`. Invalid arguments do not.
- The canonical return value matches `output.schema`. A thrown error becomes an error result and does not crash the turn.
- Cancelling the call fires `exec.signal`, and in-flight work stops.
- Unloading the plugin removes the tool. Disposing the plugin fiber unregisters it, as the adding-a-tool guide states.
- In PTC mode, a successful call resolves to the canonical JSON value, not to rendered prose. Do not recover an id by parsing the renderer text.
- State which of the above you actually ran, and which you only read.

## Common failures

- Policy or a prompt hidden inside `execute`. Move it to the policy task.
- Returning content blocks, or making the model parse prose for an id.
- Mutating the registered schema instead of disposing the effect and registering a replacement.
- Blocking `execute` until a long job exits, after `ctx.jobs.start` has already published the id.
- Assuming a Web card exists because `presentCall` is defined. The adding-a-tool guide says the built-in Web Client does not consume `presentCall` or `presentResult`.

## Runnable example

Runnable example: not yet (planned). This page has no copy-paste package and no tests. A later round adds a runnable task pack.

## Sources

- [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md)
- [docs/user/develop/basic/tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/tool.md)
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)
- [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)
