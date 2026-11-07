# Session Manager

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

Find and read sessions across working directories, start a chat in a temporary workspace, continue with one tap or automatically when a reply stops early, and get a welcome-back recap after time away.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-session-manager
```

Replace `web` with your profile name and restart the profile.

## Use

Open **Settings → Session Management** to change the Continue ghost, Auto-continue, and welcome-back options.

- **Agent tools**: `list_sessions`, `search_sessions`, and `read_session` find sessions by title or content and read a conversation, its full details, or a handoff summary. Reading a conversation returns one preview per turn, newest first; page back with the returned cursor and open full content in details mode.
- **Session context menu**: right-click a session row or use its **⋯** button to open its actions menu while staying in the current conversation; left-click the row to open that session. The menu appears on saved session rows in the sidebar.
- **Edit and resend**: an icon below each message opens an editor at the original message, with images and files above the text box. Change text, remove attachments, paste images, or drop files; cancelling restores the original message. Before sending, the editor explains that the conversation continues from the edited message, the previous version moves to the archive, and file, command, and external changes already made remain in place. After confirmation, the reply is regenerated in a session that keeps the chat's title and sidebar position, while the earlier version stays recoverable from the archive list. This requires a host that can read and fork sessions and read attachments; it keeps original attachments in their original order while editing text, and relies on host attachment support for new or replaced files.
- **Temporary workspace**: pick it in the new-session workspace picker to chat in its own new folder.
- **Continue ghost**: after a turn ends and the composer is empty, a grey suggestion floats in the input area. Press `Tab` to fill it into the draft, or click it to send it at once. While a turn is running, the composer's own placeholder stays. **Fixed text** uses the configured text, or "Continue" when empty. **Model-generated** uses the model chosen in that same switch; it runs once after the previous turn ends and caches the line in the session. Mode, fixed text, and ghost model live under **Continue ghost** (keys: `continueMode`, `continueText`).
- **Auto-continue**: on the new-session page, pick **Off**, **Cautious**, or **Bold** from the Auto-continue chip above the composer before sending the first message; the choice locks once the session starts. When a reply stops early, one judge pass decides whether the host sends a follow-up message, shown in the conversation as an "auto-continue" notice. The sent text follows the Continue ghost source: fixed text (or the "Continue" default) in **Fixed text** mode, the judge's suggested message in **Model-generated** mode. It continues at most `autoContinueMax` times (default 3) after each message you send, and stops on abort, error, a pending question or approval, no progress, or when the human is needed. The default mode, limit, and judge model live under **Auto-continue** (keys: `autoContinueMode`, `autoContinueMax`).
- **Welcome back**: returning to a session whose last response is older than `recapMinutes` (default 15) shows an inline card after the last turn, recapping what you were discussing, the progress, and a suggested next step. Past `compactMinutes` (default 60), the same card adds a prompt-cache expiry note and two optional buttons: **Compact context** invokes the host's native compaction; **Continue in a new session** creates a blank session in the source session's workspace (or keeps the original directory when the source is ungrouped) and fills its draft with the recap and source session ID for you to review and send. You can also send your next message directly; compaction and session switching happen only when you click their buttons, and the card disappears once you continue the conversation. Toggle each feature and set its idle threshold under **When you return**; after **Save** is confirmed, the current conversation is rechecked against the new thresholds. Idle time is measured from the last response.
- **Feature models**: the welcome-back recap, the generated ghost, the auto-continue judge, and `read_session` handoff summaries each have their own model selector in **Session Management**. Leaving one on the default follows the shared **default auxiliary model** (a row on this same page), then the current conversation or host default model. A judge choice saved before the separate judge field existed keeps applying through migration. The model menu supports provider groups and search; when the list fails to load, a message and retry button appear while keeping your unsaved settings.

## Limits

- Edit and resend uses persistent storage. If sending fails after the new chat is created, sending again continues that same operation, including after a host restart. If chat creation is interrupted before its result is saved, further creation stops so you can check the session list for the new chat first.
- Temporary workspaces remain on disk across restarts and uninstall until you remove them.
- Content read from other sessions serves as background context rather than instructions.
- Free chats, deleting chats, and editing and resending a sent message require a DSH host with those capabilities; editing after later modifications also requires host support for explicit modification confirmation. The buttons appear when the host supports them. Image understanding depends on the selected model; audio, video, and other non-image attachments are sent as ordinary files, and reading them depends on the host and model. Modification warnings reflect changes recorded by the host.
- Each finished turn in an auto-continue session costs one extra model call.
- The welcome-back recap is model-generated; when a model route is unavailable or the call fails, the recap section is omitted while any compaction suggestion still appears on its own. The recap call is read-only and leaves session history unchanged. Compaction uses the host's native command and reports its result in the conversation entry. A new session carries a concise recap and the source session ID for looking up full details, leaving the original session and draft untouched.
- The card is checked when you return to a session (window focus, tab visibility, or switching sessions) and periodically while the page stays visible. Your next send always goes through directly. Tapping the ghost sends the ghost text, while the composer itself still requires non-empty input.

## License

[SATA License 2.1](LICENSE)
