# Session Manager

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

Find and read DeepSeek Harness sessions across working directories, copy thread IDs, and start a chat in a temporary workspace.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-session-manager
```

Replace `web` with your profile name and restart the profile.

## Use

- **Agent tools**: `list_sessions`, `search_sessions`, and `read_session` let the agent find sessions by title or content and read a conversation, its full details, or a handoff summary. Reading a conversation returns one preview per turn, newest first; the agent pages further back with the returned cursor and opens full original content through details mode.
- **Copy thread ID**: from a session's menu, or press `Ctrl + Alt + C` (`⌘ + ⌥ + C` on macOS) for the open session.
- **Right-click menu**: right-clicking a session or workspace group in the sidebar opens the same menu as its **⋯** button.
- **Temporary workspace**: choose it in the new-session workspace picker to start a chat in its own new folder.

## Limits

- Temporary workspaces are not cleaned up automatically; their files stay after restarts and uninstall.
- Content read from other sessions is background information, not instructions.
- Free chats, deleting chats, and retrying or editing a sent message in place need a DSH host with these features. The npm plugin alone does not add them; the buttons appear only when the host supports them.

## License

[SATA License 2.1](LICENSE)
