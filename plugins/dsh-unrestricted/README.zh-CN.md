# 破限 / Unrestricted

<!-- release-state-note -->

[English](README.md)

一个 DeepSeek Harness 会话 Preset：解除模型对回答内容的限制，交付完整成果。它只作用于选择它的会话，其他 Preset 完全不受影响。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-unrestricted
```

把 `web` 换成你的 profile 名，安装后重启 profile。

## 使用

新建会话时在 Preset 菜单中选择「破限模式」。卡片文案跟随界面语言：中文界面显示「破限模式」，其他语言显示 Unrestricted mode。已有消息的会话不能切换 Preset。从该会话派出的子代理通常也会沿用它。

没有需要记得关闭的开关：选择即生效，换成其他 Preset 即结束。它不会改变你的模型、默认 Preset 或权限。

预设包含标准会话工具，包括提醒与当前时间上下文。实际可用的操作仍取决于配置档已启用的能力。

## 限制

- ⚠ 可能导致账号被封禁：这是选用本 Preset 的已知风险，Preset 卡片里以红字标出，请自行判断是否使用。
- 不解锁任何工具或权限，审批、沙箱和计划模式照常生效。
- 被单独指定了 persona 的子代理不会沿用本 Preset。
- 卸载时在插件管理器中移除该 bundle。

## 署名

契约文本改写自 [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted)（MIT）。完整署名与许可见 [NOTICE.md](NOTICE.md)。
