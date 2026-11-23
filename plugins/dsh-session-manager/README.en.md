# Session Manager

<!-- release-state-note -->

[简体中文](README.md) / English

Search and read DeepSeek Harness sessions across working directories, use temporary workspaces, continue replies with composer suggestions or auto-continue, show welcome-back recaps and compaction hints after time away, edit and resend messages, and optionally let the agent fork or message sessions.

## Demo

![The new-session workspace picker with the temporary workspace entry](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/pr23-session-manager-picker.gif)

## Downloads

[![Daily npm downloads trend](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/downloads-session-manager.svg)](https://www.npmjs.com/package/@klarkxy/dsh-session-manager)

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-session-manager
```

Replace `web` with your profile name and restart the profile.

## Usage

Open **Settings → Session Management** to adjust composer suggestions, auto-continue, welcome-back behavior, session handoff, and agent actions. Every setting saves immediately—there is no Save button.

### Session list and message actions

- **Session context menu**: right-click a saved session row in the sidebar or click its **⋯** button to open its actions menu without leaving the current conversation; left-clicking still opens that session.
- **Delete chat**: when the host supports session deletion, **Delete chat** appears in the session actions menu. Deleting a free chat removes both the chat and its owned files; deleting an ordinary chat keeps project files intact.
- **Edit and resend**: when the host supports reading sessions, forking sessions, and reading attachments, an edit button appears below each sent user message to open an inline editor at the original message (with images and files shown above the text box). You can edit text and, when the host supports attachment editing, remove, paste, or drop attachments; cancelling restores the original message. Before sending, a confirmation dialog notes that the conversation continues from the edited message, moves the earlier version to the archive, and leaves already-applied file, command, and external changes in place. Once confirmed, a new branch keeps the original title and sidebar position and regenerates the reply while the earlier version remains in the archive list.
- **Host capability requirements**: free chats, deleting chats, editing and resending, and explicit confirmation after later modifications all require host support; buttons appear only when the host provides those capabilities, and without host attachment-editing support you can edit text while keeping original attachments in order.

### New sessions, suggestions, and auto-continue

- **Remembered new-session choices**: on the new-session page, your chosen agent preset, permission preset, and Auto-continue mode automatically apply to the next new session (including after restarts). Sessions forked from an existing one inherit their parent's choices without changing the remembered defaults. Host permission rules still apply: **Auto** and **Custom** cannot be saved as defaults.
- **Temporary workspace**: choose **Temporary Workspace** in the new-session workspace picker to chat in a newly allocated folder.
- **Composer suggestion**: after a turn finishes and the composer has no draft or attachments, grey suggestion text appears in the input box; press `Tab` (while focused in the composer outside IME composition) to fill it into the draft (the host placeholder remains while a turn is running). Configure the source under **Settings → Session Management → Composer suggestion**:
  - **Fixed text**: uses your configured text, or `Continue` when left empty.
  - **Model-generated**: runs the selected generation model once after a turn ends and caches the suggestion per session.
- **Auto-continue**: before sending the first message in a new session, choose **Off**, **Cautious**, or **Bold** in the **Auto-continue** selector above the composer; the choice locks once the session starts (forked sessions inherit their parent's setting). When a reply stops early, a judge model decides whether to send a follow-up automatically (shown as an `auto-continue` notice in the chat). Follow-ups use the **Composer suggestion** source: configured text (or `Continue`) in **Fixed text** mode, or the judge's suggested message in **Model-generated** mode. Configure **Maximum continuations** (1–10, default 3 per user message) and **Judge model** under **Settings → Session Management → Auto-continue**. Automatic continuation stops on abort, error, pending question or approval, no progress, or when human input is needed.

### Welcome back and compaction hints

Configure switches and idle thresholds (measured in minutes from the last response) under **Settings → Session Management → When you return**; saving a change immediately rechecks the open session:

- **Show session recap**: returning to a session idle past the threshold (default 15 minutes) renders an inline **Welcome back** card after the latest completed turn summarizing what you were discussing, current progress, and a suggested next step.
- **Suggest context compaction**: once idle past the compaction threshold (default 60 minutes), the card adds a prompt-cache expiry notice and two optional actions: **Compact context** (runs the host's native compaction command) and **Continue in a new session** (creates a blank session in the source session's workspace, or original directory if ungrouped, and fills its draft with the recap and source session ID for you to review and send).

You can dismiss the card or send your next message directly; continuing the conversation closes the card automatically.

### Agent tools and agent actions

This plugin exposes 5 session tools for the agent:

| Tool | Default | Description |
| --- | --- | --- |
| `list_sessions` | Always enabled (read-only) | Lists host-visible sessions across projects (caller directory first), with optional session ID, directory, parent, time-range filters, and cursor pagination. |
| `search_sessions` | Always enabled (read-only) | Searches sessions across projects by literal text in `title`, `content` (default), or `both`, with filters and pagination. |
| `read_session` | Always enabled (read-only) | Reads a session in `conversation` (turn previews, newest first), `handoff` (continuation context, optionally summarized by a model), or `details` (original events/tools or model-visible surface). |
| `fork_session` | Off by default (switch + host support) | When **Allow self-fork** is enabled in **Agent actions**, lets the agent fork the current session (including an in-flight turn) into an independent new branch with a starting prompt. |
| `send_session_message` | Off by default (switch + host support) | When **Allow sending messages** is enabled in **Agent actions**, lets the agent send one agent-attributed message to another unarchived non-subagent session, waking an idle target or queuing for a running one. |

- **Agent actions (off by default)**: enable **Allow self-fork** and **Allow sending messages** independently under **Settings → Session Management → Agent actions**; changes save immediately and run without per-call confirmation. Both tools also require host support for session forking or agent message delivery and report unavailable if the host lacks them.

### Model settings

Under **Settings → Session Management**, four features each provide an independent model selector inside their settings row:

- **Composer suggestion → Generation model**
- **Auto-continue → Judge model**
- **When you return → Recap model** (enabled when **Show session recap** is on)
- **Session handoff → Summary model** (used for `read_session` handoff summaries)

Leaving any selector on **Default auxiliary model** follows the shared **Default auxiliary model** row on the same page, then falls back to the current conversation or host default model. Model menus support provider grouping and search (showing an error and retry button if loading fails). With the optional **Model Picker** plugin installed, these selectors upgrade to the shared searchable picker with a reasoning-effort slider.

## Limitations

- **Host capability dependencies**: free chats, deleting chats, editing and resending sent messages (including explicit modification confirmation and attachment editing), and agent write tools (`fork_session`, `send_session_message`) require host support; unsupported UI controls stay hidden and unsupported tools report unavailable.
- **Edit-and-resend persistence & side effects**: edit-and-resend persists progress in a local retry journal; if sending fails after the new chat is created, sending again resumes the same operation even across host restarts. If creation is interrupted before its result is recorded, further creation pauses so you can check the session list for an existing new chat first. Forking does not undo prior file, command, or external changes.
- **Temporary workspaces**: temporary workspace folders stay on disk across restarts and uninstalls until you delete them manually.
- **Cross-session context & agent action boundaries**: content read by `list_sessions`, `search_sessions`, and `read_session` is untrusted background reference, not instructions. `fork_session` starts an independent conversation that shares the same workspace files (no file isolation). `send_session_message` cannot target the calling session, archived sessions, or subagent sessions, and delivered messages cannot be recalled.
- **Model calls & degradation**: each finished turn in an auto-continue session incurs one extra judge model call. Welcome-back recaps and `read_session` summaries are read-only model calls; if a route is unavailable or fails, the recap section is omitted (compaction hints still appear on their own) and `read_session` falls back to source excerpts. Welcome-back checks run on return (window focus, tab visibility, session switch) and periodically while the page stays visible.

## License

[SATA License 2.1](LICENSE)
