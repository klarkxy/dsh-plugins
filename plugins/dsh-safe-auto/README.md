# Safe Auto (release candidate)

Automatic review of native sandbox escalation requests. When a real `write`/`edit`/`bash`/`pwsh` call asks to widen its sandbox beyond Workspace Write, an independent reviewer model vets that one call; only a pass returns `allowed-once`. Uncertainty, errors, timeouts and exhausted budgets are **rejected, never delegated**. The plugin never switches the standing session to Full Access, and never lets a model enlarge what you configured.

[简体中文](README.zh-CN.md) · [One-shot escalation](docs/ADR-0002.md) · [Reviewer routing](docs/ADR-0003.md)

> **0.2.0 is a breaking simplification.** The 0.1.x exact-rule preflight, workspace/shell/escalation candidate lists, `shadow`/`smart`/`unattended` modes, the deep review stage and the HTTP endpoint were removed. See [Migrating from 0.1.x](#migrating-from-01x).

## Install and enable

```sh
dsh plugin --profile <profile> add @klarkxy/dsh-safe-auto
```

From a checked source checkout instead:

```sh
pnpm install --frozen-lockfile
pnpm --filter @klarkxy/dsh-safe-auto test
dsh plugin --profile <profile> add ./plugins/dsh-safe-auto
```

The bundle inserts the `dsh-safe-auto` and `dsh-safe-auto-ui` profile rows. Then open the plugin page, pick a live root session and click **Enable**. Nothing is automatic until you do: no session inherits activation, and restart, a permission change or uninstall revokes it.

## How it works

1. A native tool call asks for `sandbox_permissions` widening (`workspace-write` or `danger-full-access`).
2. The plugin binds the live execution — agent, callId, signal, exact arguments, cwd, sandbox policy and the latest direct human message.
3. The approval request is matched against that binding and reviewed once by the reviewer model with a fixed safety prompt.
4. `allow` → `allowed-once` for that one call. Anything else → `rejected`. An explicit denial is never retried or softened.

The reviewer sees only the bounded action and the direct human intent — never the transcript, main-agent prompt or tools. Structured verdicts separate risk, authorization and scope: automatic allowance requires low/medium risk, medium/high direct authorization and bounded one-call side effects. High/critical risk, uncertainty, malformed verdicts, errors and timeouts reject.

## Configuration

Everything is optional; with no configuration the reviewer follows the current conversation's model. Edit the profile row's `config` and reload:

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. `false` mounts nothing. |
| `provider` / `model` | *(follow conversation)* | Fixed reviewer route, configured as a pair using your DSH model IDs. |
| `reasoningEffort` | *(model default)* | Advertised reasoning effort of the fixed route. |
| `reviewerPrompt` | *(none)* | Extra review constraints (≤4096 chars); may only restrict, never widen. |
| `timeoutMs` | `30000` | Per-review deadline. |
| `maxInputBytes` | `8192` | Combined UTF-8 prompt/input cap. |
| `outputTokens` | `256` | Reviewer output cap. Reasoning models may need more. |
| `maxReviewsPerTask` | `20` | Review calls per direct user task. |
| `consecutiveDenials` | `3` | Non-allowing results per task before the breaker opens. |

Unknown keys fail validation rather than being ignored. Reviewer model, effort and prompt can also be set per deployment on the plugin page; those saved values override the profile route but never the budgets.

## The reviewer model

**Default: follow the conversation.** Leave `provider`/`model` empty. Each review resolves the provider/model from the requesting session's accepted request header, reusing DSH's configured credentials — no extra API key. Only the model route is inherited, not history, prompt, tools or budgets.

**Fixed model.** Set `provider` and `model` together to pin a reviewer that stays put when the conversation switches models. A missing or invalid route rejects instead of falling back silently.

## Policy

| Request | Outcome |
| --- | --- |
| Bound single escalation of `write`/`edit`/`bash`/`pwsh`, reviewer passes | `allowed-once`, this call only |
| Protected credentials/security files, secrets, dangerous programs | Hard denial before review |
| High/critical risk, uncertainty, missing evidence | Rejected |
| Unknown tools, subagents, nested or unbound requests | Rejected |
| Errors, timeouts, exhausted budget, invalidated grants | Rejected |
| Explicit model denial | Rejected, no retry |

Native `approval: never` still rejects before any answerer. Never stack this with another automatic approval answerer.

## Migrating from 0.1.x

- Profile keys `mode`, `workspaceRoots`, `shellCandidates`, `escalationCandidates`, `endpoint`, `apiKeyEnv`, `tokenField`, `fast*`/`deep*` and the budget fuses `sessionBudgetUnits`/`totalDenials` were removed; a profile still carrying them fails validation. The equivalent of 0.1.x `approvalReview: true` plus a UI-enabled session is now the only behavior.
- `fastProvider`/`fastModel`/`fastReasoningEffort` became `provider`/`model`/`reasoningEffort`; `fastOutputTokens` became `outputTokens`; `fastCallsPerTask` became `maxReviewsPerTask`.
- Settings saved by the 0.1.x panel keep loading (retired keys are stripped), but the reviewer route falls back to following the conversation — re-pick a model on the plugin page if you had a fixed one.

## Boundaries and limits

- **Not an audited boundary.** The reviewer is a language model and can be wrong, especially in adversarial contexts. Keep the native sandbox, isolation and backups you already rely on.
- **No human fallback.** Uncertainty and reviewer failure reject outright instead of delegating: the approval waterfall is not a verified human-only channel, and another automatic answerer is not a human. Retrying the action asks again.
- **Coverage stops at native single-call escalation.** Only `write`/`edit`/`bash`/`pwsh` widening from `workspace-write` is reviewed. Other tools, MCP, remote execution, subagent calls and standing permission changes stay outside the automatic envelope.
- **Enrolled content is not pinned and other plugins stay trusted.** Approved commands can run repository-controlled code; trusted same-process plugins remain trusted, and unloading the plugin removes its guards. Use external isolation with restricted credentials and egress for real confinement.
- **No guarantee is claimed.** There is no fail-open option, no durable audit database and no claim of absolute safety or savings.

## Verification

Run `npm test`, `npm run build` and `npm pack --dry-run` in this package, plus repository `pnpm check`. Tests cover routing, concurrent sessions, native streams, caps, stale decisions, model service removal, execution binding, and real Cordis/ToolRuntime/ApprovalService/LlmRuntime contracts. CI requires installed DSH dependencies; offline source-only runs may skip the native contracts. If the Windows sandbox blocks the test runner's subprocess pipes, run each test file separately with `node --test --test-isolation=none test/<file>.test.js`.

The native contract tests use controlled adapters and fixture sessions/tools. They prove runtime integration, not live model accuracy, OS isolation or authenticated Web/Headless acceptance; those remain in [ADR-0002's checklist](docs/ADR-0002.md). Logs separate assessment, outcome and final result without raw commands, prompts or keys; host retention is operator-managed.

## License

Original implementation under [SATA License 2.1](LICENSE). Community designs informed the work; their code was not vendored.
