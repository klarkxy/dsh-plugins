# 添加设置界面

[English](../../tasks/add-a-settings-ui.md)

人要修改插件配置，并且修改必须留在 profile 补丁里时，用这个任务。批准一次工具调用是另一个任务。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。目标版本不同时，把本页当作未经核实，并核对钉住的源码。

## 什么时候用

这个值是配置，不是会话历史，也不是一次性许可。[packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md) 说，可调的值放在插件的 `Config` 里，用户在 `cordis.patch.yml` 里改。用户那一层补丁能熬过升级。

## 怎么选

[docs/cookbook/adding-a-settings-card.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-settings-card.md) 是表单路径。[docs/subsystems/settings.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/settings.md) 说，业务代码在自己的配置引用上读 `.get()`。设置服务不是通用的键值存储。没有文档化的 `ctx.settings.get` / `set`。写入走 `describe`、`update`、`replace` 和 `mutate`，`expectedRevision` 来自 `describe`。

| 需求 | 机制 | 为什么是它 |
| --- | --- | --- |
| 插件运行时要读的值 | `Config` 字段；必须不重载实例就能改时，用 `Schema` 的 `.volatile()` | 食谱示例在 `loader/volatile-update` 上读 `config.retries.get()`。实例身份保持不变。 |
| 内置插件页要编辑这份 schema | 导出 `Config`，并给这一行唯一的 profile 条目 id | 设置服务投影易变字段。你不用自己画那张库存卡片。 |
| 在别人的插件页上放一个控件 | 用 `ctx.slots.inject` 进入 `plugins.detail.actions`、`plugins.detail.badge` 或 `plugins.detail.section` | 食谱传入页面的 `subject`，并说没有内容时返回空。 |
| 自定义页面编辑同一份配置 | 插件页所有者给出的 `form.state` 和 `form.mutate(operations, expectedRevision)` | 宿主校验完整配置。过期的修订会被拒绝。 |
| 问这一次动作能否继续 | `ctx.approval.request` | 那是[设置、审批与权限预设](../areas/settings-approval.md)，不是存下来的设置。 |
| 不是设置表单的面板 | [添加界面面板](add-a-ui-panel.md) | 写视图之前先选槽位。 |

`role('secret')` 让值不出现在表单响应里。凭据域管理的值用凭据引用。补丁会整份替换 `config`，所以覆盖时必须重写仍然需要的每个字段。见[Bundle、Profile 与补丁](../areas/bundle-profile-patch.md)。

浏览器那一半挂在说明符为裸包名的那一行的 `dsh.client` 上。食谱说，子路径行永远不携带这一半。必须比其他行活得更久的页面，自己做成一个包。

## 要一起读

章节：[设置、审批与权限预设](../areas/settings-approval.md)、[插件模块](../areas/plugin-module.md)、[界面插槽](../areas/ui-slots.md)、[Bundle、Profile 与补丁](../areas/bundle-profile-patch.md)。

钉住提交上的官方文件：

- [docs/cookbook/adding-a-settings-card.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-settings-card.md)
- [docs/subsystems/settings.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/settings.md)
- [packages/settings/settings/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/settings/settings/README.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)

## 事前检查

- 把目标 DSH 版本和 `meta.json` 比较。
- 在 DSH 里面，按包 `name` 查 `Config.listConfigs`，读实时 schema 再加字段。在 DSH 外面，读类型声明，并把实时 schema 标成未经核实。
- 确认 profile 挂了设置服务。食谱说 base bundle 会挂设置和配置编辑器。自定义 profile 未必挂。
- 决定字段是不是易变的。非易变的修改会热替换插件。

## 验证清单

- 保存合法值会更新 profile 补丁，下一次消费操作能看到 `.get()`。
- 易变修改不改变插件实例身份。
- 重启后能恢复保存的值。
- 非法值被拒绝，文件和实时值都不改变。
- 过期的 `expectedRevision` 被拒绝。
- 秘密或凭据不出现在表单响应里。
- 卸载根包那一行会移除浏览器那一半。子路径行从来不是载体。
- 写明哪些行你跑过，哪些仍未经核实。

## 常见失败

- 发明 `ctx.settings.get` / `set`，再写一个旁路文件。存下来的配置是 profile 补丁。
- 覆盖一行的 `config` 时只写新键。其余配置会消失。
- 把客户端那一半挂在子路径导出上，然后奇怪页面为什么不出现。
- 把审批提示放进设置表单。审批是一次动作，除 `allowed-once` 外都失败关闭。
- 读另一个插件的 DOM 来放徽章。用 `plugins.detail.badge` 和 `subject` 参数。

## 可运行示例

`Runnable example: not yet (planned)`。本页没有可复制的包，也没有测试。后续轮次才会补上可运行的任务包。

## 来源

- [docs/cookbook/adding-a-settings-card.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-settings-card.md)
- [docs/subsystems/settings.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/settings.md)
- [packages/settings/settings/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/settings/settings/README.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
