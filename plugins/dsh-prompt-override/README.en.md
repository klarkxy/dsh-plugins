# Prompt Override

<!-- release-state-note -->

[简体中文](README.md) / English

Adds a working contract to DSH's native system prompt and rewrites its terse built-in tool guidance, in every session.

DSH's native system prompt has a one-line identity followed by isolated per-tool rules; it lacks general conventions for how to work, verify, handle risky operations and reply. This plugin fills those in without changing tools, permissions or the sandbox.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-prompt-override
```

Replace `web` with your profile name, then restart the profile.

## Usage

It takes effect once installed and applies to every session, including subagents. New sessions use the new prompt from the first turn; existing sessions switch at their next prompt assembly.

The plugin does three things:

| Part | What it does |
| --- | --- |
| Working contract | Inserts an English contract after the identity: understand before changing, minimal changes, verify after changing, never overstate results, confirm risky operations, call independent tools in parallel, reply concisely in the user's language; the harness's planning mode, permissions and preset restrictions take precedence over the contract |
| Built-in tool guidance | Rewrites the guidance for read, write, edit, glob and grep, adding edit uniqueness, line-number prefixes and parallel searches; bash/pwsh keep their native text with shell discipline appended; guidance for a disabled tool still stays out |
| DSH development notes | Removes the per-turn DSH source checkout and Web GUI development notes by default; the decision follows the session's agent preset (the official `cordis` preset customizes DSH and keeps them), falling back to the persona and then to keeping them |

Prompt text contributed by other plugins is left as is.

### Local overrides

Put a configuration at `$DSH_HOME/prompt-override/overrides.json` (`~/.dsh/prompt-override/overrides.json` when `$DSH_HOME` is unset) and restart the profile after editing; malformed fields are ignored, but an unreadable file or a non-object root fails the plugin load — the plugin refuses to rewrite every session on hidden built-in defaults:

| Field | Default | Description |
| --- | --- | --- |
| `core` | `true` | Insert the working contract |
| `tools` | `true` | Rewrite the built-in tool guidance |
| `devContext` | `"auto"` | DSH development notes: `auto` (kept when the session runs a DSH-development preset such as `cordis`), `keep`, `drop` |
| `coreText` | — | Your own text in place of the working contract; an empty string disables the contract entirely |
| `sections` | `{}` | Replacement text by prompt section name; `null` removes the section; an explicit entry can rescue a section the default drop would remove |

Example:

```json
{
  "devContext": "keep",
  "sections": {
    "tool:edit": "Read a file before editing it. Keep edits small.",
    "ui:deliverable-file-references": null
  }
}
```

Common section names: `tool:read`, `tool:write`, `tool:edit`, `tool:glob`, `tool:grep`, `tool:bash`, `tool:pwsh`, `tool:jobs`, `tool:web_search`, `tool:web_fetch`, `tool:subagent`, `ui:deliverable-file-references`, `harness:source`, `app:web-surface`; the inserted contract is `prompt-override:core`.

## Limitations

- Only the system prompt is rewritten; each tool's own description and parameter descriptions stay native.
- Sessions on the `minimal` preset have a host-locked complete prompt, so the plugin does not apply there.
- The replacement text is English; the contract still tells the model to reply in the user's language.
- Rewrites match prompt section names: if a future host renames or reworks a section, that rewrite silently falls back to the native text instead of mis-splicing.
