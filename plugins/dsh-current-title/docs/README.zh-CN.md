# 自动标题

<!-- release-state-note -->

[English](../README.md)

让 DeepSeek Harness 的会话标题跟着你手头的任务走。你手动改过的名字不会被覆盖。

```text
0903 | 修复 | 登录回调失败
```

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-current-title
```

把 `web` 换成你的 profile 名，DSH 提示时重启。安装后默认启用，可在插件列表中关闭。

## 使用

标题会自动更新。在「插件 → 自动标题」里可以：

- 选择标题跟随每条消息，还是只看第一条消息；
- 填写自己的标题提示词；
- 选择标题模型（留空跟随当前会话模型）；
- 重新生成当前会话的标题。

## 限制

- 每次生成标题会调用一次模型；生成失败时保留原标题。
- 关闭插件后，标题交还给 DSH 自带的标题功能。

## 许可证

[SATA License 2.1](../LICENSE)
