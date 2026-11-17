# 子代理模型发现修复

简体中文 / [English](README.en.md)

修复桌面版子代理模型列表不完整的问题：列出当前会话允许的全部路线，分别提供 `provider` 和 `model`，并明确报告提供方未注册、缺少凭据和模型元数据解析失败，同时保持允许名单不变且零付费模型调用。

## 安装

使用已为当前安装准备并校验的补丁副本与回执文件。完全退出 DeepSeek Harness（包括托盘进程），然后在独立 PowerShell 窗口运行：

```powershell
& '<仓库目录>\host-patches\subagent-model-discovery\install.ps1' -Receipt '<仓库目录>\.scratch\subagent-model-discovery-reviewed\receipt.json' -Action apply
```

安装器会在应用已退出且原文件匹配基线时，核对原文件和补丁副本、保留原文件备份，并完成原子替换。完成后重新启动 DeepSeek Harness。

## 使用

让智能体无参数调用 `list_subagent_models`。每条结果分别提供 `provider`、`model`、模型元数据、思考强度及发现失败的原因；派发子代理时分别传入这两个 ID。

允许名单按会话保存。修改允许名单只对新建顶层会话生效，已有会话及其子代理继续沿用原名单。模型管理插件的设置页也会提示这一点。

如需恢复原文件，完全退出 DeepSeek Harness 后将同一命令的 `-Action` 改为 `restore`。使用 `-Action check` 可只读检查当前安装状态。

## 主要限制

- 补丁仅适用于已核验的宿主版本，升级宿主后需重新审查。
- 模型目录信息仅描述元数据，实际调用仍经过宿主原有的权限、凭据与网络检查。
- 缺少凭据的提供方会在浏览器模型目录中显示明确失败原因，以便所有已配置提供方保持可见。
- 桌面端更新会覆盖本地修复；原始备份仅对应其来源的宿主版本。
- 修复在重启应用后生效；本补丁仅适用于本地桌面端安装。

原宿主代码版权为 Copyright (c) 2026 DeepSeek，使用随附的 [MIT 许可证](UPSTREAM-LICENSE)。
