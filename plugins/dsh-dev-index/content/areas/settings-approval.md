# Settings, approval, and permission presets

中文：业务插件读自己的 Config，不存在文档化的 `ctx.settings.get` / `set`。设置表单通过 `ctx.settings` 的 `describe`、`update`、`replace` 和 `mutate` 改 profile 补丁。审批问的是「这一次动作能否继续」，权限预设把 sandbox 和 approval 绑在一起。

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

Settings are schema-derived forms for volatile configuration. Edits persist by rewriting profile Cordis patches. A form namespace is the local id of a uniquely addressed entry in the active profile.

Approval asks whether one specific action may proceed. Permission presets bundle a sandbox policy and an approval policy so a user can switch them together.

## Where it lives

- Settings subsystem: [docs/subsystems/settings.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/settings.md)
- Settings package: [packages/settings/settings/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/settings/settings/README.md)
- Approval: [docs/subsystems/approval.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/approval.md)
- Permission presets: [packages/interaction/permission-presets/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/interaction/permission-presets/README.md)

## Contract

Business consumers read `.get()` on their own Config references. The settings service is not a generic key-value store. `ctx.settings` (`SettingsForms`) exposes `configure`, `prepareDocument`, `describe`, `update`, `replace`, and `mutate`. Writes carry `expectedRevision` from `describe`. The remote mirror is `ctx.settingsController` / `ctx.remote.settings`.

`@deepseek-ai/dsh-user-approval` provides `ctx.approval`. `ctx.approval.request(req)` issues an `ApprovalRequestId` and runs the `approval/request` waterfall. `ApprovalOutcome` is `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`. The outcome fails closed except `allowed-once`. `ApprovalPolicy` is `'ask' | 'never'`, read with `effectivePolicy(session)` and changed with `setApprovalPolicy`.

`@deepseek-ai/dsh-permission-presets` config includes `presets` and `defaultPreset`. The shipped default presets include `workspace-write` and `danger-full-access`. Each preset bundles `sandbox` and `approval`. Users switch with `/permission`, which records a `permission/preset` event.

Tool policy should use `tools/pre-execute` (allow, deny, or ask) and call into approval when a human must decide. Do not hide a prompt inside `execute`.

## How a plugin author uses it

- Add a user-facing setting by exporting `Config` on the plugin row, then letting the settings service render that schema. A new settings card in the official client follows [docs/cookbook/adding-a-settings-card.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-settings-card.md).
- Request approval through `ctx.approval.request`. Treat every outcome other than `allowed-once` as a refusal.
- Do not invent a second permission mode. Compose a permission preset when the product needs a named sandbox plus approval pair.
- `danger-full-access` is an existing preset name. Requiring it for a management tool is a host policy, not something a plugin should bypass.

## Sources

- [docs/subsystems/settings.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/settings.md)
- [packages/settings/settings/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/settings/settings/README.md)
- [docs/subsystems/approval.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/approval.md)
- [packages/interaction/permission-presets/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/interaction/permission-presets/README.md)
- [docs/cookbook/adding-a-settings-card.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-settings-card.md)
