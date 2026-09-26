# 插件管理器与实时检查

[English](../../areas/plugin-manager-inspect.md)

改当前 profile 用 `plugin_manager` 工具或 `dsh plugin`，不要手改 profile 的 `package.json`。查已挂载服务的方法签名用 `cordis_inspect_query`。这两个工具都会要求 `danger-full-access` 或一次审批。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

`@deepseek-ai/dsh-plugin-manager` 管理当前 profile：列出并切换插件行，列出并切换 bundle，通过 pnpm 安装和移除 bundle，并记录精确版本的兼容豁免。Web 侧栏和 `plugin_manager` 工具共用这项服务。

`@deepseek-ai/dsh-tool-cordis` 是面向模型的、检查正在运行的组合的表面。它不安装包。

## 它在哪里

- 管理器：[packages/boot/plugin-manager/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/plugin-manager/README.md)
- 工具参数：[packages/boot/plugin-manager/src/tools.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/plugin-manager/src/tools.ts)
- 扩展分组：[packages/extensions/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/extensions/README.md)
- 检查工具：[packages/extensions/tool-cordis/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/extensions/tool-cordis/README.md)
- 动态 Cordis 实践：[docs/user/develop/practice/dynamic-cordis.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/dynamic-cordis.md)

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

每个动作都经过一次审批升级，请求的模式是 `danger-full-access`。理由写明 profile 变更会持久化，并且安装的宿主代码在工作区沙箱之外运行。只在用户批准那些安装脚本之后才传入 `approvedBuilds`。服务记录这些名字；它不检查对话。

工具背后的服务方法包括 `listPlugins`、`listBundles`、`setPluginEnabled`、`setBundleEnabled`、`installBundle`、`removeBundle`、`inspect`、`listVersionExemptions`、`setVersionExemption`、`waitForInstall` 和 `cancelInstall`。事件包括 `plugin-manager/changed`、`plugin-manager/install-log` 和 `plugin-manager/install-state`。

写明的管理器配置默认值包括 `pnpmCommand` 为 `pnpm`，`inspectTimeoutMs` 为 20000，`githubConnectionTimeoutMs` 为 5000，`fallbackRegistries` 为 `['https://registry.npmmirror.com/']`，`outputBytes` 为 16384，`lockWaitMs` 为 120000，服务运行的 `idleTimeoutMs` 为 600000。继承了终端的 CLI 运行不受 `idleTimeoutMs` 约束。

激活结果区分为 `applied`、`restart-required`、`failed` 和 `overridden`。替换已安装的包需要进程重启，才能加载新一代 JavaScript 模块。HMR 可以应用新安装的 bundle。管理器不能禁用自己的管理组件，不能改另一个 profile，也不能编辑 agent preset 的组合。

扩展分组记录的检查工具是 `cordis_inspect_list` 和 `cordis_inspect_query`。插件开发技能告诉 agent，在写插件之前先查询 `Service`、`Event`、`Config.listConfigs`、`Tool`、`Slots` 和 `Theme`。按包 `name` 过滤的 `Config.listConfigs` 给出一个 `entry` id；查询那个条目会返回 `packageDir`，`README.md` 和 `lib/types` 就在那里。`ctx.cordisInspect` 和 `ctx.dynamicCordisRunner` 来自 `cordis-host-runner`。

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
- [docs/user/develop/practice/dynamic-cordis.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/dynamic-cordis.md)
- [packages/bundle/base/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/base/cordis.patch.yml)
