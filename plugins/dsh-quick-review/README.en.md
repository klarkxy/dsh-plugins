# Quick Review

<!-- release-state-note -->

[简体中文](README.md) / English

Start a read-only review session from the current conversation with one click. It streams live in a right-sidebar tab, reviews only this session's own changes, and its first-turn verdict is sent back to the conversation automatically.

## Demo

![Header Review → pick a model and focus → the live review streams in a sidebar tab](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/pr29-quick-review.gif)

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-quick-review
```

Replace `web` with your profile name and restart the profile as DSH prompts.

## Use

1. Open a conversation that has already produced file changes.
2. Click **Review** in the conversation header.
3. Pick a review model in the popover (your last choice is remembered; leaving it empty follows the host default chat model), optionally add a focus, then click **Start review**.
4. A review tab opens in the right sidebar showing the live review conversation, with its status on top.
5. When the review's first turn finishes, its final answer is sent back to the main session. After chatting further with the reviewer, use **Send to main again** in the tab to relay the newest answer.

## Limits

- The review scope comes from the host's session change recording (`workspace/changes` summaries). After a host restart or without recorded changes it falls back to "all uncommitted changes in the workspace", which the popover and the review prompt state plainly.
- The review session is pinned to the host's built-in `read-only` permission preset (read-only sandbox, writes require approval). The plugin refuses to start when the preset is missing rather than launching a writable reviewer.
- The review model is written to the review session only; it never changes your global default model.
- The first-turn verdict is sent back exactly once. An aborted, failed, or empty turn sends nothing and shows as undelivered in the tab.
- Blank and subagent sessions have no review entry. **Send to main again** relies on the plugin's in-memory records and is unavailable after a host restart.

## License

[SATA License 2.1](LICENSE)
