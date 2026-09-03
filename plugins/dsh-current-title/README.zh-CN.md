# dsh-current-title

[English documentation](README.md)

这是一个仅运行在 Host 端的 DeepSeek Harness bundle。它让会话标题持续反映当前正在讨论的任务，而不是一直停留在首次提问。

标题格式如下：

```text
0903 | 修复 | 登录回调失败
```

提供器会在每次符合条件的用户提问后异步运行，优先使用最新的有效消息窗口，并交由 DSH 原生标题服务持久化结果。手动修改的标题仍会保持锁定，不会被自动覆盖。

## 兼容性

基于 DSH `0.1.2-rc.1` 的提供器与 patch 协议开发和测试。插件会禁用内置的 `session-title-llm` 行并插入 `current-session-title-llm`，因此不要同时安装其他占用自动标题提供器位置的 bundle。

## 从当前仓库安装

先构建，再把插件加入目标 profile：

```bash
pnpm install
pnpm --filter dsh-current-title build
dsh plugin --profile web add ./plugins/dsh-current-title
```

安装后重启该 profile，并检查组合配置：

```bash
dsh --profile web --dump-config
```

`session-title-llm` 应处于禁用状态，`current-session-title-llm` 应指向 `dsh-current-title`。

## 配置

如需调整配置，请在 profile patch 中完整覆盖 `current-session-title-llm` 行：

| 配置项 | 默认值 | 说明 |
| --- | ---: | --- |
| `maxRecentMessages` | `8` | 最多考虑多少条最近用户消息。 |
| `locale` | `auto` | 类型词语言：`auto`、`zh` 或 `en`。自动模式优先采用 DSH 显式语言偏好，否则根据最近消息判断。 |
| `targetWords` | `5` | 非 CJK 摘要的最大单词数。 |
| `targetCjkCharacters` | `10` | CJK 摘要的最大字符数。 |
| `maxInputBytes` | `4096` | 完整输入的 UTF-8 字节硬上限。 |
| `maxOutputTokens` | `64` | 标题模型响应的最大 token 数。 |
| `timeoutMs` | `60000` | 标题请求的端到端超时时间。 |
| `provider`、`model` | 继承当前路由 | 可选的显式模型路由；必须同时设置或同时省略。 |

模型只返回稳定语义键：`feature`、`fix`、`optimize`、`refactor`、`test`、`docs`、`release`、`config`、`explore`、`discuss`。插件在格式化标题时，将它们翻译为：功能、修复、优化、重构、测试、文档、发布、配置、探索、讨论。

## Windows 路径

如果仓库路径含空格，且 DSH 插件命令错误拆分本地路径，请先打包插件，再从不含空格的路径安装生成的压缩包。

## 卸载

```bash
dsh plugin --profile web remove dsh-current-title
```

## 许可证

[SATA License 2.1](LICENSE)
