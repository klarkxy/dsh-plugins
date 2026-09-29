# @klarkxy/dsh-plugin-kit

Shared support package for klarkxy DSH feature plugins: shared record types, the plugin-page model menu, host RPC registration, and one native `llm` text call.

It does not route models by tier, retry, time out, queue, or record usage. Each feature chooses its model on its own plugin-page row and calls the host `llm` service directly. An empty selection uses the current session model, then the host default chat model. This package never starts inference by itself.

## Entry points

- `.` — the Cordis plugin entry (`name`, `inject`, `apply`), `registerHostRpc`, `callLlmText`, `resolveFeatureModel`, and the shared contract types.
- `./contracts` — browser-safe types and constants: shared memory/knowledge records, `TaskContract` / `TaskCheckpoint`, `ModelRoute`, `RpcResult`, `CHAT_EVENTS_SLOT`, `projectIdFromCwd`.
- `./host-rpc` — host RPC registration helper and its context type.
- `./client-utils` — browser-safe React-optional helpers for native plugin-page seats.
- `./model-menu` — plugin-page model select: catalog parsing, empty-route handling, reasoning-effort options.
- `./llm-call` — `callLlmText` and `resolveFeatureModel` as separate exports.

`AiPolicy`, `PurposeSpec`, `ModelTarget`, `AiServices`, `AiFeatureScope`, `AuxiliaryRequest`, `AuxiliaryResult` and `UsageReceipt` are retained under `./contracts` marked `@deprecated`. They described the retired shared model-routing service; features must not use them for new calls.

This package is a dependency of feature plugins, not a DSH bundle; it declares no `dsh.bundle` and registers no plugin page.

## Development

```sh
pnpm --filter @klarkxy/dsh-plugin-kit typecheck
pnpm --filter @klarkxy/dsh-plugin-kit test
pnpm --filter @klarkxy/dsh-plugin-kit build
```
