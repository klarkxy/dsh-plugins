# Model Hub

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

View and change the models your DeepSeek Harness plugins use, control which models subagents may use, and track the model and reasoning effort of each running subagent — all on one page.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-model-hub
```

Replace `web` with your profile name and restart the profile.

## Use

Open **Plugins → Model Hub**.

- **Fields**: every model setting exposed by installed plugins, such as Auto Title, Git Commit, and Safe Auto. Search by plugin, purpose, or current model, then pick a new model. The plugin that owns the setting saves the change.
- **Subagent Cast**: toggle the subagent model allowlist and add, replace, or remove models. When enabled with at least one model, it guides the agent to discover the models available in the current conversation and pick one explicitly when delegating. For independent reviews and alternative approaches it favors a different model when suitable, but allows the same one when it fits better. Per-model task tendencies you add are optional hints; none are supplied by default. Below the list, a live view shows each running subagent with its current model and reasoning effort; an effort marked adapter default comes from the adapter, not an explicit choice.

## Limits

- Only plugins that expose model settings appear.
- Changes made elsewhere update the page automatically. If an edit conflicts with a newer change, refresh and choose again.
- If the model list cannot load, use **Retry**. The last available list stays visible; warnings name providers that failed while others stay usable.
- Selection guidance needs host tools that support choosing a subagent model. List changes apply to new conversations; existing conversations and their subagents keep their saved lists. Refreshing the settings page does not change a conversation's list. Omitting an explicit model can still inherit the parent model.
- Guidance never forces a model choice or adds subtasks just for variety.
- Remote subagents and finished runs have no readable route; the live list covers only live local subagents.
- No usage statistics.

## License

[SATA License 2.1](LICENSE)
