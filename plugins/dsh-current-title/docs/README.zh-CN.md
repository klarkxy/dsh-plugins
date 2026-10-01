# @klarkxy/dsh-current-title

让会话标题跟着你手头的任务走；你手动改过的名字不会被覆盖。

[English](../README.md)

从 [`dsh-plugins/dsh-current-title`](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title) 迁入。类型标签保持中英双语（`功能` / `Feature` 及其余固定词表）。生成直接调用宿主 `llm` 服务，一个标题一次调用，不重试。

安装后 bundle 插入项默认启用。启用期间占用原生 `sessionTitle` 槽位；关闭时若槽位仍由本包持有，且被让出的加载项身份未变，则交还原所有者。安装不会永久停用宿主自带的标题插件。插件页可以填写标题提示词，并选择标题模型。提示词留空使用内置说明；模型留空先跟随当前会话模型，再回落到宿主默认对话模型。类型标签仍跟随宿主语言。

## 安装

需要 Node.js ≥22 与 DSH `0.1.7-rc.2`。「自动标题」默认启用，可在插件设置中关闭。标题写入宿主 `sessionTitle`，由宿主调度；生成使用宿主 `llm` 服务。

```sh
npm install @klarkxy/dsh-current-title
```

部分宿主会预装并默认启用本功能；宿主支持热切换时，通过「设置 → 插件」开关无需重启。宿主提示需要重启时，安装或移除后重启。

## 宿主 RPC

频道 `/dsh-current-title`，走宿主授权策略。

- `status` — 当前设置、槽位支持与归属；传入 `sessionId` 时附带该会话的标题状态（标题、来源类型、是否生成中、是否被手动固定）。
- `settings` — 按比较并交换修订号更新提示词和模型（`{ prompt?, model?, expectedRevision }`）。提示词留空使用内置说明；模型留空先跟随当前会话模型，再回落到宿主默认对话模型。类型标签语言保持 `auto`。
- `regenerate` — 重新生成单个会话的标题（`{ sessionId }`）；会话不存在报 `not-found`，标题服务未就绪报 `unavailable`。

## 标题形状

```text
0903 | 修复 | 登录回调失败
```

月日、类型标签、任务摘要。标签取自固定的中英双语词表，摘要语言跟随最近几条消息。只有最近真实的人工 `user/message` 事件参与生成，插件辅助消息不参与。

## 边界

- 手动改过的标题由原生标题存储保留。
- 生成失败时不写入新标题，会话保留原有标题。
- 关闭插件会取消在途生成并丢弃迟到结果。

## 许可证

[SATA License 2.1](../LICENSE)，保留原 `dsh-plugins` 出处。
