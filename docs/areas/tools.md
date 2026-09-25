# Tools

中文：模型可见的工具通过 `defineTool` 声明，并用 `ctx.tools.register` 注册。`execute` 只返回 schema 规定的 JSON 值。允许、拒绝和询问写在 `tools/pre-execute` 等事件上，不要写进工具正文。

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

`@deepseek-ai/dsh-tools` provides `ctx.tools`, the registry the agent loop dispatches through. Registering a tool is enough for its schema to enter system-prompt assembly. Models see each permitted tool's name, description, and parameter schema. Per-agent restrictions can narrow that set.

## Where it lives

- First tool: [docs/user/develop/basic/tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/tool.md)
- Authoring reference: [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md)
- Package: [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)
- Subsystem: [docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md)
- Generated names: [docs/tool-catalog.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/tool-catalog.md)

`defineTool` is exported from `@deepseek-ai/dsh-tools`.

## Contract

A plugin injects `tools` and registers inside `apply`. Disposal of the plugin fiber unregisters the tool.

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))
}
```

Required fields are `name`, `description`, `parameters`, and `output.schema` plus `output.render`. Optional fields documented on `DefineToolOptions` include `output.presentationMeta`, `deferLoading`, `timeoutMs`, `isConcurrencySafe`, `execute`, `projectContent`, `finalizeContent`, `presentCall`, and `presentResult`.

Rules from the cookbook:

- `defineTool` validates model arguments before `execute`. Inside `execute`, args match the schema. Hand-check constraints the DSL does not express.
- `execute` returns one canonical JSON value. The registry validates it and passes it to `output.render`. Do not return content blocks from the body.
- A throw or an invalid value becomes an error result. Throw for infrastructure failures. Represent a successful domain outcome in the canonical value.
- Honor `exec.signal`. Identity fields (`callId`, `name`, `arguments`, `agent`, `token`, `signal`) stay immutable.
- `output.presentationMeta(args, value)` derives replayable card JSON. The core persists it on `tool/result`.
- `agent.inject({ content, source: { kind: 'plugin', plugin: '<name>' } })` appends durable context the next model request sees. It does not wake an idle agent.

Policy events, in pipeline order:

| Event or method | Role |
| --- | --- |
| `tools/pre-execute` | Allow, deny, or ask. |
| `ctx.tools.guard(guard)` | Monotonic deny after pre-execute. Later listeners cannot undo it. |
| `tools/execute` | Around-dispatch, including deadlines and retry. |
| `tools/post-execute` | Replace content or value, block, or attach context. |
| `tools/result` | Observe the final outcome. |

Per-agent narrowing uses `ctx.tools.restrict(filter)`, `ctx.tools.get(name, scope)`, and `ctx.tools.schemas(scope)`.

Registry config from the package README: `mode` is `native`, `ptc`, or `both` (default `native`); `maxParallelSubCalls` defaults to 10. Under `ptc` or `both`, visible tools are also exposed as `await tools.<name>(args)` inside the generated `run_code` SDK. An agent can override presentation with `presentAs`.

Background work uses `ctx.jobs.start({ kind, label, owner: exec.agent, run })` after the producer config gates `run_in_background`. A successful background branch returns a typed handle such as `{ kind: 'background', jobId }`. Once `ctx.jobs.start()` publishes the id, cancellation belongs to the job (`job_kill`, owner disposal, service teardown), not to the outer `exec.signal`.

## How a plugin author uses it

- Inject `tools`. Register with `defineTool`. Keep policy in the events above.
- Read `docs/tool-catalog.md` before choosing a name that might already exist.
- For a long-running tool, follow `dsh-tool-bash` and the jobs runtime rather than blocking `execute` until the process exits.
- PTC mode must not parse renderer prose to recover an id. Put the id in the canonical value.

## Sources

- [docs/user/develop/basic/tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/tool.md)
- [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md)
- [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)
- [docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md)
- [docs/tool-catalog.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/tool-catalog.md)
