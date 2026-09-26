# 压缩、子代理、任务与目录

[English](../../areas/other-seams.md)

压缩、子代理和后台任务都是「定义 / 提供者 / 消费者」三条缝。换实现时挂新的 provider，不要复制服务。字段的完整列表在生成的 config catalog，不在这篇索引里。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

有几条缝和工具、技能的形状相同：其他插件注入的服务定义、一个或多个提供者，以及面向模型的消费者。本页记录注册名字。它不是第二份配置目录。

## 它在哪里

- 压缩家族：[packages/compaction/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/compaction/README.md)
- 压缩约定：[packages/compaction/compaction/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/compaction/compaction/README.md)
- 子代理家族：[packages/subagent/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/subagent/README.md)
- 子代理服务：[packages/subagent/subagent/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/subagent/subagent/README.md)
- 子代理类型：[docs/subsystems/subagent.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/subagent.md)
- 任务家族：[packages/jobs/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/jobs/README.md)
- 配置目录：[docs/config-catalog.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/config-catalog.md)
- 扩展食谱：[docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)

## 约定

### 压缩

`@deepseek-ai/dsh-compaction` 自己不做浓缩。挂载 `@deepseek-ai/dsh-compaction-basic` 来注册 `ctx.compaction`，用 `@deepseek-ai/dsh-command-compact` 提供 `/compact`。自定义后端实现 `compactIfNeeded`（自动的 `pressure` 或 `context-overflow`）、`compactNow`（一次显式缩减）和 `compactRegion`（调用方选定的范围）。度量是 `ctx.tokenMeter`，不是压缩服务上的字段。括号事件从 `compaction/start` 走到 `compaction/end`。家族 README 还列出用于裁剪工具结果的 `ctx.toolResultPruner`。

### 子代理

`ctx.subagents.registerProvider(provider)` 注册一个后端。`provider.name` 在这一层里唯一（`spawn`、`fork`、`acp`，以及其他随发行的名字）。进程内的包 `@deepseek-ai/dsh-subagent-spawn-in-process` 把 `providerName` 默认成 `spawn`。面向模型的行指向这个名字：

```yaml
- name: '@deepseek-ai/dsh-subagent'
- name: '@deepseek-ai/dsh-subagent-spawn-in-process'
- name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent
```

子系统页面把拆分写得很明确：服务定义是 `dsh-subagent`（`ctx.subagents`），提供者是兄弟包，`dsh-tool-subagent` 这类消费者面向模型。

### 后台任务

`@deepseek-ai/dsh-jobs` 定义 `ctx.jobs`：id、所有权、生命周期和完成监听器。`@deepseek-ai/dsh-jobs-local` 在进程内运行任务。工具作者按工具食谱所述，用 `ctx.jobs.start({ kind, label, owner, run })` 开始工作。见[工具](tools.md)。

### 目录

`docs/config-catalog.md` 由 `scripts/gen-config-catalog.ts` 生成，并由 `pnpm run verify-config-catalog` 检查。它列出每一个 `config:` 块，带有 `inject`、`refs` 和 `source`。不要手改它。`docs/tool-catalog.md` 列出面向模型的工具。子系统页面保存生成的 Cordis API（`ctx.*` 方法）。当本索引和目录对某个字段不一致时，以固定提交上的目录为准。

`docs/cookbook/extension-cookbook.md` 是跨切面插件的食谱索引，包括权限门监听器。

## 插件作者怎么用

- 替换浓缩时，为 `ctx.compaction` 发布一个后端。不要靠删除会话事件来总结历史。
- 用 `ctx.subagents.registerProvider` 增加子 agent 运行时，然后让工具行指向 `provider.name`。
- 通过 `ctx.jobs` 发布后台工作，这样取消和 `job_*` 工具保持一致。
- 往补丁里加配置键之前，先在这一提交的 `docs/config-catalog.md` 里查它。那个包的条目里没有的键，就不是加载器字段。

## 来源

- [packages/compaction/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/compaction/README.md)
- [packages/compaction/compaction/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/compaction/compaction/README.md)
- [packages/subagent/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/subagent/README.md)
- [packages/subagent/subagent/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/subagent/subagent/README.md)
- [docs/subsystems/subagent.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/subagent.md)
- [packages/jobs/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/jobs/README.md)
- [docs/config-catalog.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/config-catalog.md)
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)
