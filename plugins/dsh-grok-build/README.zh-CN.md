# Grok Build

<!-- release-state-note -->

[English](README.md)

借助本机已登录的 Grok Build CLI 搜索网页、读取页面、生成和编辑图片，以及用图片生成视频。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-grok-build
```

同时安装并登录官方 Grok Build CLI，目前只支持 1.0.50 版本。打开「插件 → Grok Build」；CLI 不在 PATH 中时，填写其路径。

## 工具

| 工具 | 用途 |
| --- | --- |
| `grok_search` | 搜索网页并给出来源 |
| `grok_fetch` | 读取页面 |
| `grok_generate_image` | 生成图片 |
| `grok_edit_image` | 编辑工作区图片或会话附件 |
| `grok_image_to_video` | 让图片动起来 |
| `grok_reference_to_video` | 用参考图、预设音色或关键帧生成视频 |
| `grok_media_jobs`、`grok_recover_media` | 查找并重新取回之前的结果 |

## 限制

- 图片编辑和视频需要打开「允许 Grok 原生工具读取媒体文件」（默认关闭）。这只是额外检查，不是沙箱：Grok 拥有本机 CLI 平常的文件访问权限。
- 结果保存在工作区，只读工作区无法生成媒体。
- 取消只停止本地进程，远端生成可能仍在进行；不会自动重新生成。
- 不提供图片理解、X 搜索、音频和音乐生成。

## 许可证

[SATA License 2.1](LICENSE)
