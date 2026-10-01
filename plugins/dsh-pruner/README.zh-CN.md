# 代码精简

代码精简替你审查和精简代码：在保持现有行为的前提下削减冗余与多余抽象，并说明删了什么、留了什么。它复用 DSH 既有的文件、搜索、终端、技能、计划模式和上下文压缩能力。包名为 `@klarkxy/dsh-pruner`。

[English](README.md)

## 运行环境

Node.js 24+、DSH 0.1.7-rc.2。下面的安装与使用步骤以 Web profile 为准。

## 安装

npm 发布后可直接安装到目标 profile：

```sh
dsh plugin --profile web add @klarkxy/dsh-pruner
```

也可以从源码打包，再把生成的 `.tgz` 安装到目标 profile：

```sh
cd plugins/dsh-pruner
npm pack --ignore-scripts
dsh plugin --profile web add "D:/path/to/klarkxy-dsh-pruner-<version>.tgz"
```

自定义 profile 请把 `web` 换成其名称。安装后重启该 profile，在新会话的预设选择器中选择 **代码精简**；再在模型选择器中选一个当前可用的强推理、大上下文模型，并启用该模型支持的较高推理强度。

## 两种请求

- **只读审计**：“审计这个子系统，找出可以删除或合并的概念，先不修改。”只回复证据与候选，不写报告、任务文件或构建缓存。
- **直接执行**：“保持当前受支持行为，精简这个模块并完成验证。”先只读 MAP，再按批次 ABLATE / COLLAPSE，然后是验证和必要修复；已有授权下不逐项询问可逆候选。

## 判断标准

缺少存在证据只会让某项成为候选，不等于已经证明可以删除。删除前需要核实动态加载、外部 API、当前支持范围、持久化数据、安全和失败恢复。只保护已废弃实现的测试可以随之删除；用户行为和安全保证始终受保护。测试有覆盖不能单独证明设计必要，测试失败也不能成为随意删断言的理由。名字相近不代表职责或时间语义相同：重叠职责可以合并，但时间语义不同的 desired/observed state、或拥有独立生命周期的资源，不能只因为名字像就硬合并。

## 报告内容

报告以“少了什么”为中心，用同一口径对比概念、状态和维护范围的前后变化，并列出实际验证与未验证项。零删除可以是正确结果；LOC 和测试数量只是辅助证据，不是成功配额。

## 边界与限制

- 这是只注册原生预设的插件包，不增加运行时服务，也不改全局默认预设、其他预设、权限或模型设置。
- Audit 是模型行为约定，**不是独立的工具权限沙箱**。需要强制只读时，请同时使用宿主的只读权限或计划模式。宿主权限与计划模式仍然有约束力，Execute 不会解除它们。
- 已有消息的会话不能切换预设；更新后请重启 profile 并新建会话。
- Web 声明在 [cordis.patch.yml](cordis.patch.yml)，由旧版 [agent.cordis.yml](presets/pruner/agent.cordis.yml) 与 [preset.yml](presets/pruner/preset.yml) 迁移而来；它的静态工具组合取自 DSH `0.1.5-rc.2` 的标准 Preset，并在 Web `0.1.7-rc.2` 上核验过。升级宿主时应重新核验这组静态组合。
- DSH 0.1.7 已不再读取 `$DSH_HOME/.agent-presets`，`install.mjs` 仅供旧版 0.1.5-rc.2 使用，不能用来安装到当前 Web。旧安装器留下的 `.agent-presets/pruner` 目录对 0.1.7 无效；确认新 bundle 可用后即可移走。
- 卸载时在目标 profile 的原生插件管理页移除 `@klarkxy/dsh-pruner` bundle。

## 验证

```sh
pnpm --filter @klarkxy/dsh-pruner test
pnpm check
```

安装测试覆盖实际复制、冲突拒绝、已有设置不被改动和 Home 选择。[验收场景](ACCEPTANCE.md) 单独评估模型在 A–G 场景中的决策，静态关键词断言不能替代行为验收。真实运行证据与未完成的检查记录在仓库根目录的 `tasks/pruner.md`。
