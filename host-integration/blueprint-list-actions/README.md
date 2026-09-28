# Plugin-list toolbar integration

DSH `0.1.7-rc.2` exposes detail-page extension slots but no list-toolbar slot.
The Blueprint plugin therefore needs this small host change to put its Blueprint menu
beside Refresh and Add plugin. Installing the plugin alone on the stock host
keeps the controls on its own configuration page.

`dsh-0.1.7-rc.2.patch` targets the official `dsh-v0.1.7-rc.2` source tag:

- Declare `plugins.list.actions` as a root list slot with an empty owner.
- Include it in the page's typed render contract and slot declarations.
- Render contributions before the existing list toolbar controls.
- Let the header and toolbar wrap at narrow widths; keep controls non-draggable.

Apply to a checkout of that tag with `git apply --check` followed by `git apply`,
then build and distribute the host through its normal workflow. For another
version, review and port the four source hunks; do not patch minified assets in
an installed application. This directory neither changes the user's installed
host nor publishes an upstream patch.

The plugin uses `ctx.slots.inject` so absent slots do not become fabricated
capabilities. It retains `plugins.bundle.config` as a supported fallback and
does not relocate DOM elements or replace the native manager page.

Source: [official tagged plugin manager](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.7-rc.2/packages/client/ui-plugin-manager/src/client).
Local source-patch and isolated runtime checks are recorded in
[Blueprint acceptance](../../plugins/dsh-blueprint/ACCEPTANCE.md).

## 中文

此补丁给官方插件列表顶部增加公开操作插槽，供“蓝图”菜单使用。
原生刷新、添加插件及详情页行为保持不变。补丁适用于官方 `dsh-v0.1.7-rc.2` 源码；
其他版本需核对后移植，并按宿主正常流程构建分发。

当前是可审查的源码补丁及隔离环境验证，不代表官方版本或用户已安装客户端已更新。
未接入该插槽的宿主可在蓝图插件自身页面使用导入和导出蓝图；它的列表顶部不会出现菜单。
