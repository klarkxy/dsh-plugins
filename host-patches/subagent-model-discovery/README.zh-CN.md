# 子代理模型发现修复

[English](README.md)

修复桌面版子代理模型列表不完整的问题：列出当前会话允许的全部模型，分别提供 provider 和 model，并明确报告提供方未注册、缺少凭据和模型信息解析失败，同时保持允许名单不变且零付费模型调用。

## 安装

使用已经为当前安装准备并校验的补丁副本。完全退出 DeepSeek Harness（包括托盘进程），然后在独立 PowerShell 窗口运行：

```powershell
& 'H:\Code\dsh-plugins\host-patches\subagent-model-discovery\install.ps1' -Receipt 'H:\Code\dsh-plugins\.scratch\subagent-model-discovery-reviewed\receipt.json' -Action apply
```

安装器在应用已退出且原文件匹配基线时，核对原文件和补丁副本、保留原文件备份，并完成原子替换。完成后重新打开 DeepSeek Harness。

## 使用

让智能体无参数调用 `list_subagent_models`。每个条目分别提供 `provider`、`model`、模型信息、思考强度和发现失败的原因。派发子代理时分别传入这两个 ID。

允许名单按会话保存。名单修改对新建顶层会话生效，已有会话及其子代理沿用原名单。模型枢纽插件的设置页面也会提示这一点。

如需恢复，完全退出 DeepSeek Harness，将同一命令的参数改为 `-Action restore`。使用 `-Action check` 可只读检查当前安装状态。

## 限制

- 补丁仅适用于已核验的宿主版本，升级版本后需重新核验。
- 模型目录信息仅描述元数据，实际调用仍经过宿主原有的权限、凭据与网络检查。
- 缺少凭据的提供方会在浏览器模型目录中显示明确失败原因，保持所有提供方可见。
- 桌面版更新会覆盖本地修复，原始备份仅对应原版本宿主。
- 宿主修复在重启应用后加载。本补丁仅用于本地桌面端安装。

原宿主代码版权为 Copyright (c) 2026 DeepSeek，使用随附的 MIT 许可证。
