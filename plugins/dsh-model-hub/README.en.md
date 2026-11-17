# Subagents

<!-- release-state-note -->

[简体中文](README.md) / English

Configure the models and reasoning effort available to new DeepSeek Harness subagents, and view each subagent's last-used model in the conversation's read-only subagent popup.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-model-hub
```

Replace `web` with your profile name and restart the profile after installation.

## Usage

- **Configure subagent models**: Open **Settings → Subagents** to add, replace, or remove allowed models, choose a reasoning effort for each route, and enter optional task tendencies (saved on blur). Add at least one model before turning on **Enable subagent model selection**; these settings guide delegation while the agent makes the final choice.
- **Optional picker upgrade**: When the optional **Model Picker** (`@klarkxy/dsh-model-picker`) plugin is installed, model menus here upgrade to the shared searchable picker with a reasoning-effort slider; without it, the built-in menus keep working as-is.
- **Inspect last-used models**: In a conversation, open the subagent count or breadcrumb switcher to view each child's last-used model and reasoning effort in read-only mode.

## Limitations

- List changes apply only to new conversations; existing conversations keep their saved lists. Effort preferences apply to new subagents and do not alter running ones.
- Explicit model selection requires host delegation tools that support specifying a subagent model; omitting a model still inherits the parent model.
- Model and effort options come from the host catalog; if loading fails, click **Retry**, while other available providers remain usable.
- The popup relies on the host's private tree and style contracts and shows routes only for subagents that have sent a model request (external subagents and children with no model request yet have no route to show).
- Settings changed elsewhere sync automatically; if a conflicting edit occurs, refresh and review before saving again.

## License

[SATA License 2.1](LICENSE)
