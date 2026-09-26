# Plugin module

[中文](../zh/areas/plugin-module.md)

A plugin is a module that exports `apply`. Required services are listed in `inject`. Tunable parameters use a same-named Schemastery `Config`. Resources registered through `ctx` are cleaned up automatically on unload.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

A Harness plugin is a module the Cordis loader calls when its dependencies are ready. The usual form is a named function plugin:

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools is ready here.
}
```

`inject` lists required service keys. The framework waits for every one of them before `apply` runs. If a required service disappears, the plugin unloads and loads again when the service returns.

Two other forms exist. An object plugin is `{ name, inject, apply }`. A class plugin is `export default class X extends Service` with `static inject` and `super(ctx, 'serviceKey')` in the constructor. Use the class form when other plugins must call your service. Function form is enough for most contributions.

## Where it lives

- First plugin, three forms, `ctx.effect`: [docs/user/develop/basic/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/index.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/))
- `Config` schema: [docs/user/develop/basic/config.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/config.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/config))
- Fiber states and cleanup: [docs/user/develop/framework/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/framework/index.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/))
- Providing a service: [docs/user/develop/framework/service.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/framework/service.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/service))
- Events: [docs/user/develop/framework/events.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/framework/events.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/events))
- Loader `config` and `disabled` interpolation: [docs/cordis-primer.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cordis-primer.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-primer))

## Contract

Fiber states are `PENDING`, `LOADING`, `ACTIVE`, `FAILED`, `UNLOADING`, and `DISPOSED`.

Registrations made through `ctx` are undone on unload, including `ctx.on`, `ctx.tools.register`, `ctx.llm.registerAdapter`, and `ctx.effect(() => cleanup)`. During unload, disposer invocation starts in reverse registration order, but multiple async disposers run concurrently. Put order-dependent cleanup in one disposer returned from a single `ctx.effect()`.

`ctx.plugin(child)` creates a child Fiber that unloads with its parent.

Event dispatch methods are `ctx.emit`, `ctx.bail`, `ctx.serial`, and `ctx.waterfall`. A waterfall listener receives `next` and must call it unless it intentionally short-circuits.

Configuration is a Schemastery schema exported as `Config`, paired with a TypeScript `Config` type of the same name. Put defaults on the schema fields (`Schema.string().default('Hello')`). Do not export a plain object as `Config`; Cordis requires the Standard Schema interface. Invalid configuration fails the load. A configuration edit hot-replaces the plugin: the old instance unloads and a new one loads.

Anything two deployments may want to set differently must be a configuration field. The test is whether `cordis.yml` can change the value without a code edit.

A service class augments Cordis context so callers see a typed key:

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}
```

The constructor name passed to `super(ctx, 'metrics')` is that key.

## How a plugin author uses it

- Export `name` so logs and inventory can identify the plugin.
- Declare `inject` for every `ctx.*` service `apply` uses. Do not reach for a service that is not injected.
- Export `Config` when the patch row has a `config` object. Query `Config.listConfigs` on a running host before writing a row you have not already read.
- Register tools, skills, listeners, and timers inside `apply` (or the service constructor) so unload removes them.
- For a network socket or other external resource, return its closer from `ctx.effect`.

Display text for Plugin Manager cards is not part of `apply`. See [Bundles, profiles, and patches](bundle-profile-patch.md) for `locale/en.json`.

## Sources

- [docs/user/develop/basic/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/index.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/))
- [docs/user/develop/basic/config.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/config.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/config))
- [docs/user/develop/framework/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/framework/index.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/))
- [docs/user/develop/framework/service.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/framework/service.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/service))
- [docs/user/develop/framework/events.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/framework/events.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/events))
- [docs/cordis-primer.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cordis-primer.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-primer))
