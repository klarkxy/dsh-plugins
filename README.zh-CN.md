# dsh-plugins

简体中文 / [English](README.md)

klarkxy 的 DeepSeek Harness（DSH）插件。可以在[插件站点](https://klarkxy.github.io/dsh-plugins/)浏览安装命令和各插件说明。

## 插件

| 包 | 作用 |
| --- | --- |
| [`@klarkxy/dsh-current-title`](plugins/dsh-current-title/docs/README.zh-CN.md) | 自动标题：会话标题跟随最新任务自动更新，手动改过的名字不会被覆盖，自动重命名与人工命名两不误。 |
| [`@klarkxy/dsh-git-commit`](plugins/dsh-git-commit/docs/README.zh-CN.md) | Git 提交：在对话里提交工作区改动，由模型分组并生成 Git 提交信息。 |
| [`@klarkxy/dsh-delegation`](plugins/dsh-delegation/docs/README.zh-CN.md) | 委派模式：按会话开启，主代理负责拆解、委派和验收，子代理执行具体任务，支持多智能体协作。 |
| [`@klarkxy/dsh-safe-auto`](plugins/dsh-safe-auto/README.zh-CN.md) | 安全自动：新增「Safe Auto」审批档位，需要审批的请求交给审核模型判断，通过才放行，并记录完整的审核历史。 |
| [`@klarkxy/dsh-session-manager`](plugins/dsh-session-manager/README.zh-CN.md) | 会话管理：跨工作目录搜索和阅读 DeepSeek Harness 会话，使用临时工作区；空输入一键续写或自动继续，久离回来给出摘要与上下文压缩建议；可选择让 agent 分叉当前会话或向其他会话发送消息。 |
| [`@klarkxy/dsh-model-hub`](plugins/dsh-model-hub/docs/README.zh-CN.md) | 子代理：配置子代理的模型与推理强度（思考强度），并在会话弹层查看最后使用的模型。 |
| [`@klarkxy/dsh-magpie`](plugins/dsh-magpie/docs/README.zh-CN.md) | Magpie：把 DSH 连接到本机、局域网或其他位置的 Magpie 网关，同步模型、默认模型和网络搜索；支持本地 LLM 与 OpenAI 兼容接口。 |
| [`@klarkxy/dsh-web-search-manager`](plugins/dsh-web-search-manager/docs/README.zh-CN.md) | 网页搜索：在一个设置页管理和排序多家搜索与网页读取服务，包括已安装插件提供的能力。 |
| [`@klarkxy/dsh-zhihu`](plugins/dsh-zhihu/docs/README.zh-CN.md) | 知乎：知乎站内与全网搜索、热榜、Zhida 直答、知识库、问题推荐与回答摘要、内容与评论读取、创作数据与额度统计，以及草稿管理和配图上传。 |
| [`@klarkxy/dsh-font`](plugins/dsh-font/docs/README.zh-CN.md) | 字体：自定义 Web GUI 的界面字体、对话字体、代码与终端字体及字号。 |
| [`@klarkxy/dsh-unrestricted`](plugins/dsh-unrestricted/README.zh-CN.md) | 破限：解除模型的回答限制、交付完整成果的会话 Preset，只作用于选用它的会话；可能导致账号被封禁。 |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.zh-CN.md) | DSH 文档：在插件页浏览 DSH 官方开发文档；智能体获得两个只读工具检索文档与核对插件（`dsh_docs`、`dsh_plugins`）。 |
| [`@klarkxy/dsh-context-cleaner`](plugins/dsh-context-cleaner/docs/README.zh-CN.md) | 上下文面板清理：隐藏 dsh-context 仪表盘顶部的插件信息与推广卡片。 |
| [`@klarkxy/dsh-deep-view`](plugins/dsh-deep-view/docs/README.zh-CN.md) | Deep View 回复卡片：在回复中展示图表、指标、表格和安全联动的本地输入；`show_view` 可接收已校验的用户回答。 |
| [`@klarkxy/dsh-model-picker`](plugins/dsh-model-picker/docs/README.zh-CN.md) | 模型选择器：输入框里的模型搜索与推理档位滑杆；其他插件可复用同一选择器。 |

`@klarkxy/dsh-plugin-kit` 和 `@klarkxy/dsh-model-route` 是共享库，其他插件会自动安装它们。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-current-title
```

把 `web` 换成你的 profile 名，安装后重启该 profile。插件依赖的共享库会随它一起装上。

要在 DSH 中浏览插件列表，先启用实验性的「自定义插件市场」组合包，再选择「插件 → 发现 → 添加索引源」，输入：

```text
https://raw.githubusercontent.com/klarkxy/dsh-plugins/main/index.json
```

列表更新也来自这个索引源。安装任何插件前，DSH 都会要求确认。

## 开发

需要 Node.js 24+ 与 pnpm 10。

```bash
pnpm install
pnpm check
```

代码就是开发文档。发布流程见[发布指南](RELEASING.zh-CN.md)。

## 插件生命周期

<!-- plugin-release-states:start -->
| 包 | 生命周期 | 说明 |
| --- | --- | --- |
| [@klarkxy/dsh-context-cleaner](plugins/dsh-context-cleaner/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-current-title](plugins/dsh-current-title/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-deep-view](plugins/dsh-deep-view/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-delegation](plugins/dsh-delegation/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-dev-index](plugins/dsh-dev-index/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-font](plugins/dsh-font/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-git-commit](plugins/dsh-git-commit/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-magpie](plugins/dsh-magpie/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-model-hub](plugins/dsh-model-hub/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-model-picker](plugins/dsh-model-picker/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-model-route](plugins/dsh-model-route/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-plugin-kit](plugins/dsh-plugin-kit/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-safe-auto](plugins/dsh-safe-auto/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-session-manager](plugins/dsh-session-manager/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-shortcuts](plugins/dsh-shortcuts/README.md) | 草稿 (`draft`) | 新增快捷键管理与可扩展命令面板，待完成首次发布验收。 |
| [@klarkxy/dsh-unrestricted](plugins/dsh-unrestricted/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-web-search-manager](plugins/dsh-web-search-manager/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-zhihu](plugins/dsh-zhihu/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
<!-- plugin-release-states:end -->

## 许可证

[SATA License 2.1](LICENSE)
