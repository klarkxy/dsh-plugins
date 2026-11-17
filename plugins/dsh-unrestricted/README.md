# 破限模式

<!-- release-state-note -->

简体中文 / [English](README.en.md)

一个 DeepSeek Harness 会话 Preset：解除模型对回答内容的限制，交付完整成果；仅作用于选用它的会话，其他 Preset 保持原有设置。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-unrestricted
```

将 `web` 替换为你的 profile 名称，安装后重启 profile。

## 使用

### 选择与生效范围

1. 新建会话时，在发送消息前从 Preset 菜单选择「破限模式」（非中文界面下显示为 `Unrestricted mode`）。
2. 该模式仅作用于选用它的会话及其派生的子代理（未单独指定人设时默认继承）；日常会话切回其他 Preset 即可，原有模型、默认 Preset 与权限设置均不受影响。
3. 预设包含标准会话工具（含定时任务与时间上下文），具体可用能力仍取决于 profile 已启用的功能。
4. 回复可结合正文、步骤、代码及已启用插件提供的原生界面；例如启用 Deep View 后可用对比表、关系图和可调估算。你指定的输出格式仍优先。

### 运行时强化与调优

除静态交付契约外，插件仅对选用「破限模式」的会话启用以下运行时机制，其他 Preset 与标题、压缩等辅助调用均不受影响：

- **尾部提醒（`tailReminder`）**：每次组装系统提示词时在末尾追加简短执行提醒，避免长上下文冲淡契约；可按模型家族附带一条简短适配提示（支持通过 `modelProfiles` 自定义）。
- **轮次拒绝重试（`refusalRetry` / `maxRetries`）**：若回复以拒绝、说教或推诿开头，插件会以自有来源追加一条 user 角色纠正消息并重新生成（默认每轮最多重试 1 次）。
- **流式请求拦截（`transportEnabled` / `transportMaxRetries`）**：对本 Preset 普通对话的响应开头进行缓冲检测，若开头呈拒绝形式则丢弃该次尝试并按阶梯形态重试（默认最多重试 3 次，最终一次始终透传）。
- **提示词档位（`profile`）**：可选 `default`、`stealth`（精简输出，先给完整产物）或 `max`（强化单轮端到端完整交付）。

可在 `$DSH_HOME/unrestricted/tuning.json`（未设置 `$DSH_HOME` 时默认 `~/.dsh/unrestricted/tuning.json`）放置本地配置覆盖默认值，修改后重启 profile 生效；格式错误的配置项会自动回落到默认值：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `tailReminder` | `true` | 是否在系统提示词末尾追加执行提醒 |
| `refusalRetry` | `true` | 是否启用轮次末尾的拒绝纠正重试 |
| `maxRetries` | `1` | 每轮纠正重试上限（1–3） |
| `profile` | `"default"` | 提示词档位：`default`、`stealth` 或 `max` |
| `transportEnabled` | `true` | 是否启用请求边界的流式拒绝拦截 |
| `transportMaxRetries` | `3` | 请求边界流式重试上限（1–3） |
| `modelProfiles` | `{}` | 按 provider/model 子串映射一句额外模型提示 |

示例：

```json
{
  "tailReminder": true,
  "refusalRetry": true,
  "maxRetries": 2,
  "profile": "default",
  "transportEnabled": true,
  "transportMaxRetries": 3,
  "modelProfiles": {
    "kimi": "Keep the first line concrete and short."
  }
}
```

### 会话内的工具预算

本 Preset 仅在自身会话内提高以下读取、结果保留与子代理递归预算，不影响宿主默认配置或其他 Preset：

| 项目 | 宿主默认 | 本 Preset |
| --- | --- | --- |
| `read` 单次行数 | 2000 | 20000 |
| `read` 单行字符数 | 2000 | 10000 |
| `read` 单次字节数 | 50 KiB | 1 MiB |
| 工具结果保留阈值 | 8 KiB | 64 KiB |
| 子代理递归深度 | 1 | 3 |

## 主要限制

- ⚠ **可能导致账号被封禁**：这是本 Preset 的已知风险，Preset 卡片中已以红字标出，请自行评估后再使用。
- 不改变工具范围与权限机制：审批、沙箱与计划模式照常生效（计划模式下仍禁止在批准前修改文件，仅允许在方案正文写完整技术细节）。
- 运行时强化会消耗额外提示词 token；默认配置下，持续拒绝最多可触发 3 次流式请求重试及 1 次轮次纠正（纠正本身还可触发最多 3 次流式重试），调高上限会相应放大消耗。流式开头检测期间，短回复可能会稍作缓冲后再显示。
- 单独指定了其他 persona 的子代理不会继承本 Preset；卸载时在插件管理器中移除本插件即可。

## 署名

契约文本改写自 [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted)（MIT）；persona 后缀结构参考 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)（MIT）；尾部提醒与拒绝重试由本包实现。完整署名与许可证见 [NOTICE.md](NOTICE.md)。

## 许可证

[SATA License 2.1](LICENSE)
