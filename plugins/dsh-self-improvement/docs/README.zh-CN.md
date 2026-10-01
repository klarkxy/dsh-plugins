# @klarkxy/dsh-self-improvement

Self Improve 负责“怎样做事”：目标、适用条件、推荐步骤、避免做法与检查方式。lesson 存放在共享 Memory 存储中，需要你明确启用 Memory；Dream 是 `@klarkxy/dsh-memory` 内部的语境观察与整理机制，作者用语、偏好和最近在做什么由它维护，本包只产生程序性 lesson 记录。

[English](../README.md)

## 独立 DSH Web 安装

需要 Node.js ≥22 和 DSH `0.1.7-rc.2`，不依赖应用私有包。独立 DSH Web 宿主先装 Memory，再装本包：

```sh
dsh plugin --profile web add @klarkxy/dsh-memory
dsh plugin --profile web add @klarkxy/dsh-self-improvement
```

卸载用 `dsh plugin --profile web remove @klarkxy/dsh-self-improvement`。

Memory 必须明确启用为存储，Dream 可以关闭；本插件不会替用户打开其他插件。安装后默认启用，可单独停用，也不增加聊天管理面板或单独设置页。经验与技能草稿在「设置 → 长期记忆 → 经验学习」里审计。

## 插件页设置

「设置 → 插件 → 经验学习」下有本包自己的设置行，含可留空的**经验学习摘录模型**菜单，用于摘录调用；在此查看方法或技能草稿不会调用 Memory 的模型。保存某个路由后，对应该调用会使用这个显式模型；留空则使用当前会话模型，再回落到宿主默认对话模型。只有这个调用受影响；保存路由只表示选定模型，不代表已连通。

## 行为

### 什么会成为方法

新增 lesson 的 procedure 包含来源类型（明确要求或结果观察）、目标、条件、步骤、避免项和验证检查。原文依据与例外保留。纯词义或事实纠正不生成方法；混合消息只摘录方法部分，临时请求、角色台词和引用资料不变成永久规程。

### 什么会生效

明确的人类方法要求可在原适用范围内直接生效；正向方法反馈和工具恢复观察保留为候选，采纳后才参与行动。采纳表示允许使用，不代表通过了自动化质量验证。当前指令、任务验收标准及权限始终优先。

### 什么算证据

工具恢复要求同一人类请求、明确的同一目标和发生变化的参数。仅同名工具后来没报错、另一文件成功、目标未知或参数不变的重试都不够；即使匹配，也只算观察，不是已验证的任务成功。沉默和模型自称成功不作为成功依据。没有 AI 时，只保守保留明确的方法要求，不把词义或错误日志整段当作技能。

### 方法怎么进入对话

通过原生 pre-step 注入最多 5 条、含包装约 800 tokens 的相关 active 方法。支持中文检索；用户只说“继续”时先读取未过期的同项目近期状态，再选方法，不依赖插件加载顺序。停用插件或等待期间失去 Memory 时不注入旧结果。

### 技能草稿与边界

Skill 由已生效方法形成可审阅 Markdown 草稿。采纳、下载和撤回仍为显式操作：不自动安装，也不改写 AGENTS.md 或执行脚本；撤回不收回已经下载的文件。旧记录继续可读，不补造结构化字段或验证历史。

## 接口与导出

本包有三个入口：

- `.`：Cordis 插件（`name`、`inject`、`apply`）、`SelfImprovementEngine` 类，以及共享常量 `CHAT_EVENTS_SLOT`、`SELF_IMPROVEMENT_RPC_CHANNEL`。`apply` 把引擎挂到 `ctx.selfImprovement`，并注册宿主 RPC 通道。
- `./contracts`：浏览器安全的类型与常量——转引自 `@klarkxy/dsh-plugin-kit` 的冻结 AI/Memory 接口，另加 `SkillRecord`、`ReviewSnapshot`、`LessonTrigger`、注入上限与 `/dsh-self-improvement` 通道名。
- `./client`：审计界面 bundle，提供 `dshSelfImprovementReview` 渲染服务；记忆设置页的「经验学习」一节嵌入的就是它。

宿主 RPC 通道为 `/dsh-self-improvement`，端点包括 `status`、`extract`、`inspect`、`accept`、`reject`、`revoke`、`skill.preview`、`skill.accept`、`skill.reject`、`skill.revoke`、`skill.export`、`skill.exported`、`skill.unexport`。

[设计与限制](../../../docs/portable-learning.md) · [发布维护](../../PUBLISHING.md) · [许可证](../LICENSE)
