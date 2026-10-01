# @klarkxy/dsh-mood

Mood 为当前主代理提供一个工具，用来记录、读取和更新它对本次任务需求的理解。主代理结合当前提示词、前文和最新用户要求整理需求；Mood 不调用辅助模型，也不选择或切换模型。

[English](../README.md)

需要 Node.js ≥22、DSH ≥0.1.7-rc.2。通过宿主插件管理器独立启停。不依赖 Web 服务，TUI 等宿主也可使用。没有设置页、需求卡片或模型选择菜单。

```sh
npm install @klarkxy/dsh-mood
dsh plugin --profile web add @klarkxy/dsh-mood
```

## 代理使用流程

1. 开始一项实质任务时，以 `{"action":"read"}` 调用 `mood_requirements`。
2. 根据当前上下文整理目标、交付物、范围、约束和完成标准，明确区分用户要求、代理假设与未决问题。
3. 再以 `action: "record"` 调用工具，将读取结果的 `revision` 填入 `expectedRevision`，同时带上返回的 `sourceVersion` 和整理出的 `requirements`。
4. 工具续跑期间复用记录；用户纠正或改变要求时重新读取并更新。单纯“继续”保留原任务来源。

读取返回 `revision: 0`、`sourceVersion: "user-message-id"` 后的记录示例：

```json
{
  "action": "record",
  "expectedRevision": 0,
  "sourceVersion": "user-message-id",
  "requirements": {
    "goal": "修复搜索错误说明",
    "deliverables": ["经过验证的修复"],
    "constraints": ["保持现有公开接口"],
    "acceptance": ["回归测试通过"],
    "assumptions": [],
    "questions": []
  }
}
```

`requirements.goal` 必填；可选列表为 `deliverables`、`inScope`、`outOfScope`、`constraints`、`acceptance`、`assumptions`、`questions`，省略时保持为空。只记录简洁的理解结果，不记录私有推理过程或凭据。返回值包含当前修订版本、请求来源和完整需求。新要求会让旧理解显示为过期；版本或请求来源变化时，旧写入被拒绝，不覆盖新记录。

会话身份来自实际调用工具的代理，不接受模型或会话覆盖。需求记录表示代理的理解，不标记为用户已确认，也不授予执行权限。必要澄清及原生审批仍由主代理与宿主处理。工具注册和说明使模型知道如何使用，但不保证每个模型都会调用。

## 旧数据与集成

保留 `dsh_editor_mood` 存储域及 `TaskContract` 字段，Recap 仍可通过 `aiMood.getContract(sessionId)` 读取。旧需求、回答、挂起请求与设置不删除；旧模型选择不再参与执行，不恢复消息，也不启动后台分析。

宿主提供 Web 服务时，`/dsh-mood/status`、`/dsh-mood/contract` 保留为受宿主鉴权保护的只读兼容端点。原 UI 操作 `model`、`mode`、`manual`、`edit`、`retry` 返回 `MOOD_TOOL_ONLY`，不修改设置、不调用模型、不恢复请求。新的记录只通过当前代理的工具写入。

保存失败时保留原记录。写入串行执行，开始保存前取消会阻止写入；存储已接受的写入不会因为后续取消被回滚。停用时等待已开始的写入结束，并拒绝排队或新操作。

## 验证

```sh
pnpm --filter @klarkxy/dsh-mood typecheck
pnpm --filter @klarkxy/dsh-mood test
pnpm --filter @klarkxy/dsh-mood build
```

测试覆盖当前会话绑定、完整需求保存、用户纠正、继续、过期版本、并发、取消、停用、存储失败、旧数据、宿主工具注册与无 Web 宿主加载。

[发布说明](../../PUBLISHING.md) · [许可证](../LICENSE)
