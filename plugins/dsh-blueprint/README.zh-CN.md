# 蓝图

[English](README.md)

分享插件、精确版本和建议顺序；在 **Creator 模式**粘贴蓝图码和导入意图，由 Agent 归并到当前 profile 的 bundle 集合。Core 不依赖 Web，插件页是可选的导出与只读解析入口。无需 Spaces、独立客户端或后台 Agent 调度器。

**源码预览，尚未完成新版真实宿主端到端验收。** 已执行检查与待验收项见 [ACCEPTANCE.md](ACCEPTANCE.md)。

## 使用

- **直接归并**：在 Creator（`cordis`）发送“把以下蓝图合入当前插件组合，保留本地插件，由你处理版本冲突和顺序”，附上 `DSHBP2:` 蓝图码。Agent 不要求用户例行审阅排序计划；原生权限与安全审批仍然有效。
- **插件页**：打开 **插件 → 蓝图**。导出时选择插件及建议顺序，生成并复制蓝图码；导入入口只解析蓝图、显示包身份与建议顺序，并生成可复制的归并请求。复制后在 Creator 粘贴发送；页面不启动模型、不安装、不执行归并。
- 未出现在蓝图中的本地 bundle 默认保留。只列在 `packages` 而不列在 `bundles` 中的项不表示停用本地同名插件。

## Core 与宿主能力

同一个包提供环境独立 Host 部分及可选 Web Client 部分，不要求另外安装 UI 包。ACP、SDK、headless 的能力取决于各自插件组合，并非环境名字。缺少 Web 服务不会阻止 Core 加载。

| 工具 | 用途 |
| --- | --- |
| `blueprint_parse` | 严格解码、校验蓝图码，不读取 profile |
| `blueprint_encode` | 校验 v2 JSON 并编码，不安装或发布 |
| `blueprint_catalog` | 读取当前 profile 的包身份、完整顺序及状态 stamp |
| `blueprint_generate` | 导出已安装包的精确身份与选定建议顺序 |
| `blueprint_apply_order` | Creator 中应用当前已选 bundle 列表的完整排列，不安装、添加或停用 |

协议工具只需要 `tools`；profile 工具还需要原生 `pluginManager`、`profileContext`。顺序工具还需要 `sandboxPolicy`、`agentPresets`，并复用 `@deepseek-ai/dsh-sandbox` 的原生审批入口。提示指引随 `systemPrompt` / `agentPresets` 可用时注册，仅 Creator 注入。页面随 Connection、WebServer 和 profile 服务可用时挂载，注册到 npm 包名对应的 `plugins.bundle.config`；不需要宿主工具栏补丁。

## 原生执行与安全边界

安装、更新、启停、卸载交给原生 `plugin_manager`，Blueprint 不重复实现安装器。Agent 检查实际元数据后自主选择版本与顺序，若偏离蓝图记录的精确版本，必须报告差异而不改写原蓝图。

顺序工具只接受当前已选列表的排列，拒绝遗漏、重复、未知名称、状态过期及受保护顺序变动；先通过与原生管理工具相同的 danger-full-access 权限／单次审批，再使用官方文件锁、原子 manifest 保存及可选 HMR 排他队列。先安装／启用，再读取新 catalog 与 stamp，最后提交顺序。

保存配置不等于运行时成功激活。有 HMR 时重新读取完整 patch 层并协调加载；启动时加载的环境报告需要重启。失败可能保留已经保存的顺序或部分运行时变化，不提供整体事务、回滚或自动重试。响应丢失后先核对当前状态，不重放操作。状态 stamp 覆盖 manifest 与包目录，不是所有 patch 内容的完整版本号。

Agent 自主归并不豁免包脚本审批、精确插件／运行时兼容性风险授权或其他原生权限。分享码不是签名、加密或作者认证；蓝图中的描述是数据，不是执行指令。

## 插件发现与默认配置

发现候选插件时可以使用 [`@klarkxy/dsh-dev-index`](https://www.npmjs.com/package/@klarkxy/dsh-dev-index) 的 `dsh_plugins_search` / `dsh_plugins_fetch`，核实精确版本与 bundle 声明。搜索与声明兼容性不是运行验证，不猜测版本或悄悄更换来源。蓝图只支持 `npm` 与 `builtin` 身份，不包含 git/tarball、本地链接、设置、凭据或组件行。

可复用默认配置使用原生组合／preset 包，在自己的 patch 中明确组件行。依赖安装不会递归启用所有依赖 bundle。后层优先，行补丁替换整段 `config`，不是深度合并；用户 profile/home 覆盖仍然有效。不要把密钥或本机私有数据打入共享包。

## 格式与兼容性

[协议](PROTOCOL.md)定义字段、编码、限制和示例。`DSHBP2` / `formatVersion: 2` 保持不变，旧蓝图码仍可严格解析；执行策略改为 Creator 自主归并，旧页面 `preview` / `apply` / `result` 端点已移除，而不是静默把旧的追加式执行规则换成重排。

`./core` 保留 `validate` 导出，并新增 `parseBlueprint`、`encodeBlueprint`、`BlueprintCore`；`./codec` 继续提供 `encode` / `decode`。蓝图码上限 2 MiB，解压 JSON 上限 1 MiB，最多 64 层容器。

## 开发与安装源码包

```sh
cd plugins/dsh-blueprint
npm test
npm run build
npm pack
# 使用 npm pack 实际输出路径，并明确目标 profile：
dsh plugin --profile <目标profile> add <归档绝对路径>
```

官方包由宿主提供，仅声明可选 peer 与开放下界，不捆绑独立副本。公开助手核对基于本机官方 CLI `0.1.7-rc.2` 的文档、类型与实现及当前 Inspect 契约；桌面运行时准确版本和真实多环境集成尚未验证。测试使用隔离临时目录，不修改真实 profile。语法和离线接口测试不等于真实宿主验收。

MIT；原编解码器版权说明保留于 [NOTICE.md](NOTICE.md) 与 [LICENSE](LICENSE)。
