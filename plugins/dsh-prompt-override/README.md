# 提示词优化

<!-- release-state-note -->

简体中文 / [English](README.en.md)

为 DSH 原生系统提示词补上通用工作规范，并改写过于简略的内置工具指引，对所有会话生效。

DSH 原生系统提示词只有一句身份说明，后面是零散的单条工具规则，缺少工作方式、验证、安全操作和回复要求等通用约定。本插件在不改动工具、权限和沙箱的前提下补全这些内容。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-prompt-override
```

将 `web` 替换为你的 profile 名称，安装后重启 profile。

## 使用

安装即生效，作用于所有会话（含子代理）。新会话从第一轮起使用新提示词；已有会话在下一次组装提示词时切换。

插件做三件事：

| 内容 | 说明 |
| --- | --- |
| 通用工作规范 | 在身份说明之后插入一段英文规范：先理解再改动、最小改动、改完验证、不虚报结果、危险操作前确认、并行调用独立工具、用用户的语言简洁回复 |
| 内置工具指引 | 改写 read、write、edit、glob、grep、bash/pwsh 的使用指引，补充 edit 唯一匹配、行号前缀、并行搜索、后台长任务等要点；工具未启用时对应指引照常不出现 |
| DSH 开发说明 | 默认移除每轮附带的 DSH 自身源码与 Web GUI 开发说明；官方 `cordis`（定制 DSH）Preset 中保留 |

其他插件贡献的提示词保持原样。

### 本地覆盖

在 `$DSH_HOME/prompt-override/overrides.json`（未设置 `$DSH_HOME` 时为 `~/.dsh/prompt-override/overrides.json`）放置配置，修改后重启 profile 生效；格式错误的字段会被忽略：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `core` | `true` | 是否插入通用工作规范 |
| `tools` | `true` | 是否改写内置工具指引 |
| `devContext` | `"auto"` | DSH 开发说明：`auto`（仅 `cordis` Preset 保留）、`keep`、`drop` |
| `coreText` | — | 用自己的文本替换通用工作规范 |
| `sections` | `{}` | 按提示词段名替换文本，值为 `null` 时删除该段 |

示例：

```json
{
  "devContext": "keep",
  "sections": {
    "tool:edit": "Read a file before editing it. Keep edits small.",
    "ui:deliverable-file-references": null
  }
}
```

常用段名：`tool:read`、`tool:write`、`tool:edit`、`tool:glob`、`tool:grep`、`tool:bash`、`tool:pwsh`、`tool:jobs`、`tool:web_search`、`tool:web_fetch`、`tool:subagent`、`ui:deliverable-file-references`、`harness:source`、`app:web-surface`，插入的规范段为 `prompt-override:core`。

## 主要限制

- 只改写系统提示词，工具自身的说明与参数描述保持原生内容。
- 使用 `minimal` Preset 的会话由宿主锁定完整提示词，本插件对其不生效。
- 替换文本为英文，模型仍按规范使用用户的语言回复。
