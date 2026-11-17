# Safe Auto

<!-- release-state-note -->

[简体中文](README.md) / English

Adds a **Safe Auto** approval level: ordinary actions run inside the workspace sandbox as usual, while requests requiring approval are judged one call at a time by a reviewer model, with complete local audit trails.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-safe-auto
```

Replace `web` with your profile name and restart the profile after installing.

## Usage

### Enable and configure the reviewer

- **Enable per session**: pick **Safe Auto** from the permission menu next to the chat input. It applies only to that session, and choosing another level turns it off. When the most recently opened or selected top-level session uses Safe Auto, new top-level sessions inherit it automatically (or keep native permissions without escalating if Safe Auto is unavailable).
- **Reviewer settings**: open **Settings → Session Management → Safe Auto** and use the **Reviewer** tab to configure the **Reviewer model**, **Reasoning effort**, and **Additional reviewer prompt** (up to 4096 characters; may add constraints only, never expand authorization or override safety rules). The **Limits** tab shows the profile-configured timeout and size caps.
- **Model following and retry**: leaving the reviewer model empty follows the shared **Default auxiliary model** under **Settings → Session Management** (or the current conversation model when no default is set); changes made elsewhere sync automatically. If the model list fails to load or some providers are unavailable, click **Retry**; your saved configuration and unsaved draft stay intact.

### Review scope and criteria

- **What gets reviewed**: sandbox escalations requested by `write`, `edit`, `bash`, and `pwsh`, approval prompts raised by other plugins or tools, and a short list of dangerous shell commands even inside the sandbox (forced deletion such as `rm -f`, `Remove-Item -Force`, `del /f`, `rd /s /q`, and launching URLs). Routine reads, searches, builds, and tests run directly without review.
- **How decisions are made**: the reviewer inspects the current conversation (only your direct messages are marked trusted; agent prose, tool outputs, file contents, and earlier approval outcomes are untrusted evidence), the working directory, the sandbox boundary, and the full action arguments. Replaced messages and abandoned turns are excluded, and a new user message or settings change cancels any in-flight review.
- **Risk tiers and circuit breaker**: low- and medium-risk actions are approved; high-risk actions are approved only when clearly requested and narrowly scoped; critical actions (such as exfiltrating secrets or broad irreversible deletion) are always denied. Timeouts, malformed verdicts, unavailable models, or an unreadable shared auxiliary default fail closed as review denials. After 3 consecutive denials, or 10 denials among the last 50 reviews in one turn, automatic approval pauses until your next message.

### Review history and query tool

- **Inspect and export**: open **Settings → Session Management → Safe Auto → Review history** to filter recorded reviews by search text, session ID, tool, outcome, risk, and time range, and page through results. Each record shows the trigger, redacted arguments and review input, rationale, per-attempt token usage, observed native approval outcome, and tool execution result. Export a single record or all filtered matches as JSON (paged with cancellation support; written only after clean completion).
- **Read-only agent tool**: while Safe Auto is enabled in the plugin config, a local read-only tool is registered for the current session (leaving the reviewer model idle; use Settings for cross-session history):

| Tool | What it does |
| --- | --- |
| `safe_auto_history` | Read-only lookup of the current session's review history: `list` returns summaries and a `nextCursor` (with filters for tool, outcome, risk, time range, and search query); `get` returns one complete redacted record by `id`. |

## Limitations

- **This is not a hard security boundary**: the reviewer is a language model and can be wrong. Keep your sandbox, environment isolation, and backups.
- Denied actions return their rationale directly to the agent; to allow one, explicitly confirm it in chat so the reviewer sees your approval on retry.
- Long conversations are truncated from excess history, and actions or review inputs exceeding the size cap are refused automatically.
- Turning Safe Auto off or changing reviewer settings invalidates in-progress reviews. Subagent sessions follow the native approval flow instead of Safe Auto.
- Use Safe Auto as the sole automatic approver in a profile.
- History stores best-effort redacted copies: known credential formats are masked, while unfamiliar secret formats may remain; oversized or unserializable actions carry explicit capture markers. The reviewer verdict, observed native approval, and execution outcome are stored separately, with unobserved stages marked explicitly.
- Automatic approval requires the audit record to save first; write failures reject approval. Local audit records are plain profile data rather than tamper-proof logs.

## License

[SATA License 2.1](LICENSE)
