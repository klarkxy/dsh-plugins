# Architecture rules and anti-patterns

[中文](../zh/tasks/architecture-rules.md)

These four rules come from the official plugin practices. Each section is a wrong approach that looks fine in one live session, the case that breaks it, the alternative, and how to test it.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`). If the target version differs, treat this page as unverified and check the pinned source.

The source of the ordering and the session rule is [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md).

## The session log is authoritative

Wrong approach: store the feature's truth in plugin memory, a private file, or a new session event `type`.

Why it seems to work: the process that wrote the memory still shows the right value, and a custom event appears in that same process.

When it breaks: fork, resume, and replay rebuild from the log. Practices says anything the model sees must be reconstructable from committed session events, and plugin memory is a derived cache. Readers accept an unknown stored event only when its envelope carries `ignorable: true`. Live `Session.append()` cannot set that marker, so the session would refuse to reopen. [docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session)) defines `fork` as a seeded child with an exact inherited prefix.

Correct alternative: derive state from existing events, or keep plugin-owned data in a storage service you found through inspection. Model-visible text goes through the mechanisms that already log it, such as `agent.inject` or a tool result.

How to test: fork at a between-turn boundary and compare the derived value with the parent prefix. Restart and replay the same log. Do not stop after checking the process that wrote the memory.

## Registrations belong to one context

Wrong approach: register on `agent.ctx` inside `agent/created` and dispose from only one side, or register on the plugin fiber for a resource that must die with the agent.

Why it seems to work: disposing the agent once, or unloading the plugin once, looks clean in the path you tried.

When it breaks: practices says a registration on another context, such as `agent.ctx`, has two owners. Unloading the plugin does not dispose `agent.ctx` registrations by itself. Disposing the agent does not run a disposer that lived only on the plugin fiber.

Correct alternative: obtain `agent.ctx` in an `agent/created` listener, wrap the registration in one `agent.ctx.effect()`, and also keep that disposer, keyed by agent, in the plugin's own effect. Either teardown removes it. Put optional services in `inject` or `ctx.inject` so a profile without them leaves the plugin inactive instead of throwing.

How to test: unload the plugin while the agent still exists and confirm the registration is gone. Dispose the agent while the plugin stays and confirm it is gone. Run both orders.

## Prefer the weakest mechanism

Wrong approach: listen to `system-prompt/assemble` to add or remove tools or text, or deny in an early `tools/pre-execute` listener and call that denial final.

Why it seems to work: in a profile where your listener runs last, the tool disappears and the prompt looks right.

When it breaks: `system-prompt/assemble` replaces the whole assembly, so other plugins' sections and the active PTC mode are yours to preserve. [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/extension-cookbook)) says to prefer `ctx.tools.restrict()` for tool filtering that must stay aligned. A waterfall is reorderable. A later listener can replace an earlier allow or deny when earlier listeners call `next()`. [docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools)) says a guard has no allow result, so listener order cannot turn that denial back into permission.

Correct alternative, weakest first: `ctx.tools.restrict()` only removes tools. `ctx.tools.guard()` only denies, and it is synchronous. A waterfall may rewrite and depends on order. `system-prompt/assemble` is the strongest and replaces everything. Add prompt text with `ctx.systemPrompt.section()`. Return `ask` from `tools/pre-execute` when the decision must await. Observe on `tools/result`.

How to test: load a second plugin that contributes a prompt section or returns `allow` from `tools/pre-execute`. Confirm your change does not erase that section. Confirm a guard denial still blocks after the other plugin allows the call.

## Do not recompute session-derived data

Wrong approach: subscribe to `session/event` and rescan `session.events`, or fold the log in the client.

Why it seems to work: the open page updates, and a full scan returns the same list the log would.

When it breaks: every event rescans the log. Fork `init` must take `inheritedEventCount` and must not infer the cut from `firstLiveSeq` or `session/end-seed`. A client fold diverges from the host. A new object from `wire.view` publishes even when the value did not change. A stale checkpoint is applied if `stateVersion` stays put. [docs/subsystems/session-projection.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session-projection.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session-projection)) says the framework drives `apply` and the domain holds no subscription.

Correct alternative: `ctx.sessionProjections.register` with a synchronous `apply` that returns the same state reference for events it ignores, plain JSON state, a `stateVersion` you bump when the fold changes, and `wire.view` when the client needs the value. Read with `stateOf` or `snapshot`.

How to test: an ignored event keeps the same state reference. A fork child matches a fold of the inherited prefix. After a `stateVersion` bump, the old cache row is discarded. Two sessions do not share one cell.

## Read together

Area pages: [Orientation](../areas/orientation.md), [Sessions and titles](../areas/sessions-titles.md), [Tools](../areas/tools.md), [Plugin module](../areas/plugin-module.md).

## Runnable example

Runnable example: not yet (planned). This page has no copy-paste package and no tests. A later round adds a runnable task pack.

## Sources

- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [docs/subsystems/session-projection.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session-projection.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session-projection))
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/extension-cookbook))
- [docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools))
- [docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session))
