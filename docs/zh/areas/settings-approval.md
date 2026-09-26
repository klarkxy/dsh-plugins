# 设置、审批与权限预设

[English](../../areas/settings-approval.md)

业务插件读自己的 Config，不存在文档化的 `ctx.settings.get` / `set`。设置表单通过 `ctx.settings` 的 `describe`、`update`、`replace` 和 `mutate` 改 profile 补丁。审批问的是「这一次动作能否继续」，权限预设把 sandbox 和 approval 绑在一起。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

设置是从模式派生的表单，用来编辑易变配置。编辑通过重写 profile 的 Cordis 补丁来持久化。表单命名空间是活动 profile 里一条唯一寻址条目的本地 id。

审批问的是某一次具体动作能否继续。权限预设把一份沙箱策略和一份审批策略捆在一起，让用户可以一起切换。

## 它在哪里

- 设置子系统：[docs/subsystems/settings.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/settings.md)
- 设置包：[packages/settings/settings/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/settings/settings/README.md)
- 审批：[docs/subsystems/approval.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/approval.md)
- 权限预设：[packages/interaction/permission-presets/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/interaction/permission-presets/README.md)

## 约定

业务消费者在自己的 Config 引用上读 `.get()`。设置服务不是通用的键值存储。`ctx.settings`（`SettingsForms`）暴露 `configure`、`prepareDocument`、`describe`、`update`、`replace` 和 `mutate`。写入携带 `describe` 给出的 `expectedRevision`。远程镜像是 `ctx.settingsController` / `ctx.remote.settings`。

`@deepseek-ai/dsh-user-approval` 提供 `ctx.approval`。`ctx.approval.request(req)` 发出一个 `ApprovalRequestId`，并运行 `approval/request` waterfall。`ApprovalOutcome` 是 `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`。除 `allowed-once` 外，结果都失败关闭。`ApprovalPolicy` 是 `'ask' | 'never'`，用 `effectivePolicy(session)` 读取，用 `setApprovalPolicy` 修改。

`@deepseek-ai/dsh-permission-presets` 的配置包括 `presets` 和 `defaultPreset`。随发行的默认预设包括 `workspace-write` 和 `danger-full-access`。每个预设捆绑 `sandbox` 和 `approval`。用户用 `/permission` 切换，这会记录一条 `permission/preset` 事件。

工具策略应该使用 `tools/pre-execute`（允许、拒绝或询问），并在必须由人决定时调用审批。不要把提示藏在 `execute` 里面。

## 插件作者怎么用

- 要增加面向用户的设置，在插件行上导出 `Config`，然后让设置服务渲染那份模式。官方客户端里的新设置卡片遵循 [docs/cookbook/adding-a-settings-card.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-settings-card.md)。
- 通过 `ctx.approval.request` 请求审批。除 `allowed-once` 以外的每个结果都当作拒绝。
- 不要发明第二种权限模式。产品需要一对有名字的沙箱加审批时，组合一个权限预设。
- `danger-full-access` 是已有的预设名。管理工具要求它，这是宿主策略，插件不应该绕过。

## 来源

- [docs/subsystems/settings.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/settings.md)
- [packages/settings/settings/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/settings/settings/README.md)
- [docs/subsystems/approval.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/approval.md)
- [packages/interaction/permission-presets/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/interaction/permission-presets/README.md)
- [docs/cookbook/adding-a-settings-card.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-settings-card.md)
