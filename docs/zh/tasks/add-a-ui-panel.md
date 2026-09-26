# 添加界面面板

[English](../../tasks/add-a-ui-panel.md)

人要在 Harness 网页界面里看到一块内容时用这个任务。写视图之前先选表面。选错表面之后，样式补不回来。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。目标版本不同时，把本页当作未经核实，并核对钉住的源码。

## 什么时候用

目的地是当前的 Harness 网页界面。单独的 HTML 文件完不成这个请求。官方技能 `cordis-plugin-development` 说，没有指明的视觉目的地就是一个已安装的界面插件。超出静态装饰时，先读 [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md) 再选扩展点。

## 怎么选

实践原则第六条：插件界面是 Harness 界面的一部分，所以先选渲染表面。第三条：框架驱动渲染。自己写 DOM 的插件绕过了这套增量机制。

| 需求 | 机制 | 为什么是它 |
| --- | --- | --- |
| 装饰在宿主已经留出的空间里 | `ctx.slots.inject` 加 `ctx.slots.register`；`Slots.listSubTree` 能看到时，可用 `conversation.composer.dock` 这类槽位 | [packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md) 说，优先用已经分配空间的槽位。`shell.overlay` 只用于已知的遮罩位置。 |
| 聊天记录里的一行 | `ctx.uiConversation.events.register()`，以及该定义 `kind` 下的 `conversation.chat.node` 视图 | 实践文档说，对话层拥有分页、放置和增量拼装。 |
| 设置表单 | [添加设置界面](add-a-settings-ui.md) | 易变配置，不是随手画的面板。 |
| 客户端上的会话数据 | 带 `wire.view` 的宿主投影 | 实践文档说，客户端不折叠会话事件。见[添加会话派生状态](add-session-derived-state.md)。 |
| iframe 里的 HTML 页面 | 不要 | iframe 收不到主题令牌、明暗切换或 `ctx.locale`。 |

宿主和客户端分开。宿主入口放服务。客户端文件只渲染。`package.json` 增加 `dsh.client`（`platform`、`immediately`、`inject`）和 `./client` 导出。浏览器产物的工厂 id 等于包名。React 来自浏览器模块表。不要把 `@deepseek-ai/dsh-client-ui-primitives` 或其他 Harness 客户端包当作模块导入。`dsh.client.inject` 条目只排列激活顺序。

`inject` 回调里的注册，在所属声明折叠时释放，返回时重新安装。样式、定时器和监听器放在 `apply` 里，用 `ctx.effect` 或 `ctx.on`。不要往 `document.body` 追加，也不要换掉应用根节点。

主题：用 `cordis_inspect_query` 的 `Theme` 列出的令牌（`--dsw-alias-*`）。字面颜色只给画作用。可见文字走客户端的区域设置服务。用最小的选择器读槽位属性。基数和范围由声明固定。见[界面插槽](../areas/ui-slots.md)和 [docs/subsystems/slots.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/slots.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/slots)）。

[docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/extension-cookbook)） 还描述了监听 `agent/assistant-stream` 和 `session/event` 的协议驱动界面。那是给你自己拥有的客户端用的，不是内置网页里的面板。网页聊天里的业务节点用上面的对话注册。

## 要一起读

章节：[界面插槽](../areas/ui-slots.md)、[插件模块](../areas/plugin-module.md)、[会话与标题](../areas/sessions-titles.md)。

钉住提交上的官方文件：

- [packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [docs/subsystems/slots.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/slots.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/slots)）
- [packages/client/ui-slots/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-slots/README.md)
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/extension-cookbook)）

## 事前检查

- 把目标 DSH 版本和 `meta.json` 比较。
- 在 DSH 里面，写注册之前先查客户端的 `Slots.listSubTree`，以及所选槽位的选项和属性。客户端查询要等有响应的页面。在 DSH 外面，不要假设槽位存在。把实时树标成未经核实。
- 写死颜色之前先查 `Theme`。没有检查工具时，只用你在钉住源码里读到的 `--dsw-alias-*` 名字，并写明这一点。
- 确认你不会导入 Harness 客户端包。

## 验证清单

- 安装之后 `application` 为 `applied`，并且 `cordis_inspect_query` 能看到客户端注册。技能说，只有注册并不能说明用户看见了什么。
- 已连接的页面在所选槽位里显示面板，明暗两种主题都要看，并放在一块同类宿主页面旁边。
- 控制台没有 `slot entry crashed in '<slot>'`。
- 样式引用主题令牌。只有画作使用字面颜色。
- 插件模块图不导入 `@deepseek-ai/dsh-client-ui-primitives`。
- 卸载会移除槽位条目、定时器和监听器。所属声明折叠时也一样。
- 依赖会话的数字与日志重放一致。客户端自己没有折叠事件。
- 写明哪些行你跑过。没有浏览器控制时，视觉检查保持未经核实。把这一点明确写出来。

## 常见失败

- 提供 iframe，或往 `document.body` 追加第二个应用。
- 猜测槽位属性，而不是读 `Slots.listSubTree`。
- 在客户端重扫日志来取会话状态。在宿主上声明 `wire.view`。
- 复制宿主组件的导入。抛错会把槽位条目清空。
- 复用随发行的单元格 id，盖住宿主单元格。追加的界面需要新的列表 `id`。
- 把动态挂载当成持久的。重启后留下的是 bundle 补丁。

## 可运行示例

`Runnable example: not yet (planned)`。本页没有可复制的包，也没有测试。后续轮次才会补上可运行的任务包。

## 来源

- [packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)
- [docs/subsystems/slots.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/slots.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/slots)）
- [packages/client/ui-slots/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-slots/README.md)
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/extension-cookbook)）
