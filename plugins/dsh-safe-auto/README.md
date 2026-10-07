# Safe Auto (release candidate)

Automatic review of native sandbox escalation requests. When a real `write`/`edit`/`bash`/`pwsh` call asks to widen its sandbox beyond Workspace Write, an independent reviewer model vets that one call — except a `bash` call the built-in static proof can show is read-only, which is granted without a model. A pass continues automatically; other review results offer an exact-call confirmation in the current session, with 60 seconds to approve once or reject. No response means rejection. The plugin never switches the standing session to Full Access.

[简体中文](README.zh-CN.md) · [One-shot escalation](docs/ADR-0002.md) · [Reviewer routing](docs/ADR-0003.md) · [Authorization and evidence](docs/ADR-0004.md) · [Timed human confirmation](docs/ADR-0005.md) · [Static shell proof](docs/ADR-0006.md)

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

The bundle inserts the `dsh-safe-auto` and `dsh-safe-auto-ui` profile rows. Safe Auto then appears as a fourth option in the composer's permission menu, next to the native presets — pick **Safe Auto** there to enable it for the current session, and pick any native preset to disable it again. Nothing is automatic until you do: no session inherits activation, and restart, a permission change or uninstall revokes it. The plugin page only holds reviewer configuration, safety notes and the read-only budget limits, grouped into tabs.

> The composer permission control is a replacement slot: while Safe Auto is installed, the plugin renders that control itself (native presets included) so the option can appear in the menu. If the host redesigns this control, the plugin's copy may lag behind until updated.

## How it works

1. A native tool call asks for `sandbox_permissions` widening (`workspace-write` or `danger-full-access`).
2. The plugin binds the live execution — agent, callId, signal, exact arguments, cwd, sandbox policy and the ordered direct-human instructions, including later restrictions and revocations.
3. A fully literal `bash` command is granted without evidence or a model only when every invocation matches an exact positive grammar: case-sensitive POSIX program names, supported flags and values, input-only operand counts, safe redirects and bounded environment prefixes. Unknown options, abbreviations, clusters, output operands and assignment-only statements continue to review. Ordinary reads such as `ls -la`, `cat input | jq .name`, `grep -rn pattern src`, `find . -name "*.md"` and `ps aux` retain this fast path; `pwsh` does not.
4. The exact request is reviewed once. For shell calls, bounded workspace package definitions and referenced local scripts provide untrusted evidence; their canonical paths and content are rechecked before granting.
5. A reviewed pass returns `allowed-once`. For an otherwise eligible action, model denial, uncertainty, failure or budget exhaustion opens a timed confirmation. The dialog shows the exact operation, requested permission, reviewer opinion and countdown. Explicit approval grants this call after another binding/evidence check; rejection or expiry returns `rejected`. Closing the dialog rejects. No downstream approval answerer is consulted.

Native prohibitions, structural refusals, changed evidence, cancellation and invalidated requests cannot be overridden. Timed confirmation requires the UI row and an authenticated browser client; without them, or with the timeout set to zero, the existing non-grant path remains. Headless sessions do not gain an automatic fallback.

The reviewer sees the bounded action, chronological direct-human instructions and local evidence, with no main-agent prompt, private reasoning or tools. Authorization is judged by substance: necessary local installation, build and test steps may implement a requested development task without the user naming every command. Earlier authority remains visible after a progress question or “continue”; later restrictions still apply. Automatic allowance requires low/medium risk, medium/high authorization and bounded side effects.

Human text is retained without lossy selection, up to 12 KiB. Sensitive text, nontext constraints or overflow prevent automatic review rather than silently dropping restrictions; an otherwise valid action can receive fresh explicit confirmation through the timed UI without sending that history to the model. Evidence is capped at eight files, 6 KiB per file and 12 KiB overall. Protected, escaped, sensitive or unreadable files are withheld with explicit omission markers. Evidence coverage is partial: dependencies, imported code and workspace-wide scripts are not exhaustively inspected. Material remaining uncertainty prevents automatic permission.

## Configuration

Everything is optional; with no configuration the reviewer follows the current conversation's model. Edit the profile row's `config` and reload:

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. `false` mounts nothing. |
| `provider` / `model` | *(follow conversation)* | Fixed reviewer route, configured as a pair using your DSH model IDs. |
| `reasoningEffort` | *(model default)* | Advertised reasoning effort of the fixed route. |
| `reviewerPrompt` | *(none)* | Extra review constraints (≤4096 chars); may only restrict, never widen. |
| `timeoutMs` | `30000` | Per-review deadline. |
| `humanApprovalTimeoutMs` | `60000` | Human confirmation window, separate from model review; `0` disables it. Maximum 300000 ms; profile-owned. |
| `maxInputBytes` | `32768` | Combined UTF-8 prompt/input cap; existing explicit values are retained. |
| `outputTokens` | `256` | Reviewer output cap. Reasoning models may need more. |
| `maxReviewsPerTask` | `20` | Review calls per direct user task. |
| `consecutiveDenials` | `3` | Consecutive explicit denials before the breaker opens. Uncertainty and failures reset the streak but still consume review reservations. |
| `staticReadonly` | `true` | Grant provably read-only `bash` escalations without a model call. `false` sends everything to the reviewer. |

Unknown keys fail validation rather than being ignored. Reviewer model, effort and prompt can also be set per deployment on the plugin page; those saved values override the profile route but never the budgets.

## The reviewer model

**Default: follow the conversation.** Leave `provider`/`model` empty. Each review resolves the provider/model from the requesting session's accepted request header, reusing DSH's configured credentials — no extra API key. Only the model route is inherited, not history, prompt, tools or budgets.

**Fixed model.** Set `provider` and `model` together to pin a reviewer that stays put when the conversation switches models. A missing or invalid route rejects instead of falling back silently.

## Policy

| Request | Outcome |
| --- | --- |
| Bound single escalation of `write`/`edit`/`bash`/`pwsh`, reviewer passes | `allowed-once`, this call only |
| Bound `bash` escalation proven read-only by the strict static parse | `allowed-once`, no model call, no budget consumed |
| Protected credentials/security files, secrets, dangerous programs (anywhere in a fully parsed command) | Hard denial before review |
| Model denial (including risk opinions), uncertainty or review failure for an eligible action | Timed human confirmation; no grant without explicit approval |
| Unknown tools, subagents, nested or unbound requests | No automatic grant |
| Human rejection or confirmation expiry | Rejected; fresh execution needs fresh review |
| Changed evidence, invalidated grants, audit failure or cancellation | No grant; terminal feedback |

Native `approval: never` still rejects before any answerer. Never stack this with another automatic approval answerer.

## Migrating from 0.1.x

- Profile keys `mode`, `workspaceRoots`, `shellCandidates`, `escalationCandidates`, `endpoint`, `apiKeyEnv`, `tokenField`, `fast*`/`deep*` and the budget fuses `sessionBudgetUnits`/`totalDenials` were removed; a profile still carrying them fails validation. The equivalent of 0.1.x `approvalReview: true` plus a UI-enabled session is now the only behavior.
- `fastProvider`/`fastModel`/`fastReasoningEffort` became `provider`/`model`/`reasoningEffort`; `fastOutputTokens` became `outputTokens`; `fastCallsPerTask` became `maxReviewsPerTask`.
- Settings saved by the 0.1.x panel keep loading (retired keys are stripped), but the reviewer route falls back to following the conversation — re-pick a model on the plugin page if you had a fixed one.

## Boundaries and limits

- **Not an audited boundary.** The reviewer is a language model and can be wrong, especially in adversarial contexts. Keep the native sandbox, isolation and backups you already rely on.
- **Static proof assumes operator-trusted PATH and runtimes.** It checks the original command text, not installed binary identity, shell functions or ambient runtime integrity. Explicit executable paths, `.exe`/`.cmd` suffixes, case variants, executable pager/config environment prefixes and persistent assignments do not qualify. Parser or grammar defects can produce incorrect proofs; this is not a runtime attestation or an absolute safety guarantee. An unproven command returns to reviewer/manual confirmation, not a new hard refusal.
- **Quoting does not bypass hard refusals.** Literal argv, environment and redirect values are decoded before the protected-path/secret checks, including adjacent quote fragments. These checks also apply outside the static path and cannot be overridden by reviewer or manual confirmation. Unquoted wildcard fragments still invalidate proof even next to quoted text. Bash `/dev/tcp` and `/dev/udp` file redirects return to review, including quoted and numbered-fd input redirects; ordinary file input, fd merges and `/dev/null` output retain their existing rules.
- **Git is not read-only by subcommand name.** Bare `git status`, worktree diffs, `git ls-files --modified` and other content-checking worktree operations remain under review because refresh/conversion can execute configured clean/process filters. Supported object/index reads require the original `--no-pager --no-optional-locks --no-lazy-fetch -c core.fsmonitor=false`; cached/staged diff also requires `--no-ext-diff --no-textconv --ignore-submodules=all`. History reads additionally need `--no-show-signature` and a supported fixed format such as `--oneline`. The plugin never prepends controls or rewrites argv. Exact `git version` and `git --no-pager config --get user.name` are narrow independent reads; transport helpers, editors, filters and mixed config mutations do not qualify. Ordinary `sort` can spill to temporary files, so only its check mode qualifies.
- **Dedicated confirmation channel.** Pinned DSH 0.2.0-rc.2 approval and question waterfalls accept automatic answerers. Manual confirmation instead uses the plugin's authenticated browser HTTP endpoints and unpredictable single-use request IDs. Fetch metadata and host origin/authentication checks protect the browser channel against cross-site requests; they do not prove physical human action. Authenticated clients, their transport and same-process plugins remain trusted. No model tool is registered for approval.
- **Server-owned expiry.** The window starts when a pending request is published. The server uses a monotonic deadline and atomically accepts the first valid answer; duplicate, late or cross-session answers fail. Disabling, changing settings, unloading or cancelling invalidates pending requests. Requests are in memory only, so restarts do not restore them. Both direct browser requests and the authenticated DSH desktop carrier are supported; incompatible request metadata is rejected.
- **Foreign native approvals remain native.** Blueprint order and Classmates model approvals continue to downstream answerers when no Safe Auto-owned execution context exists. Requests in an owned context, including mismatches, stale/claimed requests, and unbound impersonation of `bash`/`pwsh`/`write`/`edit`, remain fail-closed.
- **Coverage stops at native single-call escalation.** Only `write`/`edit`/`bash`/`pwsh` widening from `workspace-write` is reviewed. Other tools, MCP, remote execution, subagent calls and standing permission changes stay outside the automatic envelope.
- **Evidence is checked, execution is not atomic.** Evidence paths, versions and SHA-256 digests are revalidated before granting, but files can still change between approval and execution. Other same-process plugins remain trusted; unloading removes the guards. Keep external isolation with restricted credentials and egress.
- **No guarantee is claimed.** There is no fail-open option, no durable audit database and no claim of absolute safety or savings.

## Verification

Run `npm test`, `npm run build` and `npm pack --dry-run` in this package, plus repository `pnpm check`. Tests cover routing, concurrent sessions, native streams, caps, stale decisions, model service removal, execution binding, and real Cordis/ToolRuntime/ApprovalService/LlmRuntime contracts. CI requires installed DSH dependencies; offline source-only runs may skip the native contracts. If the Windows sandbox blocks the test runner's subprocess pipes, run each test file separately with `node --test --test-isolation=none test/<file>.test.js`.

The native contract tests use controlled adapters and fixture sessions/tools. They prove runtime integration, not live model accuracy, OS isolation or authenticated Web/Headless acceptance; those remain in [ADR-0002's checklist](docs/ADR-0002.md). Logs separate assessment, outcome and final result without raw commands, prompts or keys; host retention is operator-managed.

## License

Original implementation under [SATA License 2.1](LICENSE). Community designs informed the work; their code was not vendored.
