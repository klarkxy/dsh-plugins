# Unrestricted

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

A DeepSeek Harness session preset that delivers complete results directly, without watering them down or dodging. It only affects sessions where you choose it; every other preset stays exactly as it was.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-unrestricted
```

Replace `web` with your profile name and restart the profile.

## Use

Pick **Unrestricted** in the preset menu when creating a new session. A session that already has messages cannot switch presets. Subagents started from that session normally carry it too.

There is no switch to remember: choose the preset to use it, choose another preset to stop. It does not change your model, default preset, or permissions.

## Limits

- It unlocks no tools or permissions; approvals, sandbox, and plan mode work as usual.
- A subagent given its own persona does not carry the preset.
- To uninstall, remove the bundle from the plugin manager.

## Credits

The contract text is adapted from [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted) (MIT). See [NOTICE.md](NOTICE.md) for full attribution and licenses.
