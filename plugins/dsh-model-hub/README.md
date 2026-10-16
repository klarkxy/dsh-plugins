# Model Hub

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

See and change the models used by your DeepSeek Harness plugins from one page, manage which models subagents may use, and watch which model and reasoning effort each running subagent is on.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-model-hub
```

Replace `web` with your profile name and restart the profile.

## Use

Open **Plugins → Model Hub**.

- **Fields**: every model setting exposed by installed plugins, such as Auto Title, Git Commit, and Safe Auto. Search by plugin, purpose, or current model, then pick a new model. Changes are saved by the plugin that owns the setting.
- **Subagent Cast**: turn the subagent model allowlist on or off and add, replace, or remove models. When enabled with at least one model, it guides the agent to discover the models available in the current conversation and explicitly choose one when delegating. For independent reviews and alternative approaches, it encourages a different model when suitable, while allowing the same model when it fits better. You can add your own task tendencies for individual models; they remain optional hints, and no model-specific tendencies are supplied by default. Below the list, a live view shows each running subagent with the model and reasoning effort it is currently using; an effort marked as adapter default comes from the adapter rather than an explicit choice.

## Limits

- Only plugins that expose model settings appear.
- If a setting changed elsewhere, refresh and choose again.
- If the model list cannot load, use **Retry**. The last available list stays visible; warnings identify providers that could not be loaded while other providers remain usable.
- Model selection guidance requires host tools that support choosing a subagent model. Existing conversations retain their saved model lists; start a new conversation to use an updated list.
- Guidance does not force a model choice or add extra subtasks solely for variety.
- Remote subagents and finished runs have no readable route; the live list covers only live local subagents.
- No usage statistics.

## License

[SATA License 2.1](LICENSE)
