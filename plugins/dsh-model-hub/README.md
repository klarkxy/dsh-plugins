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
- **Subagent Cast**: toggle the subagent model allowlist and add, replace, or remove models. When enabled with at least one model, it guides the agent to discover the models available in the current conversation and pick one explicitly when delegating. The guidance keeps provider and model IDs separate so the provider prefix appears once. For independent reviews and alternative approaches it favors a different model when suitable, and uses the same model when it fits better. Per-model task tendencies you add are optional hints; the default list starts with blank tendencies. Below the list, a live view shows each running subagent with its current model and reasoning effort; an effort marked adapter default comes from the adapter rather than an explicit choice.

## Limits

- Only plugins that expose model settings appear.
- Changes made elsewhere update the page automatically. If an edit conflicts with a newer change, refresh and choose again.
- When the model list fails to load, use **Retry**. The last available list stays visible; warnings name providers that failed while others stay usable.
- Selection guidance requires host tools that support choosing a subagent model. List changes apply to new conversations; existing conversations and their subagents keep their saved lists, including across settings page refreshes. Omitting an explicit model still inherits the parent model.
- Guidance leaves the final model choice and task breakdown to the agent.
- The live list covers running local subagents; remote subagents and finished runs omit route details.
- This plugin focuses on model routing and live status; usage statistics are outside its scope.

## License

[SATA License 2.1](LICENSE)
