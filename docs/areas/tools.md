# Tools

[中文](../zh/areas/tools.md)

Model-visible tools are declared with `defineTool` and registered with `ctx.tools.register`. `execute` returns only the JSON value required by the schema. Allow, deny, cancel, and ask belong on `tools/pre-execute`. An order-independent denial is `ctx.tools.guard`, which is synchronous and cannot ask. Do not hide policy inside the tool body.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

`@deepseek-ai/dsh-tools` provides `ctx.tools`, the registry the agent loop dispatches through. Registering a tool is enough for its schema to enter system-prompt assembly. Models see each permitted tool's name, description, and parameter schema. Per-agent restrictions can narrow that set.

## Where it lives

- First tool: [docs/user/develop/basic/tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/tool.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool))
- Authoring reference: [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool))
- Package: [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)
- Subsystem: [docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools))
- Generated names: [docs/tool-catalog.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/tool-catalog.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/tool-catalog))

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
| `tools/pre-execute` | Allow, deny, cancel, or ask. `ask` continues only after approval returns `allowed-once`; anything else denies. |
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

- [docs/user/develop/basic/tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/tool.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool))
- [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool))
- [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)
- [docs/subsystems/tools.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/tools.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools))
- [docs/tool-catalog.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/tool-catalog.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/tool-catalog))
