# Task index

[中文](../zh/tasks/index.md)

Pick a task, then read the linked area pages. Area pages stay the reference layer. These steps are written against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`). If the target DSH version differs, treat every page as unverified for that version and check the pinned source and type declarations. Do not silently substitute this index.

Inside a running DSH, prefer the official `cordis-plugin-development` skill and `cordis_inspect_query` for what is actually mounted. Outside DSH, do not assume those tools exist. Context7 (`/deepseek-ai/deepseek-harness`) tracks master and is only a secondary source for scattered examples.

Read [Architecture rules and anti-patterns](architecture-rules.md) before choosing a mechanism.

| Task | Use it when |
| --- | --- |
| [Add a tool](add-a-tool.md) | The model must call a new capability by name. |
| [Add a tool execution policy](add-a-tool-policy.md) | An existing call must be hidden, denied, asked, or observed. |
| [Add a settings UI](add-a-settings-ui.md) | A person must edit plugin config that survives in the profile patch. |
| [Add a UI panel](add-a-ui-panel.md) | A person must see something in the Harness Web UI. |
| [Add session-derived state](add-session-derived-state.md) | A value must follow the session log across replay, restore, and forks. |
| [Implement or replace a provider](implement-or-replace-a-provider.md) | A seam needs a new backend, or a shipped backend must be swapped. |

Runnable example: not yet (planned). This index does not ship task packs. A later round adds runnable examples and tests.

## Sources

- [packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
