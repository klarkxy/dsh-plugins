# Safe Auto

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

Adds a **Safe Auto** permission level. When the agent asks to run a command or edit a file outside the sandbox, an independent reviewer model checks that one call. If it passes, the call goes ahead; otherwise you get 60 seconds to approve or reject it. Your session is never switched to Full Access.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-safe-auto
```

Replace `web` with your profile name and restart the profile.

## Use

Pick **Safe Auto** from the permission menu next to the chat input. It applies only to that session; choosing any other level turns it off. Nothing happens automatically until you pick it.

When a request does not pass review, a dialog shows the full action, the reviewer's opinion, and a countdown. Approve it once, or reject it. No answer means reject.

Under **Plugins → Safe Auto** you can choose the reviewer model (empty follows the current session model), its reasoning effort, and extra review rules.

## What it covers

- Sandbox escalations of `write`, `edit`, `bash`, and `pwsh`, one call at a time.
- A few clearly harmless shell commands, such as `ls` or `pwd`, are approved without a model call.
- Credential files, private keys, and dangerous programs are always refused.
- Other tools, MCP, remote execution, and subagents are not auto-approved.

## Limits

- **This is not a security boundary.** The reviewer is a language model and can be wrong. Keep your sandbox, isolation, and backups.
- Files can still change between approval and execution.
- Do not combine it with other automatic approvers.

## License

[SATA License 2.1](LICENSE)
