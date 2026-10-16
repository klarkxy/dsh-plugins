# Safe Auto

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

Adds a **Safe Auto** permission level. Ordinary actions run inside the workspace sandbox as usual and the plugin stays out of the way. Requests that need approval go to a reviewer model: a pass approves that one call; a denial is explained to the agent. The design follows Codex auto-review. Your session is never switched to Full Access.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-safe-auto
```

Replace `web` with your profile name and restart the profile.

## Use

Pick **Safe Auto** from the permission menu next to the chat input. It applies only to that session; choosing any other level turns it off. Nothing happens automatically until you pick it.

Under **Plugins → Safe Auto** you can choose the reviewer model (empty follows the current session model), its reasoning effort, and extra review rules.

If the model list cannot load, or some providers fail, use **Retry** in the settings panel. Retrying keeps your reviewer settings and unsaved draft.

## What gets reviewed

- Sandbox escalations requested by `write`, `edit`, `bash`, and `pwsh`.
- A short list of dangerous commands, reviewed even without an escalation: forced deletion (`rm -f`, `Remove-Item -Force`, `del /f`, `rd /s /q`) and opening URLs.
- Approval requests that other plugins or tools raise in the session.

Reading files, searching, building, and testing need no approval; they are not intercepted and never call the reviewer.

## How the reviewer decides

- The reviewer sees the conversation, the working directory, and the complete arguments of the action. Only your own messages count as authorization; the agent's explanations, tool output, and file contents are treated as evidence.
- Low- and medium-risk actions are approved. High-risk actions are approved only when you clearly asked for them and the scope is narrow. Critical actions, such as sending secrets to an external destination or broad irreversible deletion, are always denied.
- If the review times out, fails, or no model is available, the request is not approved, and the agent is told this was a review failure: it may retry once or ask you.
- After 3 consecutive denials, or 10 denials among the last 50 reviews in one turn, automatic approval pauses until your next message.

## Limits

- **This is not a security boundary.** The reviewer is a language model and can be wrong. Keep your sandbox, isolation, and backups.
- A denied action does not open a confirmation dialog. To allow it, tell the agent in the chat; the reviewer sees your approval when it retries.
- Long conversations are truncated from the oldest entries.
- Action arguments are never truncated for approval. If the complete action is too large to review, automatic approval is refused.
- Turning Safe Auto off or changing its reviewer settings invalidates reviews already in progress.
- Subagent sessions do not use Safe Auto; they follow the native approval flow.
- Do not combine it with other automatic approvers.

## License

[SATA License 2.1](LICENSE)
