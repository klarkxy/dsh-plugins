# Add a tool execution policy

[中文](../zh/tasks/add-a-tool-policy.md)

Use this task when an existing tool call must be hidden, denied, approved, or observed. Do not put that decision inside the tool's `execute`.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`). If the target version differs, treat this page as unverified and check the pinned source.

## When to use it

Another plugin, or a shipped tool, already performs the action. You need to narrow who can call it, stop a call, ask a person, or record the outcome. [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/extension-cookbook)) shows a permission gate on `tools/pre-execute` and says that waterfall is the reorderable policy layer.

## How to choose

[packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md) orders mechanisms from weakest to strongest: `ctx.tools.restrict()` can only remove tools; `ctx.tools.guard()` can only deny; waterfall listeners can rewrite a decision and depend on registration order; `system-prompt/assemble` replaces the whole assembly. Use the weakest one that suffices, and preserve other plugins' contributions.

The pipeline in [docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools)) and [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md) is fixed: `tools/pre-execute`, then monotonic guards, then `tools/execute`, then `tools/post-execute`, then `tools/result`.

| Need | Mechanism | Why this one |
| --- | --- | --- |
| Hide a tool from one agent, including its schema | `ctx.tools.restrict()` on that agent's context | It only removes tools, and presentation, lookup, and execution stay aligned. |
| Deny no matter who listens later | `ctx.tools.guard()` | A guard is synchronous and has no allow result, so a later listener cannot undo the denial. It cannot await. |
| Deny, but order among plugins may matter | `tools/pre-execute` returning `{ kind: 'deny', reason }` | The waterfall is reorderable. A listener that returns without `next()` short-circuits. A later listener can replace an earlier decision when earlier listeners call `next()`. |
| Ask a person, which must await | `tools/pre-execute` returning `{ kind: 'ask', reason }` | `ask` runs only after approval returns `allowed-once`. Anything else denies. Missing approval support turns `ask` into denial. |
| Stop before dispatch without a policy-denial message | `tools/pre-execute` returning `{ kind: 'cancel' }` | `cancel` selects the canonical pre-dispatch cancellation result. |
| Watch the final outcome without changing it | `tools/result` | The outcome is frozen. Listener failures are contained. |
| Replace content or the value, or block with feedback | `tools/post-execute` | Use this only when you must transform. Observation belongs on `tools/result`. |

[docs/subsystems/approval.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/approval.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/approval)) says `allowed-once` grants only the asked-about action. The next call that returns `ask` asks again. Do not treat one approval as a session mode. `ApprovalPolicy` `never` rejects without prompting.

A guard registered for one agent belongs on `agent.ctx`, with the disposer also kept in the plugin effect. Practices says unloading the plugin does not dispose `agent.ctx` registrations by itself. See [Architecture rules and anti-patterns](architecture-rules.md).

## Read together

Area pages: [Tools](../areas/tools.md), [Settings, approval, and permission presets](../areas/settings-approval.md), [Plugin module](../areas/plugin-module.md).

Official files at the pinned commit:

- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/extension-cookbook))
- [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool))
- [docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools))
- [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [docs/subsystems/approval.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/approval.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/approval))

## Pre-checks

- Compare the target DSH version with `meta.json`.
- Inside DSH, query `Event` for `tools/pre-execute` and confirm the dispatch mode before relying on `next()`. Outside DSH, mark that check unverified.
- Name the other policy plugins already mounted. A waterfall decision is order-dependent.
- If the decision must await, do not use `ctx.tools.guard`. Practices says a guard is synchronous.

## Verification checklist

- A deny really blocks: `execute` does not run, and the model sees the denial reason.
- Approval repeats: two calls that return `ask` each wait for `allowed-once`. One grant does not skip the next call.
- Cancel stops: `{ kind: 'cancel' }` does not run `execute`. An in-flight body still honors `exec.signal`.
- Listeners are cleaned up on unload. Dispose the plugin and confirm the guard or waterfall listener is gone. If you registered on `agent.ctx`, also dispose the agent while the plugin stays loaded, and unload the plugin while the agent stays. Either teardown must remove the registration.
- Multiple policy plugins do not silently override each other. A later `tools/pre-execute` listener that returns `allow` must not undo a `ctx.tools.guard` denial. A later waterfall listener can replace an earlier waterfall decision when the earlier one calls `next()`. Record the order you observed.
- `tools/result` does not change the canonical value. A transform belongs on `tools/post-execute`.
- State which rows you ran and which remain unverified.

## Common failures

- Returning `deny` from an early waterfall listener and assuming no later plugin can change it. That is what `guard` is for.
- Using `ask` from a guard, or awaiting inside a guard. The guard type returns `string | undefined` and does not ask.
- Hiding an approval prompt inside `execute`. The call has already passed policy.
- Treating `allowed-once` as a sticky permission mode.
- Listening to `system-prompt/assemble` to remove a tool. That replaces the whole assembly and drops other plugins' contributions. Use `restrict`.
- Forgetting the second disposer for an `agent.ctx` registration, so plugin unload leaves the policy in place.

## Runnable example

Runnable example: not yet (planned). This page has no copy-paste package and no tests. A later round adds a runnable task pack.

## Sources

- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/extension-cookbook))
- [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool))
- [docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools))
- [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [docs/subsystems/approval.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/approval.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/approval))
