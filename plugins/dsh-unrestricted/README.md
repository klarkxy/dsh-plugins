# Unrestricted

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

A DeepSeek Harness session preset that removes the limits on what the model answers and delivers complete results. It only affects sessions where you choose it; every other preset stays exactly as it was.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-unrestricted
```

Replace `web` with your profile name and restart the profile.

## Use

Pick **Unrestricted mode** in the preset menu when creating a new session. The card and selected-preset button follow the interface language: Chinese shows 破限模式, every other language shows Unrestricted mode. Workspace names are kept as you named them. A session that already has messages cannot switch presets. Subagents started from that session normally carry it too.

There is no switch to remember: choose the preset to use it, choose another preset to stop. It does not change your model, default preset, or permissions.

The preset includes the standard session tools, including reminders and current time context. Available actions still depend on the capabilities enabled in your profile.

## Limits

- ⚠ May get your account banned: the known risk of picking this preset, marked in red on the preset card. Decide for yourself whether to use it.
- It unlocks no tools or permissions; approvals, sandbox, and plan mode work as usual.
- A subagent given its own persona does not carry the preset.
- To uninstall, remove the bundle from the plugin manager.

## Credits

The contract text is adapted from [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted) (MIT). See [NOTICE.md](NOTICE.md) for full attribution and licenses.
