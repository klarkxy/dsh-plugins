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

## Limits

- ⚠ May get your account banned: a known risk of this preset, marked in red on the preset card. Decide for yourself whether to use it.
- Tool access and permissions stay unchanged; approvals, sandbox, and plan mode work as usual.
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

The contract text is adapted from [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted) (MIT); the persona suffix sections follow the prompt structure of [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) (MIT). See [NOTICE.md](NOTICE.md) for full attribution and licenses.
