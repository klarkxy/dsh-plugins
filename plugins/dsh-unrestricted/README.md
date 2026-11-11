# Unrestricted

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

A DeepSeek Harness session preset that removes limits on what the model answers and delivers complete results. It affects only sessions where you choose it; every other preset stays as configured.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-unrestricted
```

Replace `web` with your profile name, then restart the profile.

## Use

Pick **Unrestricted mode** in the preset menu when creating a session. The card and selected-preset button follow the interface language: Chinese shows 破限模式, and every other language shows Unrestricted mode. Workspace names stay as you named them. The preset is chosen when creating a session before messages are sent, and subagents started from that session inherit it by default.

Choose the preset to use it for a session, or pick another preset for ordinary sessions; your model, default preset, and permissions stay unchanged.

The preset includes the standard session tools, including reminders and current time context. Available actions still depend on the capabilities enabled in your profile.

## Runtime reinforcement

Beyond the static contract, the preset adds two runtime behaviours only to sessions that select it:

- **Tail reminder**: every system-prompt assembly appends a short execution reminder after the persona, restating "deliver first, do not stop halfway, do not replace the result with a summary" so a long context cannot dilute the contract.
- **Refusal retry**: when a turn opens with a refusal, a lecture, or a suggestion to consult someone else, the preset appends one corrective message in the same turn and retries once by default; a second refusal stops the loop. The plugin-sourced corrective message appears in the transcript as a user-role message.

Both check `agentPresets.composedPreset()` and stay completely inert for every other preset. The tail reminder is pinned to section order `1_000_000`, after every host section in the system prompt. They can be switched off or tuned in the bundle config:

| Setting | Default | Meaning |
| --- | --- | --- |
| `tailReminder` | `true` | Append the standing reminder on each assembly |
| `refusalRetry` | `true` | Enable the corrective retry |
| `maxRetries` | `1` | Maximum retries per turn, 1–3 |

A local override can be placed in `$DSH_HOME/unrestricted/tuning.json` with the same fields plus `modelProfiles` (provider/model substring to one extra sentence):

```json
{
  "tailReminder": true,
  "refusalRetry": true,
  "maxRetries": 2,
  "transportEnabled": true,
  "transportMaxRetries": 3,
  "modelProfiles": { "kimi": "Keep the first line concrete and short." }
}
```

Values in `tuning.json` win over the bundle config; malformed values fall back to defaults. Restart the profile after editing.

`profile` accepts `default`, `stealth`, or `max`, backed by `presets/profiles/*.md`; `stealth` keeps output compact and `max` strengthens the one-pass delivery requirement. `transportEnabled` controls request-boundary stream interception (on by default); it resolves the live Agent and only intercepts ordinary conversation calls from this preset, never titles, compaction or one-shot auxiliary calls. `transportMaxRetries` sets the retry cap (1–3), with the final attempt always passed through honestly.

## Limits

- ⚠ May get your account banned: a known risk of this preset, marked in red on the preset card. Decide for yourself whether to use it.
- Tool access and permissions stay unchanged; approvals, sandbox, and plan mode work as usual.
- The runtime reinforcement adds a small amount of prompt tokens. At default settings, a persistent refusal can cost up to 3 request retries plus 1 corrective step, which may itself use another 3 retries; raising the caps can multiply those budgets. Short answers may be held until the opening is classified.
- Subagents keep the preset unless assigned a separate persona.
- To uninstall, remove the bundle in the plugin manager.

## Tool budgets inside the session

The preset raises read and retention budgets for its own sessions using the host's documented config keys, while leaving host files and other presets at their shipped defaults:

| Setting | Host default | This preset |
| --- | --- | --- |
| `read` lines per call | 2000 | 20000 |
| `read` characters per line | 2000 | 10000 |
| `read` bytes per call | 50 KiB | 1 MiB |
| Tool result retained | 8 KiB | 64 KiB |
| Subagent recursion depth | 1 | 3 |

The host defaults are sized for short chat turns (50 KiB per `read`, 8 KiB retained tool output, and a single subagent depth). Raising these budgets lets multi-file audits, migrations, and multi-angle reviews run across larger files and deeper subagent trees while keeping all host mechanisms active.

## Credits

The contract text is adapted from [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted) (MIT, v0.2.8); the persona suffix sections follow the prompt structure of [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) (MIT); the tail reminder and refusal retry are implemented by this package. See [NOTICE.md](NOTICE.md) for full attribution and licenses.
