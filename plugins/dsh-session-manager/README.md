# Session Manager

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

Find and read DeepSeek Harness sessions across working directories, start a chat in a temporary workspace, continue with one tap on an empty composer, and get a welcome-back recap after time away.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-session-manager
```

Replace `web` with your profile name and restart the profile.

## Use

- **Agent tools**: `list_sessions`, `search_sessions`, and `read_session` let the agent find sessions by title or content and read a conversation, its full details, or a handoff summary. Reading a conversation returns one preview per turn, newest first; the agent pages further back with the returned cursor and opens full original content through details mode.
- **Session context menu**: right-click a session row in the sidebar, or its **⋯** button, to open the session's actions menu without switching conversations. Left-click the row to open the conversation. Search results and blank new-session rows do not have this menu.
- **Temporary workspace**: choose it in the new-session workspace picker to start a chat in its own new folder.
- **Continue ghost**: with an empty composer, a grey suggestion floats in the input area. Press `Tab` to fill it into the draft, or click it to send it immediately. **Fixed text** uses the configured text, or "Continue" when that is empty. **Model-generated** uses the model chosen in that same switch. The model runs once after the previous turn ends and the line stays cached in the session, so the same turn does not call it again. Mode, fixed text, and the ghost model are all under **Continue ghost** (equivalent keys: `continueMode`, `continueText`).
- **Welcome back**: returning to a session whose last response is older than `recapMinutes` (default 15) shows an inline card at the end of the conversation, after the last turn, with a model-written recap of what you were discussing, the progress so far, and a suggested next step. Past `compactMinutes` (default 60), the same card adds a prompt-cache expiry note with two optional buttons: **Compact context** invokes the host's native compaction command; **Continue in a new session** creates a blank session in the source session's workspace (or keeps the original directory when the source is ungrouped) and fills its draft with the recap and source session ID for you to review and send, without copying the full history. You can also ignore both buttons and send normally; nothing is compacted or switched automatically. The card disappears once you continue the conversation. Toggle each feature and set its idle threshold under the **Welcome back** settings group. After **Save** is confirmed, the current conversation is checked against the new thresholds. Time is measured from the last response, not from when the settings were saved.
- **Welcome-back model**: the **Recap model** field under the **Welcome-back recap** toggle in the **Welcome back** settings group is only for the welcome-back recap. The ghost model is chosen inside **Continue ghost** after switching to **Model-generated**. Leaving either on the default option follows the current conversation or the host default model. The model menu supports provider groups and search. If the model list fails to load, a message and retry button appear; retrying keeps your unsaved settings.

## Limits

- Temporary workspaces are not cleaned up automatically; their files stay after restarts and uninstall.
- Content read from other sessions is background information, not instructions.
- Free chats, deleting chats, and retrying or editing a sent message in place need a DSH host with these features. The npm plugin alone does not add them; the buttons appear only when the host supports them.
- The welcome-back recap is model-generated; when no model route is available or the call fails, the card stays silent (a compaction suggestion still shows on its own). The recap call only reads the session and never adds to its history. Compaction needs the host's native command; its conversation entry reports the result. A new session carries only a short recap, which may omit details; use the source session ID to look them up. The original session and draft remain unchanged.
- The card is checked when you return to a session (window focus, tab visibility, or switching sessions) and periodically while the page stays visible, so crossing a threshold does not require switching windows. It never intercepts your next send. Sending an empty composer means sending the ghost text; the composer itself still requires non-empty input.

## License

[SATA License 2.1](LICENSE)
