# Sidekick

Sidekick gives the assistant one persistent native partner. The Lead hands it a bounded task, reads the exact result, then either accepts it or asks for a revision. Sessions, tools, permissions, models and execution history stay with DeepSeek Harness.

[简体中文](docs/README.zh-CN.md)

The plugin is **disabled by default**. Turn it on with the **副驾协作** entry in the host's plugin settings; there is no per-conversation switch. Once enabled, existing writing conversations take part too, and child sessions never become new Leads.

## Install

Requires Node.js ≥22 and a compatible DSH `0.1.7-rc.2+` host; the peer dependencies use open lower bounds such as `>=0.1.7-alpha.1`. If your DSH distribution does not bundle this plugin, install it and enable its `fusion` entry from the host plugin configuration.

```sh
npm install @klarkxy/dsh-fusion
```

## How it works

The Lead covers discussion, planning, maintenance and review; the Writer produces an exact candidate. Approving that review does not touch your manuscript: click **预览采用** on the task card to open the candidate preview, then **确认采用** to apply it. Before writing, the host re-checks the original source versions and any unsaved drafts. If the source has changed since, keep the candidate and ask for a new revision against the current text.

Text proposals for both manuscripts and outlines go through the Writer, because the ordinary-folder project model cannot reliably classify file contents. Structural operations and supported maintenance tools stay with the Lead. Candidate text never streams into the manuscript.

In native Web the Sidekick runs on the existing native tool and permission system, and the collaboration card links to its native execution record. A generic task may already have changed files by the time it finishes, so its accepted result is a review status rather than a manuscript application waiting to be applied.

## Model and lifecycle

A pair's Sidekick is a native child session, so its route is pinned when the pair is created and re-checked on every later request. A new pair resolves its route from the plugin-page selection first, then the live session model, then the host default chat model — and when none of those resolve, nothing is configured. Existing pairs keep their pinned route, so changing settings never re-pins a live pair.

## Task lifecycle

At most one task runs in each pair, and revisions and later tasks reuse the same native child session. Stop cancels the participating work; closing a card only closes the view. Disabling the plugin stops the work it owns and keeps its records and candidates.

A process restart does not replay uncertain messages or file writes. Inspect the task card and the native history before you explicitly resume or notify the Lead again. If an application was interrupted, Fusion compares the persisted write intent with the current file. It never retries an uncertain write on its own and never overwrites later author edits.

The task card shows the current state, the candidate preview, a **停止协作任务** button and a resume entry point. When a report is saved but its notification was never acknowledged, you can re-notify the Lead to continue the review instead of restarting the Writer.

## Plugin page settings

`Settings → Plugins → Sidekick` carries a **Sidekick model** row. It is optional, and it applies only when a new pair is created: a saved route becomes that pair's pinned model, while an empty selection follows the live session model and then the host default chat model. Existing pairs keep the route selected when they were created, so editing this row never re-pins a live pair. A saved route selects a model; it is not evidence of connectivity.

## Agent tools

The Lead gets five tools, and the Sidekick gets one reporting tool. Tool identity is bound at registration and re-checked on every call, so no other agent can borrow them.

Lead tools:

- `fusion_delegate`: delegate one bounded task to the same persistent Sidekick. In a writing session the Writer authors exact prose against the versioned target supplied by the Lead; a generic task keeps its ordinary execution tools, and the Lead must explicitly cancel before taking over.
- `fusion_read`: read the saved exact Sidekick candidate and its hash; review this content without rewriting it.
- `fusion_review`: review an exact candidate by id and hash. `accept` is a model review only — whether to adopt it stays with the author; `revise` requires concrete feedback; `reject` ends the task.
- `fusion_decide`: resolve a Sidekick decision request, or explicitly resume an interrupted task with feedback, reusing its persistent session.
- `fusion_cancel`: cancel the owned Sidekick task before an explicit takeover. This preserves unrelated child sessions and does not undo files that are already applied.

Sidekick tool:

- `fusion_report`: report the exact candidate or a decision request for the current task under a unique reportId. It never writes the manuscript, and it never regenerates or resends a report after acknowledgement.

## Package use

This package depends on no application-private package. The native Web adapter reuses the existing conversation and child-session navigation.

Entry points: the default export registers the plugin; `./contracts` exports the browser-safe public records (RPC channel, tool names, task and candidate types); `./host-contracts` defines the host-side `fusionWriting` port; `./client` is the browser client bundle.

The host supplies a narrow `fusionWriting` service, and only Host code receives that application port. Browser commands carry the stored candidate identity and the author's actions — never replacement candidate content and never a new destination.

## Development checks

- `pnpm --filter @klarkxy/dsh-fusion typecheck`: type checking.
- `pnpm --filter @klarkxy/dsh-fusion test`: deterministic service and native-boundary tests.
- `pnpm --filter @klarkxy/dsh-fusion build`: the production client bundle.

These deterministic integration tests establish the wiring and the lifecycle behavior. They do not measure live model writing quality, and they do not measure provider cache savings.
