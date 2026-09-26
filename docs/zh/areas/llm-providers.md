# 大模型供应商

[English](../../areas/llm-providers.md)

所有模型调用都走 `ctx.llm`。新供应商实现 `LlmAdapter` 并 `ctx.llm.registerAdapter`。不要在插件里直接请求供应商 HTTP。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

`@deepseek-ai/dsh-llm` 是与供应商无关的流式服务。适配器把供应商的线上格式翻译成共享的 `StreamChunk` 词汇。服务本身没有配置，也没有供应商的线上代码。重试是另一个包 `@deepseek-ai/dsh-llm-retry`。调用方必须让模型可见的输入能从会话日志重建。循环构建的请求到达时是深冻结的。

## 它在哪里

- 适配器教程：[docs/user/develop/practice/llm-adapter.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/llm-adapter.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/practice/llm-adapter)）
- 分组地图：[packages/llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/llm/README.md)
- 服务：[packages/llm/llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/llm/llm/README.md)

自己写一个之前，先读随发行的适配器：`packages/llm/llm-deepseek/` 和 `packages/llm/llm-pi-ai/`。

## 约定

适配器插件注入 `llm`，导出一份 Schemastery `Config`，并在 `apply` 期间注册：

```ts
export const name = 'my-llm'
export const inject = ['llm']

export function apply(ctx, config) {
  ctx.llm.registerAdapter(config.providers, adapter)
}
```

`registerAdapter` 也接受固定的名字列表，例如 `['my-provider']`。适配器扩展 `LlmAdapter` 并实现 `async *stream(options)`。可选方法是 `resolveModel(provider, model, signal?)` 和 `listModels()`。图形界面只提供 `listModels()` 宣告的模型。基类实现返回空列表，因此不提供图形界面模型。

流块使用 `block-start`、`text-delta`、`tool-call-delta`、`block-end`、`usage` 和 `finish`。流总是以一个终止结果结束。失败使用稳定的 `LlmError` 代码。

每一次 `stream` 调用是一次供应商尝试。agent 循环为每个请求选择 `provider` 和 `model`。会话标题生成和压缩这类消费者用显式路由调用 `ctx.llm.stream`。它们不 import 适配器。

分组表里相关的上下文键包括 `ctx.deepseekLlmApiExtensions` 和 `ctx.tokenMeter`。适配器本身注册在 `ctx.llm` 上。

## 插件作者怎么用

- 要从插件调用模型，注入 `llm`，并把 `provider` 加上 `model` 传给 `ctx.llm.stream`。宿主已经挂载的供应商，不要再开第二个 HTTP 客户端。
- 要增加一个供应商，发布一个适配器包，再加上配置其凭据的 bundle 行。教程示例使用的键包括 `apiKey`、`providers` 和 `apiKeyEnv`。添加字段之前，先读你正在抄的那个适配器。
- 秘密放在加载器的 `!!js` 表达式或凭据缝里，不要放进聊天，也不要作为补丁默认值提交。
- 如果 Web 的模型选择器应该显示这个供应商，就实现 `listModels()`。

## 来源

- [docs/user/develop/practice/llm-adapter.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/llm-adapter.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/practice/llm-adapter)）
- [packages/llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/llm/README.md)
- [packages/llm/llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/llm/llm/README.md)
