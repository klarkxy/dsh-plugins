# 删繁 / Pruner

[English](README.md)

保持受支持行为，减少理解系统必须掌握的概念、状态与抽象层。Pruner 是独立 DSH Preset，使用原生文件、搜索、Shell、Skills、计划模式和上下文压缩能力；没有额外运行时插件、自动路由或统计服务。

## 安装与使用

需要 Node.js 22.19+、DSH 0.1.5-rc.2 系列及其标准编码工具。仓库根目录执行：

```sh
node plugins/dsh-pruner/install.mjs
```

默认安装到 `$DSH_HOME/.agent-presets/pruner`；未设置 `DSH_HOME` 时使用 `~/.dsh`。DSH Editor 或其他启动器使用独立 Home 时，指定它实际使用的路径：

```sh
node plugins/dsh-pruner/install.mjs --home "D:/my-dsh-home"
```

在新会话的 Preset 选择器中选择 **删繁 / Pruner**，然后在模型选择器中选择当前可用的强推理、大上下文模型，并启用该模型支持的较高推理强度。Preset 元数据不支持单独绑定模型或 reasoning effort，所以此包不改全局模型配置，也不承诺替你选好了模型。

这是原生 Preset 文件包，不是 `dsh plugin add` 的 bundle。安装只复制 Preset 配置与随附声明，不改默认 Preset、其他 Preset、权限或模型设置，不执行构建钩子。已有同名目录、文件或符号链接会被拒绝；更新前自行备份并移走旧 `pruner` 目录，再运行安装。复制中断会报告未完成目录，不将半成品宣称为安装成功。无需更换当前正在运行的会话；已有消息的会话不能切换 Preset。

卸载时移走这个 Home 下的 `.agent-presets/pruner` 目录即可。文件在会话开始后发生变化，建议重启 DSH，再新建会话，以确保所有资源重新加载。若宿主关闭了 `includeUserRoot`，应在其现有 Preset 配置中启用用户目录或手动加入此根目录，保留其他已有配置。

## 两种请求

- **只读审计**：“审计这个子系统，找出可以删除或合并的概念，先不修改。”只回复证据与候选，不写报告、任务文件或构建缓存。
- **直接执行**：“保持当前受支持行为，精简这个模块并完成验证。”先只读 MAP，再连续 ABLATE / COLLAPSE、验证和必要修复。已有授权下不逐项询问。

Audit 是模型行为约定，**不是独立的工具权限沙箱**。需要强制只读时，应同时使用宿主的只读权限或计划模式。宿主计划模式和权限仍有约束力，Execute 不会绕过它们。

## 判断标准

缺少存在证据只会让某项成为候选。删除前需要核实动态加载、外部 API、当前支持范围、持久化数据、安全和失败恢复。测试有覆盖不能单独证明设计必要，测试失败也不能成为随意删断言的理由。重叠职责可以合并，不同时间语义的 desired/observed state 或独立资源生命周期不能凭名字硬合并。

报告以“少了什么”为中心，使用同一口径对比概念、状态和维护范围，列出实际验证与未验证项。零删除可以是正确结果；不以 LOC 或测试数量作为成功配额。

系统提示词在 [agent.cordis.yml](presets/pruner/agent.cordis.yml)，显示信息在 [preset.yml](presets/pruner/preset.yml)。工具组合取自 DSH `0.1.5-rc.2` 的标准 Preset，并保留宿主所有权与服务隔离；升级 DSH 时应重新核验该静态组合。

## 验证

```sh
pnpm --filter dsh-pruner test
pnpm check
```

安装测试验证实际复制、冲突拒绝、已有设置保护和 Home 选择。[验收场景](ACCEPTANCE.md) 用来评估模型在 A–G 场景中的决策，不能用静态关键词断言冒充行为验收。真实运行与未完成验证记录见仓库的 `tasks/pruner.md`。
