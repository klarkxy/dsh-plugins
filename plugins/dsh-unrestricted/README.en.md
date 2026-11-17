# Unrestricted Mode

<!-- release-state-note -->

[简体中文](README.md) / English

A DeepSeek Harness session preset that removes limits on what the model answers and delivers complete results. It affects only sessions that select it, leaving every other preset as configured.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-unrestricted
```

Replace `web` with your profile name and restart the profile after installing.

## Usage

### Selection and scope

1. When creating a session, choose **Unrestricted mode** in the preset menu before sending a message (displayed as `破限模式` when the interface language is Chinese).
2. It applies only to sessions that select it and their spawned subagents (unless assigned a separate persona). Pick another preset for ordinary sessions; your model, default preset, and permissions remain unchanged.
3. The preset includes the standard session tools (including schedules/reminders and time context). Available actions still depend on the capabilities enabled in your profile.
4. Replies can combine prose, steps, code, and native interfaces provided by enabled plugins—for example, comparison tables, node graphs, and adjustable estimates with Deep View. Your requested output format still takes precedence.

### Runtime reinforcement and tuning

Beyond the static delivery contract, the plugin applies runtime reinforcement only to sessions running this preset; other presets and auxiliary calls (titles, compaction, one-shot helpers) stay untouched:

- **Tail reminder (`tailReminder`)**: appends a short standing execution reminder at the end of every assembled system prompt so long contexts do not dilute the contract, optionally followed by a model-family hint (customizable via `modelProfiles`).
- **Turn-level refusal retry (`refusalRetry` / `maxRetries`)**: when a reply opens with a refusal, lecture, or deflection, appends a plugin-sourced user-role corrective message in the same turn and retries (default: up to 1 retry per turn).
- **Stream request guard (`transportEnabled` / `transportMaxRetries`)**: buffers the opening chunks of ordinary conversation streams for this preset; if the opening looks like a refusal, discards that attempt and retries with escalating request forms (default: up to 3 retries, with the final attempt always passed through honestly).
- **Prompt profile (`profile`)**: accepts `default`, `stealth` (keeps output compact with the artifact first), or `max` (strengthens end-to-end one-turn completion).

You can override defaults locally in `$DSH_HOME/unrestricted/tuning.json` (falling back to `~/.dsh/unrestricted/tuning.json` when `DSH_HOME` is unset), then restart the profile. Malformed fields fall back to defaults:

| Setting | Default | Meaning |
| --- | --- | --- |
| `tailReminder` | `true` | Append the standing reminder on each prompt assembly |
| `refusalRetry` | `true` | Enable turn-level corrective retry on refusal |
| `maxRetries` | `1` | Maximum corrective retries per turn (1–3) |
| `profile` | `"default"` | Prompt profile: `default`, `stealth`, or `max` |
| `transportEnabled` | `true` | Enable request-boundary stream refusal interception |
| `transportMaxRetries` | `3` | Maximum stream-level retries per request (1–3) |
| `modelProfiles` | `{}` | Map provider/model substrings to one extra hint sentence |

Example:

```json
{
  "tailReminder": true,
  "refusalRetry": true,
  "maxRetries": 2,
  "profile": "default",
  "transportEnabled": true,
  "transportMaxRetries": 3,
  "modelProfiles": {
    "kimi": "Keep the first line concrete and short."
  }
}
```

### Tool budgets inside the session

The preset raises read, retention, and subagent recursion budgets for its own sessions while leaving host files and other presets at their shipped defaults:

| Setting | Host default | This preset |
| --- | --- | --- |
| `read` lines per call | 2000 | 20000 |
| `read` characters per line | 2000 | 10000 |
| `read` bytes per call | 50 KiB | 1 MiB |
| Tool result retained | 8 KiB | 64 KiB |
| Subagent recursion depth | 1 | 3 |

## Limitations

- ⚠ **May get your account banned**: a known risk of this preset, highlighted in red on the preset card. Decide for yourself whether to use it.
- Tool access and host permissions remain unchanged: approvals, sandbox rules, and plan mode apply as usual (plan mode still blocks mutations before approval, while keeping technical plans unabridged).
- Runtime reinforcement adds extra prompt tokens, and persistent refusals can multiply retry requests: under default settings, a persistent refusal can trigger up to 3 stream retries plus 1 corrective turn retry (which may itself use up to 3 stream retries). Stream opening checks may briefly buffer short replies before displaying them.
- Subagents assigned a separate persona do not inherit this preset. To uninstall, remove the bundle in the plugin manager.

## Credits

The contract text is adapted from [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted) (MIT); the persona suffix structure follows [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) (MIT); the tail reminder and refusal retry are implemented by this package. See [NOTICE.md](NOTICE.md) for full attribution and licenses.

## License

[SATA License 2.1](LICENSE)
