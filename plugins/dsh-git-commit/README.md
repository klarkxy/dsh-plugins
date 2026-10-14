# Git Commit

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Commit workspace changes without leaving the chat. A model groups your changes into a few sensible commits and writes their messages.

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

Under **Plugins → Git Commit** you can choose the **Commit planning model** (empty follows the current session model) and turn on **Commit even without a model plan**, which makes one commit when the model is unavailable.

## Good to know

- All uncommitted changes in the repository are included, including new files.
- It only commits; it never pushes.
- If the run stops partway, finished commits stay and the panel shows what was left. Nothing is rolled back or retried automatically.
- The button is unavailable while the session is running.

## License

[SATA License 2.1](LICENSE)
