# @klarkxy/dsh-plugin-kit

功能插件共用的支撑包：共享记录类型、插件页模型菜单、宿主 RPC 注册、官方 UI 样式契约，以及一次原生 `llm` 文本调用。

它不做模型档位路由、重试、超时、排队或用量记录。每个功能在自己的插件页选择模型，并直接调用宿主 `llm`；未选择时使用当前会话模型，再回落到宿主默认对话模型。本包自身从不发起推理。

## 入口

- `.` — Cordis 插件入口（`name`、`inject`、`apply`）、`registerHostRpc`、`callLlmText`、`resolveFeatureModel` 与共享契约类型。
- `./contracts` — 浏览器安全的类型与常量：共享记忆/知识记录、`TaskContract` / `TaskCheckpoint`、`ModelRoute`、`RpcResult`、`CHAT_EVENTS_SLOT`、`projectIdFromCwd`。
- `./host-rpc` — 宿主 RPC 注册辅助及其上下文类型。
- `./client-utils` — 浏览器安全的 React 可选辅助，用于原生插件页座位。
- `./model-menu` — 插件页模型菜单：目录解析、空路由处理、思考强度选项。
- `./llm-call` — 单独导出 `callLlmText` 与 `resolveFeatureModel`。
- `./official-ui` — 浏览器端共享样式契约：`officialUiCss(roots)`、`--dsw-*` token 白名单，以及焦点环与层级辅助。

## 插件 UI 约定

功能插件的浏览器端用宿主自己的组件拼装界面，而不是自己重画控件。具体是：

- **控件来自 `@deepseek-ai/dsh-client-ui-primitives`**——`Button`、`Input`、`Checkbox`、`Switch`、`Tag`、`Pill`、`SegmentedControl`、`Menu`、`Modal`、`Tooltip`、`Toast`、`DisclosureRow`、`StateDot`、`PathLabel` 与设置表单套件。几何、焦点环、状态和本地化接口都由宿主掌握，抄一份就会在下次换肤时掉队。原生 `<select>` 是唯一例外：官方组件里没有它，保留平台控件并套用契约的 `dsh-ui-select` 即可。
- **排版、字阶、卡片、表单、横幅、空态和浮层来自 `./official-ui`**，并限定在该插件自己的根类名下，因此两个插件可以挂同名类而互不影响。
- **颜色、圆角、层级和焦点环直接写宿主的 `--dsw-*` token**，不另起一套私有别名，也不带字面量回落：宿主同时发布浅色与深色，字面量会把其中一套钉死。样式表里写错 token 不会报错——边框直接消失、文字继承错颜色——所以 `src/official-ui.spec.ts` 会在插件样式表点到白名单之外的 token 时让构建失败。

`OFFICIAL_THEME_TOKEN_NAMES` 就是这份白名单。往里加 token 是一个需要确认的动作：先对照宿主主题核实名字。

`AiPolicy`、`PurposeSpec`、`ModelTarget`、`AiServices`、`AiFeatureScope`、`AuxiliaryRequest`、`AuxiliaryResult`、`UsageReceipt` 仍保留在 `./contracts` 并标注 `@deprecated`。它们描述已停用的共享模型路由服务，新调用不得使用。

本包是功能插件的依赖，不是 DSH bundle：不声明 `dsh.bundle`，也不注册插件页。

## 开发

```sh
pnpm --filter @klarkxy/dsh-plugin-kit typecheck
pnpm --filter @klarkxy/dsh-plugin-kit test
pnpm --filter @klarkxy/dsh-plugin-kit build
```
