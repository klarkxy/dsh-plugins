# MiniMax Code · DSH 插件

<!-- release-state-note -->

复用官方 MiniMax Code 登录，提供图片、视频和语音生成、图片搜索、音频转写及音视频理解。插件不要求填写 API Key。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-minimax-code
```

启动并登录官方 MiniMax Code 桌面端，在 DSH 启用插件，进入「插件 → MiniMax Code」。媒体调用使用官方生成的区域版 `mcode-tools` 启动器，使用时保持 MiniMax Code 运行。媒体路径留空可自动查找，也可选择官方启动器或 JavaScript 入口；同时安装中国和全球启动器时须明确选择区域。

网页搜索使用独立的官方 `mcode` CLI 和搜索专用配置，与媒体工具路径分开。状态检查不会生成媒体。搜索须先通过工具及扩展检查才会发起模型请求，设置页单独显示其可用性。

若现有搜索 profile 启用了 MCP 或可执行扩展，可在「搜索专用配置目录」指定已通过官方 CLI 登录的独立目录。插件不会更改全局扩展或复制认证文件；检测到活动扩展时会阻止搜索，不影响媒体功能。

## 能力

| 工具 | 用途 |
| --- | --- |
| `minimax_search` | 搜索公开网页，返回真实搜索来源链接 |
| `minimax_generate_image` | 生图或参考图编辑，每批最多 10 项、每项最多 4 张参考图 |
| `minimax_search_images`、`minimax_reverse_image_search` | 搜索已有图片并按需下载，或以图搜图 |
| `minimax_generate_video`、`minimax_video_status` | 提交一次视频任务，随后查询并下载同一任务 |
| `minimax_list_voices` | 查看可用音色 |
| `minimax_synthesize_speech`、`minimax_batch_speech` | 单段配音或最多 10 段独立参数的批量配音 |
| `minimax_transcribe_audio` | 录音转写 |
| `minimax_understand_audio`、`minimax_understand_video` | 对最多 10 份指定音视频提问 |
| `minimax_media_jobs`、`minimax_recover_media` | 查找已保存任务，取回已有结果，不重新生成 |

本批不提供图片理解、X 搜索和音乐生成。

## 文件与视频模型

输入只能是明确指定的当前工作区文件，或当前会话已有的附件。CLI 只上传指定媒体。结果保存在 `.dsh-minimax-code/<jobId>/`，同时作为 DSH 原生图片或文件附件返回。只读工作区不能生成或下载媒体。

视频必须明确选模型：H3 支持 4–15 秒、768P/2K 及图像、视频、音频参考；H3-Max 支持 5–15 秒、480P/768P、文生或关键帧；Hailuo 2.3 支持 768P 的 6/10 秒或 1080P 的 6 秒。H3 系列可生成声音，消耗账号点数；Hailuo 是套餐可用的低成本无声选项。实际额度与费用以账号及官方规则为准，插件不会自行替换模型。

提交后使用返回的 `jobId` 调用 `minimax_video_status`，不要用重复提交来查询进度。下载失败时使用恢复工具。取消会停止本地 CLI 进程树，但不保证取消远端生成；提交结果不确定时会保留不确定状态，不自动重试。

任务元数据保存在宿主的受保护存储域中，不能用工作区里的回执文件授权查询任意远端任务。记录不保存登录令牌、媒体签名链接或提示词。

已测版本与验证边界见[验收记录](ACCEPTANCE.md)。
