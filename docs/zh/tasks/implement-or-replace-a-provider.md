# 实现或替换提供者

[English](../../tasks/implement-or-replace-a-provider.md)

能力缝需要一个后端，或必须换掉随发行的后端时，用这个任务。依赖服务定义。不要复制这条缝，也不要为了调用而去导入具体提供者。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。目标版本不同时，把本页当作未经核实，并核对钉住的源码。

## 什么时候用

你在加模型路由、子代理运行时、压缩后端，或其他可替换的实现。如果只是调用宿主已经挂上的能力，注入那个服务然后停下来。提供者包是给新实现用的。

## 怎么选

[packages/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/README.md) 写了依赖规则：扩展插件依赖服务定义，从不依赖具体提供者。[docs/capability-seams.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/capability-seams.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/capability-seams)） 标出声明服务的包、已知实现包和直接消费者。先在这张图里找到你要进入的缝，再读包说明。不要另造第二份注册表。

[docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/extension-cookbook)） 把模型适配器映射为通过 `registerAdapter` 登记的 `LlmAdapter` 子类。同一张表把子代理委托映射到 `ctx.subagents`，把压缩映射到 `ctx.compaction`。

| 缝 | 登记或替换 | 为什么 |
| --- | --- | --- |
| 模型路由 | 实现 `LlmAdapter.stream`，并调用 `ctx.llm.registerAdapter` | [docs/user/develop/practice/llm-adapter.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/llm-adapter.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/practice/llm-adapter)） 说，第一个参数是提供者路由列表。调用方用 `ctx.llm.stream`。他们不再开第二个 HTTP 客户端。无法兑现的字段抛出带稳定代码的 `LlmError`。选择器要显示模型时实现 `listModels()`。 |
| 子代理运行时 | `ctx.subagents.registerProvider` | [docs/subsystems/subagent.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/subagent.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/subagent)） 把定义、提供者和面向模型的消费者分开。`provider.name` 在这一层里唯一。把工具行指向这个名字。见[压缩、子代理、任务与目录](../areas/other-seams.md)。 |
| 压缩 | 在压缩缝上实现 `compactIfNeeded`、`compactNow` 和 `compactRegion` | [packages/compaction/compaction/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/compaction/compaction/README.md) 说，定义本身不做浓缩。不要靠删除会话事件来做摘要。度量是 `ctx.tokenMeter`。 |
| 会话标题 | `ctx.sessionTitle.register` 只登记一次 | 第二次 `register` 会抛错。禁用随发行的提供者行，再插入你的行。覆盖服务行时要重写配置，因为补丁会整份替换 `config`。见[会话与标题](../areas/sessions-titles.md)。 |

替换随发行的提供者，是用 profile 补丁按稳定 id 禁用或覆盖那一行，再加上你的包。不是去改提供者已安装的源码。在 DSH 里面，用 `plugin_manager` 安装 bundle。用 `cordis_inspect_query` 确认那一行，不要假设补丁文本已经生效。

秘密放在加载器的 `!!js` 表达式或凭据缝里，不要放进已提交的补丁默认值。适配器教程的示例就是这样读 `apiKey` 的。

## 要一起读

章节：[总览](../areas/orientation.md)、[大模型供应商](../areas/llm-providers.md)、[压缩、子代理、任务与目录](../areas/other-seams.md)、[会话与标题](../areas/sessions-titles.md)。

钉住提交上的官方文件：

- [packages/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/README.md)
- [docs/capability-seams.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/capability-seams.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/capability-seams)）
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/extension-cookbook)）
- [docs/user/develop/practice/llm-adapter.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/llm-adapter.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/practice/llm-adapter)）
- [docs/subsystems/subagent.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/subagent.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/subagent)）
- [packages/compaction/compaction/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/compaction/compaction/README.md)

## 事前检查

- 把目标 DSH 版本和 `meta.json` 比较。
- 在钉住提交的 `docs/capability-seams.md` 上找到这条缝。版本不同时改看目标提交。图里没有这个服务，就停下来，并说这条缝未经核实。
- 在 DSH 里面，对你要调用的注册方法查 `Service`，例如 `registerAdapter`、`registerProvider` 或 `register`。在 DSH 外面，读已安装包里的 `.d.ts`，或钉住的 `lib/types`，并把这次调用标成未经核实。
- 决定这条缝允许一个提供者还是多个。标题登记是单个。LLM 适配器和子代理提供者是注册表。

## 验证清单

- 注入服务定义、而不是你的具体包的消费者，能调用新路由或提供者名字。
- 你打算替换的随发行提供者已被禁用或覆盖。`dump-config` 显示一行胜出。`overridden` 表示更高优先级的层仍在胜出。
- 对适配器，流以 `finish` 结束；不支持的字段抛 `LlmError`，而不是被悄悄丢掉；`listModels()` 和选择器显示的一致。
- 对压缩，历史仍然是日志。一次压缩不会靠删除事件来假装摘要。
- 对标题提供者，第二次 `register` 会抛错，标题不进入模型输入。
- 卸载会移除你的注册。先前的提供者不会停在替换到一半的状态。
- 写明哪些行你跑过，哪些仍未经核实。

## 常见失败

- 从功能插件导入 `@deepseek-ai/dsh-llm-deepseek`，只为了“调用模型”。应调用 `ctx.llm`。
- 不禁用随发行的行就登记第二个标题提供者。第二次 `register` 会抛错。
- 改已安装的提供者，而不是交付一行 bundle。
- 靠拼接会话日志来复制压缩。
- 把 `apiKey` 放进已提交的补丁默认值。
- 以为 Context7 在 master 上的示例和这次钉住的提交一致。它跟随的是 master。

## 可运行示例

`Runnable example: not yet (planned)`。本页没有可复制的包，也没有测试。后续轮次才会补上可运行的任务包。

## 来源

- [packages/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/README.md)
- [docs/capability-seams.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/capability-seams.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/capability-seams)）
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/extension-cookbook)）
- [docs/user/develop/practice/llm-adapter.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/llm-adapter.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/practice/llm-adapter)）
- [docs/subsystems/subagent.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/subagent.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/subagent)）
- [packages/compaction/compaction/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/compaction/compaction/README.md)
