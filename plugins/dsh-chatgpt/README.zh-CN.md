# DSH ChatGPT

让 DSH 智能体直接调用 ChatGPT 搜索、生图、图片编辑、看图与文本分析。工具安装后直接注册到宿主，不需要用户点名 skill。

所有请求通过本机官方 Codex 的 app-server 发出。插件不调用 OpenAI HTTP 接口，不读取或保存账户令牌，也不使用 API Key 回退。登录、凭据刷新及账户额度由 Codex 管理。

## 本地安装

本包目前用于本地验收，尚未发布到 npm。先在仓库运行：

```powershell
pnpm --filter @klarkxy/dsh-chatgpt build
dsh plugin --profile web add "link:H:/Code/dsh-plugins/plugins/dsh-chatgpt"
dsh web
```

打开插件详情页的配置区，点击「刷新状态」。已有 Codex ChatGPT 登录时直接复用；未登录时可选择浏览器或设备码登录。远程 DSH 应使用设备码，并在自己的浏览器完成授权。

Codex 必须运行在 DSH 所在的机器上，版本至少为 `0.162.0-alpha.17.2`。自动发现失败时，在配置区填写官方 Codex 可执行文件路径。模型与推理强度可在插件页选择；留空时使用 Codex 返回的默认模型。配置不修改全局 Codex 设置。

## 工具

| 工具 | 使用场景 |
| --- | --- |
| `chatgpt_search` | 查最新资料、联网核实、获取来源链接 |
| `chatgpt_generate_image` | 创建插图、海报、素材，可指定参考图 |
| `chatgpt_edit_image` | 修改明确选定的图片，保留原文件 |
| `chatgpt_view_image` | 看图、读截图文字、比较图片 |
| `chatgpt_ask` | 对提供的文本作独立分析、推理、翻译或写作 |

工具描述包含这些场景，供智能体自行选择；插件不在每个对话步骤自动发起请求。不同 DSH 主模型都可调用这些工具。

图片输入使用当前工作区内的文件路径，或当前会话已有的图片附件标识，每次最多五张。输出保存到工作区的 `.dsh-chatgpt/` 下，并作为会话图片返回。生图和编辑要求当前会话允许写入工作区。

## 调用与取消

每次能力调用使用独立的 Codex 会话。插件关闭环境工具，搜索只使用原生网页搜索，生图和编辑只接受原生图片完成事件及其对应的实际图片文件。不存在的能力会明确报错，不以文字说明或自行绘制替代。

调用随 DSH 任务取消；卸载插件会停止其拥有的 Codex 子进程，不关闭其他 Codex 会话。配置页的取消登录仅针对插件发起的登录，不提供退出共享 Codex 账户的操作。

调用消耗当前 ChatGPT 账户的 Codex 额度。连接成功只说明运行时和登录可用；模型及工具权限以实际调用结果为准。插件依赖 app-server 的实验性环境隔离字段，旧 Codex 不满足契约时会报兼容错误。

## 开发与验收

```powershell
pnpm --filter @klarkxy/dsh-chatgpt typecheck
pnpm --filter @klarkxy/dsh-chatgpt test
pnpm --filter @klarkxy/dsh-chatgpt build
node --test scripts/plugin-settings.test.mjs
pnpm test:editor-build
```

目标 DSH 版本见 `engines.dsh`。构建和离线测试不能代替真实登录、模型调用及 DSH 宿主验收；当前证据见 `ACCEPTANCE.md`。

接口依据：[Codex app-server](https://learn.chatgpt.com/docs/app-server)、[原生搜索](https://learn.chatgpt.com/docs/web-search)、[原生生图与编辑](https://learn.chatgpt.com/docs/image-generation)。
