# Unrestricted

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

A DeepSeek Harness session preset that removes limits on what the model answers and delivers complete results. It affects only sessions where you choose it; every other preset stays exactly as it was.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-unrestricted
```

Replace `web` with your profile name, then restart the profile.

## Use

Pick **Unrestricted mode** in the preset menu when creating a session. The card and selected-preset button follow the interface language: Chinese shows 破限模式, every other language shows Unrestricted mode. Workspace names stay as you named them. A session with existing messages cannot switch presets. Subagents started from that session normally carry it too.

Nothing to remember to turn off: choose the preset to use it, choose another to stop. It does not change your model, default preset, or permissions.

The preset includes the standard session tools, including reminders and current time context. Available actions still depend on the capabilities enabled in your profile.

## Limits

- ⚠ May get your account banned: a known risk of this preset, marked in red on the preset card. Decide for yourself whether to use it.
- It unlocks no tools or permissions; approvals, sandbox, and plan mode work as usual.
- A subagent given its own persona does not carry the preset.
- To uninstall, remove the bundle in the plugin manager.

## Tool budgets inside the session

The preset changes only its own sessions' read and retention budgets, using the host's documented config keys. No host file is touched, and every other preset keeps the shipped defaults:

| Setting | Host default | This preset |
| --- | --- | --- |
| `read` lines per call | 2000 | 20000 |
| `read` characters per line | 2000 | 10000 |
| `read` bytes per call | 50 KiB | 1 MiB |
| Tool result retained | 8 KiB | 64 KiB |
| Subagent recursion depth | 1 | 3 |

The host defaults suit chat-shaped output: a `read` that hits the 50 KiB cap returns only a file's first half, a tool result over 8 KiB gets its middle replaced by a marker, and a subagent cannot delegate further by default — so a multi-file audit, a migration, or a multi-angle review cannot fan out in one pass. No mechanism is disabled here; the budgets are only raised to where the work fits.

## Credits

The contract text is adapted from [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted) (MIT). See [NOTICE.md](NOTICE.md) for full attribution and licenses.
