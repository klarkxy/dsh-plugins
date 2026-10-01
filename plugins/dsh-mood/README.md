# @klarkxy/dsh-mood

Mood gives the current Agent one tool to record, read and update its understanding of the current task. The Agent uses its existing instructions, conversation and latest user request; Mood does not call or select another model.

[简体中文](docs/README.zh-CN.md)

Requires Node.js ≥22 and DSH ≥0.1.7-rc.2. Enable or disable the bundle using the native plugin manager. It works without Web services in TUI and other hosts. There is no settings panel, requirements card or model selector.

```sh
npm install @klarkxy/dsh-mood
dsh plugin --profile web add @klarkxy/dsh-mood
```

## Agent workflow

1. Call `mood_requirements` with `{"action":"read"}` at the start of a substantive task.
2. Use the current context to identify the goal, deliverables, scope, constraints and completion criteria. Keep assumptions and unresolved questions distinct from explicit requirements.
3. Call `mood_requirements` with `action: "record"`, the returned `revision` as `expectedRevision`, the returned `sourceVersion`, and `requirements`.
4. Reuse the record during tool continuations. Read and update it when the user corrects or changes the requirements. A plain “continue” preserves the task anchor.

Example record call after a read returned revision `0` and sourceVersion `user-message-id`:

```json
{
  "action": "record",
  "expectedRevision": 0,
  "sourceVersion": "user-message-id",
  "requirements": {
    "goal": "Fix the search error description",
    "deliverables": ["A verified fix"],
    "constraints": ["Keep the existing public interface"],
    "acceptance": ["The regression test passes"],
    "assumptions": [],
    "questions": []
  }
}
```

`requirements.goal` is required; optional list fields are `deliverables`, `inScope`, `outOfScope`, `constraints`, `acceptance`, `assumptions` and `questions`. Omitted lists remain empty. Record concise conclusions, not private reasoning or credentials. The result returns the current revision, source version and full requirements. A new user request marks an older interpretation as stale; reread before updating. Conflicting revisions or request versions fail without overwriting the record.

Session identity comes only from the invoking Agent. Model and session overrides are rejected. The summary is the Agent's interpretation, not human confirmation or execution permission. Necessary questions and native approvals remain with the main Agent and Host. Registration makes the tool available and describes when to use it; it does not force every model to call it.

## Existing records and integration

The existing `dsh_editor_mood` storage domain and `TaskContract` fields remain readable. Recap can continue to use `aiMood.getContract(sessionId)`. Historical notes, answers, held requests and settings are preserved. Old model selections are inert; no requests are replayed and no background analysis is started.

When Web services are present, `/dsh-mood/status` and `/dsh-mood/contract` remain authenticated read-only compatibility endpoints. The former UI operations (`model`, `mode`, `manual`, `edit`, `retry`) return `MOOD_TOOL_ONLY` without changing settings, calling a model or resuming messages. Future writes use only the current Agent's tool.

A failed save leaves the previous record unchanged. Writes are serialized; cancellation before a write starts prevents it, while an accepted storage write remains committed. Disposal waits for started writes to finish and rejects queued or new work.

## Validation

```sh
pnpm --filter @klarkxy/dsh-mood typecheck
pnpm --filter @klarkxy/dsh-mood test
pnpm --filter @klarkxy/dsh-mood build
```

Tests cover current-session binding, full summary persistence, corrections and continuation, stale revisions, concurrency, cancellation, disposal, storage failures, legacy data, native registration and headless host loading.

[Publishing](../PUBLISHING.md) · [License](LICENSE)
