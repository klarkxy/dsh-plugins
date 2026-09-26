# Skills

[中文](../zh/areas/skills.md)

A skill is an on-demand instruction, not a session event. Embedded instructions use `ctx.skills.register`. On-disk instructions are `SKILL.md` files with frontmatter, discovered by the filesystem provider. The model loads the body with the `skill` tool.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

The skill family gives agents one catalog of reusable instructions. `@deepseek-ai/dsh-skill` is the registry (`ctx.skills`) and ships no skill text itself. `@deepseek-ai/dsh-skill-filesystem` discovers local files. `@deepseek-ai/dsh-tool-skill` publishes the session catalog and the model-facing `skill` tool. Packaged providers such as `@deepseek-ai/dsh-skill-badge` and `@deepseek-ai/dsh-skill-office` register their own sources.

This index plugin uses `ctx.skills.register` for the same reason: a host-level runtime skill is visible to every agent that can see the global layer, without replacing the agent's preset.

## Where it lives

- Group map: [packages/skill/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/README.md)
- Registry: [packages/skill/skill/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill/README.md) and [packages/skill/skill/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill/src/index.ts)
- Filesystem provider: [packages/skill/skill-filesystem/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill-filesystem/README.md)
- Subsystem types: [docs/subsystems/skills.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/skills.md)
- Model consumer: [packages/skill/tool-skill/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/tool-skill/README.md)

The base bundle mounts `skill`, `skill-filesystem`, and `skill-badge` (the badge row ships disabled). `sdk-minimal` does not mount the registry; a plugin that only `inject`s `skills` stays pending there.

## Contract

Names are kebab-case: `^[a-z0-9]+(?:-[a-z0-9]+)*$`.

Embedded registration:

```ts
ctx.skills.register({
  name: 'my-skill',
  description: 'Short routing text for the catalog.',
  whenToUse: 'Optional extra routing guidance.',
  source: 'bundled',
  content: 'Instructions loaded on demand.',
  invocation: { modelInvocable: true, userInvocable: true },
  resourceBase: { kind: 'directory', path: '/absolute/dir' },
})
```

`SkillRegistration` may omit `invocation` and `provider`. Omitted invocation permits both model and user surfaces. Omitted provider uses the registry-owned `runtime` label. `runtime` is a reserved provider name. Same-name runtime registrations in one layer are first-wins with a warning. Within one layer, project entries outrank runtime entries, which outrank user entries. A nearer scope layer shadows a farther one outright.

`resourceBase` is `{ kind: 'directory', path }`, `{ kind: 'url', url }`, or `{ kind: 'opaque', description }`. `renderSkillContent` tells the model to resolve relative paths against that base and to load them only as needed. The tool result does not enumerate the directory.

A filesystem skill is `<name>/SKILL.md` or a flat `<name>.md` at the top of a scanned root. Nested `**/SKILL.md` discovery is not supported. Frontmatter requires `name` and `description`. Optional keys are `whenToUse`, `metadata`, `disable-model-invocation`, and `user-invocable`. Omitted invocation keys permit that surface. An invalid boolean spelling drops the whole skill with a warning.

Filesystem ranks:

| Rank | Source | Root |
| --- | --- | --- |
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | `bundledSkillDir` when configured |

The project root is the nearest ancestor containing `.git`, or the cwd when there is none. `BUNDLED_SKILL_RANK` in source is `600`.

Registry config: `collectCacheMaxEntries` defaults to 128. Filesystem config worth knowing: `providerName` defaults to `filesystem`, `includeDefaultRoots` defaults to true, `dshHome` defaults to `$DSH_HOME` or `~/.dsh`, `agentsHome` defaults to `$DSH_AGENTS_HOME` or `~/.agents`, `customSkillDirs` defaults to `[]`, `watch` defaults to true.

The model catalog includes only model-invocable `name` and `description`. `catalogDescriptionMaxLength` on the consumer defaults to 500 (integer minimum 3). The `skill` tool takes `{ name }`, rejects non-model-invocable skills, and returns `<skill_content>` via `renderSkillContent`. A user message whose first line starts with `/<name>` loads a user-invocable skill without a tool call. Shipped preset skills stay under 8192 characters because the standard preset's tool-result pruner trims longer tool results.

Providers that are not a single embedded skill use `ctx.skills.registerProvider(create)`. `create` receives a control whose `invalidate()` clears catalogs only while that registration is active.

## How a plugin author uses it

- Prefer `ctx.skills.register` for one instruction set shipped inside the plugin. Point `resourceBase` at a directory of longer references so the catalog entry stays short.
- Prefer a `SKILL.md` under a scanned root when the user should edit the text without reinstalling a bundle.
- Keep `description` within the catalog bound. Put procedures in `content` and long tables in files the body names explicitly.
- Do not expect `sdk-minimal` to load a skill plugin. Base-backed profiles (`web`, `headless`, `sdk`, `acp`) mount `ctx.skills`.
- A project skill with the same name outranks a runtime registration in the same layer.

## Sources

- [packages/skill/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/README.md)
- [packages/skill/skill/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill/README.md)
- [packages/skill/skill/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill/src/index.ts)
- [packages/skill/skill-filesystem/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill-filesystem/README.md)
- [docs/subsystems/skills.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/skills.md)
- [packages/skill/tool-skill/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/tool-skill/README.md)
