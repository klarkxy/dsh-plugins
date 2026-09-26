# Add session-derived state

[中文](../zh/tasks/add-session-derived-state.md)

Use this task when a value is derived from the conversation and must survive replay, restore, and forks. The session log is the source of truth. Plugin memory is a cache.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`). If the target version differs, treat this page as unverified and check the pinned source.

## When to use it

Clients, or later host code, need the current value of something the log already records: a list, a counter, a folded title input. [packages/session/session-projection/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-projection/README.md) says to use `ctx.sessionProjections` when clients need that value without replaying the raw log. Skip it for host-only bookkeeping no client reads, or keep the unit host-only by omitting `wire`.

## How to choose

[packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md) principle 1: the session log is the only source of truth. Fork, resume, and replay derive from the log. Principle 3: do not subscribe, rescan, or write DOM yourself. The performance section says to keep per-session state in a `ctx.sessionProjections` unit instead of subscribing to `session/event` and rescanning `session.events`.

[docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session)) says a `Session` is an append-only log. `ctx.sessions.create(id, { seed })` replays or forks. `fork(source, boundary?)` copies a prefix that must end outside an open turn, and the child receives the exact `inheritedEventCount`. That prefix is the branch. Do not invent a second history store.

| Need | Mechanism | Why this one |
| --- | --- | --- |
| Current value of committed events | `ctx.sessionProjections.register` with synchronous `apply` | The registry drives every committed event. `apply` returns the same state reference when it ignores an event, so unchanged state costs nothing downstream. |
| The client must display it | `wire.view` plus `viewSchema` | Practices says the value reaches the client already computed. The client does not fold. |
| Host-only fold | Omit `wire` | The README says a unit without `wire` stays host-only. Read it with `stateOf(session, key)`. |
| Faster cold start | Mount `dsh-session-projection-cache` and bump `stateVersion` when fields or fold semantics change | [packages/session/session-projection-cache/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-projection-cache/README.md) says a mismatched version is not applied as if it were current. |
| A new event type for plugin memory | Do not | Practices says readers accept an unknown stored event only when the envelope carries `ignorable: true`, and live `Session.append()` cannot set that marker, so the session would refuse to reopen. |
| A title | `ctx.sessionTitle.register` | That is a single provider, documented on [Sessions and titles](../areas/sessions-titles.md), not a general projection. |

`init(header, inheritedEventCount)` must use the fork-inherited cut. The projection README says not to infer that cut from `firstLiveSeq` or `session/end-seed`. State must be plain JSON. A duplicate key with a different `stateVersion` throws. Same-version registrants share cells. The unit table is process-wide, so a key registered by any agent preset appears in every session snapshot. Isolation is per session cell, not per key. Read `stateOf(session, key)` or `snapshot(session)`. Do not share one mutable object across sessions.

Registration is an effect on the calling fiber. The last unload removes the key and its cached cells. Optional contributors use `ctx.inject(['sessionProjections'], ...)` so a profile without the registry stays inactive.

## Read together

Area pages: [Sessions and titles](../areas/sessions-titles.md), [Plugin module](../areas/plugin-module.md), [UI slots](../areas/ui-slots.md).

Official files at the pinned commit:

- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [packages/session/session-projection/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-projection/README.md)
- [docs/subsystems/session-projection.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session-projection.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session-projection))
- [docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session))
- [packages/session/session-projection-cache/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-projection-cache/README.md)

## Pre-checks

- Compare the target DSH version with `meta.json`.
- Inside DSH, confirm `sessionProjections` is mounted before registering. Outside DSH, read the package README at the target commit and mark the live registry unverified.
- Name the existing events you will fold. Do not add a new event `type`.
- If a client displays the value, plan `wire.view` now. A client-side rescan is the wrong fix later.

## Verification checklist

- Replay of the same log produces the same value as the live session.
- A fork at a between-turn boundary, with the documented `inheritedEventCount`, matches a fold of that prefix. An open turn is rejected by `fork`, not clipped.
- Restore after restart matches the live value. After a `stateVersion` bump, the old checkpoint is discarded rather than applied.
- Two sessions do not share cell state. A key present in one snapshot is not evidence the feature ran in that session. Read the value.
- An ignored event returns the same state reference (`Object.is`). An object `wire.view` reuses its reference when the client value did not change.
- Unload removes the key from later snapshots.
- State which rows you ran and which remain unverified.

## Common failures

- Keeping the list in a `Map` on the plugin and writing it back on startup. Fork and replay never see it.
- Subscribing to `session/event` and scanning `session.events` on every event.
- Folding in the client. The host view is already the contract.
- Inferring the fork cut from `firstLiveSeq`.
- Forgetting to bump `stateVersion` after changing the fold, so a stale checkpoint comes back as truth.
- Appending a custom event type. The session can refuse to reopen.

## Runnable example

Runnable example: not yet (planned). This page has no copy-paste package and no tests. A later round adds a runnable task pack.

## Sources

- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [packages/session/session-projection/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-projection/README.md)
- [docs/subsystems/session-projection.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session-projection.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session-projection))
- [docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session))
- [packages/session/session-projection-cache/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-projection-cache/README.md)
