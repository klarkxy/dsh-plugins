# @klarkxy/dsh-memory

DeepSeek Harness keeps hold of how you talk and what you are working on: the vocabulary you use, the preferences you stated, project facts, decisions and recent activity. Dream observes your own messages and consolidates them into scoped records; the same store can also hold procedural lessons, but Self Improve owns their creation and injection. Novel canon stays in the authoritative worldbook files.

[简体中文](docs/README.zh-CN.md)

## Standalone DSH Web

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. On a standalone DSH Web host, install:

```sh
npm install @klarkxy/dsh-memory
```

Load it explicitly:

```sh
dsh plugin --profile web add @klarkxy/dsh-memory
```

No application-private packages and no Self Improve are required — Memory stands on its own. The bundle starts enabled, and merely opening its UI does not call a model. Use Plugins → Memory to manage records, prompt injection and the Dream observation/consolidation switch.

## Plugin page settings

`Plugins → Long-term Memory` carries two optional model rows, and neither is required:

| Row | Used for |
| --- | --- |
| **Dream model** | consolidation |
| **Observation model** | context observation |

A saved route is used for that feature's own call as an explicit model; an empty selection follows the live session model and then the host default chat model. Only these two features are affected, and a saved route selects a model — it is not evidence of connectivity.

## Behavior

### Records and scope

`ctx.aiMemory` implements the shared `MemoryService`. New `vocabulary` and `activity` records may carry subject, domain, term/topic key, aliases, host observation time, literal event-time text and activity status. Project scope comes from the native session cwd, never an arbitrary client path, and automatic observation without a cwd is skipped rather than promoted to global.

Activity has a default seven-day freshness bound. Expiry removes it from recall; it does not prove completion. A new explicit update supersedes the previous matching subject/domain/topic while preserving history, and stable vocabulary has no automatic activity expiry. Existing authoritative task records and project documents remain authoritative.

### Observation

At turn end, Dream observes original human messages only. A new session contributes its latest message; later batches include at most four new messages, each capped at 2000 characters. Accepted output requires exact quoted evidence from real human events, and pure continuation acknowledgements do not trigger inference. Context observation runs its own model call under the same resolved route rules.

### Idle consolidation

Idle Dream runs after roughly 15 minutes of inactivity, at least 24 hours after the previous attempt, with at least three changes. It never consolidates lessons, crosses kinds or identities, extends source expiry, refreshes observation dates, or confirms candidate sources. Only all-active sources produce active replacements; otherwise the result stays candidate. Old manual records without referenceable evidence are left unchanged rather than assigned invented provenance. Corrections, deletion and lifecycle cancellation invalidate stale results.

### Recall and injection

Recall contains at most five active records, about 800 tokens including the wrapper; lessons are omitted. For a continuation request, recent in-scope activity can restore the task context. Candidates, revoked, rejected, deleted, superseded and expired records are not injected, and current instructions and permissions take precedence.

### Limits and compatibility

Observation cursors are persisted across restart and deletion. The 512-session cursor bound fails closed for new sessions instead of evicting deletion protection. Disabling Dream stops observation and idle consolidation, not Memory storage or Self Improve, and disabling the plugin preserves stored data.

Existing records remain readable without synthetic metadata. Update the shared service and both learning packages together when testing these new fields; merging source does not publish an npm release.

## Verification

```sh
pnpm --filter @klarkxy/dsh-memory typecheck
pnpm --filter @klarkxy/dsh-memory test
pnpm --filter @klarkxy/dsh-memory build
```

## API and exports

The package has three entry points:

- `.` — the Cordis plugin (`name`, `inject`, `apply`), the `MemoryRuntime` service class and the shared constants `CHAT_EVENTS_SLOT`, `MEMORY_RPC_CHANNEL`, `defaultSettings` and `projectIdFromCwd`. `apply` provides the runtime as `ctx.aiMemory` and registers the host RPC channel.
- `./contracts` — browser-safe types and constants. `MemoryRecord`, `MemoryService`, `MemoryQuery`, `NewMemoryRecord` and the other shared interfaces come from the frozen `@klarkxy/dsh-plugin-kit` contracts; this package adds `MemorySettings`, `DreamPlan`, `MemoryStatus`, the recall/injection bounds and the `/dsh-memory` channel name.
- `./client` — the settings UI bundle loaded by the host web client.

`MemoryRuntime` implements the frozen `MemoryService` surface — `list`, `create`, `update`, `promoteToGlobal`, `remove` and `recall` — and adds settings (`status`/`readStatus`, `updateSettings`), the candidate lifecycle (`accept`, `reject`, `revoke`), manual records (`createManualRecord`), turn hooks (`handlePreStep`, `observeSession`) and the Dream lifecycle (`previewDream`, `runIdleDream`, `applyDream`, `cancelDream`).

The host RPC channel is `/dsh-memory` with endpoints `status`, `settings.update`, `records.list`, `records.create`, `records.update`, `records.remove`, `records.accept`, `records.reject`, `records.revoke` and `dream.run`.

[Design and limits](../../docs/portable-learning.md) · [Publishing](../PUBLISHING.md) · [License](LICENSE)
