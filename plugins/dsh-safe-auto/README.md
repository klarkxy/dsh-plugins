# DSH Safe Auto (release candidate)

[中文](README.zh-CN.md) · [Preflight](docs/ADR-0001.md) · [One-shot escalation](docs/ADR-0002.md) · [Reviewer routing](docs/ADR-0003.md)

Budgeted preflight and opt-in automatic approval of one native sandbox escalation at a time. **The reviewer follows the current conversation model by default, and can be configured independently.** The plugin reuses DSH's model adapters, tool loop and approval service. It never switches the standing session to Full Access and never lets a model enlarge the operator's configured envelope.

This is a local POSIX/native-tool candidate, not an independently audited security boundary. Start with `shadow`; retain native sandbox providers, human approval, isolation and backups. DSH `workspace-write` governs file effects, not network egress or all secret reads. An approved `danger-full-access` call genuinely bypasses the DSH file sandbox; exact rules are not a finer OS sandbox.

## Install and configure

Use a disposable profile from a checked repository checkout:

```sh
pnpm install --frozen-lockfile
pnpm --filter @klarkxy/dsh-safe-auto test
dsh plugin --profile web add ./plugins/dsh-safe-auto
```

A PR is not an npm release. The bundle inserts the `dsh-safe-auto` profile row. Configure its `config` through the profile patch mechanism:

```yaml
id: dsh-safe-auto
name: '@klarkxy/dsh-safe-auto'
config:
  mode: shadow
  workspaceRoots:
    - /absolute/canonical/project
  shellCandidates:
    - git status --short
  # No endpoint or model override: follow this conversation's DSH provider/model.
```

Select native Workspace Write separately. The enrolled canonical root must exactly match session cwd and the resolved sandbox root. Config is strictly validated and immutable per plugin instance; reload after edits. This release exposes profile configuration, not a graphical model picker or generated settings form.

## Choose the approval model

### Default: follow the conversation

Leave `endpoint`, `fastProvider` and `fastModel` unset or empty. Each eligible review resolves the provider/model from the requesting session's accepted `requestHeader().config`. If no accepted header exists, it uses that same agent's `options`. A malformed header never falls back to another route. A new conversation request using a different model changes subsequent reviews; concurrent sessions do not share a global model selection.

This reuses DSH's configured provider and credentials. No additional API key or endpoint is required. **Only the model route is inherited**, not the conversation history, main-agent prompt, tools, replay state, reasoning setting or output budget. The reviewer is a separate tool-free one-shot with its own prompt and caps. A model requiring more reasoning tokens may need a larger reviewer cap; unsupported options fail closed rather than dropping limits.

### Independent DSH model

Set both fields in the same `config`, using IDs from your DSH model configuration:

```yaml
fastProvider: your-review-provider
fastModel: your-small-review-model
```

The model can differ from the conversation in both provider and model. It stays fixed when the conversation switches models. Clearing both fields restores following. Invalid/missing providers or models do not trigger a silent fallback to the conversation, another provider, or HTTP.

The optional deep stage is independently configurable, including while the primary reviewer follows the conversation:

```yaml
deepProvider: your-deep-review-provider
deepModel: your-deep-review-model
```

Only a fast `review` decision invokes it. Both deep fields empty means no deep model; uncertainty then asks a human or denies in unattended mode. There is no second implicit call to the conversation model. Native provider/model fields must be configured in pairs.

### Independent HTTP endpoint (RC2-compatible)

```yaml
endpoint: https://your-trusted-gateway.example/v1/chat/completions
fastModel: your-http-review-model
# deepModel: your-http-deep-model
apiKeyEnv: DSH_SAFE_AUTO_API_KEY
```

`endpoint` is the complete OpenAI-compatible Chat Completions URL. This explicit endpoint uses the existing HTTP transport, including compatible lapp gateways; omit `fastProvider` and `deepProvider`. Combining native providers with an HTTP endpoint is rejected rather than guessed. Only this mode reads the named API key environment variable. HTTPS is required except loopback HTTP; redirects, URL credentials, query and fragment are rejected. To restore following, clear the endpoint and its fast model, not just the endpoint.

Both ordinary preflight and one-shot escalation use the selected reviewer. Routes are snapshotted for each review. A change during an outstanding native review invalidates automatic allowance; final guards recheck the route. Removing the model service leaves the policy guards installed. Switching models does not reset budgets. Explicit denials remain denials even if the route changes.

## Policy and one-shot escalation

| Action | Smart behavior |
| --- | --- |
| Ordinary `read/read_image/write/edit` in an enrolled workspace | Deterministic pass to existing policy; no reviewer call |
| Protected credentials/security configuration or selected dangerous programs | Hard denial, including escalation |
| Exact enrolled simple `shell/bash` command | Reviewer, within the operator envelope only |
| Exact separately enrolled native `write/edit` or eligible `bash` escalation | Review at native `approval/request`; a fresh allow returns `allowed-once` |
| Unenrolled, unsupported or ambiguous operation | Native human approval; unattended rejects |
| Explicit model denial | Rejected, no semantic retry |
| Cancellation, binding mismatch or changed authority | No automatic grant |

`escalationCandidates` defaults to `[]`. Ordinary `shellCandidates` do not authorize widening. Register exact rules separately:

```yaml
escalationCandidates:
  - tool: write
    cwd: /absolute/canonical/project
    mode: danger-full-access
    filePath: /absolute/other-project/notes.txt
  - tool: edit
    cwd: /absolute/canonical/project
    mode: danger-full-access
    filePath: /absolute/other-project/notes.txt
  - tool: bash
    cwd: /absolute/canonical/project
    mode: danger-full-access
    command: git status --short
escalationApprovalTtlMs: 30000
escalationMaxTimeoutMs: 30000
```

Rules require exactly tool/cwd/mode and filePath or command. No prefixes, globs or directory grants. Native DSH requests use `sandbox_permissions: danger-full-access` with `justification`, not Codex's `require_escalated`. Only widening from Workspace Write is supported. File targets must be absolute and canonical, with existing parents; links, hard-linked writes, protected/system targets and unknown arguments do not get automatic approval. The reviewer receives complete bounded file-write/edit arguments, including content, or refuses oversized/sensitive inputs without truncating them.

**Automatic Bash escalation requires no `jobs` service**, a visible sandbox-capable shell, false/omitted `run_in_background`, an explicit positive `timeoutMs` within the configured limit, and no workdir change. A jobs-enabled DSH profile can promote even a foreground call after timeout. Such requests stay manual or are rejected in unattended mode; the plugin never silently disables jobs. Neither a timeout nor one-shot approval proves that arbitrary descendants cannot outlive the call.

The native tool consumes the grant; the plugin does not execute the command itself. Async context and opaque execution tokens bind the exact agent, call, signal, arguments, cwd, policy, user intent and filesystem state. Concurrent identical call IDs cannot borrow a grant. One execution consumes one approval slot; no cross-call grant cache exists. `escalationApprovalTtlMs` limits decision freshness, not process lifetime, revocation or rollback. Expiry asks a human or denies; side effects are not undone. See [ADR-0002](docs/ADR-0002.md) for the complete execution contract.

## Modes and composition

`off` installs nothing. `shadow` observes ordinary candidates without protecting execution; **enrolled ordinary commands can now use the conversation model even without an explicit endpoint**, and consume reviewer tokens. Shadow escalation remains native/manual without automatic review. Empty candidate lists make no model requests on installation. `smart` enforces policy and sends uncertainty to native human approval. `unattended` can grant eligible reviewed one-shot escalations but rejects uncertainty and other approval requests.

Native `approval: never` rejects before any answerer. For automatic escalation, keep native approval at `ask` even with plugin `unattended`; `ask` dispatches to an answerer, not necessarily a human. Missing native approval services fail closed. Ordinary passes call `next()`, preserving other policy denials and prompts. Never stack this with official experimental Auto, Autogate or another auto-answerer, because human fallback assumes the downstream native human channel.

## Budgets, privacy and limitations

| Setting | Default | Meaning |
| --- | --- | --- |
| `timeoutMs`, `maxInputBytes` | `8000`, `8192` | Per-stage deadline and combined UTF-8 prompt/input cap |
| `fastOutputTokens`, `deepOutputTokens` | `64`, `256` | Explicit native `maxTokens` or HTTP output caps |
| `tokenField` | `max_tokens` | HTTP only; alternatively `max_completion_tokens` |
| `fastCallsPerTask`, `deepCallsPerTask` | `20`, `3` | Atomic logical-review reservations per direct user task |
| `sessionBudgetUnits` | `100000` | Prompt bytes + output cap + 1024 reserved per stage |
| `consecutiveDenials`, `totalDenials` | `3`, `20` | Non-allowing review/error fuse per task/session |

Fast JSON is `allow/review/deny`; deep JSON is `allow/ask/deny`. Extra fields, invalid JSON, tool calls, missing finish or output truncation cannot grant. Both transports have bounded responses, including native reasoning text, and an outer cancellation/timeout deadline. No plugin-level transport or semantic retry is added. Native adapters/middleware remain host-controlled and may implement their own transport policy; reservations count logical reviews, not every downstream wire attempt.

Only the action and latest direct human text are supplied. No main transcript, assistant reasoning or tool results are copied. Descriptions and justifications do not authorize actions. Secret detection is heuristic; following a model or configuring a remote reviewer sends bounded review inputs to that provider, including file contents for escalation. Fixed routes never silently change data destinations on failure.

Preflight and escalation share a session ledger, reserved before I/O with no error refunds. Usage counts include DSH's disjoint cache counters when reported. Reservations are not exact billable tokens, currency limits or a cap on the main agent. Providers must honor limits. New direct user messages reset task counters but not session totals; model changes reset neither; plugin reload/restart resets in-memory counters. The fuse stops more reviews, not the whole agent loop.

Tests, builds, installation and Git hooks can run repository-controlled code and are not inherently safe. Enrollment does not pin executable contents. `grep/glob`, PTC, MCP, PowerShell, remote execution, complex shell and subagent model grants remain outside the automatic envelope. Trusted same-process plugins and execution providers remain trusted; unloading a policy removes its guards. Path rechecks cannot eliminate OS TOCTOU. Use external isolation with restricted credentials and egress.

## Verification

Run `npm test`, `npm run build` (JavaScript syntax checks, not TypeScript checking), and `npm pack --dry-run` in this package, plus repository `pnpm check`. Tests cover routing, concurrent sessions, native streams, caps, stale decisions, model service removal, preflight/escalation binding, real loopback HTTP, and real Cordis/ToolRuntime/ApprovalService/LlmRuntime contracts. CI requires installed DSH dependencies; offline source-only tests may explicitly skip native contracts.

The native test uses a controlled adapter and fixture session/tool/policy. It proves runtime integration, not live model accuracy, OS isolation or authenticated Web/Headless acceptance. These remain in [ADR-0002's checklist](docs/ADR-0002.md). Logs separate assessment, escalation outcome and final result without raw commands/prompts/keys; host retention is operator-managed. No durable budget/audit database, cross-call grant cache, PI probe or graphical model picker is bundled. No absolute safety or savings percentage is claimed.

## License

Original implementation under [SATA License 2.1](LICENSE). Community designs informed the work; their code was not vendored.
