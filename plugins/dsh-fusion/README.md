# Sidekick

Sidekick pairs the current assistant with one persistent native partner. The Lead delegates a bounded task, reads the exact result, and accepts it or requests a revision. DeepSeek Harness remains responsible for sessions, tools, permissions, models and execution history.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-fusion/docs/README.zh-CN.md)

The plugin is **disabled by default**. Enable **副驾协作** in the host's plugin settings. There is no additional conversation switch. Existing writing conversations participate when enabled; child sessions do not become new Leads.

## Install

Requires Node.js ≥22 and a compatible DSH `0.1.7-rc.2+` host (peer dependencies use open lower bounds such as `>=0.1.7-alpha.1`). If your DSH distribution does not bundle this plugin, install it and enable its `fusion` entry through the host plugin configuration.

```sh
npm install @klarkxy/dsh-fusion
```

The Lead handles discussion, planning, maintenance and review. The Writer produces an exact candidate. Review approval does not change your manuscript: click **预览采用** on the task card to open the candidate preview, then **确认采用** to apply it. Host checks the original source versions and any unsaved drafts before writing. If the source changed, preserve the candidate and request a new revision against the current text.

Text proposals for both manuscripts and outlines go through the Writer because the ordinary-folder project model does not reliably classify file contents. Structural operations and supported maintenance tools remain with the Lead. Candidate text never streams into the manuscript.

In native Web, the Sidekick uses the existing native tool and permission system. The collaboration card links to its native execution record. Generic tasks can already have changed files during execution; their accepted result is a review status, not a pending manuscript application.

## Model and lifecycle

A pair's Sidekick is a native child session, so its route is pinned when the pair is created and checked on every later request. A new pair resolves its route from the plugin-page selection, then the live session model and the host default chat model; nothing is configured when no route can be resolved. Existing pairs keep their pinned route, so changing settings never repins a live pair.

## Plugin page settings

`Settings → Plugins → Sidekick` carries a **Sidekick model** row. It is optional and only applies when a new pair is created: a saved route becomes that pair's pinned model, while an empty selection follows the live session model and then the host default chat model. Existing pairs keep the route selected when they were created, so editing this row never repins a live pair. A saved route selects a model but is not evidence of connectivity.

At most one task runs in each pair. Revisions and later tasks reuse the same native child session. Stop cancels participating work; closing a card only closes the view. Disabling the plugin stops owned work and preserves its records and candidates.

A process restart does not replay uncertain messages or file writes. Inspect the task card and native history before explicitly resuming or notifying the Lead again. If application was interrupted, Fusion compares the persisted write intent with the current file. It never retries an uncertain write automatically or overwrites later author edits.

## Agent tools

The Lead receives five tools; the Sidekick receives one reporting tool. Tool identity is bound at registration and checked again on every call, so another agent cannot borrow them.

Lead tools:

- `fusion_delegate`: delegate one bounded task to the same persistent Sidekick. In writing sessions the Writer authors exact prose against a versioned target supplied by the Lead; generic tasks retain ordinary execution tools, and the Lead explicitly cancels before takeover.
- `fusion_read`: read the saved exact Sidekick candidate and its hash; review this content without rewriting it.
- `fusion_review`: review an exact candidate by id and hash. `accept` is model review only — the author still decides manuscript adoption; `revise` requires concrete feedback; `reject` ends the task.
- `fusion_decide`: resolve a Sidekick decision request, or explicitly resume an interrupted task with feedback, reusing its persistent session.
- `fusion_cancel`: cancel the owned Sidekick task before explicit takeover. This preserves unrelated child sessions and does not undo files already applied.

Sidekick tool:

- `fusion_report`: report the exact candidate or a decision request for the current task under a unique reportId. It never writes the manuscript and never regenerates or resends a report after acknowledgement.

## Package use

This package has no dependency on application-private packages. The native Web adapter uses the existing conversation and child-session navigation.

Entry points: the default export registers the plugin; `./contracts` exports the browser-safe public records (RPC channel, tool names, task and candidate types); `./host-contracts` defines the host-side `fusionWriting` port; `./client` is the browser client bundle.

The host supplies a narrow `fusionWriting` service. Only Host code receives that application port; browser commands supply stored candidate identity and author actions, never replacement candidate content or a new destination.

## Development checks

- `pnpm test:fusion`: deterministic service/native boundary tests and type checking.
- `pnpm exec vitest run packages/dsh-editor-workbench/src/fusion-host.spec.ts`: Host file authority and version checks.
- `pnpm test:e2e:fusion`: desktop and standalone Web hosts on the isolated real native runtime with a local deterministic model fixture, after workspace build and desktop runtime preparation.

Deterministic integration tests establish wiring and lifecycle behavior. They do not measure live model writing quality or provider cache savings.
