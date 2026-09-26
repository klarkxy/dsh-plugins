# Agent 预设与 Persona

[English](../../areas/presets-persona.md)

Agent preset 是一条 `@deepseek-ai/dsh-agent-preset` 声明，放在 bundle 补丁里。`$DSH_HOME/.agent-presets/` 在这一版已经不再被读取。Persona 用 `@deepseek-ai/dsh-persona` 挂在 preset 内部。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

agent preset 用普通的 Cordis YAML 声明一个 agent 的子插件。宿主仍然拥有 agent 循环。每个 agent 看到的是它选中的那一修订上的工具、提示和技能。定义会急切加载。编辑影响之后创建的 agent。已有会话保留它们开始时的修订。

`@deepseek-ai/dsh-agent-preset-registry`（`ctx.agentPresets`）选择 preset 并保留修订。`@deepseek-ai/dsh-agent-preset` 是一条声明。`@deepseek-ai/dsh-persona` 贡献一份带作用域的 persona。

## 它在哪里

- 分组：[packages/preset/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/README.md)
- 声明：[packages/preset/agent-preset/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/README.md)
- 注册表：[packages/preset/agent-preset-registry/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset-registry/README.md)
- Persona：[packages/preset/persona/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/persona/README.md)
- 编写技能：[packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md)
- 最短的随发行 preset：[packages/bundle/web-app/presets/minimal.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/web-app/presets/minimal.patch.yml)
- 设计笔记：[.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.md)

随发行的 Web preset 补丁文件是 `packages/bundle/web-app/presets/` 下的 `standard`、`ptc`、`minimal` 和 `cordis`。

## 约定

注册表行：

```yaml
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: standard
```

`default` 必填。没有人指定时就用这个 preset。

声明行：

```yaml
- id: preset-review
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: review
    name: Review
    description: Reviews changes with the shell only.
    order: 10
    plugins:
      - id: persona
        name: '@deepseek-ai/dsh-persona'
        config:
          prefix: You review software changes.
      - id: tool-bash
        name: '@deepseek-ai/dsh-tool-bash'
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `id` | 必填 | 会话保存的稳定 preset id。小写字母、数字和连字符。 |
| `plugins` | 必填 | 子插件条目列表。 |
| `name` | 未设置 | 显示名。 |
| `description` | 未设置 | 显示描述。 |
| `order` | 未设置 | 名册顺序。 |

加载器行的 `id`（约定是 `preset-<id>`）不是 `config.id`。覆盖一个随发行的 preset 会替换完整的 `config`，所以要重写 `id`、`plugins` 和其他每一个字段。

persona 应该只影响一个 agent 时，挂在 preset 内部，而不是当作全宿主的替换：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `prefix` | 必填 | persona 前缀模板。 |
| `suffix` | `''` | persona 后缀模板。 |
| `complete` | `false` | 只用渲染后的前缀作为系统提示的 section。拼装仍然解析 context、工具和变量。 |
| `includeRuntimeContext` | `true` | 包含该作用域的运行时上下文。 |

在声明行出现之前，用户 preset 是 `$DSH_HOME/.agent-presets/<id>/`，里面有 `preset.yml`（`name`、`description`、`order`）和 `agent.cordis.yml`（插件列表）。编写技能写明，已经没有任何东西读取那个目录。迁移方式是做一个 bundle，其声明抄下那些字段，新行验证之后再删除遗留目录。

宿主插件提供共享服务：工具和提示注册表、agent 循环、会话、持久化、设置、沙箱策略、模型路由，以及子代理后端。preset 插件贡献带作用域的工具、persona、提示 section 和策略。宿主插件消费的服务属于宿主配置。`isolate` 控制服务实例。作用域控制贡献和事件可见性。

`!!js` 表达式只属于插件配置或 `disabled`。加载器在子插件激活时求值它们。

## 插件作者怎么用

- 把新 preset 放进 bundle 补丁。用 `dsh plugin` 或 `plugin_manager` 的 `install_bundle` 安装那个 bundle。不要手写 profile 的 `package.json`。
- 改随发行的 preset 时，覆盖 `preset-<id>`，不要再插入第二条具有相同 `config.id` 的声明。
- 在新会话里验证。已经有消息的会话保留它们的修订，不能切换 preset。
- 不要靠把文件复制进 `.agent-presets` 来发布新 preset。在这一提交上，那个目录是遗留的。
- 发明插件列表之前先读 `minimal.patch.yml`。自旧 preset 写成以来改过名的包会在激活时失败。

## 来源

- [packages/preset/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/README.md)
- [packages/preset/agent-preset/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/README.md)
- [packages/preset/agent-preset-registry/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset-registry/README.md)
- [packages/preset/persona/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/persona/README.md)
- [packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md)
- [packages/bundle/web-app/presets/minimal.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/web-app/presets/minimal.patch.yml)
- [.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.md)
