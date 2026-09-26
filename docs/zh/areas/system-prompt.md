# 系统提示与请求上下文

[English](../../areas/system-prompt.md)

模型看到的系统提示由 `ctx.systemPrompt` 按顺序拼装。插件用 `section`、`variable`、`context` 和 `tools` 贡献内容。同名注册在 agent scope 上会盖住全局项。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

`@deepseek-ai/dsh-system-prompt` 提供 `ctx.systemPrompt`。它为每一个模型步骤拼装一份有序的系统提示，以及可见的工具 schema。通过 `agent.ctx` 注册的贡献只影响那个 agent，并盖住同名的全局贡献。

`packages/context` 是另一族：工作区说明、`@file` 引用、会话引用、时间和 tmux。那些插件喂给请求上下文。它们不是拼装器。

## 它在哪里

- 拼装器：[packages/core/system-prompt/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/system-prompt/README.md)
- 类型与 Cordis 表面：[docs/subsystems/system-prompt.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/system-prompt.md)
- 请求上下文插件：[packages/context/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/context/README.md)

为一个 preset 设置前缀和后缀，通常用 persona section。见 [Agent 预设与 Persona](presets-persona.md)。

## 约定

拼装器配置：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `includeHarnessIdentity` | `true` | 固定开场白 `You are an AI agent powered by DeepSeek Harness.`，顺序为 −1000。 |
| `includeRuntimeContext` | `true` | 包含有序的动态运行时上下文。 |
| `personaPrefix` | `''` | 全局 persona 前缀，顺序为 `0`。 |
| `personaSuffix` | `''` | 全局 `deployment:persona-suffix`，顺序为 `10200`。 |
| `toolOrder` | — | 显式的工具顺序，其中恰好有一个 `'<unlisted-tools>'` 余项。 |

`toolOrder` 列表如果不是恰好一个余项，或者有重复，加载时就会失败。列出的名字没有已注册工具时，每一次 `assemble()` 都会被拒绝。

贡献：

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

- `section` 的文本是静态的，或 `(context) => string`。section 按 `order` 升序拼接，然后按码元名字排序。`interpolate: false` 让 `{{…}}` 保持字面量。其他 section 会插值变量。`complete: true` 的 section 成为精确的完整提示。多于一个生效的 complete section 会导致拼装失败。
- `variable` 提供 `{{name}}`。循环提供 `model` 和 `cwd`。未解析的变量会导致拼装失败。
- `context` 贡献会变成持久用户角色快照的动态事实。
- `tools` 为一轮拼装贡献模型可见的 `ToolSchema` 集合。`ToolRuntime` 会自行注册，所以大多数工具不需要手工接线。
- 仓库拥有的位置使用 `getSectionOrder(name)` 和 `getContextOrder(name)`。外部贡献可以使用任何有限的顺序值。

类型文档里写明的 persona section 名字包括 `deployment:persona-prefix` 和 `deployment:persona-suffix`。

## 插件作者怎么用

- 每个 agent 都应该看到的短说明，在宿主上用 `section`。只有一个 agent 应该看到时，放在 `agent.ctx` 上或 preset 内部。
- 除非那个插件拥有整份提示，否则不要设置 `complete: true`。另一个 complete section 也生效时，这一步会失败。
- 不要分叉拼装器。注册一份贡献。
- 长步骤放进技能。系统提示的 section 在每一步上，不适合放索引。

## 来源

- [packages/core/system-prompt/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/system-prompt/README.md)
- [docs/subsystems/system-prompt.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/system-prompt.md)
- [packages/context/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/context/README.md)
