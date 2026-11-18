---
name: dsh-web-isolated-test
description: 已停用。隔离 dsh web 的验收、截图和 GIF 改用 dsh-web-acceptance。本目录旧脚本会继承父进程环境，并且在带 token 的 URL 上截图，不能再当验收入口。
---

# 已停用

隔离验收、截图和真实 GIF 使用 [dsh-web-acceptance](../dsh-web-acceptance/SKILL.md)。

`scripts/start-web.mjs` 和 `scripts/shot.mjs` 会直接退出。它们继承父进程环境、不隔离 `DSH_AGENTS_HOME`，并让浏览器打开带 `?token=` 的地址。不要再调用。
