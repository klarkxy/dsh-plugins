# DSH 蓝图码协议

本文定义当前实现的蓝图数据、文本编码和导入语义。协议标识为 **DSHBP2**，
JSON 的 `formatVersion` 为 **2**。这是插件组合分享协议，不是环境备份或设置迁移协议。

参考实现：`blueprint.mjs`（数据校验）、`codec.mjs`（文本编解码）、
`engine.mjs`（导出、预览及执行）。三个层次分别负责结构、编码和操作，
解码成功不等于数据符合蓝图结构，更不等于可以直接执行。

## 1. 数据结构

```json
{
  "kind": "dsh-blueprint",
  "formatVersion": 2,
  "metadata": {
    "name": "示例组合",
    "description": "以下包名仅用于展示协议结构"
  },
  "packages": [
    { "name": "example-a", "version": "1.2.3", "source": "npm" },
    { "name": "example-b", "version": "2.0.0", "source": "npm" }
  ],
  "bundles": ["example-a", "example-b"]
}
```

示例包名不表示真实可安装包。可直接用于编解码验证的空组合及对应蓝图码见
[`examples/empty.dsh-blueprint.json`](examples/empty.dsh-blueprint.json)、
[`examples/empty.code.txt`](examples/empty.code.txt)。空组合导入不会停用或删除任何现有插件。

| 字段 | 必需 | 规则 |
| --- | --- | --- |
| `kind` | 是 | 固定字符串 `dsh-blueprint` |
| `formatVersion` | 是 | 固定整数 `2` |
| `metadata` | 是 | 只允许 `name`、`description` |
| `metadata.name` | 是 | 1–120 个 UTF-16 代码单元，不含 U+0000–U+001F |
| `metadata.description` | 否 | 存在时为 1–4000 个 UTF-16 代码单元，不含 U+0000–U+001F |
| `packages` | 是 | 最多 128 项；按顶层安装请求的建议顺序排列 |
| `packages[].name` | 是 | 包名字符串，最多 214 个代码单元；包名不能重复，不能引用 `@klarkxy/dsh-blueprint` 本身 |
| `packages[].version` | 是 | 精确 SemVer，包括可选预发布／构建标识；不接受 `latest`、范围或未固定版本 |
| `packages[].source` | 是 | `npm` 或 `builtin` |
| `bundles` | 是 | 最多 128 个互不重复的包名；必须全部存在于 `packages`，表达请求启用的组合层及建议先后 |

包名语法为 `^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$`。
当前协议只允许以上字段；每个 package 对象只允许 `name`、`version`、`source`。
不包含设置、凭据、组件行状态、执行脚本、其他蓝图的嵌套引用或自动更新链接。

`packages` 和 `bundles` 分别表达安装与启用意图。某项在 `packages` 中但不在
`bundles` 中，表示只请求它存在，**不表示接收方应停用它**。
`npm` 包缺失时由官方管理器安装精确版本；`builtin` 必须由接收方宿主提供。
顶层安装请求顺序不替代包管理器的依赖解析，也不定义异步插件启动顺序。

## 2. 导入语义

导入是向当前组合补充插件，不能把蓝图顺序当作强制重排或依赖声明。

1. 已存在、来源和版本匹配的可管理包复用；不同来源、不同版本或受保护／不可用的目标列为阻碍，不自动升级、降级或换源。
2. 缺失的 npm 包按 `packages` 顺序安装，安装时不启用。
3. 当前启用的完整列表记作 `L`，蓝图的 `bundles` 记作 `B`。
   最终顺序为 `L + B 中尚未存在于 L 的项`，保留这些新增项在 B 中的先后。
4. 只启用尚未启用且在 `bundles` 中的项，不重装已匹配的包，不停用或移动任何现有层。
5. 未出现在蓝图中的本地插件保留；重复导入同一蓝图且本地状态未变化时，无需执行任何动作。
6. 先预览安装／启用动作和最终顺序，确认后执行。顺序不同本身不构成冲突。

| 当前 L | 外来 B | 结果 |
| --- | --- | --- |
| A → B → C | C → D → A | A → B → C → D |
| A → X → B → C | A → D → B | A → X → B → C → D |
| A → B → C | C → A | A → B → C（无操作） |
| A → C，B 已安装但未启用 | B → A | A → C → B（只启用 B） |

当前协议没有 `before`、`after` 或其他硬顺序约束字段，不从排列或包名猜测依赖。
需要严格封装组件及默认配置关系时，使用 DSH 原生组合插件。顺序合并成功不证明
任意插件之间语义兼容；组合包自身的配置层仍可能改变最终生效默认值。

导入后保存的是宿主的一份平面组合，外来蓝图不会成为持续同步的子蓝图。
安装与启用使用宿主接口；整个多步骤导入不提供跨插件事务、自动重试或整体回滚。
状态变化会使预览失效；需要重启、操作失败或中断时停止并报告已完成部分。

## 3. 文本编码

导入只接受以下一种大小写敏感的蓝图码。JSON 只用于内部数据结构和开发调试，不作为界面的导入或导出格式：

```text
DSHBP2:<payload>
```

- 固定流程：JSON 的 UTF-8 字节 → **raw DEFLATE** → 无填充 Base64url。
  raw DEFLATE 没有 zlib／gzip 头尾，不得使用 gzip 或普通 zlib 包装流替代。
- Base64url 字符集为 `A–Z a–z 0–9 - _`；不允许 `=` 填充或空载荷，且重新编码必须逐字一致。
- 解码前只裁去文本首尾的空格、Tab、CR、LF；不移除码内空白，不接受 Markdown 围栏。
- UTF-8 必须有效，不接受 BOM。JSON 字段顺序和普通 JSON 空白不具有语义。
- 参考编码器使用紧凑 JSON，始终压缩后编码，不提供编码模式参数。
  不要求不同压缩库生成完全相同的压缩字节，只要求能正确解码。

蓝图码不提供加密、签名或作者认证。导入方仍须检查包身份和将执行的动作。

## 4. 限制与拒绝规则

- 输入文本最大 **2 MiB（UTF-8 字节数）**；解码／解压后的 JSON 最大 **1 MiB**。
- JSON 最多 **64 层容器嵌套**；压缩数据只能包含一个完整 raw DEFLATE 流，禁止尾随字节。
- 拒绝重复 JSON 成员（含转义后同名）、非法 Unicode、非有限数和不安全整数。
- 任意对象层级禁止键 `__proto__`、`prototype`、`constructor`。
- 不支持的前缀、编码、协议版本、文档类型、字段、包来源或不明确版本均拒绝；不做格式猜测或迁移。
- 宿主传输层可以另有请求体限制，协议上限不保证所有宿主接受同样大小的 RPC 请求。

## 5. 使用参考实现生成与验证

```js
import { validate } from '@klarkxy/dsh-blueprint/core';
import { encode, decode } from '@klarkxy/dsh-blueprint/codec';

const document = validate({
  kind: 'dsh-blueprint',
  formatVersion: 2,
  metadata: { name: '空组合' },
  packages: [],
  bundles: [],
});
const code = encode(document);             // 生成唯一格式的蓝图码
const checked = validate(decode(code));   // 解码之后仍须校验文档
```

`encode`／`decode` 负责 JSON 和编码安全边界，`validate` 负责蓝图结构。
制作工具应在编码前、解码后调用 `validate`。随后还需要当前宿主的导入预览；
不要把生成蓝图码当作执行授权。

## English summary

DSHBP2 transports a plugin-only JSON document with exact package identities.
`packages` gives top-level installation request order; `bundles` gives requested
activations in preferred order. Import keeps the full current active sequence and
appends only requested names not already active. Matching packages are reused;
version/source conflicts block application. Absence never disables a local bundle.
There are no hard ordering constraints, settings transfers or nested blueprint links.

`DSHBP2:` is the only code format and carries unpadded canonical Base64url of
raw-DEFLATE-compressed UTF-8 JSON. Raw JSON is not accepted for import. The caps are
2 MiB input, 1 MiB decoded JSON, and 64 JSON container levels. No signatures or
encryption are implied. Use `validate(decode(text))` before host preview and
`encode(validate(document))` when authoring. The shipped empty-document vectors
are safe no-op examples; compressed byte-for-byte equality is not required.
