# Agent presets and persona

[中文](../zh/areas/presets-persona.md)

An agent preset is one `@deepseek-ai/dsh-agent-preset` declaration in a bundle patch. This revision no longer reads `$DSH_HOME/.agent-presets/`. Persona is mounted inside the preset with `@deepseek-ai/dsh-persona`.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

An agent preset declares one agent's child plugins in ordinary Cordis YAML. The host still owns the agent loop. Each agent sees the tools, prompts, and skills of its selected revision. Definitions load eagerly. Edits affect agents created afterward. Existing sessions keep the revision they started with.

`@deepseek-ai/dsh-agent-preset-registry` (`ctx.agentPresets`) selects presets and retains revisions. `@deepseek-ai/dsh-agent-preset` is one declaration. `@deepseek-ai/dsh-persona` contributes a scoped persona.

## Where it lives

- Group: [packages/preset/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/README.md)
- Declaration: [packages/preset/agent-preset/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/README.md)
- Registry: [packages/preset/agent-preset-registry/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset-registry/README.md)
- Persona: [packages/preset/persona/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/persona/README.md)
- Authoring skill: [packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md)
- Shortest shipped preset: [packages/bundle/web-app/presets/minimal.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/web-app/presets/minimal.patch.yml)
- Design note: [.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.md)

Shipped Web preset patch files are `standard`, `ptc`, `minimal`, and `cordis` under `packages/bundle/web-app/presets/`.

## Contract

Registry row:

```yaml
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: standard
```

`default` is required. It is the preset used when none is requested.

Declaration row:

```yaml
- id: preset-review
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: review
    name: Review
    description: Reviews changes with the shell only.
    order: 10
    plugins:
      - id: persona
        name: '@deepseek-ai/dsh-persona'
        config:
          prefix: You review software changes.
      - id: tool-bash
        name: '@deepseek-ai/dsh-tool-bash'
```

| Field | Default | Meaning |
| --- | --- | --- |
| `id` | required | Stable preset id saved by sessions. Lowercase letters, digits, and hyphens. |
| `plugins` | required | Child plugin entry list. |
| `name` | unset | Display name. |
| `description` | unset | Display description. |
| `order` | unset | Roster order. |

The loader row `id` (convention `preset-<id>`) is not `config.id`. Overriding a shipped preset replaces the complete `config`, so restate `id`, `plugins`, and every other field.

Persona mounts inside the preset, not as a host-wide replacement, when it should affect one agent:

| Field | Default | Meaning |
| --- | --- | --- |
| `prefix` | required | Persona prefix template. |
| `suffix` | `''` | Persona suffix template. |
| `complete` | `false` | Use only the rendered prefix as the system prompt section. Assembly still resolves contexts, tools, and variables. |
| `includeRuntimeContext` | `true` | Include runtime context for that scope. |

Before declaration rows, a user preset was `$DSH_HOME/.agent-presets/<id>/` with `preset.yml` (`name`, `description`, `order`) and `agent.cordis.yml` (the plugin list). The editing skill states that nothing reads that directory any more. Migration is a bundle whose declaration copies those fields, then delete the legacy directory after the new row is verified.

Host plugins supply shared services: tool and prompt registries, the agent loop, sessions, persistence, settings, sandbox policy, model routes, and subagent backends. Preset plugins contribute scoped tools, persona, prompt sections, and policies. A service consumed by host plugins belongs in the host configuration. `isolate` controls service instances. Scope controls contribution and event visibility.

`!!js` expressions belong only in plugin configuration or `disabled`. The loader evaluates them when the child plugin activates.

## How a plugin author uses it

- Put a new preset in a bundle patch. Install that bundle with `dsh plugin` or `plugin_manager` `install_bundle`. Do not write the profile `package.json` by hand.
- Change a shipped preset by overriding `preset-<id>`, not by inserting a second declaration with the same `config.id`.
- Validate in a new session. Sessions that already have messages keep their revision and cannot switch presets.
- Do not ship a new preset by copying files into `.agent-presets`. That directory is legacy at this commit.
- Read `minimal.patch.yml` before inventing a plugin list. Packages renamed since an old preset was written fail at activation.

## Sources

- [packages/preset/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/README.md)
- [packages/preset/agent-preset/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/README.md)
- [packages/preset/agent-preset-registry/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset-registry/README.md)
- [packages/preset/persona/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/persona/README.md)
- [packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md)
- [packages/bundle/web-app/presets/minimal.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/web-app/presets/minimal.patch.yml)
- [.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.md)
