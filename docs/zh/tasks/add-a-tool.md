# 添加工具

[English](../../tasks/add-a-tool.md)

模型必须按名字调用一项新能力时用这个任务。工具就是这个面向模型的动作。策略、设置和面板是别的任务。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。目标版本不同时，把本页当作未经核实，并核对钉住的源码。

## 什么时候用

产品需要模型用名字、描述和参数 schema 调用的函数。在 `ctx.tools` 上注册，schema 就会进入系统提示的拼装。[docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/extension-cookbook)） 把内置工具映射到 `ctx.tools.register()`。

## 怎么选

抄邻近插件之前先读 [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/adding-a-tool)）。`defineTool` 是带类型的助手。食谱也接受在 `ctx.tools.register()` 上直接登记原始 JSON Schema 的 `ToolDefinition`，MCP 来的工具就是这样进来的。自己写的插件优先用 `defineTool`。

模型并不是在调用函数时，换一种机制：

- 外部服务器已经暴露了工具，就做只含配置的 MCP bundle，不要再写一个客户端。见[MCP 服务器](../areas/mcp.md)。
- 模型只需要阅读、本身没有副作用的说明，是 skill。见[技能](../areas/skills.md)。
- 允许、拒绝、取消和询问不要写进 `execute`。那是[添加工具执行策略](add-a-tool-policy.md)。[docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/adding-a-tool)）说，不要把部署策略做进工具里。
- 用户要改的值是[添加设置界面](add-a-settings-ui.md)。用户要看的视图是[添加界面面板](add-a-ui-panel.md)。

`execute` 返回一个规范的 JSON 值。注册表校验它，再交给 `output.render`。不要从函数体返回内容块。遵守 `exec.signal`。`agent.inject` 追加下一次请求能看到的上下文，不会唤醒空闲的 agent。长时间工作在生产者放行 `run_in_background` 之后用 `ctx.jobs.start`。id 一旦公布，取消属于这个任务，不再属于外层的 `exec.signal`。这些规则在添加工具指南和[工具](../areas/tools.md)章节里。

## 要一起读

章节：[工具](../areas/tools.md)、[插件模块](../areas/plugin-module.md)、[插件管理器与实时检查](../areas/plugin-manager-inspect.md)、[MCP 服务器](../areas/mcp.md)。

钉住提交上的官方文件：

- [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/adding-a-tool)）
- [docs/user/develop/basic/tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/tool.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/tool)）
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/extension-cookbook)）
- [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)

## 事前检查

- 把目标 DSH 版本和 `meta.json` 比较。不一致就说明本页对那个版本未经核实。
- 在 DSH 里面，先加载 `cordis-plugin-development`，用 `cordis_inspect_query` 查 `Tool`，再起名字。在 DSH 外面，读目标提交上的 `docs/tool-catalog.md`，并把名字检查标成未经核实。
- 确认插件 `inject` 了 `tools`。缺少这项服务时插件会一直等待。
- 读[架构规则与反模式](architecture-rules.md)。不要靠监听 `system-prompt/assemble` 来发布 schema。注册本身就会发布。

## 验证清单

- 模型可见的 schema 含有你声明的名字、描述和参数，并且没有另一个插件的同名工具。
- 合法参数能进入 `execute`。非法参数不能。
- 规范返回值符合 `output.schema`。抛出的错误变成错误结果，不会弄垮这一轮。
- 取消调用会触发 `exec.signal`，进行中的工作会停。
- 卸载插件会移除工具。释放插件 fiber 会取消注册，添加工具指南是这样写的。
- 在 PTC 模式下，成功调用解析为规范 JSON 值，而不是渲染后的散文。不要靠解析渲染文本来找回 id。
- 写明上面哪些是你实际跑过的，哪些只是读过。

## 常见失败

- 把策略或提示藏在 `execute` 里。挪到策略任务。
- 返回内容块，或让模型从散文里解析 id。
- 改已注册的 schema，而不是释放 effect 再注册替换件。
- `ctx.jobs.start` 已经公布 id 之后，还在 `execute` 里阻塞到长任务退出。
- 因为定义了 `presentCall` 就以为网页卡片存在。添加工具指南说，内置网页客户端不消费 `presentCall` 或 `presentResult`。

## 可运行示例

`Runnable example: not yet (planned)`。本页没有可复制的包，也没有测试。后续轮次才会补上可运行的任务包。

## 来源

- [docs/cookbook/adding-a-tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/adding-a-tool.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/adding-a-tool)）
- [docs/user/develop/basic/tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/tool.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/tool)）
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/cookbook/extension-cookbook.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/extension-cookbook)）
- [packages/core/tools/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)
