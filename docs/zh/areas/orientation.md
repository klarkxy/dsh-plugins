# 总览

[English](../../areas/orientation.md)

DeepSeek Harness 是「一切皆插件」的 agent harness。二次开发先定位能力属于哪一组包，再读该组 README 和对应子系统文档，不要从记忆里发明 API。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

DeepSeek Harness（`dsh`）是开源的 agent harness。它建立在 [Cordis](https://github.com/cordiverse/cordis) 驱动的「一切皆插件」架构上。产品行为由 `packages/` 下的 npm 包拼装而成，每个包的作用域都是 `@deepseek-ai/dsh-*`，并且只属于一个分组。分组 README 就是该家族的包地图。

官方渲染文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)。

项目处于开发者预览。README 写明后续会有破坏兼容的变更。本索引固定在一个提交上，因此上游之后的改动不会悄悄改写这些页面。

## 它在哪里

| 问题 | 从这里开始 |
| --- | --- |
| 产品是什么？ | [README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/README.md) |
| 哪一个包拥有这项能力？ | [packages/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/README.md) |
| 服务、实现和消费者如何关联？ | [docs/capability-seams.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/capability-seams.md) |
| 仓库如何开发？ | [docs/development.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/development.md) 和 [docs/architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/architecture.md) |
| 在官方检出里工作的 agent 应该做什么？ | [AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/AGENTS.md) |

`docs/capability-seams.md` 由 `scripts/gen-doc-graphs.ts` 生成。一项服务可以是核心脊柱服务、可替换的能力缝、bundle 或组合点，或者独立服务。图中标出声明该服务的包、已知实现包，以及直接消费该服务的包。「服务定义 / 服务提供者 / 消费者」的说法写在子系统页面上，例如 [docs/subsystems/subagent.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/subagent.md)，不在生成图的开头。

`packages/README.md` 给扩展作者的依赖规则是：扩展插件依赖服务定义，绝不依赖具体提供者。

## 插件作者怎么用

1. 点明能力（工具、skill、preset、标题、模型路由、MCP 服务器、界面插槽、hook 桥接）。
2. 打开本索引里的对应章节，再打开固定提交上被引用的官方文件。
3. 优先读包 README 里的 `Use this package` 一节，以及生成的[配置目录](other-seams.md)，不要抄邻近插件。
4. 挂载宿主已经提供的服务定义。交付一个提供者或一个消费者，不要再复制一份缝。
5. 当官方检出和本索引不一致时，对本索引而言以固定提交为准，对实际行为而言以你正在运行的检出为准。刷新本索引，不要猜测。

## 来源

- [README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/README.md)
- [packages/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/README.md)
- [docs/capability-seams.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/capability-seams.md)
- [docs/architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/architecture.md)
- [docs/development.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/development.md)
- [AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/AGENTS.md)
