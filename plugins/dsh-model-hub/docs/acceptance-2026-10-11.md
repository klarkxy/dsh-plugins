# 模型集中选择修复验收（2026-10-11）

> 历史验收记录：文中队友角色插件已于后续清理中移除；以下保留当时的测试事实，不代表当前工作区仍包含该插件。

本次修复补齐会话标题、Git 提交、安全审核、队友角色及模型用途预设、ChatGPT 的
模型设置来源。各插件主动提供模型字段并复用自己的保存接口，不读取其他插件私有存储。
第三方 volatile 模型字段继续使用原生设置投影发现。

界面改为紧凑的插件分组和用途行，支持搜索插件、字段和当前模型。自检字段仅留在
诊断报告中；读取与保存失败会显示原因。刷新同时读取设置与模型目录，保存期间锁住
其他编辑，冲突后要求刷新再选择。插件重新加载后，旧页面不能写入新的实例。

ChatGPT 使用独立 Codex 目录；队友预设引用保留，在预设行修改模型。各来源保留
自己的默认模式和思考强度限制。原生根字段、嵌套字段以及交集 schema 内的附加设置
使用模型叶字段操作，保留提示词等无关内容。

## 验证结果

- 最终 `pnpm check` 退出码 0：发布目标检查、离线站点测试、全部构建、客户端打包
  检查、类型检查、插件测试及打包检查通过。现有 Git symlink 测试因 Windows 权限跳过 1 项。
- `pnpm test:e2e:model-hub` 退出码 0：浏览器加载最终 `lib/client.js` 构建产物，
  通过注册的插件配置入口验证键盘选择、焦点回归、搜索、目录隔离、冲突恢复、双路
  刷新及读取失败时保留内容。桌面 1080px、手机 390px 无横向溢出，无浏览器页面错误。
- 所属插件测试覆盖 CAS、其他设置保留、审批失效、队友引用与条目版本、外部目录
  及卸载。原生回归使用真实 `SettingsForms@0.2.0-rc.2`，覆盖选择与恢复默认两条路径。
- 独立代码复查发现的交集字段数据丢失和包装字段标记丢失均已修复并复核通过。

浏览器验收使用仓库的 UI 组件替身、隔离设置数据和真实 Cordis 贡献事件；不代表已
替换或重启安装中的 DSH Desktop。没有发布 npm 包、提交或推送。原有存储无需迁移；
回退代码不会改写保存的数据。生效时须使用对应更新后的插件及共享包。

截图与结构化结果由浏览器回归生成于 `e2e/out/model-hub-settings/`，全仓检查日志位于
`.scratch/model-hub-check.log`，均为忽略的测试产物。

## 契约依据

- 同族参考：`H:/Refernece/ZCode/packages/services/src/setting/normalizeSettingsPatch.ts`
  和 `packages/services/src/subagents/subagentModelSelection.ts`，分别展示所属设置默认
  语义和子代理选择归一化。未把 ZCode 的字段名或 RPC 当作 DSH 契约。
- DSH 实际依赖：`plugins/dsh-model-hub/node_modules/@deepseek-ai/dsh-settings/lib/index.js`
  的 `describe` 只投影活动 volatile 配置；`mutate` 校验版本并在 unset 时恢复继承值。
- 事件生命周期：`plugins/dsh-model-hub/node_modules/@deepseek-ai/cordis/src/events.ts`
  的 `parallel` 等待监听器完成，`register` 随所属 fiber 回收。新增入口另外防止已捕获
  的引用在卸载后被使用。

新增公共入口和探测元数据按库的版本约定提升次版本：`dsh-plugin-kit` 为 `0.3.0`，
`dsh-model-route` 为 `0.2.0`。本次仅更新本地源代码、锁文件和构建产物。

## 自动同步追加验收

模型保存成功后，所属插件通过 `model-settings/changed` 通知枢纽的原生远程流；
原生设置保存继续使用 `settings/document-updated`。通知只包含命名空间和版本，
各页面重新读取所属插件的权威设置。共享客户端订阅声明远程容器及服务两项依赖，
由宿主负责连接恢复、服务重挂载和卸载取消。

没有未保存修改的页面自动采用最新设置；有草稿的页面保留草稿和原版本，显示外部
变更提示，明确丢弃并重新加载后才采用新设置。标题提示词遇到外部变更时停止失焦
自动保存，防止旧草稿覆盖新模型。读取和保存中的通知合并处理，过期结果不覆盖新状态。

### 当前通过的证据

- 最终 `pnpm check` 退出码 0，包含全部构建、类型检查、测试和打包检查；Windows
  Git symlink 权限测试仍跳过 1 项。日志：`.scratch/model-hub-sync-check.log`。
- 真实 Cordis 和原生 Gateway 的共享订阅测试 7/7 通过，覆盖消费者未自行注入
  remote、服务挂载、卸载、重挂载、取消，以及通知监听器失败不影响已提交保存。
- 已打包的八个本地包在隔离 DSH `0.2.0-rc.2` 中加载，使用宿主原生页面和官方组件，
  无组件替身。真实浏览器交互从枢纽恢复默认再修改，已打开的 Current Title、Git
  Commit、Safe Auto、Classmates Researcher 页面均自动显示 `ocg / mimo-v2.6-flash`；
  ChatGPT 页面自动显示其独立 Codex 目录的 `gpt-6.1-sol`。
- 同一真实交互验证标题未保存草稿保留、外部变更提示、明确丢弃后采用最新设置，
  以及 Git Commit 原插件页保存后已打开枢纽反向更新；页面错误为 0。
- 真实宿主暴露了两个此前构建和替身测试未发现的问题，均已修复后复验：Hub 标准
  装饰器需要在打包时转换，构建增加 `node --check`；共享订阅子作用域必须同时注入
  `remote` 和 `remote.modelSettingsChanges`。ChatGPT 客户端补齐原生远程和本地化模块声明。

真实页面的结构化结果与限定在模型设置区域的截图位于
`.scratch/model-hub-sync-ui-20261011/`，其中 `ui-result.json` 记录上述交互结果，
`packages.json` 记录最终包内容哈希。界面测试使用不含密钥的模型目录配置，
没有触发外部推理请求。

### 实际调用追加结果

用户指定使用 OCG MiMo。当前 OCG 公共路由元数据确认发布 ID 为
`mimo-v2.6-flash`，使用 Chat Completions。用户仅在隔离 DSH 的本地 Key 表单填写
并保存凭据后，使用同一组最终包完成以下真实调用；没有读取、复制或输出密钥。

| 功能 | 原生入口与观察结果 |
| --- | --- |
| Current Title | 从枢纽保存固定 MiMo 后，`currentTitle.regenerate` 完成原生标题刷新，结果 source 为 `@klarkxy/dsh-current-title`；对应 `session-title` 请求为 `ocg / mimo-v2.6-flash`，终态 `stop`。 |
| Git Commit | `gitCommit.commit` 在独立测试仓库生成并提交 `c59777a`；返回 `fallback:false`，模型为 `ocg / mimo-v2.6-flash`，source 为 `page`，实际仓库干净。 |
| Safe Auto | 通过正常认证的原生控制入口为顶层测试会话启用 Safe Auto；原生 `pwsh` 单次审批触发 MiMo 审核请求，终态 `stop`，随后审批决定与工具结果出现，无害命令返回 `DSH-SAFE-AUTO-OK`。没有直接调用 reviewer 函数代替审批链。 |
| Classmates | 从枢纽重新保存 Researcher 固定 MiMo，再从所属页面启用角色；原生运行时确认 `subagent_researcher` 已挂载，通过该真实专属工具执行管线派发（不传 `model_profile`），子线程 `44c63be7-3ca2-4e96-851b-a30b6b852d74` 的实际 MiMo 请求终态 `stop`，专属工具结果 `isError:false` 并返回 `DSH-CLASSMATES-MIMO-OK 15`。 |

队友角色默认停用；枢纽修改模型保留开关，不应自动启用。验收最初漏了这个准备
步骤，后经原页面启用确认专属工具出现。主模型自行选择通用 subagent 或复述之前
标记的轮次不计入专属角色验收；最终证据来自实际 DSH 原生工具执行管线和子线程请求。

Safe Auto 初次测试使用斜杠形式的 Windows 路径，触发 `LOCAL_EXECUTION_UNVERIFIED`；
按宿主 `fs-local.processPathFromHostPath` 的原生路径表示重建会话后通过，没有放宽
插件身份校验。过程中 OCG 进程与监听端口发生变化，传输失败轮次不计作成功；
隔离供应商地址按实际监听恢复，最终 OCG 日志也记录了 MiMo HTTP 200 / success。

上述真实调用与此前真实页面验收的八个包内容哈希逐一一致。调用证据位于
`.scratch/model-hub-sync-20261011/`：`call-traces-first.json`、
`safe-call-result.json`、`call-traces-safe-and-generic.json`、
`classmates-native-call.json`、`classmates-call-traces.json`、`gateway-result.json`。
其中 Gateway 证据仅保留模型、时间、状态及尝试次数，未保留账号、请求正文或请求头。

ChatGPT 使用独立 Codex 调用域，本轮只验证其页面自动采用 Codex 设置；OCG MiMo
不能作为 ChatGPT 实际推理验收路线，未触发 ChatGPT 推理。原生工具自动选择不属于
本次配置同步的验收结论。

本次没有修改日常 DSH Desktop 的配置，没有提交、推送或发布 npm 包；仅验证隔离
宿主中的最终本地包。测试宿主已停止，其临时认证 URL 已删除；用户保存的隔离原生
凭据没有擅自删除。原生流重连的覆盖来自实际 Gateway 测试，未做长期稳定性运行。
