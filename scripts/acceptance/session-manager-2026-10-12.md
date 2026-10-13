# Session manager 最终包验收（2026-10-12）

范围：`@klarkxy/dsh-session-manager@0.1.0-rc.1` 的当前最终内容。用户在本次会话明确确认「OK，没问题了」，要求登记为已验收可发布。本报告不表示已经发布 npm、提交、推送或升级版本。

## 最终归档

- `pnpm release:fingerprint @klarkxy/dsh-session-manager` 生成的验收指纹：`c3cbd8353ae41e879e5d94ce84c683882d65137bf86b52212b84044acd3ec922`。
- 归档：`.artifacts/npm-release/klarkxy-dsh-session-manager-0.1.0-rc.1.tgz`；SHA256：`228cf6848281023dd37423a9c1a0a161d0f8d584edad10867690c3284c15e96d`。
- 复核全部 14 个文件：许可证、双语 README、两个 locale 文件、图标、Cordis 补丁声明、服务端入口及声明、客户端入口及包装、源映射。没有测试脚本、用户数据或凭据。所有公开入口及声明文件存在。
- 官方运行时包保持开放下界的 optional peer；UI 包由宿主 inject。kit 的 host-rpc、llm-call、official-ui、client-utils 按构建规则打包。共享代码验收见 [基础库报告](shared-libraries-2026-10-12.md)。

## 当前检查

- 2026-10-12 `pnpm check` 退出码 0，覆盖发布清单检查、站点离线测试、全仓构建、编辑器插件打包检查、类型检查、插件测试及打包检查。测试环境中的已有 SSR/jsdom 警告不改变通过结果。
- session-manager 的 80 项测试通过，另一次独立复核的 80 项测试与类型检查通过，最终判定 READY。覆盖轮次归属、所有执行终态、长消息 Unicode 分页、原始工具参数/结果、超长错误、快照、跨层定位、非法引用和取消。
- 最终 Desktop 链接的 `lib/index.js` 与构建产物 SHA256 一致：`e8bbf5c7873c0c8ce7cf6a081cd2cbc1c5a523bd5f501b3895178f23939582df`。

## 标准目标宿主

从最终归档解包到独立目录，使用标准 DSH `0.2.0-rc.2` 提供的官方依赖，实际加载归档的 `lib/index.js`。Node `v24.21.0`；真实服务为 Sessions、SQLite SessionQuery（`openAt: never`）、SystemPrompt、ToolRuntime 和 LlmRuntime。没有安装线程管理宿主补丁，没有读取用户 profile 或凭据。

实际通过注册的工具验证：

- 默认最近轮次优先，保留需求、结论与执行状态，隐藏原始工具日志；默认阅读与交接摘录均为零模型调用。
- 交接事实的 `seq` 与 `snapshot` 可逐条回查原文；未建立的待办不会从历史错误推断。原始工具调用参数可展开。
- 显式模型归纳使用原生 LlmRuntime 和内存模型适配器；非法引用保留原文摘录并报告失败，不重试。模型服务单独卸载与插件卸载均取消在途调用；基础读取在可选服务消失后继续可用。
- 标题精确/部分匹配、标题与正文去重、搜索后读取及正文索引关闭时的标题搜索通过。

运行脚本及原始结果保留在 `.scratch/session-manager-release-20261012/`（本地忽略产物）；上述结果登记于本报告，避免依赖本地临时文件才能理解验收范围。

客户端的 Ctrl+Alt+C（macOS Command+Option+C）复制线程 ID、临时工作区独立目录、添加工作区下方的菜单顺序已通过对应测试。2026-10-12 标准隔离宿主的真实浏览器交互验证了临时工作区创建及菜单顺序，用户随后确认本插件没问题。

## 限制与回退

三层阅读、标题搜索、复制线程 ID 和临时工作区不依赖宿主补丁。真正删除及同会话重试仍只在宿主提供对应能力时出现；当前验收没有重新签认独立补丁宿主，其已有记录见 `host-patches/thread-management/acceptance.json`。

内存适配器证明原生模型调用契约、引用校验与取消，不证明外部模型生成质量。本次代理未重启运行中的 Desktop；用户确认与隔离宿主证据分别记录。无持久数据迁移，卸载恢复选择器，回退代码不删除已创建工作区、文件或会话。后续任何打包内容变化必须降级并重新验收。
