# 破限 / Unrestricted

<!-- release-state-note -->

[English](README.md)

一个 DeepSeek Harness 会话 Preset：解除模型对回答内容的限制，交付完整成果。只作用于选择它的会话，其他 Preset 保持原有设置。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-unrestricted
```

把 `web` 换成你的 profile 名，安装后重启 profile。

## 使用

新建会话时在 Preset 菜单选择「破限模式」。卡片文案和已选预设按钮跟随界面语言：中文显示「破限模式」，其他语言显示 Unrestricted mode。工作区名称保持用户命名。Preset 在新建会话、发送消息前选定；从该会话派出的子代理默认沿用该预设。

选择本 Preset 即可在当前会话生效，日常会话选回其他 Preset 即可；你的模型、默认 Preset 和权限均保持不变。

预设包含标准会话工具，包括提醒与当前时间上下文。实际可用的操作仍取决于配置档已启用的能力。

## 限制

- ⚠ 可能导致账号被封禁：这是本 Preset 的已知风险，卡片里以红字标出，请自行判断是否使用。
- 工具范围与权限保持不变，审批、沙箱和计划模式照常生效。
- 未单独指定 persona 的子代理默认继承本 Preset；单独指定 persona 的子代理使用其各自人设。
- 卸载时在插件管理器中移除该 bundle。

## 会话内的工具预算

本 Preset 通过宿主公开的配置项调高自身会话的读取与保留预算，宿主文件和其他 Preset 保持默认：

| 项 | 宿主默认 | 本 Preset |
| --- | --- | --- |
| `read` 单次行数 | 2000 | 20000 |
| `read` 单行字符 | 2000 | 10000 |
| `read` 单次字节 | 50 KiB | 1 MiB |
| 工具结果保留 | 8 KiB | 64 KiB |
| 子代理递归深度 | 1 | 3 |

宿主默认值面向简短对话设定（单次 `read` 50 KiB、工具结果保留 8 KiB、子代理深度 1 层）。调高上述预算后，跨多文件的审计、迁移和多方评审可以在单次流程中完整读取与展开，同时保持宿主原有的各项机制开启。

## 署名

契约文本改写自 [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted)（MIT）；persona 后缀三节参考 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)（MIT）的提示词结构。完整署名与许可见 [NOTICE.md](NOTICE.md)。
