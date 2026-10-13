# @klarkxy/dsh-plugin-kit

<!-- release-state-note -->
插件生命周期见[仓库状态清单](../../../README.zh-CN.md#插件生命周期)：草稿 → 测试中 → 已发布，只向前推进。已发布插件的修复、测试和升版保持已发布；每次更新仍须通过发布检查。首次发布须明确选择测试中的包，并在 npm 归档验证成功后登记。详见[发布规则](../../../RELEASING.zh-CN.md)。

本仓库功能插件共用的支撑包：共享记录类型、插件页模型菜单、宿主 RPC 注册、官方 UI 样式契约，以及一次原生 `llm` 文本调用。它是一个库，不是 DSH bundle——把它作为依赖装上，得到的是功能插件需要的零件，而不是一个新的用户可见功能。

[English](../README.md)

## 本包不做什么

- 它是功能插件的依赖，不是 DSH bundle：不声明 `dsh.bundle`，也不注册插件页，单独安装它不会让用户看到任何变化。
- 它自身从不发起推理：没有功能要求时，它不会发起任何模型调用。
- 它不做模型档位路由、重试、超时、排队或用量记录。每个功能在自己的插件页选择模型，并直接调用宿主 `llm`；未选择时使用当前会话模型，再回落到宿主默认对话模型。

## 入口

- `.` — 共享契约类型，以及 `registerHostRpc`、`callLlmText`、`resolveFeatureModel`。
- `./contracts` — 浏览器安全的类型与常量：共享记忆/知识记录、`TaskContract` / `TaskCheckpoint`、`ModelRoute`、`RpcResult`、`CHAT_EVENTS_SLOT`、`projectIdFromCwd`。
- `./host-rpc` — 宿主 RPC 注册辅助及其上下文类型。
- `./model-settings` — 仅供宿主使用的模型设置贡献入口。在 `ctx.effect` 中用 `registerModelSettings` 登记所属插件的模型快照和 CAS 保存接口，枢纽通过 `collectModelSettings` 发现活动入口。每次注册有独立实例标识，旧页面不能写入重新加载的实例。只公开模型字段、版本以及可选的独立模型目录；存储与校验仍归所属插件维护。
- `./client-utils` — 浏览器安全的原生插件页座位辅助：`selectedSessionId`、`useNativeSeat`、`useFeatureRefresh`。`react` 是可选对等依赖。
- `./model-settings-client` — 浏览器安全的可选模型设置订阅。`createModelSettingsSubscriber` 复用原生远程流，模型枢纽统一注册描述符；消费页处理刷新和草稿冲突。所属插件在持久化和内存更新完成后用宿主入口的 `notifyModelSettingsChanged` 发出失效提示。
- `./model-menu` — 插件页模型菜单：目录解析、空路由处理、思考强度选项。
- `./llm-call` — 单独导出 `callLlmText` 与 `resolveFeatureModel`。
- `./official-ui` — 浏览器端共享样式契约：`officialUiCss(roots)`、`--dsw-*` token 白名单，以及焦点环与层级辅助。
- `./cli-process` — 不经命令 shell 运行已解析的可执行文件，提供输出上限、串行逐行回调、超时及本次进程树的取消。流式模式通过 `onLine` 交付 stdout，不再重复保留 stdout 字符串。
- `./cli-media` — 校验并暂存明确指定的工作区／当前会话媒体，限制文件大小，返回原生图片和文件附件。远端任务授权与厂商协议由各插件负责；这些辅助不为厂商 CLI 自身的文件访问提供沙箱。

将 Cordis 上下文传给 `resolveFeatureModel` 的插件须在 `inject` 中声明 `agents`、`sessionProjections` 和 `agentDefaultModel`。插件未保存模型时，这三个服务提供当前会话选择和宿主默认模型。

## 插件 UI 约定

功能插件的浏览器端用宿主自己的组件拼装界面，而不是自己重画控件。具体是：

- **控件来自 `@deepseek-ai/dsh-client-ui-primitives`**——`Button`、`Input`、`Checkbox`、`Switch`、`Tag`、`Pill`、`SegmentedControl`、`Menu`、`Modal`、`Tooltip`、`Toast`、`DisclosureRow`、`StateDot`、`PathLabel` 与设置表单套件。几何、焦点环、状态和本地化接口都由宿主掌握，抄一份就会在下次换肤时掉队。原生 `<select>` 是唯一例外：官方组件里没有它，保留平台控件并套用契约的 `dsh-ui-select` 即可。
- **排版、字阶、卡片、表单、横幅、空态和浮层来自 `./official-ui`**，并限定在该插件自己的根类名下，因此两个插件可以挂同名类而互不影响。
- **颜色、圆角、层级和焦点环直接写宿主的 `--dsw-*` token**，不另起一套私有别名，也不带字面量回落：宿主同时发布浅色与深色，字面量会把其中一套钉死。样式表里写错 token 不会报错——边框直接消失、文字继承错颜色——所以 `src/official-ui.spec.ts` 会在插件样式表点到白名单之外的 token 时让构建失败。

`OFFICIAL_THEME_TOKEN_NAMES` 就是这份白名单。往里加 token 是一个需要确认的动作：先对照宿主主题核实名字。

## 会话关系

`isSubagentSession` 只读取持久会话头，不根据 user 消息判断真人。明确的子代理来源或正派发深度优先；派发深度为零或由原生宿主省略、明确带 seed 的普通/自由真人分叉保留 parent 作为历史继承关系，仅有 parent 的旧会话及未知元数据仍按子线程处理。

## 跨插件字符串契约

`./contracts` 是插件间字面量的单一来源：

- `MODEL_SETTINGS_CHANGES_REMOTE`：由 `@klarkxy/dsh-model-hub` 提供的模型设置变更流。未安装该包时，订阅方静默降级。
- `WEB_PROVIDER_AVAILABILITY_EVENT` 与 `DshWebManagementDescriptor`：原生网页供应商宣布本地可用性变化，以及可选的展示元数据。
- `CREATOR_PRESET_ID`：宿主 Creator 预设 id。

## 开发

模型设置贡献的提供方标题、字段名称与说明、跟随模式名称及目录错误支持 `ModelSettingsText`（`string | { zh: string; en: string }`）。内置展示文案提供中英文，用户数据和第三方字符串保留原文；模型设置页在渲染时跟随宿主语言解析。

```sh
pnpm --filter @klarkxy/dsh-plugin-kit typecheck
pnpm --filter @klarkxy/dsh-plugin-kit test
pnpm --filter @klarkxy/dsh-plugin-kit build
```
