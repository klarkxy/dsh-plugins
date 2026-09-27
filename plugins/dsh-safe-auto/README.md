# DSH Safe Auto (release candidate)

[中文](README.zh-CN.md) · [Design and verified contracts](docs/ADR-0001.md)

A conservative preflight policy for DeepSeek Harness. It reuses the native tool loop, sandbox and human approval channel. It **never returns `allowed-once` for sandbox escalation**, never switches the session to Full Access, and never lets a model enlarge an operator's review envelope.

**This is a local POSIX/native-tool preview, not an independently audited security boundary.** Start with `shadow`. Keep native sandbox providers, manual approval, isolated environments and backups. DSH's `workspace-write` vocabulary governs file effects, not network egress or secret reads. A plugin cannot turn it into a network sandbox.

## What runs automatically

| Action | Policy in `smart` |
| --- | --- |
| `read`, `read_image`, `write`, `edit` on ordinary files in an enrolled canonical workspace | Deterministic pass to the existing policy; zero reviewer calls |
| Protected credentials, agent/security configuration, selected dangerous shell programs | Hard denial |
| An exact operator-enrolled simple `shell`/`bash` command | Fast reviewer; `review` may invoke the optional deep reviewer |
| Unknown tools, PowerShell, compound shell, symlinks, outside paths, escalation | Native human approval, never LLM-only approval |
| Reviewer timeout, malformed JSON, cancellation, exhausted budget | No automatic grant |

`grep`, `glob`, `run_code`/PTC, MCP and remote execution have **no automatic exemption** in this release. PTC deployments will require human approval for the transport. Do not select unattended mode for an unsupported workflow. Subagents may use the same deterministic file checks, but cannot obtain model-reviewed command grants from delegated text.

`npm test`, builds and dependency installation can execute repository-controlled code. They are **not** built-in safe commands. An exact candidate is a deliberate operator capability grant, not evidence that a script's future contents are safe. The reviewer can narrow that grant, not expand it. Avoid enrolling commands in untrusted/mutable repositories; review changes to their executable inputs.

## Install and configure

From a checkout, first install the workspace dependencies and run the checks. Add the **local package directory** to a disposable DSH profile:

```sh
pnpm install --frozen-lockfile
pnpm --filter @klarkxy/dsh-safe-auto test
# Run from the repository root; use an absolute path when installing elsewhere.
dsh plugin --profile web add ./plugins/dsh-safe-auto
```

The PR does not itself publish an npm version. After publication, use an explicit `@klarkxy/dsh-safe-auto@<version>` rather than assuming a dist-tag exists.

The bundle inserts a `dsh-safe-auto` profile row. Configure that row through the profile patch mechanism (see the DSH profile documentation); for example the resulting row is:

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

Supply the key through that environment variable, not the profile or tool arguments. `endpoint` is the complete **OpenAI-compatible Chat Completions URL**; a compatible local lapp gateway can be used. HTTPS is required except loopback HTTP. Redirects, URL credentials, query strings and fragments are rejected. Native DSH provider routing is deferred; there is no automatic fallback to the main agent's provider.

The selected workspace must match the session cwd and resolved sandbox root exactly. Select native **Workspace Write** separately. This plugin does not alter that setting. Configuration is immutable for one plugin instance and validated through Standard Schema v1; edits require a plugin reload. A custom/generated settings form is not included.

## Modes and composition

`off` installs no policy. `shadow` records hypothetical assessments and preserves native behavior; **it does not protect execution** and can still call a configured reviewer for enrolled commands. `smart` enforces denials and sends uncertainty to native approval. `unattended` turns uncertainty into denial and rejects approval requests without asking a human. Native `approval: never` remains authoritative in every mode.

Low-risk passes call `next()` instead of returning an unconditional grant, preserving downstream denials and prompts. A final monotonic guard rechecks paths and sandbox state and rejects calls that skipped our preflight. Per-execution opaque tokens, not visible call IDs, isolate pending decisions. There is no cross-call approval cache.

Do **not** stack this with official experimental Auto, Autogate or another auto-approval answerer. They can answer native prompts with different semantics. Trusted same-process plugins, the filesystem/subprocess providers, and the operator's profile remain in the trusted computing base. Unloading a plugin removes its guards; it is not an OS enforcement mechanism.

## Reviewer and budgets

The reviewer receives only the exact command/action and the latest direct human text, never tool results, assistant reasoning or a whole transcript. Non-text, missing, oversized or known-secret-bearing authority cannot auto-approve. Inputs are refused, not truncated to hide a dangerous suffix. Secret detection is heuristic: ordinary source files and arbitrary user text may still contain undiscovered secrets. Configuring an external reviewer is consent to send these bounded inputs to that endpoint; inspect the endpoint and avoid sensitive prompts.

| Setting | Default | Meaning |
| --- | --- | --- |
| `mode`, `workspaceRoots`, `shellCandidates` | `shadow`, `[]`, `[]` | Explicit enrollment; install alone spends no reviewer tokens |
| `endpoint`, `fastModel`, `deepModel` | empty | No external reviewer by default; deep is optional |
| `timeoutMs`, `maxInputBytes` | `8000`, `8192` | Per-stage deadline and combined UTF-8 prompt/input limit |
| `fastOutputTokens`, `deepOutputTokens` | `64`, `256` | Output limit actually sent to the endpoint |
| `tokenField` | `max_tokens` | Alternatively `max_completion_tokens`; choose what the provider supports |
| `fastCallsPerTask`, `deepCallsPerTask` | `20`, `3` | Atomic reservations per latest direct user message |
| `sessionBudgetUnits` | `100000` | Conservative reservation units: prompt bytes + output cap + 1024 per request |
| `consecutiveDenials`, `totalDenials` | `3`, `20` | Fuse on non-allowing reviews/errors, per task and per session |

Output must be exactly one JSON object with only `decision`. Fast: `allow / review / deny`; deep: `allow / ask / deny`. Truncation, tool calls, extra fields, missing completion or invalid JSON fail closed. There are no semantic or transport retries. Prefer a fast model that can reliably emit structured output within the chosen cap.

Reservations occur before network I/O, are never refunded on errors, and are shared by concurrent calls in the same session. Response bodies are bounded while streaming. Cancellation and timeout discard late answers even when a transport ignores its abort signal. **Reservation units are not actual billed tokens or a currency guarantee.** Provider usage is recorded when available; the provider must honor its output limit. Main-agent tokens are outside this plugin's budget.

Counters are in memory for the plugin instance. A new direct user message resets per-task counters, not the session reservation/total-denial limit. Reload/restart resets all counters; durable budgets are deferred. The fuse blocks more model review, not the entire DSH agent loop; low-risk file work can continue.

## Audit and validation

Host logger records `phase: assessment` (proposed policy verdict) separately from `phase: result` (actual tool success/error). Events contain tool/call IDs, reason codes, duration and available budget counters, not raw command, authority, endpoint, API keys or model error bodies. Configure host log retention yourself. No durable audit database/UI is bundled; final-result observer failures cannot undo an already executed tool.

```sh
cd plugins/dsh-safe-auto
npm test
npm run build                  # JavaScript syntax checks, not TypeScript checking
npm pack --dry-run
```

Unit tests cover policy, path/link edge cases, strict verdicts, budgets, timeouts, cancellations, scope, cleanup and hook composition. The real Cordis + ToolRuntime contract test uses the workspace's pinned DSH dependencies via `dsh-dev-index`. It can skip on a dependency-free offline checkout but **must run in CI**. Its sandbox provider/tool bodies are fixtures: this does not test OS sandbox enforcement, authenticated Web/Headless profiles or live model quality.

Before calling this production-ready, run the live-profile checklist in the ADR. No token-saving percentage or classifier false-negative rate is claimed.

## License

Original implementation under the repository's [SATA License 2.1](LICENSE). Community projects informed the design; their source was not copied into this package.
