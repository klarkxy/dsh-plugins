# 0.2.0-alpha.1 增强插件验收

日期：2026-09-25。目标环境：Windows、Node.js 24、DSH Web 0.1.7-rc.2。

## 交付行为

- 在官方“智能体团队”入口增强成员信息，保留原生名单、任务板和成员会话导航。
- 成员卡片显示冻结的角色名、实例名、最近一次请求使用的模型、思考强度以及承担的任务。关键信息可换行显示，窄屏下使用单列布局。
- 进入成员会话后，顶部直接显示角色和模型。尚未产生请求的绑定明确标为“已配置”；未知信息不借用主控模型。
- “角色配置助手”是独立的官方 Agent preset，通过对话读取角色与模型目录，并批量保存角色。入口会在当前工作区创建新会话，不修改已有空白会话的 preset。
- 高级表单继续保留。模板的编辑、停用和删除都不改变已有成员的冻结绑定。

## 本轮验证

| 检查 | 结果 |
| --- | --- |
| 类型检查、构建 | 通过 |
| 插件自动化测试 | 36 项全部通过；录屏附带的独立游戏测试不纳入插件测试集 |
| 独立后端审查 | 未发现新的可确认缺陷；独立运行 35 项后端测试通过 |
| 真实宿主中的管理 preset | 挂载、目录读取、两角色原子创建、过期修改拒绝和清理均通过 |
| 管理权限 | 模型只收到两个管理工具；管理会话不能创建队友；普通主控不能编辑角色库 |
| 空白会话切换 preset | standard → manager → standard 后，管理工具与权限被移除 |
| 独立进程重启后读取团队 | 原角色身份和请求模型可恢复；读取前后 live Agent 数为 0，未产生模型请求 |
| 实际 Edge 浏览器 | 同角色多个成员、原生成员、任务负责人、成员跳转、顶栏身份、键盘 Escape、390px 窄屏、深色主题、配置助手可输入对话均通过；pageerror 为 0 |
| 官方插槽生命周期 | 同名覆盖只显示一个入口，移除增强注册后原入口恢复 |
| 最终安装包 | 官方 CLI 在新 profile 安装成功；安装后运行文件哈希与候选一致，管理 preset、冷读取和浏览器场景再次通过 |
| 官方 CLI 卸载 | 独立宿主重启后增强组件消失，唯一原生 Team 入口恢复，历史名单可读；随后重新安装成功 |

自动化和宿主验收使用本地确定性模型，远程模型调用为 **0**。浏览器对话只验证会话和工具接入，不是通用自然语言理解质量测试。此前 0.1.0-alpha.1 的真实供应商结果仍属于历史证据。

## 证据与复跑

- `docs/evidence/enhancement-browser.json`：实际浏览器结果。
- `docs/evidence/enhancement-manager.json`：真实官方 preset、工具和切换验证。
- `docs/evidence/enhancement-cold.json`：独立进程重启后的只读恢复验证。
- `docs/evidence/enhancement-package.json`：最终包校验与官方安装、卸载结果。
- `docs/screenshots/enhancement-team-desktop.png`、`enhancement-team-mobile.png`、`enhancement-team-dark.png`、`enhancement-settings.png`、`enhancement-manager.png`。
- `npm run check` 运行插件检查。
- `node scripts/enhancement-host.mjs` 启动独立本地验收 profile。输入 `seed` 创建演示团队，输入 `manager` 检查 preset，重启后输入 `cold` 检查冷读取，输入 `stop` 退出。
- 以该宿主打印的本机 URL 设置进程环境变量 `DSH_ACCEPTANCE_URL`，运行 `node scripts/enhancement-browser.mjs`。测试使用独立 Edge，并修改此验收 profile 的主题。
- 安装后验收使用 `DSH_ENHANCEMENT_INSTALLED=1`；测试模型位于独立包边界，避免加载器把测试脚本误认成产品插件。`DSH_ENHANCEMENT_NATIVE_ONLY=1` 用于官方卸载后的原生界面检查。

## 支持边界

仅验证上述固定宿主版本。组件使用官方公开插槽覆盖机制，但局部展示代码是基于该版本官方组件适配的；宿主升级后需重新验收。卸载会恢复官方 UI，已有 Classmates 成员的恢复仍需要本插件和原绑定文件。未验证其他客户端、实体手机、长期持续运行或模型内部推理量。

本轮没有公开发布、推送或创建 Release，也没有修改用户既有演示 profile。
