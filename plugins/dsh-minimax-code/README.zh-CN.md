# MiniMax Code

<!-- release-state-note -->

[English](README.md)

借助本机已登录的 MiniMax Code 搜索网页，生成图片、视频和语音，搜索图片，转写音频，理解音视频。不需要 API Key。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-minimax-code
```

启动并登录官方 MiniMax Code 桌面端，然后打开「插件 → MiniMax Code」。工具路径会自动查找；同时安装了中国版和全球版时需选择一个。使用媒体工具期间请保持 MiniMax Code 运行。

## 工具

| 工具 | 用途 |
| --- | --- |
| `minimax_search` | 搜索网页并给出来源 |
| `minimax_generate_image` | 生成图片，或按参考图编辑 |
| `minimax_search_images`、`minimax_reverse_image_search` | 搜索已有图片，或以图搜图 |
| `minimax_generate_video`、`minimax_video_status` | 提交视频任务，之后查询和下载 |
| `minimax_list_voices`、`minimax_synthesize_speech`、`minimax_batch_speech` | 查看音色并生成配音 |
| `minimax_transcribe_audio` | 录音转写 |
| `minimax_understand_audio`、`minimax_understand_video` | 针对音视频提问 |
| `minimax_media_jobs`、`minimax_recover_media` | 查找并重新取回之前的结果 |

宿主提供网页搜索功能时，可在网页设置中选择 **MiniMax Code** 作为提供方，独立的 `minimax_search` 工具仍可使用。搜索需要已登录且没有可执行扩展的官方 mcode CLI 配置；请在本插件中设置 CLI 路径和搜索配置目录。本地发现 CLI 表示可选用，登录和兼容性会在执行请求时检查。调用可能消耗账号的模型与工具额度。暂未接入网页抓取，已验证的搜索连接没有开放此能力。

## 限制

- 生成视频必须选择模型。H3 系列可以带声音，会消耗账号点数；Hailuo 2.3 是更便宜的无声选项。实际费用以你的 MiniMax 账号为准。
- 查询视频进度请用 `minimax_video_status`，不要重复提交。
- 输入只能是工作区文件或会话附件。结果保存在 `.dsh-minimax-code/` 下，只读工作区无法生成媒体。
- 取消只停止本地进程，远端生成可能仍在进行。请在同一工作区查找任务；查询和恢复不会重新提交生成。
- 不提供图片理解、X 搜索和音乐生成。

## 许可证

[SATA License 2.1](LICENSE)
