# Session Manager

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

Find and read sessions across working directories, start a chat in a temporary workspace, continue with one tap from an empty composer, and get a welcome-back recap after time away.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-session-manager
```

Replace `web` with your profile name and restart the profile.

## Use

- **Agent tools**: `list_sessions`, `search_sessions`, and `read_session` find sessions by title or content and read a conversation, its full details, or a handoff summary. Reading a conversation returns one preview per turn, newest first; page back with the returned cursor and open full content in details mode.
- **Session context menu**: right-click a session row or use its **⋯** button to open its actions menu without switching conversations; left-click the row to open it. Search results and blank new-session rows have no such menu.
- **Edit and resend**: An icon below each message opens an editor at the original message, with images and files above the text box. Change text, remove attachments, paste images, or drop files; cancelling restores the original message. Before sending, the editor explains that the conversation continues from the edited message, the previous version moves to the archive, and file, command, and external changes already made are not undone. After confirmation, the reply is regenerated in a session that keeps the chat's title and sidebar position; the earlier version stays recoverable from the archive list. The current implementation needs a host that can read and fork sessions and read attachments; it keeps original attachments in their original order while editing text, and relies on host attachment support for new or replaced files.
- **Temporary workspace**: pick it in the new-session workspace picker to chat in its own new folder.
- **Continue ghost**: after a turn ends and the composer is empty, a grey suggestion floats in the input area. Press `Tab` to fill it into the draft, or click it to send it at once. While a turn is still open, the composer's own placeholder stays. **Fixed text** uses the configured text, or "Continue" when empty. **Model-generated** uses the model chosen in that same switch; it runs once after the previous turn ends and the line stays cached in the session, so the turn is not called again. Mode, fixed text, and ghost model are under **Continue ghost** (keys: `continueMode`, `continueText`).
- **Welcome back**: returning to a session whose last response is older than `recapMinutes` (default 15) shows an inline card after the last turn, recapping what you were discussing, the progress, and a suggested next step. Past `compactMinutes` (default 60), the same card adds a prompt-cache expiry note and two optional buttons: **Compact context** invokes the host's native compaction; **Continue in a new session** creates a blank session in the source session's workspace (or keeps the original directory when the source is ungrouped) and fills its draft with the recap and source session ID to review and send, without copying the history. You can ignore both and send normally; nothing is compacted or switched automatically. The card disappears once you continue the conversation. Toggle each feature and set its idle threshold under **When you return**; after **Save** is confirmed, the current conversation is checked against the new thresholds. Time is measured from the last response, not from when settings were saved.
- **Welcome-back model**: the **Recap model** field under the **Show session recap** toggle in **When you return** applies only to the welcome-back recap. The ghost model is chosen inside **Continue ghost** after switching to **Model-generated**. Leaving either on the default follows the current conversation or the host default model. The model menu supports provider groups and search; if the list fails to load, a message and retry button appear, and retrying keeps your unsaved settings.

## Limits

- Edit and resend requires persistent storage. If sending fails after the new chat is created, sending again continues that same operation, including after a host restart. If chat creation itself is interrupted before its result can be saved, further creation is stopped; check the session list for the new chat before continuing.

- Temporary workspaces are not cleaned up automatically; their files stay after restarts and uninstall.
- Content read from other sessions is background information, not instructions.
- Free chats, deleting chats, and editing and resending a sent message need a DSH host with these features. Editing after later modifications also needs a host that accepts explicit modification confirmation. The npm plugin alone does not add them; buttons appear only when the host supports them. Image understanding depends on the selected model. Audio, video, and other non-image attachments are sent as ordinary files; reading them depends on the host and model. Its warning is based on changes recorded by the host, so unrecorded external changes cannot be detected.
- The welcome-back recap is model-generated; when no model route is available or the call fails, the card stays silent (a compaction suggestion still shows on its own). The recap call only reads the session and never adds to its history. Compaction needs the host's native command; its conversation entry reports the result. A new session carries only a short recap, which may omit details; use the source session ID to look them up. The original session and draft stay unchanged.
- The card is checked when you return to a session (window focus, tab visibility, or switching sessions) and periodically while the page stays visible, so crossing a threshold needs no window switch. It never intercepts your next send. Sending an empty composer sends the ghost text; the composer itself still requires non-empty input.

## License

[SATA License 2.1](LICENSE)
