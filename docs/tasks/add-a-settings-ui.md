# Add a settings UI

[中文](../zh/tasks/add-a-settings-ui.md)

Use this task when a person must change plugin configuration and the change must survive in the profile patch. Approval of one tool call is a different task.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`). If the target version differs, treat this page as unverified and check the pinned source.

## When to use it

The value is configuration, not session history and not a one-shot permission. [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md) says tunable values belong in the plugin's `Config` so users change them in `cordis.patch.yml`. The user's patch layer survives upgrades.

## How to choose

[docs/cookbook/adding-a-settings-card.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-settings-card.md) is the form path. [docs/subsystems/settings.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/settings.md) says business consumers read `.get()` on their own Config references. The settings service is not a generic key-value store. There is no documented `ctx.settings.get` / `set`. Writes go through `describe`, `update`, `replace`, and `mutate`, with `expectedRevision` from `describe`.

| Need | Mechanism | Why this one |
| --- | --- | --- |
| A value the plugin reads while it runs | `Config` field, `Schema` `.volatile()` when it must change without reloading the instance | The cookbook's example reads `config.retries.get()` on `loader/volatile-update`. Instance identity stays. |
| The built-in Plugins page should edit that schema | Export `Config` and give the row a unique profile entry id | The settings service projects volatile fields. You do not draw the stock card yourself. |
| A control on someone else's plugin page | `ctx.slots.inject` into `plugins.detail.actions`, `plugins.detail.badge`, or `plugins.detail.section` | The cookbook passes the page `subject` and says to return null when you have nothing to say. |
| A custom page that edits the same config | `form.state` and `form.mutate(operations, expectedRevision)` from the Plugins page owner | The Host validates the full Config. A stale revision is refused. |
| One action may proceed | `ctx.approval.request` | That is [Settings, approval, and permission presets](../areas/settings-approval.md), not a stored setting. |
| A panel that is not a settings form | [Add a UI panel](add-a-ui-panel.md) | Choose the slot before writing the view. |

`role('secret')` keeps a value out of form responses. Use credential references for values the credentials domain manages. A patch replaces `config` wholesale, so an override must restate every field it still needs. See [Bundles, profiles, and patches](../areas/bundle-profile-patch.md).

The browser half rides `dsh.client` on the row whose specifier is the bare package name. The cookbook says a subpath row never carries that half. A page that must outlive other rows ships as its own package.

## Read together

Area pages: [Settings, approval, and permission presets](../areas/settings-approval.md), [Plugin module](../areas/plugin-module.md), [UI slots](../areas/ui-slots.md), [Bundles, profiles, and patches](../areas/bundle-profile-patch.md).

Official files at the pinned commit:

- [docs/cookbook/adding-a-settings-card.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-settings-card.md)
- [docs/subsystems/settings.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/settings.md)
- [packages/settings/settings/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/settings/settings/README.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)

## Pre-checks

- Compare the target DSH version with `meta.json`.
- Inside DSH, query `Config.listConfigs` for the package `name` and read the live schema before adding a field. Outside DSH, read the type declaration and mark the live schema unverified.
- Confirm the profile mounts the settings service. The cookbook says the base bundle mounts settings and config-editor. A custom profile may not.
- Decide whether the field is volatile. A non-volatile edit hot-replaces the plugin.

## Verification checklist

- Saving a valid value updates the profile patch and the next consumer operation sees `.get()`.
- Plugin instance identity is unchanged for a volatile edit.
- Restart restores the saved value.
- An invalid value is rejected, and neither the file nor the live value changes.
- A stale `expectedRevision` is refused.
- A secret or credential does not appear in the form response.
- Unloading the root package row removes the browser half. A subpath row was never the carrier.
- State which rows you ran and which remain unverified.

## Common failures

- Inventing `ctx.settings.get` / `set` and writing a side file. The profile patch is the stored config.
- Overriding a row's `config` with only the new key. The rest of the config disappears.
- Mounting the client half on a subpath export, then wondering why the page never attaches.
- Putting an approval prompt in the settings form. Approval is one action and fails closed except `allowed-once`.
- Reading another plugin's DOM to place a badge. Use `plugins.detail.badge` and the `subject` argument.

## Runnable example

Runnable example: not yet (planned). This page has no copy-paste package and no tests. A later round adds a runnable task pack.

## Sources

- [docs/cookbook/adding-a-settings-card.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-settings-card.md)
- [docs/subsystems/settings.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/settings.md)
- [packages/settings/settings/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/settings/settings/README.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
