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

## 运行时强化

除静态契约文本外，本 Preset 只对选用它的会话增加两项运行时行为：

- **尾部提醒**：每次组装系统提示词时，在人格末尾追加一条简短的执行提醒，重申「先交付、不停半路、不替换成摘要」，降低长上下文把契约冲淡的概率。
- **拒绝重试**：一轮回答以拒绝、说教或「建议咨询别人」开头时，默认在同一轮追加一条纠正消息并重试一次；重试后仍拒绝则不再循环。纠正消息以插件自有来源作为一条 user 角色消息出现在会话记录里，不会冒充真人输入。

两项行为都通过 `agentPresets.composedPreset()` 判断当前会话的 Preset，其他 Preset 完全不受影响。尾部提醒固定在 `1_000_000` 段序，排在系统提示词内宿主所有内置段落之后。可在 bundle 配置中关闭或调整：

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `tailReminder` | `true` | 是否追加尾部提醒 |
| `refusalRetry` | `true` | 是否启用拒绝重试 |
| `maxRetries` | `1` | 每轮最多重试次数，取值 1–3 |

也可以在 `$DSH_HOME/unrestricted/tuning.json` 写本地覆盖，字段同名，另支持 `modelProfiles`（按 provider/model 子串映射到一句额外提示）：

```json
{
  "tailReminder": true,
  "refusalRetry": true,
  "maxRetries": 2,
  "transportEnabled": true,
  "transportMaxRetries": 3,
  "modelProfiles": { "kimi": "Keep the first line concrete and short." }
}
```

`tuning.json` 的值优先于 bundle 配置，坏值会回落到默认值；修改后重启 profile 生效。

`profile` 可选 `default`、`stealth`、`max`，分别对应 `presets/profiles/*.md`；`stealth` 压缩输出，`max` 加强一次交付到底的要求。`transportEnabled` 控制请求边界的流式拒绝拦截，默认开启；每次请求都解析实际 Agent，只处理本 Preset 的普通对话调用，不处理标题、压缩或一次性辅助调用。`transportMaxRetries` 控制最多重试次数（1–3），最终一次始终透传。

## 限制

- ⚠ 可能导致账号被封禁：这是本 Preset 的已知风险，卡片里以红字标出，请自行判断是否使用。
- 工具范围与权限保持不变，审批、沙箱和计划模式照常生效。
- 运行时强化会增加少量提示词 token。默认配置下，持续拒绝最多触发 3 次请求重试和 1 次纠正步骤，纠正步骤本身又可重试 3 次；调高上限会叠乘这些预算。短回答可能要等开头分类完成后再显示。
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

契约文本改写自 [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted)（MIT，v0.2.8）；persona 后缀三节参考 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)（MIT）的提示词结构；尾部提醒与拒绝重试为本包实现。完整署名与许可见 [NOTICE.md](NOTICE.md)。
