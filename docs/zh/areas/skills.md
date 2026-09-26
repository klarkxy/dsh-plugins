# 技能

[English](../../areas/skills.md)

Skill 是按需加载的说明，不是会话事件。嵌入式说明用 `ctx.skills.register`。磁盘上的说明是带 frontmatter 的 `SKILL.md`，由 filesystem provider 发现。模型通过 `skill` 工具加载正文。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

技能这一族给 agent 一份可复用说明的目录。`@deepseek-ai/dsh-skill` 是注册表（`ctx.skills`），它自己不携带技能正文。`@deepseek-ai/dsh-skill-filesystem` 发现本地文件。`@deepseek-ai/dsh-tool-skill` 发布会话目录和面向模型的 `skill` 工具。打包的提供者，例如 `@deepseek-ai/dsh-skill-badge` 和 `@deepseek-ai/dsh-skill-office`，注册它们自己的来源。

本索引插件使用 `ctx.skills.register` 的原因相同：宿主层的运行时技能对每一个能看到全局层的 agent 都可见，同时不替换 agent 的 preset。

## 它在哪里

- 分组地图：[packages/skill/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/README.md)
- 注册表：[packages/skill/skill/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill/README.md) 和 [packages/skill/skill/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill/src/index.ts)
- 文件系统提供者：[packages/skill/skill-filesystem/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill-filesystem/README.md)
- 子系统类型：[docs/subsystems/skills.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/skills.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/skills)）
- 模型侧消费者：[packages/skill/tool-skill/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/tool-skill/README.md)

base bundle 挂载 `skill`、`skill-filesystem` 和 `skill-badge`（badge 那一行默认禁用）。`sdk-minimal` 不挂载注册表；只 `inject` `skills` 的插件在那里会一直等待。

## 约定

名字是 kebab-case：`^[a-z0-9]+(?:-[a-z0-9]+)*$`。

嵌入式注册：

```ts
ctx.skills.register({
  name: 'my-skill',
  description: 'Short routing text for the catalog.',
  whenToUse: 'Optional extra routing guidance.',
  source: 'bundled',
  content: 'Instructions loaded on demand.',
  invocation: { modelInvocable: true, userInvocable: true },
  resourceBase: { kind: 'directory', path: '/absolute/dir' },
})
```

`SkillRegistration` 可以省略 `invocation` 和 `provider`。省略 invocation 时，模型和用户两个表面都允许。省略 provider 时，使用注册表拥有的 `runtime` 标签。`runtime` 是保留的提供者名字。同一层里同名的 runtime 注册是先到先得，并给出警告。在同一层内，project 条目压过 runtime 条目，runtime 条目压过 user 条目。更近的作用域层会直接盖住更远的层。

`resourceBase` 是 `{ kind: 'directory', path }`、`{ kind: 'url', url }` 或 `{ kind: 'opaque', description }`。`renderSkillContent` 告诉模型相对路径要对照这个基址解析，并且只在需要时加载。工具结果不会枚举目录。

文件系统技能是扫描根顶层的 `<name>/SKILL.md`，或扁平的 `<name>.md`。不支持嵌套的 `**/SKILL.md` 发现。frontmatter 要求 `name` 和 `description`。可选键是 `whenToUse`、`metadata`、`disable-model-invocation` 和 `user-invocable`。省略的 invocation 键表示允许那个表面。布尔值拼写非法时，整份技能会被丢掉并给出警告。

文件系统优先级：

| 优先级 | 来源 | 根 |
| --- | --- | --- |
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | 配置了 `bundledSkillDir` 时使用它 |

项目根是包含 `.git` 的最近祖先，没有时就是当前工作目录。源码里的 `BUNDLED_SKILL_RANK` 是 `600`。

注册表配置：`collectCacheMaxEntries` 默认 128。值得知道的文件系统配置：`providerName` 默认 `filesystem`，`includeDefaultRoots` 默认 true，`dshHome` 默认 `$DSH_HOME` 或 `~/.dsh`，`agentsHome` 默认 `$DSH_AGENTS_HOME` 或 `~/.agents`，`customSkillDirs` 默认 `[]`，`watch` 默认 true。

模型目录只包含模型可调用的 `name` 和 `description`。消费者上的 `catalogDescriptionMaxLength` 默认 500（整数，最小 3）。`skill` 工具接受 `{ name }`，拒绝非模型可调用的技能，并通过 `renderSkillContent` 返回 `<skill_content>`。用户消息的第一行以 `/<name>` 开头时，会在没有工具调用的情况下加载一份用户可调用的技能。随发行的 preset 技能保持在 8192 个字符以内，因为标准 preset 的工具结果裁剪器会截掉更长的工具结果。

不是单条嵌入式技能的提供者使用 `ctx.skills.registerProvider(create)`。`create` 收到一个控制对象，其 `invalidate()` 只在该注册仍活跃时清空目录。

## 插件作者怎么用

- 插件内部携带的一套说明，优先用 `ctx.skills.register`。把 `resourceBase` 指到放较长参考资料的目录，这样目录条目保持简短。
- 用户应该能不重装 bundle 就改文字时，优先把 `SKILL.md` 放在被扫描的根下。
- `description` 保持在目录长度限制内。步骤放进 `content`，长表格放进正文点名的文件。
- 不要指望 `sdk-minimal` 加载技能插件。基于 base 的 profile（`web`、`headless`、`sdk`、`acp`）会挂载 `ctx.skills`。
- 同一层里，同名的项目技能压过 runtime 注册。

## 来源

- [packages/skill/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/README.md)
- [packages/skill/skill/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill/README.md)
- [packages/skill/skill/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill/src/index.ts)
- [packages/skill/skill-filesystem/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill-filesystem/README.md)
- [docs/subsystems/skills.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/subsystems/skills.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/skills)）
- [packages/skill/tool-skill/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/tool-skill/README.md)
