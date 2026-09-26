# UI slots

[中文](../zh/areas/ui-slots.md)

The web UI composes React through `ctx.slots`. Register into a slot declared elsewhere with `ctx.slots.inject`, and do not import another feature plugin's component. The client entry is `dsh.client` in `package.json` and the `./client` export.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

Slots are the Web client's typed React composition system. `@deepseek-ai/dsh-client-ui-slots` is the React-free registry. `@deepseek-ai/dsh-client-ui-renderer` binds observables and renders the tree. A feature plugin contributes UI through `ctx.slots.register()` and does not import another feature plugin's component.

## Where it lives

- Subsystem: [docs/subsystems/slots.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/slots.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/slots))
- Registry package: [packages/client/ui-slots/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-slots/README.md)
- Authoring notes: [packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md)
- Decoration template: [packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/package.json](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/package.json)

## Contract

A client module injects `slots`. Registering into a slot another package declared uses `ctx.slots.inject`, so the contribution tracks the owner's lifetime:

```ts
export const inject = ['slots']

export function apply(ctx) {
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'review',
      order: 100,
    }, HeaderAction))
}
```

`root` is the only built-in declaration. `ui-renderer` calls `ctx.slots.renderSlot('root', {})`. Registering into an undeclared slot, or declaring a child another entry already owns, fails during activation.

Cardinality and scope are fixed by the slot declaration:

| Axis | Value | Meaning |
| --- | --- | --- |
| cardinality | `single` | One cell. The active priority winner renders. |
| cardinality | `list` | Cells have a required `id` and are ordered by `order`, then registration order. |
| cardinality | `keyed` | The owner dispatches an `entryKey`. |
| cardinality | `chain` | Each entry supplies `select(owner)`. The first non-null result renders. |
| scope | `root` | One root-scoped instance. |
| scope | `session-maybe` | Renderable without a Session provider. Session values are optional. |
| scope | `session` | Requires a surrounding Session provider. |

`priority` is a shadowing rank for `single`, `list`, and `keyed`, and an election order for `chain`. Lower values run or render first. Reusing a shipped cell id replaces that cell. Additive UI should pick a fresh list `id`.

Examples of slot keys named in the subsystem introduction: `plugins.bundle.config`, `plugins.bundle.activation`, and `conversation.input.activity`. Discover the live tree with `Slots.listSubTree` rather than guessing props.

A UI bundle's `package.json` adds `dsh.client` (`platform`, `immediately`, `inject`) and a `./client` export beside `dsh.bundle.patch`. The browser artifact registers a lazy factory whose id equals the package name. React comes from the browser module table. Non-baseline runtime imports go in `dsh.client.external`. The host `index.js` can export an empty `apply` when the feature is client-only; the patch still inserts one row named after the package.

Keep factories free of side effects. Register styles, timers, and listeners inside `apply` with `ctx.effect` or `ctx.on`. Do not replace the app root or append a second application to `document.body`. Do not import `@deepseek-ai/dsh-client-ui-primitives` from an installed third-party UI plugin; the cordis-plugin-development skill tells authors to use theme tokens and the slot's own props.

## How a plugin author uses it

- Copy `templates/decoration/` and change the slot only after `Slots.listSubTree` shows that slot's props.
- Prefer a slot that already allocates space, such as `conversation.composer.dock` when it is declared, over `shell.overlay`.
- Host services stay in the host entry. The client file only renders.
- Verify in the connected page. Slot registration alone does not establish what the user sees.

## Sources

- [docs/subsystems/slots.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/slots.md) ([official site](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/slots))
- [packages/client/ui-slots/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-slots/README.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/package.json](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/package.json)
