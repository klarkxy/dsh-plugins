# @klarkxy/dsh-mood

Mood is a lightweight, autonomy-first behavior policy for DeepSeek Harness. It helps the main Agent investigate first, choose reasonable low-risk defaults, and ask the user only when a genuine blocker cannot be resolved independently.

[简体中文](docs/README.zh-CN.md)

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. Enable or disable it under **Settings → Plugins**. Native permissions, writing proposals, publishing confirmation, and Safe Auto decisions remain independent and unchanged.

## Plugin page settings

`Settings → Plugins → Requirements` carries a **Requirements analysis model** row for the requirements analysis call. It is optional. A saved route is used for that call as an explicit model; an empty selection follows the live session model and then the host default chat model. Only that call is affected; a saved route selects a model but is not evidence of connectivity.

```sh
npm install @klarkxy/dsh-mood
dsh plugin --profile web add @klarkxy/dsh-mood
```

## Default behavior

At `agent/pre-step`, Mood adds one deduplicated, stable policy message with plugin provenance. It makes **no auxiliary model call, no question dialog, no task-contract write, and no execution hold** on the normal path. The policy remains present on tool continuation steps, not just at the start of a task.

The Agent should read existing context and use authorized tools before asking. When a reasonable, low-risk, reversible default exists, it should proceed and briefly disclose a material assumption without waiting for confirmation. A necessary question must materially affect the result, be unanswerable using available information/tools, and have no reasonable default or useful unblocked work to do first. Ordinary questions should be grouped, but new genuine blockers and required approvals must still be surfaced.

“Continue”, “you decide”, and equivalent instructions continue the existing task within its scope and permissions. Deliberate discussion or collaborative decision-making remains supported. The policy discourages habitual closing questions such as “should I continue?”. This is behavioral guidance, not a guarantee that every model will follow it perfectly, and not a security boundary.

## Optional task notes

Use **Summarize requirements** in the native Mood settings panel, or call `manual`, to explicitly request a summary. Only this operation runs the requirements analysis call. It uses recent real user messages, retains prior answers in that context, and excludes plugin-authored messages pretending to be user text.

The result uses the existing `TaskContract` interface for compatibility with Recap and other consumers. It is an optional summary, never an approval certificate or a prerequisite for execution. Empty question lists stay empty. Suggested questions appear as open points in the notes, not as blocking dialogs. The main Agent applies the normal necessary-question policy to them.

Ordinary requests no longer create task cards. Legacy automatically generated cards are hidden. Explicit notes are collapsed in chat by default and remain editable in settings. Obsolete notes stop being injected when a new task arrives; a simple continuation does not invalidate them.

## Compatibility and recovery

Storage and the `/dsh-mood` RPC channel are retained. Existing notes and answers remain readable. Old `manual`/`strict` mode values normalize to the single non-blocking `auto` strategy; the obsolete mode selector is no longer displayed.

A request held by an older Mood version is never replayed automatically. **Retry original** explicitly resumes the original human messages once through the native Host adapter, without bypassing permissions. New user work supersedes old held work. An old pending/cancelled contract is not silently promoted to confirmed.

Optional analysis or note-storage errors are returned to the manual caller without blocking ordinary conversation. Cancellation, newer requests, and plugin disposal discard late analysis results. A summary edit uses revision-based compare-and-swap and does not invent answers to unrelated questions.

## Host RPC

The channel requires the Host authorization policy.

| Endpoint | Behavior |
| --- | --- |
| `status` | Settings and optional session view; `held` is legacy recovery only |
| `contract` | Current optional `TaskContract`, or `null` |
| `mode` | Compatibility CAS operation; accepted legacy names normalize to `auto` |
| `manual` | Explicitly analyze recent user context now and return optional notes; no fabricated chat message |
| `edit` | Amend notes with `{ sessionId, expectedRevision, patch }` |
| `retry` | Explicitly resume a legacy held original request once |

## Validation

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-mood typecheck
pnpm --filter @klarkxy/dsh-mood test
pnpm --filter @klarkxy/dsh-mood build
pnpm check
```

Tests cover quiet defaults, continuation/delegation, source provenance, empty analysis questions, native rejection preservation, optional failure fallback, old request recovery, stale results, storage failures, CAS edits, and quiet card presentation.

[Publishing](../PUBLISHING.md) · [License](LICENSE)
