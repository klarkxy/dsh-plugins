# @klarkxy/dsh-recap

在后台写出会话回顾，并给智能体注入有长度上限的进度检查点：长轮次结束、或你隔一段时间回来时，会话里会多出一段可读的回顾，模型则在关键节点拿到一份被截断的进度记录。插件默认启用，可在「设置 → 插件」关闭；回顾、agent 检查点和语义检查点都使用固定的自动默认值。

[English](../README.md)

需要 Node.js ≥22、DSH `0.1.7-rc.2`。辅助生成直接调用宿主 `llm` 服务，并要求 `@deepseek-ai/dsh-llm` 与 `@deepseek-ai/dsh-session` 对等依赖。

```sh
dsh plugin --profile web add @klarkxy/dsh-recap
```

把 `web` 换成你的 profile 名；卸载用 `dsh plugin --profile web remove @klarkxy/dsh-recap`。

## 回顾

回顾出现在聊天事件座位上——一个安静的生命周期控制器：会话还没有已存回顾时什么都不渲染，有回顾后显示回顾卡片，并提供生成、取消和重新生成（覆盖已完成的回顾需要再点一次确认）。

回顾在长轮次结束、或你离开超过闲置间隔后回来时在后台生成。间隔默认 15 分钟，只计算文档与用户操作，不算助手输出，且聊天面板为 `hidden` 时不计。

读取状态不调用模型；每个水位线最多生成一次，除非重试该卡片或请求一次手动 `refresh`。

## 检查点

检查点只在宿主 `agent/pre-step` 的有意义边界注入，使用原生 `createUserMessage`。注入的快照有长度上限：最多列出 12 条条目，并截断到 2000 字符，因此长轮次不会把上下文塞满。

检查点的条目从会话日志里整理出来。开启语义检查点后，模型只用来细化其中的「下一步」。同一 profile 也启用需求澄清插件时，回顾通过 `ctx.aiMood.getContract(sessionId)` 读取它的任务约定，用于检查点上下文。

## 插件页设置

「设置 → 插件 → 任务回顾」下有回顾卡片、任务检查点、语义检查点三个开关，离开多久后生成回顾（1–180 分钟），以及两条模型菜单：**回顾卡片模型**用于回顾卡片，**语义检查点模型**用于语义检查点。两者都可留空。保存某个路由后，对应该功能的调用会使用这个显式模型；留空则使用当前会话模型，再回落到宿主默认对话模型。

这些开关也可以通过 `update` RPC 修改。关闭某项能力会取消在途生成并停止自动注入，已存回顾保留。卸载插件会等待未完成的写入，并忽略之后的会话事件。

## 边界

- 回顾只用于展示，不作为模型上下文；注入模型的只有检查点。
- 语义检查点只在任务检查点开启时才会运行。
- 保存路由只影响这两个功能，且只表示选定模型，不代表已连通。

## 宿主 RPC

频道 `/dsh-recap`，走宿主授权策略。

- `status` — 设置、存储健康状况、已存的回顾卡片与检查点（可限定单个 `sessionId`）。不调用模型。
- `update` — 按比较并交换修订号（`expectedRevision`）写入设置（`cardsEnabled`、`checkpointsEnabled`、`semanticCheckpointsEnabled`、`idleReturnMs`）。
- `cards` / `checkpoints` — 已存的回顾卡片或检查点，可限定单个会话。
- `cancel` / `retry` — 取消某卡片的在途生成，或重新生成该卡片（`{ cardId, sessionId }`）。
- `idle.return` — 立即为会话执行一次闲置返回检查。
- `refresh` — 按需为会话生成一份回顾（`manual` 触发），不受「每个水位线只生成一次」限制。

## 开发

从仓库根目录运行：

```sh
pnpm --filter @klarkxy/dsh-recap typecheck
pnpm exec vitest run packages/dsh-recap/src
pnpm --filter @klarkxy/dsh-recap build
```

部分宿主会预装并默认启用本功能；宿主支持热切换时，通过「设置 → 插件」开关无需重启。宿主提示需要重启时，安装或移除后重启。
