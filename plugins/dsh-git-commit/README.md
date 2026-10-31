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

Under **Plugins → Git Commit** you can choose the **Commit planning model** (empty follows the current session model) and turn on **Commit even without a model plan**, which makes one single commit when the model is unavailable.

When the model list fails to load or some providers are unavailable, use **Retry** beside the model picker; your saved model stays selected.

## Good to know

- The repository follows the conversation's current working directory; changing directories while a commit is being planned stops the run.
- All uncommitted changes are included, including new files.
- The plugin creates local commits only; pushing stays manual.
- If the run stops partway, finished commits stay and the panel shows what remains for you to handle.
- The button is active while the session is idle.

## License

[SATA License 2.1](LICENSE)
