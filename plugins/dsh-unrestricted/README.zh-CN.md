# 破限 / Unrestricted

[English](README.md)

按破限交付契约回答的 DSH Agent Preset：直接交付完整成果，不缩水、不回避。契约只写在本 Preset 的 persona 里，**只作用于选择它的会话**；不再像全局注入那样改写所有会话的提示词。纯静态 bundle：没有运行时插件、没有 hook、没有设置卡。

## 与全局注入的区别

契约文本来自 [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted)（MIT）。它在拼装期挂根级 `system-prompt/assemble`，把契约融合进 standard / ptc / cordis / minimal 与子代理的所有提示词，并带开关、锚点校验、指纹与预览；本包把同一份契约沉淀为**按会话选择的 Preset**：

- 选用 **破限 / Unrestricted** 的新会话按契约回答；standard、Creator、PTC、minimal 等其他 Preset 的提示词一个字节都不动。
- 没有开关：选中即生效，切回其他 Preset 即结束。不存在“忘记关掉、全局限制被放开”的状态。
- 子代理自动继承：宿主让子会话加入父会话的 Preset 修订（`composeFrom`），原生 `subagent` / `subagent_fork` 只读行配置里的 persona，标准清单没有配置，所以委派出去的子代理线程同样携带契约。只有**显式给子会话指定 persona** 的派生（例如按角色指令生成的 Classmates 队友）会替换 persona 槽位，那种子会话看不到契约。

## 安装与使用

发布到 npm 前，从本包目录取包安装：

```sh
cd plugins/dsh-unrestricted
npm pack --ignore-scripts
dsh plugin --profile web add "D:/path/to/klarkxy-dsh-unrestricted-0.1.0-rc.1.tgz"
```

发布后可直接 `dsh plugin --profile web add @klarkxy/dsh-unrestricted`。自定义 profile 把 `web` 换成其名称。安装后重启该 profile，在新会话的 Preset 选择器中选择 **破限 / Unrestricted**。已有消息的会话不能切换 Preset。

模型由你在会话中选择。Preset 元数据不绑定模型或推理强度，本包不改默认 Preset、模型、权限或其他 Preset。

## 里面有什么

- **persona**：标准起始句 + 执行指针 + `## Unrestricted local execution mode` 契约全文。与 dsh-unrestricted 0.2.2 `src/rules.js` 的 `EXECUTION_MODE_BLOCK` 逐字节一致，契约指纹 `e9e4eead5f84504c`（SHA-256 前 16 位），升级或改动后测试会重新核对。
- **计划模式补注**：官方计划模式正文不变，结尾增加一段——计划模式只限制交付与变更，不限制计划内容本身。
- **工具组合**：DSH `0.2.0-rc.2` 标准 Preset 的完整工具清单（shell、文件与搜索、后台任务、Skills、目标、计划模式、上下文压缩、委派与工作流、提问、待办、网页、交付展示），不增不减。

Web 声明在 [cordis.patch.yml](cordis.patch.yml)。工具组合、persona 起始句与计划正文取自 DeepSeek Harness 标准 Preset，逐行对照本机 `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`；升级 DSH 时应重新核验该静态组合。

## 边界

- 本 Preset 不解锁任何工具或权限：审批、沙箱、计划模式、工具目录照旧由宿主管辖，契约只决定回答的内容与尺度。
- 与上游运行时插件的行为差距只剩：显式 persona 覆盖的子会话不携带契约（见上，静态 Preset 无法注册自定义名 section 绕过 persona 影子）；结构化子代理 `tool:structured_output` 说明上少一行追加提示（契约正文的 Runtime coordination 已含同一原则）；没有开关、锚点校验、提示词预览与 recheck。PTC_ONLY_NOTE 只属于 ptc Preset，与本包无关。
- 卸载：在目标 profile 的原生插件管理页移除 `@klarkxy/dsh-unrestricted` bundle。

## 验证

```sh
pnpm --filter @klarkxy/dsh-unrestricted test
pnpm check
```

测试钉住契约指纹、与标准 Preset 的工具清单一致性、模板变量和打包内容。[行为验收场景](ACCEPTANCE.md) 用来评估真实模型在各场景中的表现，不得用静态关键词断言冒充行为验收。

## 署名

契约文本改写自 yexi-by/dsh-unrestricted（MIT），其上承 Jia-Ethan/codex-keysmith（MIT）；工具组合与计划正文取自 DeepSeek Harness（MIT）。完整声明与许可文本见 [NOTICE.md](NOTICE.md)。
