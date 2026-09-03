# dsh-plugins

[English documentation](README.md)

这是一个用于收纳轻量 DeepSeek Harness 插件的 pnpm monorepo。`plugins/` 下的每个目录都是可以独立安装、测试和发布的 DSH bundle；仓库根目录本身不是插件。

## 插件

| 包 | 作用 |
| --- | --- |
| [`dsh-current-title`](plugins/dsh-current-title/README.zh-CN.md) | 用 `MMDD | 本地化类型 | 摘要` 让会话标题持续反映当前任务。 |

## 开发

需要 Node.js 22+ 与 pnpm 10。

```bash
pnpm install
pnpm check
```

每个插件自行维护 bundle patch、运行时代码、测试和版本号，避免不同小功能被迫一起安装。

## 许可证

[SATA License 2.1](LICENSE)
