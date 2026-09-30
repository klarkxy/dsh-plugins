# @klarkxy/dsh-plugin-kit

Shared support package for klarkxy DSH feature plugins: shared record types, the plugin-page model menu, host RPC registration, the official-UI style contract, and one native `llm` text call.

It does not route models by tier, retry, time out, queue, or record usage. Each feature chooses its model on its own plugin-page row and calls the host `llm` service directly. An empty selection uses the current session model, then the host default chat model. This package never starts inference by itself.

## Entry points

- `.` — the Cordis plugin entry (`name`, `inject`, `apply`), `registerHostRpc`, `callLlmText`, `resolveFeatureModel`, and the shared contract types.
- `./contracts` — browser-safe types and constants: shared memory/knowledge records, `TaskContract` / `TaskCheckpoint`, `ModelRoute`, `RpcResult`, `CHAT_EVENTS_SLOT`, `projectIdFromCwd`.
- `./host-rpc` — host RPC registration helper and its context type.
- `./client-utils` — browser-safe React-optional helpers for native plugin-page seats.
- `./model-menu` — plugin-page model select: catalog parsing, empty-route handling, reasoning-effort options.
- `./llm-call` — `callLlmText` and `resolveFeatureModel` as separate exports.
- `./official-ui` — the shared browser-side style contract: `officialUiCss(roots)`, the `--dsw-*` token allowlist, and the focus/elevation helpers.

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


`AiPolicy`, `PurposeSpec`, `ModelTarget`, `AiServices`, `AiFeatureScope`, `AuxiliaryRequest`, `AuxiliaryResult` and `UsageReceipt` are retained under `./contracts` marked `@deprecated`. They described the retired shared model-routing service; features must not use them for new calls.

This package is a dependency of feature plugins, not a DSH bundle; it declares no `dsh.bundle` and registers no plugin page.

## Development

```sh
pnpm --filter @klarkxy/dsh-plugin-kit typecheck
pnpm --filter @klarkxy/dsh-plugin-kit test
pnpm --filter @klarkxy/dsh-plugin-kit build
```
