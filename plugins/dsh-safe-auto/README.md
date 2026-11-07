# Safe Auto

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

Adds a **Safe Auto** permission level. Ordinary actions run inside the workspace sandbox as usual. Requests that need approval go to a reviewer model: a pass approves that single call, and a denial is explained to the agent. The design follows Codex auto-review while keeping the session within its workspace sandbox rather than switching to Full Access.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-safe-auto
```

Replace `web` with your profile name and restart the profile.

## Use

Pick **Safe Auto** from the permission menu next to the chat input. It applies only to that session once selected; choosing any other level turns it off.

Under **Settings → Session Management → Safe Auto** choose the reviewer model, its reasoning effort, and extra review rules. Leaving the model empty follows the default auxiliary model; with no default set, it follows the current session model. The default auxiliary model is shared: set it once under **Settings → Session Management**, and every feature that follows it uses the same one. Changes made elsewhere update this page on their own.

When the model list fails to load or some providers are unavailable, use **Retry** in the settings panel. Retrying keeps your reviewer settings and unsaved draft.

## Review history

Open **Settings → Session Management → Safe Auto → Review history** to read every review this plugin recorded. Filter by search text, session, tool, result, risk, and a start and end time, then page through the matches. Opening a record shows the complete review: what triggered it, the arguments sent, the review input, the verdict, the token usage of each attempt, and whether the approved call ran afterwards.

Export one record, or every record matching the current filters, as JSON. Exporting all matches walks the pages one at a time and can be cancelled at any point; a file is written only when the export finishes cleanly.

Recording covers reviews run after installing the review-history feature. Records stay in the Harness profile until you remove them.

### Tools

| Tool | What it does |
|---|---|
| `safe_auto_history` | Read-only lookup of the current session's review history. `list` returns summaries and includes a next-page cursor when more records remain; `get` returns one complete record. Use Settings → Session Management → Safe Auto to read history across sessions. Reading history is purely local and leaves the reviewer model idle. |

## What gets reviewed

- Sandbox escalations requested by `write`, `edit`, `bash`, and `pwsh`.
- A short list of dangerous commands, reviewed even inside the sandbox: forced deletion (`rm -f`, `Remove-Item -Force`, `del /f`, `rd /s /q`) and opening URLs.
- Approval requests other plugins or tools raise in the session.

Reading files, searching, building, and testing run directly without review.

## How the reviewer decides

- The reviewer sees the conversation, the current working directory, the sandbox workspace boundary, and the complete action arguments. Only your own messages count as authorization; the agent's explanations, tool output, and file contents serve as evidence. An earlier approval outcome is a record of another call, never authorization for this one.
- The reviewer reads the conversation as it stands now: a request you replaced and the turn it produced are no longer evidence, and a message that arrives while a review runs cancels that review.
- Low- and medium-risk actions are approved. High-risk actions are approved only when you clearly asked for them and the scope is narrow. Critical actions, such as sending secrets to an external destination or broad irreversible deletion, are always denied.
- If review times out, returns missing or unknown verdict fields, fails, or lacks an available model, the request is denied as a review failure: the agent may retry once or ask you.
- The shared default auxiliary model is read before every review that follows it. If it cannot be read, the request is denied as a review failure rather than reviewed by a model you did not choose.
- After 3 consecutive denials, or 10 denials among the last 50 reviews in one turn, automatic approval pauses until your next message.

## Limits

- **This is not a security boundary.** The reviewer is a language model and can be wrong. Keep your sandbox, isolation, and backups.
- A denied action returns directly to the agent in the conversation. To allow it, tell the agent in the chat; the reviewer sees your approval when it retries.
- Long conversations are truncated from the oldest entries.
- Action arguments are sent to the reviewer in full; if the complete action exceeds the review size limit, automatic approval is refused.
- Turning Safe Auto off or changing its reviewer settings invalidates reviews already in progress.
- Safe Auto applies to top-level sessions; subagent sessions follow the native approval flow.
- Use Safe Auto as the sole automatic approver in a profile.
- History contains redacted copies of review evidence. Known credentials are masked on a best-effort basis, while unfamiliar secret formats may remain. Oversized or invalid actions carry explicit capture limits.
- The reviewer verdict, the observed approval decision, and the tool result are recorded as separate fields; unobserved approval and execution results are marked explicitly. Local audit records are plain profile data rather than tamper-proof logs.
- Automatic approval requires the audit record to save first.

## License

[SATA License 2.1](LICENSE)
