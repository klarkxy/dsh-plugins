# 插件管理器与实时检查

[English](../../areas/plugin-manager-inspect.md)

改当前 profile 用 `plugin_manager` 工具或 `dsh plugin`，不要手改 profile 的 `package.json`。查已挂载声明用 `cordis_inspect_list` 和 `cordis_inspect_query`。这两类工具的审批要求不同。

`plugin_manager` 的每个动作，包括 `list_plugins` 和 `list_bundles`，都会在接触 profile 之前调用 `approveEscalation`，请求的模式是 `danger-full-access`。会话如果还不在该模式，这一次调用需要单独审批。该审批不会改变会话的权限模式。官方技能 `cordis-plugin-development` 说，只有结果会决定下一步时才调用 `plugin_manager`。

`cordis_inspect_list` 和 `cordis_inspect_query` 不会发起这次升级，也不请求 `danger-full-access`。同一份技能要求用 `cordis_inspect_query` 确认新安装的插件。它不需要审批，不要反复翻页调用 `list_plugins`。查询实现只跑只读的检查方法。环境自己的工具权限策略仍然适用，例如 `tools/pre-execute` 和会话的沙箱模式，和其他工具一样。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

`@deepseek-ai/dsh-plugin-manager` 管理当前 profile：列出并切换插件行，列出并切换 bundle，通过 pnpm 安装和移除 bundle，并记录精确版本的兼容豁免。Web 侧栏和 `plugin_manager` 工具共用这项服务。

`@deepseek-ai/dsh-tool-cordis` 是面向模型的、检查正在运行的组合的表面。它不安装包。

## 它在哪里

- 管理器：[packages/boot/plugin-manager/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/plugin-manager/README.md)
- 工具参数：[packages/boot/plugin-manager/src/tools.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/plugin-manager/src/tools.ts)
- 扩展分组：[packages/extensions/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/extensions/README.md)
- 检查工具：[packages/extensions/tool-cordis/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/extensions/tool-cordis/README.md)
- 动态 Cordis 实践：[docs/user/develop/practice/dynamic-cordis.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/dynamic-cordis.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/practice/dynamic-cordis)）
- 查询工具实现：[packages/extensions/tool-cordis/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/extensions/tool-cordis/src/index.ts)
- 插件开发技能：[packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md)

base 补丁随发行 `plugin-manager`，并让 `tool-plugin-manager` 保持禁用，直到某个 profile 启用它。cordis 插件开发技能说，行 id 和原因写在随发行的补丁里。

## 约定

工具 schema 里 `plugin_manager` 的 `action` 值：

| 动作 | 作用 |
| --- | --- |
| `list_plugins` | 分页列出插件行。 |
| `list_bundles` | 分页列出 bundle。 |
| `set_plugin` | 启用或禁用一行。 |
| `set_bundle` | 启用或禁用一个 bundle。 |
| `install_bundle` | 安装一个包并选中它的 bundle。 |
| `remove_bundle` | 移除一个 bundle。 |
| `list_version_exemptions` | 显示运行时版本和已保存的授权。 |
| `set_version_exemption` | 为精确的 DSH 运行时授予或撤销精确的 `package@version`。授予要求 `acceptRisk: true`。 |

其他参数：`target`、`enabled`、`runtimeVersion`、`acceptRisk`、`approvedBuilds`、`registry`、`offset`、`limit`。列表页默认 offset 为 0、limit 为 25，limit 从 1 到 100。

每个 `plugin_manager` 动作都经过上面的审批升级。理由写明 profile 变更会持久化，并且安装的宿主代码在工作区沙箱之外运行。只在用户批准那些安装脚本之后才传入 `approvedBuilds`。服务会校验待批准的包名；它不核对对话里是否真的批准过。

工具背后的服务方法包括 `listPlugins`、`listBundles`、`setPluginEnabled`、`setBundleEnabled`、`installBundle`、`removeBundle`、`inspect`、`listVersionExemptions`、`setVersionExemption`、`waitForInstall` 和 `cancelInstall`。事件包括 `plugin-manager/changed`、`plugin-manager/install-log` 和 `plugin-manager/install-state`。

写明的管理器配置默认值包括 `pnpmCommand` 为 `pnpm`，`inspectTimeoutMs` 为 20000，`githubConnectionTimeoutMs` 为 5000，`fallbackRegistries` 为 `['https://registry.npmmirror.com/']`，`outputBytes` 为 16384，`lockWaitMs` 为 120000，服务运行的 `idleTimeoutMs` 为 600000。继承了终端的 CLI 运行不受 `idleTimeoutMs` 约束。

激活结果区分为 `applied`、`restart-required`、`failed` 和 `overridden`。替换已安装的包需要进程重启，才能加载新一代 JavaScript 模块。HMR 可以应用新安装的 bundle。管理器不能禁用自己的管理组件，不能改另一个 profile，也不能编辑 agent preset 的组合。

扩展分组记录的检查工具是 `cordis_inspect_list` 和 `cordis_inspect_query`。它们在 [packages/extensions/tool-cordis/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/extensions/tool-cordis/src/index.ts) 里的注册没有调用 `approveEscalation`。查询只读声明和运行时信息：服务方法、事件模式、已挂载插件的配置 schema、工具 schema、主题令牌，以及实时槽位树。它不能调用业务服务方法，不能配置插件，不能改运行时，也不能执行生成出来的代码。宿主查询在本地运行。客户端查询要等第一个有效的页面响应，在页面回答或工具被取消之前一直挂起。`Config.listConfigs` 只走 profile 的加载树。只出现在 agent preset 的 `plugins` 列表里、profile 树没有挂载的插件，不会被列出来。

插件开发技能告诉 agent，在写插件之前先查询 `Service`、`Event`、`Config.listConfigs`、`Tool`、`Slots` 和 `Theme`。按包 `name` 过滤的 `Config.listConfigs` 给出一个 `entry` id；查询那个条目会返回 `packageDir`，`README.md` 和 `lib/types` 就在那里。`ctx.cordisInspect` 和 `ctx.dynamicCordisRunner` 来自 `cordis-host-runner`。

## 插件作者怎么用

- 用 `install_bundle` 和包目录的绝对路径安装你的 bundle，或用 `dsh plugin --profile <name> add`。不要自己写 `$DSH_HOME/profiles/<name>/package.json`。
- `application: applied` 之后，用 `cordis_inspect_query` 确认那一行，不要假设补丁文本已经生效。
- 在检出里读 `src/` 之前，先读 `<packageDir>/README.md`。已安装的包携带的是 `lib/`，不是 `src/`。
- 动态挂载用于现场实验。能在重启后留下的是 bundle 补丁。实践指南负责动态路径。

## 来源

- [packages/boot/plugin-manager/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/plugin-manager/README.md)
- [packages/boot/plugin-manager/src/tools.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/plugin-manager/src/tools.ts)
- [packages/extensions/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/extensions/README.md)
- [packages/extensions/tool-cordis/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/extensions/tool-cordis/README.md)
- [docs/user/develop/practice/dynamic-cordis.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/dynamic-cordis.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/practice/dynamic-cordis)）
- [packages/extensions/tool-cordis/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/extensions/tool-cordis/src/index.ts)
- [packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md)
- [packages/bundle/base/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/base/cordis.patch.yml)
