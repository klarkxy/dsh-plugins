# Subagents

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Configure the models and reasoning effort available to new DeepSeek Harness subagents, and see each subagent's last-used model in the conversation's subagent popup.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-model-hub
```

Replace `web` with your profile name and restart the profile.

## Use

Open **Settings → Subagents** to add, replace, or remove models, choose their reasoning effort, and add optional task tendencies. These guide the agent when delegating; the agent makes the final choice.

In a conversation, open the subagent count or switcher to see each child's last-used model and effort. This is read-only.

## Limits

- List changes apply to new conversations; existing conversations keep their saved lists. Effort preferences guide new subagents and do not change running ones.
- Selection requires host tools that support choosing a subagent model. Omitting a model still inherits the parent model.
- Model lists use the host's model and effort metadata. If loading fails, use **Retry**; available providers remain usable.
- The popup uses the host's private tree and style hooks, so host changes may require a plugin update. External subagents and children without a model request have no route to show.
- Settings changed elsewhere update automatically; refresh to resolve a conflicting edit.

## License

[SATA License 2.1](LICENSE)
