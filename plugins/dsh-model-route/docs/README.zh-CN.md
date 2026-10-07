# @klarkxy/dsh-model-route

DeepSeek Harness（DSH）插件的模型路由字段契约。

每个功能插件各自维护"我该用哪个模型"的设置。这个包是它们共享的小而稳的
契约，让枢纽插件能在一个页面里找到并修改这些字段——功能插件不需要依赖
枢纽，枢纽也不需要依赖功能插件。

## 内容

- **`ModelRoute`**：各功能插件已经在用的值形状 `{ provider, model, reasoningEffort? }`。
  provider/model 为空表示"跟随宿主默认模型"。附带 `defaultModelRoute`、
  `normalizeModelRoute`、`modelRouteOverride`、`sameModelRoute` 和
  `modelRouteKey` 一对键函数。
- **`MODEL_ROUTE_MARKER`（`x-model-route`）**：可选的 schema 标记。功能插件把它打在
  模型路由配置字段上，枢纽即可精确识别该字段及其 `purpose` / `label` 元数据。
- **`detectModelFields(schema, options?)`**：在投影后的设置 schema（如宿主
  `SettingsDescriptor` 的 `schema` 一半）里找出模型路由字段。标记命中优先；
  裸 `ModelRoute` 对象形状（`provider` + `model` 字符串属性）不带标记也能识别，
  因此未接入约定的第三方插件照样可用。会遍历分支、嵌套对象、数组元素和局部 `$ref`，
  支持 `SettingsForms.describe()` 返回的 Schemastery `{ uid, refs }` 投影及 `meta` 中的标记。
  实际数组按数字索引返回每个元素及其对应值；空数组或只有 schema 的元素模板使用
  `[]` 路径并标记 `editable: false`。`arrayItem: true` 表示该字段就是数组元素，
  清空路由应写入空路由；宿主的 unset 会删除整个元素。
- **目录辅助**：`parseModelMenuChoices`、`modelMenuEffortOptions`、
  `knownModelFromChoices`，对应宿主会话模型目录。
- **`@klarkxy/dsh-model-route/zod`**：可选 zod 绑定：`modelRouteZod(meta?)`
  与 `withModelRouteMarker(schema, meta?)`。
- **`@klarkxy/dsh-model-route/schemastery`**：可选 schemastery 绑定：
  `modelRouteSchemastery(meta?)`（自定义键标记）与
  `modelRouteRoleSchemastery(meta?)`（官方 `.role('model-route', meta)` 通道，
  供丢弃未知 meta 键的投影器使用）。

- **`@klarkxy/dsh-model-route/ui`**：受控的 `ModelMenu` 编辑器。普通按钮锚点支持点击、
  Enter、空格和上下方向键打开；保留调用方事件处理，阻止默认行为的事件和禁用按钮
  不会打开。选择或 Escape 关闭后焦点回到触发按钮。

核心入口零依赖、浏览器安全。`/ui` 使用 React 与宿主注入的原子组件；
`/zod` 和 `/schemastery` 是可选绑定。

## 用法

声明带标记的字段（schemastery）：

```ts
import Schema from '@deepseek-ai/schemastery'
import { modelRouteSchemastery } from '@klarkxy/dsh-model-route/schemastery'

export const Config = Schema.object({
  summaryModel: modelRouteSchemastery({ purpose: 'summary', label: '总结模型' }).volatile(),
})
```

`SettingsForms.describe()` 只暴露 volatile 字段。只给目标字段加 `.volatile()`，
即可保留其他普通配置的可见性边界。

或用 zod：

```ts
import { z } from 'zod'
import { modelRouteZod } from '@klarkxy/dsh-model-route/zod'

const Config = z.object({
  summaryModel: modelRouteZod({ purpose: 'summary', label: '总结模型' }),
})
```

在投影后的设置 schema 中检测字段：

```ts
import { detectModelFields } from '@klarkxy/dsh-model-route'

const fields = detectModelFields(descriptor.schema, {
  value: descriptor.value,
  knownModel: knownModelFromChoices(choices),
})
// → [{ path: ['summaryModel'], via: 'marker', marker: { purpose: 'summary', ... }, current, known }]
```

## 许可证

SEE LICENSE IN LICENSE
