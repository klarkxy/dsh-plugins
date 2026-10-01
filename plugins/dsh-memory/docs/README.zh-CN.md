# @klarkxy/dsh-memory

Dream 负责“怎样理解用户和当前项目”：作者用语、偏好、项目事实、决策与近期状态，由它观察人类消息并整理成带作用域的记录。经验记录可以放进同一份共享存储，但由 Self Improve 负责产生与注入，Dream 不整理、不注入 lesson。小说设定仍以世界书等权威文件为准。

[English](../README.md)

## 独立 DSH Web 安装

需要 Node.js ≥22 和 DSH `0.1.7-rc.2`。不依赖任何应用私有包，也不要求安装 Self Improve。独立 DSH Web 宿主手动安装：

```sh
npm install @klarkxy/dsh-memory
```

宿主需明确加载记忆插件：

```sh
dsh plugin --profile web add @klarkxy/dsh-memory
```

插件安装后默认启用，单纯打开界面不发起推理。条目管理、提示注入与 Dream 观察和整理开关都在「插件 → 记忆」里。

## 插件页设置

「插件 → 长期记忆」下有两条可留空的模型菜单，都不是必填：

| 设置项 | 用途 |
| --- | --- |
| **Dream 整理模型** | 整理 |
| **语境观察模型** | 语境观察 |

保存某个路由后，对应该功能的调用会使用这个显式模型；留空则使用当前会话模型，再回落到宿主默认对话模型。只有这两个功能受影响；保存路由只表示选定模型，不代表已连通。

## 行为

### 记录与作用域

用语按 subject、domain、词条 key 和别名描述；近期状态另带记录时间、原话中的事件时间、状态和默认 7 天新鲜度上限。项目范围来自原生会话 cwd，缺少 cwd 时不自动写全局。时间到期只停止回忆，不表示任务完成；新的明确报告可以替代同一事项，旧记录保留历史。当前指令、任务记录和权威项目资料优先。

### 回合观察

回合结束后只观察原始人类消息。首次启用取最新一条，随后每批最多 4 条、每条 2000 字符。结果必须引用实际 seq 和逐字原话；助手自述、工具结果和插件注入都不算作者发言。纯“继续”等确认不调用模型。语境观察使用同一条已解析路由，自带取消与过期判断。

### 闲时整理

闲置约 15 分钟、距上次尝试至少 24 小时且至少有 3 项变更时整理一次。Dream 不合并不同类型、作者或领域，不把近期状态写成永久词条，不延长来源有效期。只有全部来源已生效时，替代条目才自动生效；包含候选来源时仍为候选。没有可引用依据的旧手动条目保持原样，不伪造来源。

### 回忆与注入

注入最多 5 条、含包装约 800 tokens，只取当前项目及明确全局的 active 条目；候选、过期、被替代或撤回的内容不注入。

### 边界与兼容

删除墓碑与持久化观察游标阻止重启后重放旧消息。游标最多 512 个会话，满后停止新会话观察，不淘汰删除保护。关闭 Dream 不关闭存储或 Self Improve；关闭插件保留数据。旧记录不强制补造结构化字段。测试新能力时使用同一源码构建的相关插件；源码合入不代表已经发布新版 npm 包。

## 验证

```sh
pnpm --filter @klarkxy/dsh-memory typecheck
pnpm --filter @klarkxy/dsh-memory test
pnpm --filter @klarkxy/dsh-memory build
```

## 接口与导出

本包有三个入口：

- `.`：Cordis 插件（`name`、`inject`、`apply`）、`MemoryRuntime` 服务类，以及共享常量 `CHAT_EVENTS_SLOT`、`MEMORY_RPC_CHANNEL`、`defaultSettings`、`projectIdFromCwd`。`apply` 把运行时挂到 `ctx.aiMemory`，并注册宿主 RPC 通道。
- `./contracts`：浏览器安全的类型与常量。`MemoryRecord`、`MemoryService`、`MemoryQuery`、`NewMemoryRecord` 等共享接口转引自冻结的 `@klarkxy/dsh-plugin-kit` contracts；本包另加 `MemorySettings`、`DreamPlan`、`MemoryStatus`、回忆与注入上限，以及 `/dsh-memory` 通道名。
- `./client`：宿主 Web 客户端加载的设置界面 bundle。

`MemoryRuntime` 实现冻结的 `MemoryService` 方法面——`list`、`create`、`update`、`promoteToGlobal`、`remove`、`recall`——另加设置（`status`/`readStatus`、`updateSettings`）、候选生命周期（`accept`、`reject`、`revoke`）、手动条目（`createManualRecord`）、回合钩子（`handlePreStep`、`observeSession`）与 Dream 生命周期（`previewDream`、`runIdleDream`、`applyDream`、`cancelDream`）。

宿主 RPC 通道为 `/dsh-memory`，端点包括 `status`、`settings.update`、`records.list`、`records.create`、`records.update`、`records.remove`、`records.accept`、`records.reject`、`records.revoke`、`dream.run`。

[设计与限制](../../../docs/portable-learning.md) · [发布维护](../../PUBLISHING.md) · [许可证](../LICENSE)
