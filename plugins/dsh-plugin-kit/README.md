# @klarkxy/dsh-plugin-kit

<!-- release-state-note -->

The shared support package for the feature plugins in this repository: shared record types, the plugin-page model menu, host RPC registration, the official-UI style contract, and one native `llm` text call. It is a library, not a DSH bundle — adding it as a dependency gives a feature plugin the pieces it needs, not a new user-visible feature of its own.

[简体中文](docs/README.zh-CN.md)

## What this package is not

- It is a dependency of feature plugins, not a DSH bundle: it declares no `dsh.bundle` and registers no plugin page, so installing it on its own changes nothing the user can see.
- It never starts inference by itself, and makes no model call unless a feature asks for one.
- It does not route models by tier, retry, time out, queue, or record usage. Each feature chooses its model on its own plugin-page row and calls the host `llm` service directly; an empty selection uses the current session model, then the host default chat model.

## Entry points

- `.` — the shared contract types, plus `registerHostRpc`, `callLlmText` and `resolveFeatureModel`.
- `./contracts` — browser-safe types and constants: shared memory/knowledge records, `TaskContract` / `TaskCheckpoint`, `ModelRoute`, `RpcResult`, `CHAT_EVENTS_SLOT`, `projectIdFromCwd`.
- `./host-rpc` — host RPC registration helper and its context type.
- `./model-settings` — host-only model settings contributions. Register the owning plugin's read snapshot and CAS writer with `registerModelSettings` inside `ctx.effect`; the hub discovers active owners using `collectModelSettings`. Each registration has an incarnation ID, so a stale page cannot write into a replacement instance. Reads expose only model fields and revision, with an optional independent model catalog; storage and validation stay with the owner.
- `./client-utils` — browser-safe helpers for native plugin-page seats: `selectedSessionId`, `useNativeSeat`, `useFeatureRefresh`. `react` is an optional peer.
- `./model-settings-client` — browser-safe optional invalidation subscription using `createModelSettingsSubscriber`. Model Hub mounts the native stream descriptor once; pages own their rereads and draft conflicts. Owners call host-side `notifyModelSettingsChanged` after persistence and memory state commit.
- `./model-menu` — plugin-page model select: catalog parsing, empty-route handling, reasoning-effort options.
- `./llm-call` — `callLlmText` and `resolveFeatureModel` as separate exports.
- `./official-ui` — the shared browser-side style contract: `officialUiCss(roots)`, the `--dsw-*` token allowlist, and the focus/elevation helpers.
- `./cli-process` — run a resolved executable without a command shell, with bounded output, serialized line callbacks, deadlines and owned-process-tree cancellation. Streaming mode delivers stdout through `onLine`; it does not also retain stdout.
- `./cli-media` — validate and stage explicit workspace/current-session media, enforce file limits, and publish native image/file attachments. Remote job authority and vendor protocols remain in each plugin; these helpers do not sandbox a vendor CLI's own file access.

Plugins passing their Cordis context to `resolveFeatureModel` must declare `agents`, `sessionProjections` and `agentDefaultModel` in `inject`. These services supply the live session selection and the host default when the plugin has no saved model.

## Plugin UI convention

A feature plugin's browser half composes the host's own UI rather than
restyling controls of its own. Concretely:

- **Controls come from `@deepseek-ai/dsh-client-ui-primitives`** — `Button`,
  `Input`, `Checkbox`, `Switch`, `Tag`, `Pill`, `SegmentedControl`, `Menu`,
  `Modal`, `Tooltip`, `Toast`, `DisclosureRow`, `StateDot`, `PathLabel` and the
  settings-form suite. The host owns their geometry, focus ring, states and
  localisation seams, so a copy of one drifts out of style on the next theme
  change. A native `<select>` is the single exception: the primitives ship none,
  so keep the platform control and give it the contract's `dsh-ui-select` class.
- **Layout, type tiers, cards, fields, banners, empty states and floating
  surfaces come from `./official-ui`**, scoped to the plugin's own root classes
  so two plugins can mount the same class name without styling each other.
- **Colour, radius, elevation and focus are written as the host's own
  `--dsw-*` tokens**, never aliased behind a private palette and never carrying
  a literal fallback: the host publishes light and dark, so a literal pins one of
  them. A stylesheet that reaches for an unknown token fails silently — a border
  disappears, a label inherits the wrong colour — which is why
  `src/official-ui.spec.ts` fails the build when a plugin's styling names a token
  that is not on the allowlist.

`OFFICIAL_THEME_TOKEN_NAMES` is that allowlist. Adding a token to it is a
deliberate act: confirm the name against the host theme first.

## Session ancestry

`isSubagentSession` uses durable session headers, never the author of a user message.
Explicit subagent origin or positive delegation depth wins. A seeded human fork with
zero or omitted depth and ordinary/free classification keeps its parent as history
lineage; incomplete legacy parent metadata still identifies a child session.

## Shared string contracts

`./contracts` is the single source for cross-plugin literals:

- `MODEL_SETTINGS_CHANGES_REMOTE` — the model-settings change stream provided by `@klarkxy/dsh-model-hub`. Subscribers degrade silently when that package is not installed.
- `WEB_PROVIDER_AVAILABILITY_EVENT` and `DshWebManagementDescriptor` — native web providers announce a local availability change and optional display metadata.
- `CREATOR_PRESET_ID` — the host Creator agent-preset id.

## Development

Model settings contributions accept `ModelSettingsText` (`string | { zh: string; en: string }`) for provider titles, field labels/descriptions, follow labels and catalog errors. Built-in display copy should include both languages; user data and third-party literal strings stay unchanged. Model Hub resolves the text at render time when the host locale changes.
