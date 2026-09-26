# LLM providers

[中文](../zh/areas/llm-providers.md)

Every model call goes through `ctx.llm`. A new provider implements `LlmAdapter` and calls `ctx.llm.registerAdapter`. Do not request the provider's HTTP API directly from a plugin.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

`@deepseek-ai/dsh-llm` is the provider-neutral streaming service. Adapters translate a provider's wire format into the shared `StreamChunk` vocabulary. The service itself has no configuration and no provider wire code. Retry is a separate package, `@deepseek-ai/dsh-llm-retry`. Callers must keep model-visible input reconstructable from the session log. Loop-built requests arrive deep-frozen.

## Where it lives

- Adapter tutorial: [docs/user/develop/practice/llm-adapter.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/llm-adapter.md)
- Group map: [packages/llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/llm/README.md)
- Service: [packages/llm/llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/llm/llm/README.md)

Shipped adapters to read before writing one: `packages/llm/llm-deepseek/` and `packages/llm/llm-pi-ai/`.

## Contract

An adapter plugin injects `llm`, exports a Schemastery `Config`, and registers during `apply`:

```ts
export const name = 'my-llm'
export const inject = ['llm']

export function apply(ctx, config) {
  ctx.llm.registerAdapter(config.providers, adapter)
}
```

`registerAdapter` also accepts a fixed name list such as `['my-provider']`. The adapter extends `LlmAdapter` and implements `async *stream(options)`. Optional methods are `resolveModel(provider, model, signal?)` and `listModels()`. The GUI only offers models that `listModels()` advertises. The base implementation returns an empty list and therefore offers no GUI models.

Stream chunks use `block-start`, `text-delta`, `tool-call-delta`, `block-end`, `usage`, and `finish`. Streams always end with a terminal result. Failures use stable `LlmError` codes.

Each `stream` call is one provider attempt. The agent loop selects `provider` and `model` per request. Consumers such as session-title generation and compaction call `ctx.llm.stream` with an explicit route. They do not import an adapter.

Related context keys in the group table include `ctx.deepseekLlmApiExtensions` and `ctx.tokenMeter`. Adapters themselves register on `ctx.llm`.

## How a plugin author uses it

- To call a model from a plugin, inject `llm` and pass `provider` plus `model` into `ctx.llm.stream`. Do not open a second HTTP client for a provider the host already mounts.
- To add a provider, ship an adapter package plus a bundle row that configures its credentials. The tutorial's example uses keys such as `apiKey`, `providers`, and `apiKeyEnv`. Read the adapter you are copying before adding fields.
- Keep secrets in Loader `!!js` expressions or the credential seam, not in chat and not committed in a patch default.
- Implement `listModels()` if the Web model picker should show the provider.

## Sources

- [docs/user/develop/practice/llm-adapter.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/llm-adapter.md)
- [packages/llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/llm/README.md)
- [packages/llm/llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/llm/llm/README.md)
