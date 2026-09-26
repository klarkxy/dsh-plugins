# 会话与标题

[English](../../areas/sessions-titles.md)

会话是只追加的 `SessionEvent` 日志，消息历史从日志派生。标题服务是 `ctx.sessionTitle`。同一进程只能注册一个自动标题 provider；第二个 `register` 会抛错。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

`Session` 是一份只追加的、带类型的 `SessionEvent` 日志。这份日志是 agent 交互历史的事实来源。给大模型的消息历史从日志派生，而不是另存一份。内存中的存储是 `@deepseek-ai/dsh-session` 的 `ctx.sessions`（`SessionStore`）。持久化是另一条缝。

标题是持久的日志事件（`session/title`）。客户端看得见它们，它们永不进入模型输入。`@deepseek-ai/dsh-session-title` 负责调度和接受。一个可选的 provider 负责生成。

## 它在哪里

- 会话日志：[docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md)
- 持久化缝：[docs/subsystems/persistence.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/persistence.md)
- 标题子系统：[docs/subsystems/session-title.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session-title.md)
- 标题服务：[packages/session/session-title/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-title/README.md)
- 随发行的 provider：[packages/session/session-title-first-prompt-llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-title-first-prompt-llm/README.md) 和 [packages/session/session-title-all-prompts-llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-title-all-prompts-llm/README.md)
- 随发行的行：[packages/bundle/base/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/base/cordis.patch.yml)

## 约定

标题服务的方法：

- `ctx.sessionTitle.get(session)` 读取最新折叠后的标题。
- `ctx.sessionTitle.rename(session, title)` 钉住一个用户标题。
- `ctx.sessionTitle.refresh(session, signal?)` 显式重新生成。
- `ctx.sessionTitle.register(provider)` 注册那一个 provider，并返回清理函数。第二次注册会抛错。

provider 的形状：

```ts
ctx.sessionTitle.register({
  id, // SessionTitleProviderId
  automatic, // 'first-prompt' | 'all-prompts'
  generate(request) {
    return { title, messageSeqs, model }
  },
})
```

`automatic: 'first-prompt'` 从开头那条合格提示生成。`automatic: 'all-prompts'` 可以在后来的合格提示之后修订。只有人类 `user/message` 事件里的文本块才合格。用户重命名会钉住会话：之后的用户消息不会安排自动修订。`refresh()` 是有意取消钉住的路径。

服务没有库默认值。三个限制都必填：

| 字段 | 含义 |
| --- | --- |
| `fallbackMaxWords` | 确定性回退里，以空白分隔的词的最大数量。 |
| `fallbackMaxBytes` | 回退的最大 UTF-8 字节数。不得超过 `maxTitleBytes`。 |
| `maxTitleBytes` | 任何来源可接受的最大 UTF-8 字节数。 |

base bundle 随发行的是：

```yaml
- id: session-title
  name: '@deepseek-ai/dsh-session-title'
  config:
    fallbackMaxWords: 5
    fallbackMaxBytes: 40
    maxTitleBytes: 80
- id: session-title-llm
  name: '@deepseek-ai/dsh-session-title-first-prompt-llm'
  config:
    targetWords: 5
    targetCjkCharacters: 10
    maxInputBytes: 4096
    maxOutputTokens: 64
    timeoutMs: 60000
```

另一份包是 `@deepseek-ai/dsh-session-title-all-prompts-llm`。共享的大模型生成策略在 `@deepseek-ai/dsh-session-title-llm`（见服务 README 指向该包的链接）。provider 只在一条已标记的、由循环构建的请求的路由与记录的 `request/header` 匹配之后才开始。较新的修订取代并中止较旧的工作。自动失败会警告并保留最新标题。自动工作从不拖延主 agent 的响应。

`foldSessionTitle(events)` 是纯折叠。分叉在种子里原样继承标题事件。

## 插件作者怎么用

- 注入 `sessionTitle`。`register` 只调用一次。
- 在你的补丁里禁用随发行的 `session-title-llm` 行，并插入你自己的行。因为补丁会整份替换 `config`，如果你覆盖 `session-title` 本身，仍需要的每个限制都要重写。
- 除非你在实现这项服务，否则不要靠追加原始日志事件来写标题。走 `register`、`rename` 或 `refresh`。
- 返回 `title`、你实际使用的 `messageSeqs`，以及 provider 调用了模型时的 `model` 来源。
- 标题必须留在模型输入之外。不要再把它们抄进系统提示的 section。

## 来源

- [docs/subsystems/session.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session.md)
- [docs/subsystems/persistence.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/persistence.md)
- [docs/subsystems/session-title.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/session-title.md)
- [packages/session/session-title/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-title/README.md)
- [packages/session/session-title-first-prompt-llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-title-first-prompt-llm/README.md)
- [packages/session/session-title-all-prompts-llm/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/session/session-title-all-prompts-llm/README.md)
- [packages/bundle/base/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/base/cordis.patch.yml)
