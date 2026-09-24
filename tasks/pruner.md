# 删繁 / Pruner 首版施工记录

更新：2026-09-24。本记录记载本地施工与验收；Git 交付状态以仓库提交记录为准，未发布版本。

## 接续依据

- 用户提供的 GPT 会话 `6ab4bd3c-5148-83ec-a3c2-8ec464080e82`：以受支持行为不变为前提，减少概念；Audit / Execute，MAP / ABLATE / COLLAPSE，强模型建议，V1 不改 DSH Core。
- 本目录最近 Claude 会话 `f4f01165-12b4-45b0-952b-83f0e631c6d9` 只探索了本机 Preset、persona 和模型接口，因 API 额度错误中断，没有代码产物。开始时 main 工作树干净。

## 实现与取舍

- `plugins/dsh-pruner` 是静态原生 Preset 包，独立 persona 加 DSH 既有编码工具、计划模式和压缩服务，不增加运行时插件。
- 通过显式安装器复制到所选 DSH_HOME 的 `.agent-presets/pruner`；不会改全局默认、模型、权限或其他 Preset。当前 bundle patch 替换整个 config，直接覆盖 roster 会丢失其他 roots，因此不采用该方案。
- 现行元数据仅支持显示字段，不绑定 per-preset 模型/effort。说明及 UI 文案建议用户在会话中选择强推理、大上下文模型，不虚构已绑定。
- “无存在证据”只产生候选；删除须查动态入口、外部契约、支持策略、磁盘数据与失败恢复。Audit 是提示词约定，强制只读仍由宿主权限负责。
- 新包无需构建或生产依赖；根打包检查覆盖全部包。README、A–G 验收表及安装冲突测试已补齐。

## 实际验证

- `pnpm check` 通过：既有标题插件 22 测试 + Pruner 初版安装测试 6 项，类型检查、现有构建及两个包的 pack dry-run 均通过。
- 独立 reviewer（请求 gpt-6-sol / high / fork none）发现安装器没有沿用宿主的空白 DSH_HOME 与波浪号规则。主 Agent 对照本机 `dsh-home-paths` 实现确认并修复；新增针对性回归后 `pnpm --filter dsh-pruner test` 7 项全部通过。其余范围未发现高影响问题。工具未提供服务档位参数。
- `node --check plugins/dsh-pruner/install.mjs`、冻结锁文件检查、`git diff --check` 通过。
- 真正生成 `.artifacts/dsh-pruner-0.1.0.tgz`，解包到隔离目录，用包内安装器安装到 `.artifacts/pruner-packed-home` 成功，未依赖源码目录资源。
- 本机 DSH 0.1.5-rc.2：实际 `discoverPresets()` 扫描隔离用户根得到 `id: pruner`，无 broken 字段，全部配置模块可解析。
- 使用本机 Edge headless 打开独立 DSH Web（127.0.0.1:19347，Home 为 `.artifacts/pruner-runtime-home`），原生新会话菜单显示并可选中「删繁 / Pruner」。截图 `.artifacts/pruner-initial.png`。
- 通过该实例真实 `/api/session/create` 接口创建会话，返回 `ok: true`、`agentPreset: pruner`，会话 ID `session-63ed18e1-457c-4644-be3c-70416e4ca8d0`。这是实际宿主挂载成功，不是 mock 或仅解析 YAML。
- 全程使用隔离 Home；没有安装到用户日常 DSH/Editor Home，没有更改用户凭据、provider、权限或默认会话配置。

## 验证缺口与后续

- A–G 真实模型决策验收尚未执行。隔离实例没有配置模型密钥，本轮没有发起模型请求；菜单、发现、会话挂载成功不能证明模型会正确完成删除与合并。验收表在 `plugins/dsh-pruner/ACCEPTANCE.md`。
- 已验证 Windows + DSH 0.1.5-rc.2；Linux/macOS 分支取自宿主标准组合，尚未在这些系统运行。DSH 后续版本需要重新核验静态组合。
- 默认命令、文件编辑和浏览器工具遇到 sandbox setup refresh 初始化故障；本轮通过已获工具审批的本机命令和隔离 headless 浏览器完成验证，没有改沙箱配置。
- 安装器拒绝覆盖。若复制中断，保留并报告未完成目录，由用户检查、备份和移走后重装；不偷偷清理不确定内容。

隔离 Web 测试实例及其子进程已关闭；交付包保留复用 DSH 标准配置的 MIT 声明。
