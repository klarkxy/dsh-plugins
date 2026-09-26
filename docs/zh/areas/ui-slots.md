# 界面插槽

[English](../../areas/ui-slots.md)

Web 界面用 `ctx.slots` 组合 React。往别人声明的 slot 里注册时用 `ctx.slots.inject`，不要 import 另一个功能插件的组件。Client 入口在 `package.json` 的 `dsh.client` 和 `./client` 导出。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

slot 是 Web 客户端带类型的 React 组合系统。`@deepseek-ai/dsh-client-ui-slots` 是不依赖 React 的注册表。`@deepseek-ai/dsh-client-ui-renderer` 绑定可观察对象并渲染这棵树。功能插件通过 `ctx.slots.register()` 贡献界面，并且不 import 另一个功能插件的组件。

## 它在哪里

- 子系统：[docs/subsystems/slots.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/slots.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/slots)）
- 注册表包：[packages/client/ui-slots/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-slots/README.md)
- 编写笔记：[packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md)
- 装饰模板：[packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/package.json](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/package.json)

## 约定

客户端模块注入 `slots`。往另一个包声明的 slot 里注册时使用 `ctx.slots.inject`，这样贡献跟随所有者的生命周期：

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

`root` 是唯一内建的声明。`ui-renderer` 调用 `ctx.slots.renderSlot('root', {})`。往未声明的 slot 注册，或声明一个已有条目拥有的子项，会在激活期间失败。

基数和作用域由 slot 声明固定：

| 轴 | 值 | 含义 |
| --- | --- | --- |
| 基数 | `single` | 一个格子。当前优先级胜出者来渲染。 |
| 基数 | `list` | 格子有必填的 `id`，按 `order` 排序，然后按注册顺序。 |
| 基数 | `keyed` | 所有者分发一个 `entryKey`。 |
| 基数 | `chain` | 每个条目提供 `select(owner)`。第一个非空结果来渲染。 |
| 作用域 | `root` | 一个根作用域实例。 |
| 作用域 | `session-maybe` | 没有 Session 提供者也可以渲染。Session 的值是可选的。 |
| 作用域 | `session` | 需要周围有 Session 提供者。 |

`priority` 对 `single`、`list` 和 `keyed` 是遮盖等级，对 `chain` 是选举顺序。较小的值先运行或先渲染。复用随发行的格子 id 会替换那个格子。追加的界面应该选一个新的列表 `id`。

子系统导言里点名的 slot 键示例：`plugins.bundle.config`、`plugins.bundle.activation` 和 `conversation.input.activity`。用 `Slots.listSubTree` 发现活的树，不要猜测 props。

界面 bundle 的 `package.json` 在 `dsh.bundle.patch` 旁边增加 `dsh.client`（`platform`、`immediately`、`inject`）和 `./client` 导出。浏览器产物注册一个惰性工厂，其 id 等于包名。React 来自浏览器模块表。非基线的运行时 import 放进 `dsh.client.external`。功能只在客户端时，宿主 `index.js` 可以导出空的 `apply`；补丁仍然插入一行，名字跟包名一致。

工厂不要有副作用。样式、定时器和监听器在 `apply` 里用 `ctx.effect` 或 `ctx.on` 注册。不要替换应用根，也不要往 `document.body` 上再挂第二个应用。不要从已安装的第三方界面插件 import `@deepseek-ai/dsh-client-ui-primitives`；cordis 插件开发技能告诉作者使用主题记号和 slot 自己的 props。

## 插件作者怎么用

- 复制 `templates/decoration/`，并且只在 `Slots.listSubTree` 显示了那个 slot 的 props 之后才改 slot。
- 优先用已经留出空间的 slot，例如已声明时的 `conversation.composer.dock`，而不是 `shell.overlay`。
- 宿主服务留在宿主入口。客户端文件只负责渲染。
- 在已连接的页面里验证。仅仅注册 slot 并不能确定用户看到什么。

## 来源

- [docs/subsystems/slots.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/slots.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/slots)）
- [packages/client/ui-slots/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-slots/README.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/package.json](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/package.json)
