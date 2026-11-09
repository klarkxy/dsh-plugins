# Git Commit

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Commit workspace changes directly from the conversation. A model groups your changes into a few sensible commits and writes their messages.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-git-commit
```

Replace `web` with your profile name and restart it if DSH asks.

## Use

1. Open a conversation whose workspace is inside a Git repository.
2. Click **Commit** in the top-right of the conversation.
3. Check the branch, file count, and model, then confirm.
4. The panel lists the commits it created.

Inside the Commit panel you can choose the **Commit planning model** — your pick is saved as the default for future runs — and turn on **Commit even without a model plan**, which makes one single commit when the model is unavailable. With the optional **Model Picker** plugin installed, this menu upgrades to the shared searchable picker with a reasoning-effort slider; without it it keeps working as today.

When the planning model is left empty the feature follows the **default auxiliary model**; with no default set it uses the current session model, then the host default chat model. The default auxiliary model is shared: set it once under **Settings → Session Management**, and every feature that follows it uses the same one.

When the model list fails to load or some providers are unavailable, use **Retry** beside the model picker; your saved model stays selected.

## Good to know

- The repository follows the conversation's current working directory; changing directories while a commit is being planned stops the run.
- All uncommitted changes are included, including new files.
- Commit planning uses the selected model's normal output settings, without an extra output limit imposed by this plugin.
- The plugin creates local commits only; pushing stays manual.
- If the run stops partway, finished commits stay and the panel shows what remains for you to handle.
- Each planning call rebuilds its input from the workspace's current changes; earlier plans are never reused. If the shared default auxiliary model cannot be read, the run fails rather than planning on a model you did not choose.
- The button is active while the session is idle.

## License

[SATA License 2.1](LICENSE)
