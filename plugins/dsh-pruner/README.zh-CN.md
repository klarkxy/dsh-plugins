# 删繁 / Pruner

[English](README.md)

保持受支持行为，减少理解系统必须掌握的概念、状态与抽象层。Pruner 是独立 DSH Preset，使用原生文件、搜索、Shell、Skills、计划模式和上下文压缩能力；没有额外运行时插件、自动路由或统计服务。

## 安装与使用

当前 Web bundle 需要 Node.js 24+、DSH 0.1.7-rc.2。npm 发布后可直接安装：

```sh
dsh plugin --profile web add @klarkxy/dsh-pruner
```

也可以从源码打包，再把生成的 `.tgz` 安装到目标 profile：

```sh
cd plugins/dsh-pruner
npm pack --ignore-scripts
dsh plugin --profile web add "D:/path/to/klarkxy-dsh-pruner-0.2.0.tgz"
```

自定义 profile 请把 `web` 换成其名称。安装后重启该 profile，在新会话的 Preset 选择器中选择 **删繁 / Pruner**。DSH 0.1.7 已不再读取 `$DSH_HOME/.agent-presets`；`install.mjs` 仅供旧版 0.1.5-rc.2 使用，不能用来安装到当前 Web。

然后在模型选择器中选择当前可用的强推理、大上下文模型，并启用该模型支持的较高推理强度。Preset 元数据不支持单独绑定模型或 reasoning effort，所以此包不改全局模型配置，也不承诺替你选好了模型。

这是只声明原生 Preset 的 bundle，不增加运行时服务，不改默认 Preset、其他 Preset、权限或模型设置。已有消息的会话不能切换 Preset；更新后重启 profile 并新建会话。

卸载时在目标 profile 的原生插件管理页移除 `@klarkxy/dsh-pruner` bundle。旧版安装器创建的 `.agent-presets/pruner` 目录对 0.1.7 无效；迁移并确认新版入口后可移走旧目录。

## 两种请求

- **只读审计**：“审计这个子系统，找出可以删除或合并的概念，先不修改。”只回复证据与候选，不写报告、任务文件或构建缓存。
- **直接执行**：“保持当前受支持行为，精简这个模块并完成验证。”先只读 MAP，再连续 ABLATE / COLLAPSE、验证和必要修复。已有授权下不逐项询问。

Audit 是模型行为约定，**不是独立的工具权限沙箱**。需要强制只读时，应同时使用宿主的只读权限或计划模式。宿主计划模式和权限仍有约束力，Execute 不会绕过它们。

## 判断标准

缺少存在证据只会让某项成为候选。删除前需要核实动态加载、外部 API、当前支持范围、持久化数据、安全和失败恢复。测试有覆盖不能单独证明设计必要，测试失败也不能成为随意删断言的理由。重叠职责可以合并，不同时间语义的 desired/observed state 或独立资源生命周期不能凭名字硬合并。

报告以“少了什么”为中心，使用同一口径对比概念、状态和维护范围，列出实际验证与未验证项。零删除可以是正确结果；不以 LOC 或测试数量作为成功配额。

Web 声明在 [cordis.patch.yml](cordis.patch.yml)。它从旧版 [agent.cordis.yml](presets/pruner/agent.cordis.yml) 与 [preset.yml](presets/pruner/preset.yml) 迁移；工具组合取自 DSH `0.1.5-rc.2` 的标准 Preset，并在 Web `0.1.7-rc.2` 验证。升级 DSH 时应重新核验该静态组合。

## 验证

```sh
pnpm --filter @klarkxy/dsh-pruner test
pnpm check
```

安装测试验证实际复制、冲突拒绝、已有设置保护和 Home 选择。[验收场景](ACCEPTANCE.md) 用来评估模型在 A–G 场景中的决策，不能用静态关键词断言冒充行为验收。真实运行与未完成验证记录见仓库的 `tasks/pruner.md`。
