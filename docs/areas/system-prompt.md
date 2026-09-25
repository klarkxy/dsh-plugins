# System prompt and request context

中文：模型看到的系统提示由 `ctx.systemPrompt` 按顺序拼装。插件用 `section`、`variable`、`context` 和 `tools` 贡献内容。同名注册在 agent scope 上会盖住全局项。

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

`@deepseek-ai/dsh-system-prompt` provides `ctx.systemPrompt`. It assembles one ordered system prompt and the visible tool schemas for each model step. Contributions registered through `agent.ctx` affect that agent alone and shadow a same-named global contribution.

`packages/context` is a different family: workspace instructions, `@file` references, session references, time, and tmux. Those plugins feed request context. They are not the assembler.

## Where it lives

- Assembler: [packages/core/system-prompt/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/system-prompt/README.md)
- Types and Cordis surface: [docs/subsystems/system-prompt.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/system-prompt.md)
- Request-context plugins: [packages/context/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/context/README.md)

Persona sections are the usual way to set prefix and suffix for one preset. See [Agent presets and persona](presets-persona.md).

## Contract

Assembler config:

| Field | Default | Meaning |
| --- | --- | --- |
| `includeHarnessIdentity` | `true` | Fixed opener `You are an AI agent powered by DeepSeek Harness.` at order −1000. |
| `includeRuntimeContext` | `true` | Include ordered dynamic runtime context. |
| `personaPrefix` | `''` | Global persona prefix at order `0`. |
| `personaSuffix` | `''` | Global `deployment:persona-suffix` at order `10200`. |
| `toolOrder` | — | Explicit tool order containing exactly one `'<unlisted-tools>'` rest entry. |

A `toolOrder` list without exactly one rest entry, or with duplicates, fails at load. A listed name with no registered tool rejects every `assemble()`.

Contributions:

```text
ctx.systemPrompt.section({
  name: 'tool:bash',
  order: 100,
  text: 'Prefer bash for file and process operations.',
})

ctx.systemPrompt.variable('cwd', ({ agent }) => agent?.session.header.cwd)

ctx.systemPrompt.context({ name: 'clock', order: 100, text: '...' })

ctx.systemPrompt.tools(provider)
```

- `section` text is static or `(context) => string`. Sections concatenate by ascending `order`, then by code-unit name. `interpolate: false` keeps `{{…}}` literal. Other sections interpolate variables. A `complete: true` section becomes the exact complete prompt. More than one effective complete section fails assembly.
- `variable` supplies `{{name}}`. The loop provides `model` and `cwd`. Unresolved variables fail assembly.
- `context` contributes dynamic facts that become durable user-role snapshots.
- `tools` contributes the model-visible `ToolSchema` set for one assembly. `ToolRuntime` registers itself, so most tools need no manual wiring.
- Repository-owned placement uses `getSectionOrder(name)` and `getContextOrder(name)`. External contributions may use any finite order.

Persona section names documented with the types include `deployment:persona-prefix` and `deployment:persona-suffix`.

## How a plugin author uses it

- Add a short instruction with `section` on the host when every agent should see it, or on `agent.ctx` / inside a preset when only one agent should.
- Do not set `complete: true` unless that plugin owns the entire prompt. It fails the step when another complete section is also effective.
- Do not fork the assembler. Register a contribution.
- Keep long procedures in a skill. A system-prompt section is on every step and is the wrong place for an index.

## Sources

- [packages/core/system-prompt/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/system-prompt/README.md)
- [docs/subsystems/system-prompt.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/system-prompt.md)
- [packages/context/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/context/README.md)
