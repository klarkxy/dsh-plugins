# 插件模块

[English](../../areas/plugin-module.md)

一个插件是导出 `apply` 的模块。需要的服务写在 `inject` 里；可调参数用同名的 Schemastery `Config` 声明。通过 `ctx` 注册的资源会在卸载时自动清理。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

Harness 插件是一个模块。依赖就绪后，Cordis 加载器会调用它。常见形式是具名函数插件：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools is ready here.
}
```

`inject` 列出必需的服务键。框架会等它们全部就绪，然后才运行 `apply`。如果某个必需服务消失，插件会卸载，并在服务回来时再次加载。

另外还有两种形式。对象插件是 `{ name, inject, apply }`。类插件是 `export default class X extends Service`，带有 `static inject`，并在构造函数里调用 `super(ctx, 'serviceKey')`。其他插件需要调用你的服务时，用类形式。大多数贡献用函数形式就够了。

## 它在哪里

- 第一个插件、三种形式，以及 `ctx.effect`：[docs/user/develop/basic/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/index.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)）
- `Config` 模式：[docs/user/develop/basic/config.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/config.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/config)）
- Fiber 状态与清理：[docs/user/develop/framework/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/framework/index.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/framework/)）
- 提供一项服务：[docs/user/develop/framework/service.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/framework/service.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/framework/service)）
- 事件：[docs/user/develop/framework/events.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/framework/events.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/framework/events)）
- 加载器对 `config` 和 `disabled` 的插值：[docs/cordis-primer.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cordis-primer.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer)）

## 约定

Fiber 状态为 `PENDING`、`LOADING`、`ACTIVE`、`FAILED`、`UNLOADING` 和 `DISPOSED`。

通过 `ctx` 做的注册会在卸载时撤销，包括 `ctx.on`、`ctx.tools.register`、`ctx.llm.registerAdapter` 和 `ctx.effect(() => cleanup)`。卸载期间，清理函数按注册的相反顺序开始调用，但多个异步清理函数会并发运行。有顺序要求的清理要放进同一个 `ctx.effect()` 返回的那一个清理函数里。

`ctx.plugin(child)` 创建一个子 Fiber，它会随父级一起卸载。

事件分发方法是 `ctx.emit`、`ctx.bail`、`ctx.serial` 和 `ctx.waterfall`。waterfall 的监听器会收到 `next`，除非有意短路，否则必须调用它。

配置是一份 Schemastery 模式，导出为 `Config`，并配有同名的 TypeScript `Config` 类型。默认值写在模式字段上（`Schema.string().default('Hello')`）。不要把普通对象导出为 `Config`；Cordis 要求 Standard Schema 接口。非法配置会导致加载失败。修改配置会热替换插件：旧实例卸载，新实例加载。

两处部署可能想设成不同值的东西，都必须是配置字段。检验标准是：不改代码，只改 `cordis.yml`，能不能改变这个值。

服务类要扩充 Cordis 上下文，调用方才能看到带类型的键：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}
```

传给 `super(ctx, 'metrics')` 的构造名字就是这个键。

## 插件作者怎么用

- 导出 `name`，这样日志和清单能识别这个插件。
- 为 `apply` 用到的每一个 `ctx.*` 服务声明 `inject`。不要去拿没有注入的服务。
- 补丁行有 `config` 对象时就导出 `Config`。在写出还没读过的行之前，先在正在运行的宿主上查询 `Config.listConfigs`。
- 在 `apply`（或服务构造函数）里注册工具、skill、监听器和定时器，这样卸载时会移除它们。
- 网络套接字或其他外部资源，要从 `ctx.effect` 返回它的关闭函数。

插件管理器卡片上的展示文字不属于 `apply`。`locale/en.json` 见 [Bundle、Profile 与补丁](bundle-profile-patch.md)。

## 来源

- [docs/user/develop/basic/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/index.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)）
- [docs/user/develop/basic/config.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/config.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/config)）
- [docs/user/develop/framework/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/framework/index.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/framework/)）
- [docs/user/develop/framework/service.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/framework/service.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/framework/service)）
- [docs/user/develop/framework/events.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/framework/events.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/framework/events)）
- [docs/cordis-primer.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cordis-primer.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer)）
