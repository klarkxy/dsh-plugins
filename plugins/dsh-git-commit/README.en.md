# Git Commit

<!-- release-state-note -->

[简体中文](README.md) / English

Commit workspace changes directly from the conversation, with a model grouping changes and writing commit messages.

## Downloads

[![Daily npm downloads trend](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/downloads-git-commit.svg)](https://www.npmjs.com/package/@klarkxy/dsh-git-commit)

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-git-commit
```

Replace `web` with your profile name and restart the profile if DSH asks.

## Usage

### Commit workspace changes

1. Open a conversation whose workspace is inside a Git repository.
2. Click **Commit** in the top-right corner of the conversation.
3. Review the branch, changed file count, and planning model, click **Commit all workspace changes**, and confirm.
4. The panel lists each commit created and the files it includes.

### Model and fallback options

- **Commit planning model**: your pick is saved as the default for future runs. Leaving it empty follows the **Default auxiliary model**; if none is set, it falls back to the current conversation model and then the host default chat model.
- **Shared default auxiliary model**: set the **Default auxiliary model** once under **Settings → Session Management**, and every feature that follows it uses the same one.
- **Model Picker integration**: with the optional **Model Picker** plugin installed, this menu upgrades to the shared searchable picker with a reasoning-effort slider; without it, the built-in menu keeps working as usual.
- **Retry catalog loading**: if the model list fails to load or some providers are unavailable, click **Retry** beside the picker; your saved model choice stays selected.
- **Commit even without a model plan**: off by default (a failed plan cancels the run and leaves the workspace untouched). When enabled, all changes are combined into one commit with a plugin-generated message if the model is unavailable.

## Limitations

- Committing is available while the session is idle and the workspace has uncommitted changes. The target repository follows the conversation's working directory; changing directories or branches mid-run stops the operation.
- All uncommitted changes in the repository are included, including staged, unstaged, and untracked new files.
- Commit planning uses the selected model's normal output settings without an extra output limit imposed by this plugin.
- Commits are created locally only; pushing remains manual.
- If a run stops partway, completed commits stay intact and the panel shows any remaining or uncertain groups for manual follow-up.
- Each planning call rebuilds its input from the workspace's current changes and never reuses earlier plans. If the shared default auxiliary model cannot be read, the run fails rather than using an unchosen model.

## License

[SATA License 2.1](LICENSE)
