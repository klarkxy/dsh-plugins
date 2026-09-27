# DSH Safe Auto (release candidate)

[中文](README.zh-CN.md) · [Preflight design](docs/ADR-0001.md) · [One-shot escalation and acceptance](docs/ADR-0002.md)

Budgeted preflight and opt-in automatic approval of **one native sandbox escalation at a time**. The plugin reuses DSH's tool loop and approval service. It never switches the standing session to Full Access, never executes a command on the model's behalf, and never lets the reviewer enlarge the operator's configured envelope.

**Local POSIX/native-tool candidate, not an independently audited security boundary.** Start with `shadow`. Keep correctly composed native sandbox providers, human approval, isolation and backups. DSH's `workspace-write` governs file effects, not network egress or all secret reads. A one-shot `danger-full-access` execution is genuinely unconfined by the DSH file sandbox; exact target rules do not create a finer OS sandbox.

## What runs automatically

| Action | Policy in `smart` |
| --- | --- |
| Ordinary `read`, `read_image`, `write`, `edit` in an enrolled canonical workspace | Deterministic pass to existing policy; zero reviewer calls |
| Protected credentials/security configuration and selected dangerous programs | Hard denial, including when escalation is requested |
| Exact enrolled simple `shell`/`bash` command without widening | Fast reviewer; `review` may invoke optional deep review |
| Exact separately enrolled native `write`/`edit` or eligible `bash` escalation | Review at native `approval/request`; a fresh allow grants `allowed-once` |
| Unenrolled or ambiguous escalation, unsupported tools or process lifetime | Native human approval; no automatic grant |
| Explicit model denial | Rejected without retries or another answerer |
| Reviewer error, invalid output, budget exhaustion | Human fallback in smart; rejection in unattended |
| Cancelled, changed or mismatched approval binding | No grant |

`grep`, `glob`, PTC/`run_code`, MCP, PowerShell, remote execution and compound shell have no automatic exemption. PTC transports can require manual approval. Subagents may use deterministic file checks but do not receive model-reviewed command or escalation grants from delegated text.

Tests, builds and dependency installation can execute repository-controlled code. They are not built-in safe commands. Exact enrollment is an operator capability boundary, not proof that the executable, scripts, hooks or dependencies remain benign. Avoid enrolling commands in untrusted/mutable repositories.

## Install and configure

From the repository checkout, use a disposable profile:

```sh
pnpm install --frozen-lockfile
pnpm --filter @klarkxy/dsh-safe-auto test
dsh plugin --profile web add ./plugins/dsh-safe-auto
```

This PR does not publish npm. After publication, request an explicit package version. The bundle inserts a `dsh-safe-auto` row; configure it through the profile patch mechanism. Example resulting row:

```yaml
id: dsh-safe-auto
name: '@klarkxy/dsh-safe-auto'
config:
  mode: shadow
  workspaceRoots:
    - /absolute/canonical/project
  shellCandidates:
    - git status --short
  endpoint: https://your-trusted-gateway.example/v1/chat/completions
  fastModel: your-fast-model
  # deepModel: your-deep-model
  apiKeyEnv: DSH_SAFE_AUTO_API_KEY
```

`endpoint` is the complete OpenAI-compatible Chat Completions URL. A compatible lapp gateway can be used; native DSH provider routing is not implemented. Supply credentials via the named environment variable, never in a tool call or profile. HTTPS is required except loopback HTTP. Redirects, URL credentials, query strings and fragments are rejected.

Select native **Workspace Write** separately. The enrolled root must match both session cwd and resolved sandbox root exactly. This plugin does not change permission presets. Configuration is immutable for one instance and validated by Standard Schema v1; reload after edits. No custom/generated settings form is bundled.

## Enable one-shot sandbox escalation

`escalationCandidates` defaults to `[]`. Ordinary `shellCandidates` do not authorize any widening. To enable review, add exact rules to the same plugin `config`, then use `smart` or `unattended` after validation:

```yaml
escalationCandidates:
  - tool: write
    cwd: /absolute/canonical/project
    mode: danger-full-access
    filePath: /absolute/other-project/notes.txt
  # edit requires its own rule, even for the same target:
  - tool: edit
    cwd: /absolute/canonical/project
    mode: danger-full-access
    filePath: /absolute/other-project/notes.txt
  # Automatic bash widening additionally requires the foreground-only
  # composition described below. Never enroll this merely to test a checkbox.
  - tool: bash
    cwd: /absolute/canonical/project
    mode: danger-full-access
    command: git status --short
escalationApprovalTtlMs: 30000
escalationMaxTimeoutMs: 30000
```

Each rule requires exactly `tool`, `cwd`, `mode` and either `filePath` or `command`. No prefixes, globs, directory grants or inferred target changes. Native DSH uses `sandbox_permissions: danger-full-access` plus `justification`, not Codex's `require_escalated` value. This candidate supports widening from standing Workspace Write only; read-only-to-workspace-write is not implemented.

For file operations, the parent must already exist and be canonical, the target must be an exact absolute path, and links, protected/system targets and unreviewed arguments cannot receive automatic approval. The reviewer receives the complete bounded write/edit arguments, including content. Large or known-secret-bearing payloads are refused, not truncated.

For **automatic Bash escalation**, the `jobs` service must be absent, a sandbox-capable shell must be visible, `run_in_background` must be false or omitted, and an explicit positive `timeoutMs` must not exceed `escalationMaxTimeoutMs`. `workdir` may only repeat the enrolled cwd. DSH can promote a foreground command into a background job when `jobs` is composed, so merely setting `run_in_background: false` is insufficient. In a normal jobs-enabled profile these Bash requests stay manual in smart, or are rejected in unattended. The plugin does not disable jobs globally. The timeout is passed to the native executor; this is not proof that arbitrary spawned descendants can never outlive it.

The preflight only admits the native tool to request escalation. Only that tool's exact live `approval/request` can receive `allowed-once`. Complete arguments, effective policy, cwd, direct user intent and file identity are rechecked before returning a decision. Async execution context and opaque tokens isolate identical call IDs and concurrent calls. Each execution can consume one approval slot; there is no cross-call grant cache.

`escalationApprovalTtlMs` bounds the automatic review decision's freshness, **not process lifetime or rollback**. Expiry returns to human approval in smart or denies in unattended. Cancellation, changed bindings and late answers do not grant. Side effects of an approved action are not automatically undone.

## Modes and composition

`off` installs nothing. `shadow` preserves native behavior and does not protect execution; configured ordinary command reviews can still run, but sandbox escalation is left to native approval without automatic review or grant. `smart` enforces policy and sends uncertainty to native approval. `unattended` allows eligible reviewed one-shot escalations and otherwise rejects approval requests without human fallback.

**Native `approval: never` still rejects every request before any answerer, including this plugin.** A host using automatic escalation must keep the native approval service at `ask`, even when this plugin is `unattended`. Here `ask` dispatches to the configured answerer, which can be the plugin; it does not require that a human be present. Without a native approval service, widening fails closed.

Ordinary passes compose through `next()`, preserving other policies' denials and prompts. The monotonic guard rejects skipped preflight. Unrelated approvals are not automatically answered. Do not combine this plugin with official experimental Auto, Autogate or another automatic answerer: human fallback assumes the downstream chain is the native human channel, not another permission policy.

Trusted same-process plugins, tool registrations, profile and filesystem/process providers remain in the trusted computing base. Unloading a plugin removes its guards. Rechecking file identity reduces staleness but cannot eliminate OS-level TOCTOU races.

## Reviewer and budgets

Only the selected action and latest direct human text are sent, never tool results, assistant reasoning or the complete transcript. Descriptions, justifications and quoted material are not authorization. Missing, non-text, oversized, unresolved or known-secret-bearing authority cannot auto-approve. Secret detection is heuristic, not a guarantee; configuring a remote reviewer permits sending these bounded inputs, including file content for escalation, to that endpoint.

| Setting | Default | Meaning |
| --- | --- | --- |
| `mode`, `workspaceRoots`, `shellCandidates`, `escalationCandidates` | `shadow`, `[]`, `[]`, `[]` | Explicit enrollment; install alone makes no model requests |
| `endpoint`, `fastModel`, `deepModel` | empty | Fast route required for model review; deep optional |
| `timeoutMs`, `maxInputBytes` | `8000`, `8192` | Per-stage deadline; combined UTF-8 input/prompt cap |
| `fastOutputTokens`, `deepOutputTokens` | `64`, `256` | Actual output caps in HTTP requests |
| `tokenField` | `max_tokens` | Or `max_completion_tokens`, according to endpoint support |
| `fastCallsPerTask`, `deepCallsPerTask` | `20`, `3` | Atomic reservations per latest direct human message |
| `sessionBudgetUnits` | `100000` | Prompt bytes + output cap + 1024 reserved per request |
| `consecutiveDenials`, `totalDenials` | `3`, `20` | Non-allowing review/error fuse per task/session |
| `escalationApprovalTtlMs`, `escalationMaxTimeoutMs` | `30000`, `30000` | Automatic decision freshness; maximum requested Bash timeout |

Strict JSON only: fast `allow/review/deny`, deep `allow/ask/deny`. Truncation, extra fields, tools, missing finish or invalid JSON fail closed. No transport/semantic retries. Choose a model that emits structured output within its cap.

Preflight and escalation share one session ledger, with reservations before I/O and no refunds on failure. A native escalation is reviewed once at approval, not twice. Responses are bounded while streaming; timeout/cancellation discard late allows even when an adapter ignores abort.

Reservation units are not exact billable tokens, currency limits or the main agent's budget. Providers must honor their limits; reported usage is informational with an additional stop check. Counters are in memory: a new human message resets per-task counters but not session limits; reload/restart resets all. The fuse stops additional model reviews, not the entire agent loop.

## Audit and validation

Host logs distinguish `assessment`, native `escalation` outcome and actual `result`. They include reason codes, approval source, duration, available counters and a binding hash, not raw commands, prompts or keys. DSH's approval service separately records its native asked/decided pair. Host retention is operator-managed; no persistent audit database is bundled and result logging cannot undo an executed operation.

```sh
cd plugins/dsh-safe-auto
npm test
npm run build                 # JavaScript syntax checks, not TypeScript checking
npm pack --dry-run
```

Tests include fault/race/scope cases, real loopback HTTP, real Cordis/ToolRuntime, and real ApprovalService plus `approveEscalation`. The native contract test writes only a disposable fixture file outside a fixture workspace, verifies the native audit pair, `never` precedence and non-inheritance on the next call. Its session, filesystem policy and tool body are fixtures: it is **not an OS sandbox or authenticated Web/Headless acceptance test**. Real DSH tests can skip in a dependency-free local checkout but are mandatory in CI.

Follow [ADR-0002's remaining acceptance checklist](docs/ADR-0002.md) before promoting beyond candidate. Live provider/model quality, adversarial false-negative rates, authenticated profiles and supported OS enforcement still need validation. No absolute safety or token-saving percentage is claimed.

## License

Original implementation under [SATA License 2.1](LICENSE). Community projects informed the design; their code was not vendored.
