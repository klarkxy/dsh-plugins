# Implement or replace a provider

[中文](../zh/tasks/implement-or-replace-a-provider.md)

Use this task when a capability seam needs a backend, or a shipped backend must be swapped. Depend on the service definition. Do not copy the seam, and do not import a concrete provider just to call it.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`). If the target version differs, treat this page as unverified and check the pinned source.

## When to use it

You are adding a model route, a subagent runtime, a compaction backend, or another swappable implementation. If you only need to call a capability the host already mounts, inject that service and stop. A provider package is for a new implementation.

## How to choose

[packages/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/README.md) states the dependency rule: extension plugins depend on Service Definitions, never concrete providers. [docs/capability-seams.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/capability-seams.md) names the package that declares the service, known implementation packages, and direct consumers. Read that graph for the seam you are entering, then the package README. Do not invent a second registry.

[docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md) maps model adapters to an `LlmAdapter` subclass via `registerAdapter`. The same table maps sub-agent delegation to `ctx.subagents` and compaction to `ctx.compaction`.

| Seam | Register or replace | Why |
| --- | --- | --- |
| Model route | Implement `LlmAdapter.stream` and call `ctx.llm.registerAdapter` | [docs/user/develop/practice/llm-adapter.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/llm-adapter.md) says the first argument is the provider route list. Callers use `ctx.llm.stream`. They do not open a second HTTP client. Throw `LlmError` with a stable code when a field cannot be honored. Implement `listModels()` if the picker should show models. |
| Subagent runtime | `ctx.subagents.registerProvider` | [docs/subsystems/subagent.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/subagent.md) splits definition, providers, and the model-facing consumer. `provider.name` is unique in the layer. Point the tool row at that name. See [Compaction, subagents, jobs, and catalogs](../areas/other-seams.md). |
| Compaction | Implement `compactIfNeeded`, `compactNow`, and `compactRegion` on the compaction seam | [packages/compaction/compaction/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/compaction/compaction/README.md) says the definition performs no condensation by itself. Do not delete session events to summarize. Measurement is `ctx.tokenMeter`. |
| Session title | `ctx.sessionTitle.register` once | A second `register` throws. Disable the shipped provider row and insert yours. Restate config if you override the service row, because a patch replaces `config` wholesale. See [Sessions and titles](../areas/sessions-titles.md). |

Replacing a shipped provider means a profile patch that disables or overrides that row by stable id, plus your package. It does not mean editing the provider's installed sources. Inside DSH, `plugin_manager` installs the bundle. Confirm the row with `cordis_inspect_query`, not by assuming the patch text is live.

Secrets stay in Loader `!!js` expressions or the credential seam, not in a committed patch default. The adapter tutorial's example reads `apiKey` that way.

## Read together

Area pages: [Orientation](../areas/orientation.md), [LLM providers](../areas/llm-providers.md), [Compaction, subagents, jobs, and catalogs](../areas/other-seams.md), [Sessions and titles](../areas/sessions-titles.md).

Official files at the pinned commit:

- [packages/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/README.md)
- [docs/capability-seams.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/capability-seams.md)
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)
- [docs/user/develop/practice/llm-adapter.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/llm-adapter.md)
- [docs/subsystems/subagent.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/subagent.md)
- [packages/compaction/compaction/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/compaction/compaction/README.md)

## Pre-checks

- Compare the target DSH version with `meta.json`.
- Find the seam on `docs/capability-seams.md` at the pinned commit, or at the target commit if versions differ. If the graph does not name the service, stop and say the seam is unverified.
- Inside DSH, query `Service` for the registry method you will call (`registerAdapter`, `registerProvider`, or `register`). Outside DSH, read the `.d.ts` under the installed package or the pinned `lib/types`, and mark the call unverified.
- Decide whether the seam allows one provider or many. Title registration is single. LLM adapters and subagent providers are registries.

## Verification checklist

- A consumer that injects the service definition, not your concrete package, can call the new route or provider name.
- The shipped provider you meant to replace is disabled or overridden. `dump-config` shows one winning row. `overridden` means a higher-priority layer still wins.
- For an adapter, a stream ends with `finish`, unsupported fields throw `LlmError` instead of being dropped, and `listModels()` matches what the picker shows.
- For compaction, history is still a log. A compact does not delete events to fake a summary.
- For a title provider, a second `register` throws, and titles stay out of model input.
- Unload removes your registration. The previous provider is not left half-replaced.
- State which rows you ran and which remain unverified.

## Common failures

- Importing `@deepseek-ai/dsh-llm-deepseek` from a feature plugin to "just call the model". Call `ctx.llm`.
- Registering a second title provider without disabling the shipped row. The second `register` throws.
- Editing the installed provider instead of shipping a bundle row.
- Copying `compact` by splicing the session log.
- Putting `apiKey` in a committed patch default.
- Assuming Context7 examples on master match this pinned commit. They track master.

## Runnable example

Runnable example: not yet (planned). This page has no copy-paste package and no tests. A later round adds a runnable task pack.

## Sources

- [packages/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/README.md)
- [docs/capability-seams.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/capability-seams.md)
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)
- [docs/user/develop/practice/llm-adapter.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/llm-adapter.md)
- [docs/subsystems/subagent.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/subagent.md)
- [packages/compaction/compaction/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/compaction/compaction/README.md)
