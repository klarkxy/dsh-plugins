# Add a UI panel

[中文](../zh/tasks/add-a-ui-panel.md)

Use this task when a person must see something in the Harness Web UI. Choose the surface before writing the view. Styling cannot repair the wrong surface.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`). If the target version differs, treat this page as unverified and check the pinned source.

## When to use it

The destination is the current Harness Web UI. A standalone HTML file does not finish that request. The official `cordis-plugin-development` skill says an unspecified visual destination means an installed UI plugin. For anything beyond a static decoration, read [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md) before choosing the extension point.

## How to choose

Practices principle 6: plugin UI is part of the Harness UI, so pick the rendering surface first. Principle 3: the framework drives rendering. A plugin that writes DOM itself bypasses that machinery.

| Need | Mechanism | Why this one |
| --- | --- | --- |
| A decoration in space the host already reserved | `ctx.slots.inject` plus `ctx.slots.register` on a slot such as `conversation.composer.dock` when `Slots.listSubTree` shows it | [packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md) says to prefer a slot with allocated space. `shell.overlay` is only for a known overlay placement. |
| A row in the chat transcript | `ctx.uiConversation.events.register()` and a view in `conversation.chat.node` under that definition's `kind` | Practices says the Conversation layer owns paging, placement, and incremental assembly. |
| A settings form | [Add a settings UI](add-a-settings-ui.md) | Volatile Config, not a free-drawn panel. |
| Session data on the client | A host projection with `wire.view` | Practices says the client does not fold session events. See [Add session-derived state](add-session-derived-state.md). |
| An HTML page in an iframe | Do not | An iframe does not receive theme tokens, light and dark switching, or `ctx.locale`. |

Host and client stay split. The host entry holds services. The client file only renders. `package.json` adds `dsh.client` (`platform`, `immediately`, `inject`) and a `./client` export. The browser artifact's factory id equals the package name. React comes from the browser module table. Do not import `@deepseek-ai/dsh-client-ui-primitives` or any other Harness Client package as a module. `dsh.client.inject` entries only order activation.

The inject callback's registrations dispose when the owning declaration collapses and reinstall when it returns. Register styles, timers, and listeners inside `apply` with `ctx.effect` or `ctx.on`. Do not append to `document.body` or replace the app root.

Theme: use the tokens `cordis_inspect_query` `Theme` lists (`--dsw-alias-*`). Literal colors are for artwork only. Route visible text through the client locale service. Read slot props with the smallest selector. Cardinality and scope are fixed by the declaration; see [UI slots](../areas/ui-slots.md) and [docs/subsystems/slots.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/slots.md).

[docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md) also describes a protocol-driver UI that listens to `agent/assistant-stream` and `session/event`. That shape is for a client you own, not for a panel inside the built-in Web page. A Web chat business node uses the Conversation registration above.

## Read together

Area pages: [UI slots](../areas/ui-slots.md), [Plugin module](../areas/plugin-module.md), [Sessions and titles](../areas/sessions-titles.md).

Official files at the pinned commit:

- [packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [docs/subsystems/slots.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/slots.md)
- [packages/client/ui-slots/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-slots/README.md)
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)

## Pre-checks

- Compare the target DSH version with `meta.json`.
- Inside DSH, query Client `Slots.listSubTree` and the selected slot's options and props before writing the registration. A client query waits for a responding page. Outside DSH, do not assume the slot exists. Mark the live tree unverified.
- Query `Theme` before hard-coding a color. If inspection is unavailable, use only `--dsw-alias-*` names you read in the pinned source, and say so.
- Confirm you are not about to import a Harness Client package.

## Verification checklist

- After install, `application` is `applied`, and `cordis_inspect_query` shows the client registration. The skill says registration alone does not establish what the user sees.
- The connected page shows the panel in the chosen slot, in both light and dark themes, next to a comparable host page.
- The console has no `slot entry crashed in '<slot>'`.
- Styles reference theme tokens. Artwork is the only literal color.
- The plugin module graph does not import `@deepseek-ai/dsh-client-ui-primitives`.
- Unload removes the slot entry, timers, and listeners. Collapsing the owning declaration does the same.
- Session-backed numbers match a replay of the log. The client did not fold events itself.
- State which rows you ran. Without browser control, visual checks stay unverified. Say that explicitly.

## Common failures

- Serving an iframe or appending a second application to `document.body`.
- Guessing slot props instead of reading `Slots.listSubTree`.
- Fetching session state by rescanning the log in the client. Declare `wire.view` on the host.
- Copying a host component import. A throw blanks the slot entry.
- Reusing a shipped cell id and shadowing the host cell. Additive UI needs a fresh list `id`.
- Treating a dynamic mount as durable. A bundle patch is what survives restart.

## Runnable example

Runnable example: not yet (planned). This page has no copy-paste package and no tests. A later round adds a runnable task pack.

## Sources

- [packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [docs/subsystems/slots.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/slots.md)
- [packages/client/ui-slots/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-slots/README.md)
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)
