# dsh-plugins

简体中文 / [English](README.en.md)

klarkxy 的 DeepSeek Harness（DSH）插件集合。可前往[插件站点](https://klarkxy.github.io/dsh-plugins/)浏览安装命令、版本动态与各插件详细说明。

## 插件

| 分类 | 包 | 作用 |
| --- | --- | --- |
| 工作方式 | [`@klarkxy/dsh-git-commit`](plugins/dsh-git-commit/README.md) | Git 提交：在对话里提交工作区改动，由模型分组并生成 Git 提交信息。 |
| 工作方式 | [`@klarkxy/dsh-delegation`](plugins/dsh-delegation/README.md) | 委派模式：按会话开启，主代理负责拆解、委派和验收，子代理执行具体任务，支持多智能体协作。 |
| 工作方式 | [`@klarkxy/dsh-safe-auto`](plugins/dsh-safe-auto/README.md) | Safe Auto：新增「Safe Auto」审批档位，需要审批的请求交给审核模型判断，通过才放行，并记录完整的审核历史。 |
| 工作方式 | [`@klarkxy/dsh-secret-manager`](plugins/dsh-secret-manager/README.md) | 密钥管理器：在对话之外安全收集与管理密钥，工具只拿到引用，权限按会话限定。 |
| 工作方式 | [`@klarkxy/dsh-deep-view`](plugins/dsh-deep-view/README.md) | Deep View 智能界面：在正文中组合图表、交互数学、节点图、数据探索、地图与可调估算，支持草稿填入与校验回答。 |
| 工作方式 | [`@klarkxy/dsh-font`](plugins/dsh-font/README.md) | 字体：自定义 Web GUI 的界面、对话、代码与终端字体及字号。 |
| 工作方式 | [`@klarkxy/dsh-unrestricted`](plugins/dsh-unrestricted/README.md) | 破限模式：解除模型回答限制、交付完整成果的会话预设（Preset），仅作用于选用它的会话；可能导致账号被封禁。 |
| 会话与记忆 | [`@klarkxy/dsh-current-title`](plugins/dsh-current-title/README.md) | 自动标题：会话标题跟随最新任务自动更新，手动改过的名字不会被覆盖，自动重命名与人工命名两不误。 |
| 会话与记忆 | [`@klarkxy/dsh-session-manager`](plugins/dsh-session-manager/README.md) | 会话管理：跨工作目录搜索和阅读 DeepSeek Harness 会话，使用临时工作区；空输入一键续写或自动继续，久离回来给出摘要与上下文压缩建议；可选让智能体分叉当前会话或向其他会话发消息。 |
| 会话与记忆 | [`@klarkxy/dsh-workspace-folders`](plugins/dsh-workspace-folders/README.md) | 工作区文件夹：为每个工作区添加多个文件夹，在 Agent 对话中一起使用。 |
| 会话与记忆 | [`@klarkxy/dsh-context-cleaner`](plugins/dsh-context-cleaner/README.md) | 上下文面板清理：隐藏 `dsh-context` 仪表盘顶部的插件信息与推广卡片。 |
| 模型与联网 | [`@klarkxy/dsh-model-hub`](plugins/dsh-model-hub/README.md) | 子代理：配置子代理模型与推理强度、查看最后使用的模型，并按会话启用委派模式。 |
| 模型与联网 | [`@klarkxy/dsh-model-picker`](plugins/dsh-model-picker/README.md) | 模型选择器：输入框里的模型搜索与推理档位滑杆；其他插件可复用同一选择器。 |
| 模型与联网 | [`@klarkxy/dsh-web-search-manager`](plugins/dsh-web-search-manager/README.md) | 网页搜索：在一个设置页编排多源联网搜索（RRF 并发融合、主备降级、单源）与网页读取链式回退，按需勾选付费源参与并发，为模型提供 `web_search` 与 `web_fetch`。 |
| 模型与联网 | [`@klarkxy/dsh-zhihu`](plugins/dsh-zhihu/README.md) | 知乎：站内与全网搜索、热榜、直答、知识库、问题与创作数据、草稿配图，以及深度研究、知乎观察和近 30 天速览的取证与本地报告。 |
| 插件开发 | [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.md) | DSH 文档：在插件页浏览 DSH 官方开发文档；Creator 模式下智能体另获两个只读工具检索文档与核对插件（`dsh_docs`、`dsh_plugins`）。 |

[`@klarkxy/dsh-plugin-kit`](plugins/dsh-plugin-kit/README.md)（运行时、界面与诊断日志辅助）和 [`@klarkxy/dsh-model-route`](plugins/dsh-model-route/README.md)（模型路由与选择契约）是共享库，其他插件会自动安装它们。

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

需要 Node.js 24+ 与 pnpm。

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
| [@klarkxy/dsh-model-hub](plugins/dsh-model-hub/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-model-picker](plugins/dsh-model-picker/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-model-route](plugins/dsh-model-route/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-plugin-kit](plugins/dsh-plugin-kit/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-prompt-override](plugins/dsh-prompt-override/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-safe-auto](plugins/dsh-safe-auto/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-secret-manager](plugins/dsh-secret-manager/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-session-manager](plugins/dsh-session-manager/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-shortcuts](plugins/dsh-shortcuts/README.md) | 草稿 (`draft`) | 新增快捷键管理与可扩展命令面板，待完成首次发布验收。 |
| [@klarkxy/dsh-unrestricted](plugins/dsh-unrestricted/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-update](plugins/dsh-update/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-web-search-manager](plugins/dsh-web-search-manager/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-workspace-folders](plugins/dsh-workspace-folders/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-zhihu](plugins/dsh-zhihu/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
<!-- plugin-release-states:end -->

## 许可证

[SATA License 2.1](LICENSE)
