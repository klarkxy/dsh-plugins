# 蓝图

[English](README.md)

在 **DSH 官方插件管理器**内导入、导出插件组合：蓝图码只分享插件、精确版本和顺序；可复用的默认配置交给原生组合插件。无需安装 Spaces，无需独立客户端、Supervisor 或云账户。

**当前为源码预览版本，尚未发布到 npm，也未完成真实 DSH 端到端验收。** 已执行检查与剩余验收见 [ACCEPTANCE.md](ACCEPTANCE.md)。

## 安装与入口

需要提供官方 `pluginManager`、`profileContext`、已鉴权 Connection/WebServer 和插件配置 slot 的 DSH Web 宿主。启动会检查所需能力；仅凭版本号不声称兼容。接口核对基于上游提交 `477b4f420553e8a52c2fbccc464d7561b239c443`，具体 npm 或桌面版本仍需实际验收。

```sh
cd plugins/dsh-blueprint
npm test
npm run build
npm pack
# 使用 npm pack 输出的归档路径，并明确目标 profile：
dsh plugin --profile <目标profile> add /绝对路径/klarkxy-dsh-blueprint-0.1.0-alpha.2.tgz
```

包没有 npm 依赖和编译要求，复用宿主服务与 React。支持 `plugins.list.actions` 的宿主在插件列表顶部显示 **蓝图 → 导入蓝图 / 导出蓝图**。未接入该插槽的宿主可通过 **插件 → 蓝图** 使用相同的蓝图操作；其他包详情页不再放“分享蓝图”。

官方 DSH 0.1.7-rc.2 尚无列表顶部插槽，需要配套[宿主接入补丁](https://github.com/klarkxy/dsh-plugins/tree/main/host-integration/blueprint-list-actions)。仅安装本插件不能让当前官方宿主顶部出现按钮。

## 创造模式

加载插件后，创造模式（`cordis`）自动收到随包分发的[蓝图 skill](skills/dsh-blueprint/SKILL.md)，包含蓝图码制作、分享、导入预览和原生组合插件的复用边界。指引正文直接注入系统提示，不依赖技能目录或单独的 skill 工具；其他模式不注入，切换离开创造模式后下一次提示组装不再包含它。注册跟随插件及提示词服务的生命周期；没有提示词服务的宿主仍可正常使用插件页面。

该 skill 依赖插件页面、格式校验和编解码接口；发现插件时，在已加载 `@klarkxy/dsh-dev-index` 的情况下使用其只读插件元数据工具。不新增模型安装或应用工具，也不把制作蓝图视为导入或发布授权。没有页面操作能力时，智能体可以准备、检查 JSON 并说明剩余操作，但不能声称已经导入。

## 插件发现

本插件不再附带查询工具。发现候选插件、钉精确版本请使用 [`@klarkxy/dsh-dev-index`](https://www.npmjs.com/package/@klarkxy/dsh-dev-index) 的 `dsh_plugins_search` / `dsh_plugins_fetch`，它们只读查询 klarkxy 插件目录和公开 npm 元数据，不安装任何东西。安装与卸载一律走官方插件管理器，包括没有注册表元数据的 `github:owner/repo#commit` 规格。实际安装与目标兼容性仍由原生导入预览核验；宿主内置组合包以当前宿主为准。

## 导出

**导出蓝图**：选择插件，检查并用上移／下移调整建议顺序，生成蓝图码并复制。建议顺序用于安装缺失包和追加尚未启用的组合层，不会覆盖接收方已有顺序。蓝图不包含配置或插件行启停状态。

## 导入与现有环境

在文本框粘贴蓝图码，预览版本、安装／启用操作和最终顺序，确认后执行。安装通过官方管理器完成，不自动授权构建脚本；启用会执行插件代码。版本或来源冲突会阻止执行，不自动升级、降级或换源。

已有的完整启用顺序保持不变，匹配的包直接复用。缺失的包按蓝图清单安装，蓝图请求启用但当前未启用的组合层按建议顺序追加到末尾。顺序不同本身不构成冲突；不会因为分享方未启用某项而停用本地插件。重复导入且状态未变时无新动作。

## 用组合插件复用默认配置

原生组合包可以声明所需插件依赖，并在自己的 `cordis.patch.yml` 中明确加载组件、指定默认配置；配置预设包也可以覆盖已有组件行。只声明依赖不会自动递归启用所有依赖包，组合作者需要明确加载哪些组件，避免同一组件行被重复加载。

沿用 DSH 原有配置层规则：后面的层优先，行补丁替换整段 `config`，并非字段深度合并；用户自己的 profile／home 配置可以覆盖组合包默认值。密钥、凭据和本机私有数据不应打进共享包。参见[对应版本的官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/docs/user/develop/basic/publish.md#the-loading-order)。

蓝图不提供设置导入／导出、设置字段筛选或分享策略，也不读取或写入设置、schema、凭据或插件存储。组合包本身的补丁仍可能影响生效默认值，因此新启用的组合层仍需核对预览。
## 格式

完整字段、导入语义、编码规则和可验证示例见 [蓝图码协议](PROTOCOL.md)。

格式为 `kind: "dsh-blueprint"`、`formatVersion: 2`。`packages` 记录精确版本和 `npm` / `builtin` 来源；`bundles` 记录请求启用的组合层及建议顺序。蓝图禁止包含 `settings` 或 `rows`，未知字段和其他文档类型会被拒绝。最小示例及字段规则见英文文档的 Portable format v2。

分享码统一为 `DSHBP2:<内容>`：JSON → UTF-8 → raw DEFLATE → 无填充 Base64url。界面导入、导出都只使用这种蓝图码；JSON 是内部数据结构。最大 JSON 1 MiB、输入分享码 2 MiB、64 层 JSON 容器；宿主传输的请求大小限制也生效。重复键、不安全数字、原型键、损坏 Unicode、非规范 Base64url 和压缩尾随数据拒绝读取。编码不是加密、签名或作者认证。

只支持可确认的精确 npm 来源与宿主内置组合包。本地链接、git/tarball、别名和版本冲突会列出，不悄悄改源。官方管理器不列为组合包的普通依赖由包管理器负责。

## 执行边界

复用官方 Connection 的鉴权与 Host/Origin 检查，不启动第二个服务器。预览计划只保存在当前进程，五分钟过期、单次消费，最多保留八个计划或结果；实际观测变化使旧计划失效。已完成的结果可读取，不重新执行。

不自动重试、升级、降级、授权脚本、卸载、跨 profile 写入或整组回滚。原生安装器自己的失败行为保持不变。多步骤导入不是全局事务，也没有锁住所有其他编辑器；执行期间请勿在其他窗口同时改该 profile。中途失败保留已完成结果；响应丢失不表示可以重放。关闭页面会在支持时请求取消，已经完成的更改可能保留。

`npm test` 为无外部依赖的单元、接口适配和界面注册测试；`npm run build` 为语法检查，不等于真实宿主或 TypeScript 验收。所有测试只使用临时目录，不接触真实 DSH Home。

MIT；原 Spaces 编解码器的版权说明保留在 [NOTICE.md](NOTICE.md) 与 [LICENSE](LICENSE)。
