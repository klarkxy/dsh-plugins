# Sessions and titles

中文：会话是只追加的 `SessionEvent` 日志，消息历史从日志派生。标题服务是 `ctx.sessionTitle`。同一进程只能注册一个自动标题 provider；第二个 `register` 会抛错。

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

A `Session` is an append-only log of typed `SessionEvent`s. That log is the source of truth for an agent's interaction history. The LLM message history is derived from the log, not stored separately. The in-memory store is `ctx.sessions` (`SessionStore`) from `@deepseek-ai/dsh-session`. Durability is a separate persistence seam.

Titles are durable log events (`session/title`). They are client-visible and never enter model input. `@deepseek-ai/dsh-session-title` owns scheduling and acceptance. One optional provider owns generation.

## Where it lives

- Session log: [docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md)
- Persistence seam: [docs/subsystems/persistence.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/persistence.md)
- Title subsystem: [docs/subsystems/session-title.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session-title.md)
- Title service: [packages/session/session-title/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-title/README.md)
- Shipped providers: [packages/session/session-title-first-prompt-llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-title-first-prompt-llm/README.md) and [packages/session/session-title-all-prompts-llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-title-all-prompts-llm/README.md)
- Shipped rows: [packages/bundle/base/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/base/cordis.patch.yml)

## Contract

Title service methods:

- `ctx.sessionTitle.get(session)` reads the latest folded title.
- `ctx.sessionTitle.rename(session, title)` pins a user title.
- `ctx.sessionTitle.refresh(session, signal?)` explicitly regenerates.
- `ctx.sessionTitle.register(provider)` registers the single provider and returns a disposer. A second registration throws.

Provider shape:

```ts
ctx.sessionTitle.register({
  id, // SessionTitleProviderId
  automatic, // 'first-prompt' | 'all-prompts'
  generate(request) {
    return { title, messageSeqs, model }
  },
})
```

`automatic: 'first-prompt'` generates from the opening eligible prompt. `automatic: 'all-prompts'` may revise after later eligible prompts. Only text blocks from human `user/message` events are eligible. A user rename pins the session: later user messages do not schedule an automatic revision. `refresh()` is the deliberate unpin path.

The service has no library defaults. All three limits are required:

| Field | Meaning |
| --- | --- |
| `fallbackMaxWords` | Maximum whitespace-delimited words in the deterministic fallback. |
| `fallbackMaxBytes` | Maximum UTF-8 bytes in the fallback. Must not exceed `maxTitleBytes`. |
| `maxTitleBytes` | Maximum UTF-8 bytes accepted from any source. |

The base bundle ships:

```yaml
- id: session-title
  name: '@deepseek-ai/dsh-session-title'
  config:
    fallbackMaxWords: 5
    fallbackMaxBytes: 40
    maxTitleBytes: 80
- id: session-title-llm
  name: '@deepseek-ai/dsh-session-title-first-prompt-llm'
  config:
    targetWords: 5
    targetCjkCharacters: 10
    maxInputBytes: 4096
    maxOutputTokens: 64
    timeoutMs: 60000
```

The alternate package is `@deepseek-ai/dsh-session-title-all-prompts-llm`. Shared LLM generation policy lives in `@deepseek-ai/dsh-session-title-llm` (see the service README's link to that package). A provider starts only after a marked loop-built request's route matches the logged `request/header`. Newer revisions supersede and abort older work. Automatic failures warn and keep the latest title. Automatic work never delays the main agent response.

`foldSessionTitle(events)` is the pure fold. Forks inherit title events in their seed unchanged.

## How a plugin author uses it

- Inject `sessionTitle`. Call `register` once.
- Disable the shipped `session-title-llm` row in your patch and insert your own row. Because a patch replaces `config` wholesale, restate every limit you still need if you override `session-title` itself.
- Do not write the title by appending a raw log event unless you are implementing the service. Go through `register`, `rename`, or `refresh`.
- Return `title`, the `messageSeqs` you actually used, and `model` provenance when the provider called a model.
- Titles must stay out of model input. Do not also copy them into a system-prompt section.

## Sources

- [docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md)
- [docs/subsystems/persistence.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/persistence.md)
- [docs/subsystems/session-title.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session-title.md)
- [packages/session/session-title/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-title/README.md)
- [packages/session/session-title-first-prompt-llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-title-first-prompt-llm/README.md)
- [packages/session/session-title-all-prompts-llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-title-all-prompts-llm/README.md)
- [packages/bundle/base/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/base/cordis.patch.yml)
