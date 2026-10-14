# Model Hub

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

See and change the models used by your DeepSeek Harness plugins from one page, and manage which models subagents may use.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-model-hub
```

Replace `web` with your profile name and restart the profile.

## Use

Open **Plugins → Model Hub**.

- **Fields**: every model setting exposed by installed plugins, such as Auto Title, Git Commit, Safe Auto, and ChatGPT. Search by plugin, purpose, or current model, then pick a new model. Changes are saved by the plugin that owns the setting.
- **Subagent Cast**: turn the subagent model allowlist on or off and add, replace, or remove models. You can give each model a short task tendency; the main agent reads it as a hint when choosing a subagent model, not as a rule.

## Limits

- Only plugins that expose model settings appear.
- If a setting changed elsewhere, refresh and choose again.
- No usage statistics.

## License

[SATA License 2.1](LICENSE)
