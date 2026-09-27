# Settings scope / 设置范围

Decision date: 2026-09-27. Applies to `@klarkxy/dsh-blueprint@0.1.0-alpha.2`.

## 中文：只对接官方配置契约

蓝图以 **官方 Config / Settings 暴露的可编辑字段** 为唯一设置数据来源，不以任意自定义页面的控件或可见字段为准。插件管理器是操作入口，不是所有第三方数据存储的统一协议。

| 情况 | 行为 |
| --- | --- |
| 活动插件通过官方 Settings 暴露可唯一定位的 volatile 字段 | 可导出已保存的生效值；导入使用原生逐字段修改与 revision 检查。 |
| 插件自己画 UI，但仍使用同一官方 Settings 数据接口 | 原生字段照常支持，不分析 UI，也不按页面显示的子集自动裁剪。 |
| 插件只使用自定义页面、自建接口、文件、localStorage 或数据库 | 不读取、不推断、不适配；其插件清单和可管理的启用状态仍可分享。 |
| 插件未启动、已禁用或没有原生表单 | 不读取底层 Config 或旧存储作为替代；不可用设置会报告。 |
| 接收者没有匹配的原生表单或可编辑路径 | 设置预览明确阻止写入，不默默忽略、不创建自定义设置。 |

### 数据来源与写入

读操作只使用 `settings.describe({ redactSecrets: true })` 返回的原生描述符值，校对官方插件清单、包/行/模块身份和可修改性；只读取 Loader 的 schema 元数据检查 volatile 与 secret 标记，不从运行时 Config 抽取隐藏值。文件读取只用于 profile/package manifest 的组合顺序、包身份和声明式分享策略，不遍历插件设置目录。

不再维护 Shell、搜索等页面的手写字段映射，不接收浏览器上传的页面 ledger 作为授权依据，不枚举或解析第三方 React 表单，不安装页面专用导出回调。`autoGenerate: false` 只是呈现策略，不会使仍由官方 Settings 提供的数据失去支持。

导入只通过 `settings.mutate` 写入明确的字段路径和读取时的修订号，由 Host 验证完整 Config 并持久化；不整段替换脱敏对象，不修改未提及的设置。非原生路径、秘密路径及作者禁止路径不能因蓝图自行声明而获得权限。

### 分享默认值与责任边界

没有作者声明时，原生范围内的公开可编辑字段默认包含。`dshBlueprint.entries` 是本插件可选的声明式缩小规则：`exclude`、`include`、`share: false`；它不能扩展到官方数据接口以外，也不是自定义存储的适配器。宿主已标记的秘密始终排除；用户可取消表单或字段。未知的私密文本无法保证自动识别，发布前需要检查预览。

“自定义配置不支持”是当前产品的明确范围，不是承诺以后为每个插件补适配。希望参与配置分享的作者应使用官方 Config / Settings 接口；现有自建配置的迁移由插件作者处理，蓝图不提供扫描、备份或自动迁移。

### 兼容性与失败说明

此版本取消 alpha.1 中按页面 slots 选择表单和四组手写页面字段映射的行为；分享范围以官方原生描述符为准，因此同一原生表单可能比某个自定义页面显示的字段更多。导出界面和 JSON 预览必须如实展示字段，用户或作者可以进一步缩小。

蓝图仍使用格式 v2 / `DSHBP2`。接收旧的 v2 数据时，所有设置仍需通过当前原生身份、schema、作者策略和秘密检查。未识别的自定义路径会阻止设置阶段。预览、分阶段执行和部分失败报告不提供跨阶段事务保证；安装阶段已经完成的操作不会因后续设置不支持而自动回滚。

## English: native configuration contract only

The sole settings source is the **editable data exposed by official Config / Settings**, not the controls or visible subset of an arbitrary custom page. The official plugin manager supplies the user entry point; registering a UI does not make a third-party storage format part of this contract.

Active, uniquely addressable native volatile fields support export of saved effective values and import through revision-fenced path edits. A custom UI that uses the same native Settings contract remains supported at the data level, including when `autoGenerate` is false. No UI inspection or special adapter is needed or promised.

Custom-only pages, APIs, local files, browser storage and databases are out of scope. Their packages and manageable activation state remain shareable. Missing/inactive native forms have no raw-Config or filesystem fallback. Incoming settings without an exact native form or editable path block the settings preview instead of being silently ignored or written elsewhere.

The reader consumes only `settings.describe({ redactSecrets: true })` values. Native manager records and Loader schema metadata establish identity, writability, volatile fields and secret protection. Loader Config values are not an export source. File reads are limited to profile/package manifests for order, package identity and declarative policy. There is no client-supplied page ledger, hand-maintained field table, DOM/React inspection, storage crawl or page-specific export callback.

Writes use official `settings.mutate` with explicit paths and the observed revision. Host validation and persistence stay authoritative. Unmentioned values remain local; a redacted object is never used as a whole-form replacement. A blueprint cannot grant itself access to nonnative or secret paths.

No author policy means include the public native editable fields by default. The optional `dshBlueprint.entries` policy can only narrow that set; it cannot grant access to another data source. Host-marked secrets remain excluded, users can deselect fields, and unmarked private text still needs review. Custom-storage adapters and automatic migrations are deliberately not part of this product.

This supersedes alpha.1's page-ledger filtering and four hard-coded official page mappings. Native descriptors can contain more fields than one custom UI displays; the export screen and JSON preview expose that scope. Format v2 / `DSHBP2` remains unchanged and imported v2 fields are revalidated against the receiver's native contract. Unsupported settings block their stage; successful earlier package operations are not rolled back.

## Upstream evidence / 官方依据

Reviewed against upstream commit `477b4f420553e8a52c2fbccc464d7561b239c443`:

- [Settings contract](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/settings/settings/README.zh.md): native volatile forms, instance identity, `autoGenerate`, redaction and unavailable forms.
- [Settings API](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/settings.zh.md): descriptors, path edits, complete-Config validation and revision checks.
- [Plugin-page slots](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-plugin-manager/src/client/slot-contract.ts): presentation extension points, not a universal settings-storage declaration.

These source contracts are not proof of an end-to-end pass on every released host. See [ACCEPTANCE.md](ACCEPTANCE.md).
