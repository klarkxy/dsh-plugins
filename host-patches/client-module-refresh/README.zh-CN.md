# Web 刷新模块加载修复

[English](README.md)

修复 DSH Web 启动脚本尚未加载完成时，收到相同启动配置而重复加载同一客户端模块的问题。

## 安装

先停止目标配置对应的 Web 实例，再将已校验的包副本放入该配置的 `node_modules/@deepseek-ai/dsh-client-modules` 目录：

```powershell
node .\host-patches\client-module-refresh\stage.mjs --destination '<配置目录的绝对路径>\node_modules\@deepseek-ai\dsh-client-modules'
```

目标目录必须不存在。安装器校验原包后创建独立副本，不修改原始安装。完成后重新启动该 Web 配置。

## 使用

正常刷新 DSH Web。模块确有变化时仍会重新加载，真正的重复注册仍会报错。

## 限制

- 仅支持已核验的宿主文件；宿主升级后需要重新审查。
- 这是本地 Web 配置修复，不会更新已有桌面端安装。
- 如需撤销，先停止该 Web 实例，只移除 `.refresh-patch.json` 记录的补丁包目录，再重新启动。

原宿主代码版权为 Copyright (c) 2026 DeepSeek，使用随附的 MIT 许可证。
