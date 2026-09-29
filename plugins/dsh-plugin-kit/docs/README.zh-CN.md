# @klarkxy/dsh-plugin-kit

功能插件共用的支撑包：共享记录类型、插件页模型菜单、宿主 RPC 注册，以及一次原生 `llm` 文本调用。

它不做模型档位路由、重试、超时、排队或用量记录。每个功能在自己的插件页选择模型，并直接调用宿主 `llm`；未选择时使用当前会话模型，再回落到宿主默认对话模型。本包自身从不发起推理。

## 入口

- `.` — Cordis 插件入口（`name`、`inject`、`apply`）、`registerHostRpc`、`callLlmText`、`resolveFeatureModel` 与共享契约类型。
- `./contracts` — 浏览器安全的类型与常量：共享记忆/知识记录、`TaskContract` / `TaskCheckpoint`、`ModelRoute`、`RpcResult`、`CHAT_EVENTS_SLOT`、`projectIdFromCwd`。
- `./host-rpc` — 宿主 RPC 注册辅助及其上下文类型。
- `./client-utils` — 浏览器安全的 React 可选辅助，用于原生插件页座位。
- `./model-menu` — 插件页模型菜单：目录解析、空路由处理、思考强度选项。
- `./llm-call` — 单独导出 `callLlmText` 与 `resolveFeatureModel`。

`AiPolicy`、`PurposeSpec`、`ModelTarget`、`AiServices`、`AiFeatureScope`、`AuxiliaryRequest`、`AuxiliaryResult`、`UsageReceipt` 仍保留在 `./contracts` 并标注 `@deprecated`。它们描述已停用的共享模型路由服务，新调用不得使用。

本包是功能插件的依赖，不是 DSH bundle：不声明 `dsh.bundle`，也不注册插件页。

## 开发

```sh
pnpm --filter @klarkxy/dsh-plugin-kit typecheck
pnpm --filter @klarkxy/dsh-plugin-kit test
pnpm --filter @klarkxy/dsh-plugin-kit build
```
