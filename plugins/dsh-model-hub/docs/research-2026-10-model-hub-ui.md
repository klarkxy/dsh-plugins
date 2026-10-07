# model-hub UI 调研报告（2026-10-06）

> **勘误提示**：本报告初稿的探针基线结论（「自检字段验证标记穿透」）已被运行宿主实测推翻——
> `<profile>/data/model-hub/probe-report.json` 显示 21 个命名空间、**0 个检出**、自检双通道均 absent、
> hub 自身 schema 未进投影。勘误与修订方案见文末 **§七 评审结论与勘误**，阅读前文时以 §七 为准。

调研目标：把 `@klarkxy/dsh-model-hub` 从验证探针推进为完整的模型枢纽 UI，覆盖三件事——
**每个插件的模型选择**、**DSH 全模型目录**、**各插件 LLM 用量统计**。

证据来源（按可信度排序）：
1. **DSH 运行时实测**：cordis_inspect（host/client Service、Event、Slot 树、Config），对当前运行的宿主最权威。
2. **官方文档**：deepseek-harness 文档站（slots / client-modules / settings / llm-streaming / session / session-telemetry / token-meter / api-gateway / typert / sidebar-right / providers 等页）。
3. **仓内资产**：plugins/ 下现有实现（只读盘点）。
4. **ZCode v3.14.3 源码**（`H:\Refernece\ZCode`）：与宿主同族，仅作设计先例；其 API 名与 DSH 不同，**不作契约依据**。

---

## 一、现状基线（已有资产）

| 资产 | 位置 | 状态 |
| --- | --- | --- |
| hub 探针：字段检测 + 矩阵 RPC + CAS 写回 | `plugins/dsh-model-hub/src/{index,probe}.ts` | 代码已落地，但**实测 0 检出**（见 §七 F1/F2） |
| hub 客户端：`plugins.bundle.config` 单页 + ModelMenu 编辑器 | `plugins/dsh-model-hub/src/client.tsx` | 已落地（错误/冲突处理较简） |
| 模型路由契约包：ModelRoute / 标记 / 检测 / 目录 / ModelMenu UI | `plugins/dsh-model-route`（`.` `./zod` `./schemastery` `./ui`） | 已发布形态，可直接复用 |
| host RPC 通道（鉴权委托宿主、fail-closed） | `plugins/dsh-plugin-kit/src/host-rpc.ts` | 已验证（含 401/403/503 测试） |
| 官方 UI 样式与 token 白名单 | `plugins/dsh-plugin-kit/src/official-ui.ts` | 排版/卡片/表单/横幅/空态/浮层齐全 |
| 辅助 LLM 调用封装（**天然埋点点位**） | `plugins/dsh-plugin-kit/src/llm-call.ts` `callLlmText` 返回 `{text, provider, model, inputTokens?, outputTokens?}` | 无记录，需包一层 |
| 用量统计页蓝本（storage-domain 按日表 + RPC summary + 纯 SVG 图） | `plugins/dsh-zhihu` UsageSection / usage.ts | 直接可借鉴 |
| 最复杂模型管理 UI（master/detail、CAS 冲突 banner、草稿保护） | `plugins/dsh-classmates` ClassmatesPage / ModelsPage | 页面模式范本 |
| 原生 select + modelCatalog 的轻量模型选择 | `plugins/dsh-recap` RecapModelSelect | **已从工作树删除**（仅存 git 历史与已发布 npm 包），仅作历史参考 |

---

## 二、运行时契约事实（cordis_inspect 实测）

### 2.1 模型目录（目标②的数据源，全部现成）

- **客户端**：`remote.session.modelCatalog(): Promise<ModelCatalog>`（`sessionController` 的 `@Remote`）。
  `ModelCatalog = { default: ModelSelection; routableProviders: string[]; groups: ModelProviderGroup[]; failures: ModelCatalogFailure[] }`，
  每个模型含 `id/name/description?/reasoning?{efforts:[{id,name,description?}], defaultEffort?}`。仓内 dsh-recap、dsh-model-hub 已在用。
- **宿主侧更丰富的面**：`ctx.llm`（LlmRuntime）
  - `@Remote listProviders(): LlmProviderInfo[]`、`@Remote listConfigurableProviders(): LlmConfigurableProvider[]`
    （后者带 `settingsNs/settingsPath/declared?/error?`——可展示「provider 配置状态」，包括休眠路由与错误）；
  - `listModels(provider)`、`resolveModelInfo(provider, model)`（含 contextWindow、defaultMaxTokens、efforts、modalities）——
    **未标 @Remote**，按 API Gateway 规则客户端不可直接调，需经自建 RPC 转发（classmates 的 `RoleConfig.catalog()` 正是这个模式）；
  - `@Remote discoverModels(settingsNs, request)`：草稿端点探测（凭据一次性），可做「测试连接/发现模型」。
- **默认模型**：`ctx.agentDefaultModel.currentSelection()/saveSelection()`；`ctx.subagentModelSelection.current()`；
  会话级 `remote.session.selectModel()`。
- **刷新触发**：`llm/adapters-updated`（emit，provider 拓扑变化）；客户端事件白名单只有
  `connection/reset`、`locale/change`、`slots/changed`、`theme/change`——**目录/用量变化推送要自建**（轮询或 RPC 流）。

### 2.2 设置读写（目标①的底座，探针已验证）

- `settings.describe({redactSecrets:true})` → `SettingsDescriptor{ns, autoGenerate, schema, value, revision, base?, user?, applies, secrets?}`；
  只投影 **volatile** 配置字段（文档口径）。
- 写：`update`（合并）/ `replace`（重置后设）/ `mutate(ns, SettingsPathOp[], expectedRevision?)`（路径级，保留未回传的 secret），
  全部带乐观 CAS；冲突归类 `settings/conflict` / `settings/rejected`。
- 失效通知：`settings/document-updated(ns, revision)` → 重读 schema/值/revision。
- **文档空白**：schema 投影是否保留自定义 `x-*` 键——这正是探针自检字段（`selfTestMeta`/`selfTestRole`）要实证回答的问题；
  检测器 `readModelRouteMarker` 已兼容三种投影形态（顶层、`x-cordis` 袋、role+extra）。

### 2.3 用量统计（目标③，唯一需要新建数据源的能力）

**观测点（宿主侧，全部实测存在）**：

| 观测点 | 形态 | 能看到什么 | 局限 |
| --- | --- | --- | --- |
| `llm/stream` waterfall | 包裹**每一次**流式调用（retry/replay/routing 同层） | `GenerateOptions{provider, model, reasoningEffort?, sessionId?, purpose?}` + 流中 `{type:'usage', usage: TokenUsage}` 与 `finish` | **无插件归属字段**；LOOP 请求深冻结只读 |
| `session/event` emit | 每会话追加事件（post-commit） | `assistant/message` 持久化 `usage?: TokenUsage` + `message.source{provider,model}`；`assistant/attempt` 保留失败调用的 stream/usage；`request/header` 带 `LlmCallConfig` | 只覆盖会话循环；插件直调 `llm.stream` 不进会话日志 |
| `sessionTelemetry` + `session-telemetry/record` | 出站遥测导出 + 脱敏 waterfall | 镜像会话事件流 | 定位是**导出**不是统计 API |
| `tokenMeter.measure(session)` | 当前请求压力快照 | 上下文 token 压力 | 服务 compaction，非累计统计 |

`TokenUsage = { inputTokens, outputTokens, totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }`，
计数互不重叠（缓存输入单列；reasoningTokens 已含在 outputTokens 内）。**全链路无 cost 字段**（ZCode 同样如此），用量 UI 只有 token 维度。

**归因结论（关键缺口）**：宿主不知道「这次调用是哪个插件发起的」。
- 会话循环调用：可归因到 sessionId + turn/step（`session/event` 可回填历史）。
- 辅助调用：`GenerateOptions.purpose` 只有 `'compaction' | 'session-title'` 两个官方值，插件直调不带标识。
- **要得到「按插件」数字，必须契约级合作**：plugin-kit 的 `callLlmText`/`resolveFeatureModel` 是唯一汇聚点，
  在其外包一层 recorder（调用方传插件名/purpose），按日写入 storage-domain——zhihu 的 `createZhihuUsageRecorder` 就是蓝本。
  未接入契约的插件调用只能落「未归因」桶（经 `llm/stream` 全局观测仍可计入总量）。

### 2.4 UI 落点（客户端 Slot 树实测 + 文档 + 仓规）

| Slot | 形态 | 适配度 |
| --- | --- | --- |
| `plugins.bundle.config`（现状） | bundle 详情页内 keyed 区 | **仓规唯一认可的插件配置入口**（`scripts/plugin-settings.test.mjs` 守卫：禁止 `settings.section`/`settings.plugins.tab`）。页内可用 SegmentedTabs 扩成多分区（zhihu 五 tab 先例） |
| `plugins.row.config` / `plugins.detail.section` | 行级配置 / 详情页区块 | 可作补充入口 |
| `settings.models.provider-card` / `settings.models.footer` | 宿主「模型」设置区扩展位 | 适合放枢纽的**入口链接/摘要**，不放主界面 |
| `sidebar.panellist` + `main`（keyed） | 独立主面板（类 conversation） | 文档 slot 树中唯一的整页路径；超出仓规现状，需用户决策 |
| 右侧栏 tab（`ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab`） | 会话停靠面板 | 文档支持的整页替代路径；root scope 语义需核实 |
| `conversation.input.model` | composer 模型选择器 | replaceRisk=shadows-shipped-ui，不建议 |

---

## 三、ZCode 先例（设计参考，非契约）

- **完整用量统计链路可对照**：SQLite `model_usage/turn_usage/tool_usage` 三表（保留 30 天）→ `queryAppUsage` 聚合 → RPC `usage/stats` →
  设置页「App usage」面板（热力图、模型饼图、日趋势图）：`packages/ui/src/settings/usage-stats/`。
  model-hub 的存储与图表可以直接对齐这套信息架构（按日聚合 + 汇总卡片 + 分布/趋势图）。
- **归因维度**：ZCode 也只有 `querySource / agent / taskType`，**无 pluginId**——「按插件用量」在两个世界都不存在，是本插件的差异化能力，只能靠契约做出来。
- **模型目录**：ZCode 设置页用 `IModelSelectionService.getView()` 一张 providers→models→reasoningLevels 的视图；DSH 的 `ModelCatalog` 结构等价，直接用。

---

## 四、能力矩阵与方案建议

| 目标 | 数据源 | 缺口 | 建议 |
| --- | --- | --- | --- |
| ① 每插件模型选择 | `settings.describe/mutate` + model-route 检测 | 无数据源缺口 | 探针产品化：补 CAS 冲突 banner（classmates 模式）、stale guard（zhihu 模式）、`settings/document-updated` 自动刷新 |
| ② DSH 模型目录 | 客户端 `modelCatalog`；宿主 `llm.list*`（自建 RPC 转发） | 无缺口 | 新增「模型目录」分区：按 provider 分组展示模型/effort/上下文窗/默认模型/provider 配置状态（`listConfigurableProviders` 的 error/declared） |
| ③ 各插件用量统计 | **需新建**：`llm/stream` 全局计量 + plugin-kit recorder 合作归因 + storage-domain 按日聚合 | 插件归属无宿主支持 | 双轨：全局/会话/purpose 维度立即可做；「按插件」数字随契约接入逐步覆盖，未接入进「未归因」桶 |

### 建议的页面结构（守住 `plugins.bundle.config`）

单页多分区（SegmentedTabs，已访问 tab 保持挂载做缓存——zhihu 先例）：
1. **模型字段**：现有矩阵 UI 产品化（冲突处理、刷新、空态引导插件打标）。
2. **模型目录**：provider 分组只读浏览 + 默认模型/子代理默认模型展示；每张 provider 卡可带配置状态与错误。
3. **用量统计**：汇总卡（今日/累计/缓存命中）+ 按日 SVG 柱状/趋势 + 按插件·模型·用途分布表；数据经 hub 自建 RPC。

### RPC 选型

继续用 plugin-kit `registerHostRpc`（鉴权委托宿主 `connection.requestRejection`、fail-closed、有测试）。
**不选 Typert `$mount` 自建 namespace**：官方文档对第三方插件如何生成 `typert.remote-client.*` 产物是空白（classmates 能用是因为仓内自行复刻了生成流程），风险高于收益。

### 存储选型

usage 聚合落 storage-domain（`openCompatibleDomain`），表结构对齐 zhihu：按日 × 插件 × 模型 × 用途 的 rollup 行；
保留期建议 30–90 天（ZCode 先例 30 天）。`llm/stream` 监听器只做计数与入队，**不在 waterfall 热路径做 I/O**。

### 自动触发纪律（仓规）

- `llm/stream` 是每次调用一次（非按线程放大），监听器安全，但必须保持近零开销、绝不改写深冻结的 options。
- `session/event` 回填历史用量时，用 `isSubagentSession` 决定子线程是否计入「按插件」口径（建议计入总量、单列子代理维度）。
- 用量统计是**只读观测**，不触发任何模型调用。

---

## 五、风险与待验证项

1. **插件归因覆盖率**：契约接入前「按插件」只有总量+未归因桶；需要在 plugin-kit 加 recorder 并逐个插件接入（dsh-recap、dsh-zhihu 等先行）。
2. **`llm/stream` 性能**：每次模型调用都过监听器；实现必须同步、无分配热路径、失败静默不阻断（waterfall 纪律）。
3. **文档空白项**（以运行时为准复核）：SettingsDescriptor 对 `x-model-route` 的投影保留（探针自检持续观测）；`remote.llm.*` 客户端可达性（按规则推断不可达，转发方案不依赖它）；`ctx.remote.$on` 事件转发白名单是否含 `llm/adapters-updated`。
4. **整页入口决策**：是否接受 `sidebar.panellist`+`main` 或右侧栏 tab 作为枢纽整页（超出仓规现状，需用户拍板；默认守住 `plugins.bundle.config` 多分区）。
5. **版本对齐**：devDeps 钉 `0.2.0-rc.2`，运行宿主为 0.2.x；升级时复核 `ModelCatalog`/`SettingsDescriptor` 字段。

---

## 六、建议的实施分期

- **P0 探针产品化**：模型字段矩阵的冲突/刷新/空态完善；保留 probe-report 落盘作为诊断。
- **P1 模型目录分区**：provider 分组浏览 + 默认模型展示 + 配置状态。
- **P2 用量统计**：host 侧 `llm/stream` 计量器 + storage-domain rollup + `usage.*` RPC + 图表分区；plugin-kit 加 `callLlmText` recorder 包装，仓内插件逐个接入。
- **P3（可选）整页入口**：`sidebar.panellist`+`main` 或右侧栏 tab；`settings.models.footer` 放入口链接。

---

## 七、评审结论与勘误（2026-10-06 晚，独立评审 + 主控逐项复核）

评审方式：内部子代理（ocg/step-5-preview）独立评审，结论经主控逐项对照源码与运行宿主实测复核。
总评：**有条件通过——P1 可先行；P2 方向成立但归因方案简化；P0 打回重修。**

### F1（致命，已复核成立）探测管线与 describe() 真实 schema 形态失配

`settings.describe().schema` 是 **schemastery 信封形态** `{uid, refs:{<uid>:{type, meta, dict}}}`
（子节点在 `dict`、值是 uid 引用、标记在 `meta['x-model-route']` 或 `meta.role`+`meta.extra`），
而 `detectModelFields`（`plugins/dsh-model-route/src/detect.ts`，已读确认）只解析 JSON Schema 形态
（`properties`/`items`/`anyOf`/`$ref '#/'`），顶层无 `type` 时直接返回空。
**实测证据**：`C:\Users\27837\.dsh\profiles\desktop\data\model-hub\probe-report.json`（2026-10-06T14:35Z）
= 21 个命名空间、0 个检出、entries 为空。仓内单测全部用合成 JSON Schema，从未暴露。

**修订**：P0 第一步不是 UI 打磨，而是给 model-route 检测器加**信封适配层**
（解 `{uid, refs}` → 归一为可遍历节点树，读取 `meta` 里的标记），并用真实投影做回归测试。

### F2（致命，已复核成立）volatile 闸门

`describe()` 只投影 volatile 配置字段；`modelRouteSchemastery`/`modelRouteRoleSchemastery`
（`plugins/dsh-model-route/src/schemastery.ts`，已读确认）都不标 volatile，hub 自己的 Config 也没标。
实测同一 probe-report：hub 自身命名空间根本没进投影（`ownSchema` 缺失），自检双通道 absent。

**修订**：model-route 契约的 schemastery/zod 两个 helper 补 volatile 标注，并写入契约文档；
hub 的自检字段同步补标。

### S1（严重，部分复核）冲突错误码归属层

`settings/conflict`/`settings/rejected` 是 remote.settings 远程层的 RemoteError 码（文档口径）；
hub 自建 RPC 直调 host `settings.mutate`，冲突抛出的具体错误类型在 `@deepseek-ai/dsh-settings`
类型包中不可见（已 grep 确认无 `SETTINGS_CONFLICT`），运行时形态需实测。
**修订**：P0 冲突处理按结构特征分类（同时兼容两种形态），不假设单一 code。

### S2（严重，已复核成立）assistant/attempt 不带 usage 字段

运行时 SessionEventMap：`assistant/attempt` 只有 `{turn, step, stream}`，usage 在 `assistant/message` 上。
失败调用的用量只能从 attempt 内嵌的紧凑 stream（`AssistantStreamRecord` 的 chunk 变体携带 StreamChunk）
展开回收，口径需写明。

### S3（严重，已复核成立，方案简化）单监听器即可同时拿 usage 与归属

`callLlmText` 已在 messages 里打 `source.kind = 'plugin:<包名>'`
（`plugins/dsh-plugin-kit/src/llm-call.ts:124-126` + `contracts.ts:24` `producerMessageSource`，已读确认），
对 `llm/stream` 监听器只读可见（`GenerateOptions.messages[*].source`）。
**修订**：P2 归因从「双轨（监听器 + recorder 包装）」简化为「**单个 llm/stream 监听器**」：
- messages 带 `plugin:*` source → 归因到该插件（kit 中介调用自动覆盖，无需各插件再接 recorder）；
- LOOP 请求（markAgentLoopRequest / 带 sessionId 的会话循环）→ 会话维度；
- `purpose: compaction/session-title` → 宿主功能维度；其余 → 未归因桶。
覆盖率与双轨相同，但不引入 recorder 契约。

### 其他修订

- **retention 补 prune**：zhihu 蓝本（usage.ts，已 grep 确认）只有 90 天查询上限、从不删旧行；
  hub 的 rollup 表必须带 prune（建议保留 90 天，写路径顺手删）。
- **llm/stream 热路径纪律**：监听器不得吞 chunk、不得抛错、不得改写深冻结 options；
  retry 重放可能双计 usage（同一逻辑调用多次 attempt），需实测去重口径（按 finish/usage 去重或按 attempt 计）。
- **P2 新依赖合规**：`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-storage-domain` 按仓规进
  peerDependencies 开放下界 + optional，devDependencies 钉版本。
- **P1 收窄第一刀**：modelCatalog 本身就是宿主用 listProviders/listModels/resolveModelInfo 组装的，
  自建 RPC 转发的增量只有 contextWindow/defaultMaxTokens/inputModalities 与
  listConfigurableProviders 的 declared/error；第一版目录分区可以只做客户端 modelCatalog 数据，
  RPC 转发留到确有需要时。

### 修订后的分期

- **P0 契约修复**（原「探针产品化」打回重修）：
  ① model-route 检测器加 schemastery 信封适配 + 真实投影回归测试；
  ② 契约 helper 补 volatile 标注；
  ③ 修复后用 probe-report 复测确认检出 > 0；
  ④ 然后才是矩阵 UI 的冲突/刷新/空态打磨。
- **P1 模型目录分区**：维持，仅客户端 modelCatalog 起步。
- **P2 用量统计**：单 llm/stream 监听器 + storage-domain 按日 rollup（含 prune）+ 图表分区。
- **P3 可选整页入口**：维持可选。

### 评审方法学限制（如实记录）

评审子代理的 cordis_inspect_query input 参数传递失败、client 平台查询超时（GUI 未连回），
其客户端侧主张以文档 + 安装包类型 + 实测序列化替代核实；
主控复核以仓库源码与运行宿主 probe-report.json 为准。
