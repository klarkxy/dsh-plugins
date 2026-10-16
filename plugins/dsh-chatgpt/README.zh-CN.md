# DSH ChatGPT

<!-- release-state-note -->

[English](README.md)

借助本机已登录的 Codex，让 DeepSeek Harness 智能体使用 ChatGPT 联网搜索、生图、改图和图片分析。不需要 API Key。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-chatgpt
```

DSH 所在电脑上还需要安装官方 Codex，版本不低于 `0.162.0-alpha.17.2`。打开插件页点击「刷新状态」：已有 Codex ChatGPT 登录时直接复用，否则可选择浏览器或设备码登录（远程 DSH 请用设备码）。找不到 Codex 时，可手动填写其路径。调用使用 Codex 默认模型。插件保留登录、路径和超时设置，不再提供文本问答工具或模型选择入口。

## 工具

| 工具 | 用途 |
| --- | --- |
| `chatgpt_search` | 查最新资料，返回来源链接 |
| `chatgpt_generate_image` | 生成图片，可附参考图 |
| `chatgpt_edit_image` | 修改指定图片，保留原图 |
| `chatgpt_view_image` | 看图、识别截图文字、比较图片 |

智能体会自行选择这些工具，无需你点名。

## 限制

- 调用消耗你 ChatGPT 账户的 Codex 额度。
- 图片来自工作区文件或会话中已有的图片，每次最多五张。结果保存在工作区的 `.dsh-chatgpt/` 下，因此生图和改图需要工作区写权限。
- 旧版 Codex 会报兼容错误。

## 许可证

[SATA License 2.1](LICENSE)
