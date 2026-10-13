# 共享库审查整改验收补录（2026-10-12）

承接 [shared-libraries-2026-10-12.md](shared-libraries-2026-10-12.md)：全仓设计审查后对两个共享库做了一批整改，按规则先降级为 testing，本补录记录整改内容、重新验收结果与新指纹。基础库的目标宿主证据沿用既有惯例：由实际使用它们的功能插件验收承载，不为库单独造宿主场景。

## 整改内容（相对上一版验收的差异）

`@klarkxy/dsh-plugin-kit`（0.3.0，归档 35 → 33 个文件）：
- 新增 contracts 单一来源常量：`MODEL_SETTINGS_CHANGES_REMOTE`（模型设置变更 remote 描述符，提供方仍是 model-hub）、`WEB_PROVIDER_AVAILABILITY_EVENT`、`DshWebManagementDescriptor`、`CREATOR_PRESET_ID`；均为纯新增导出。
- `model-settings-client` 改为引用上述常量，订阅与静默降级行为不变（帧解析器留在本文件）。
- 删除零引用死码：`model-menu-ui` 入口（含 package.json exports、tsdown 入口）与 contracts 的 @deprecated 类型区块（AiPolicy/AiServices 等，全仓 grep 零引用）。
- `official-ui` 去掉 `--ds-font-family-code` 的字面量回落（token 守卫约定）。
- devDependencies 的 react/react-dom 钉为精确版本 18.3.1（构建期约束，不影响运行产物语义）。

`@klarkxy/dsh-model-route`（0.2.0，归档 23 个文件不变）：
- 仅 devDependencies 钉版（react/react-dom 18.3.1），运行时代码与公共入口零变更。

消费方同步（不改变库语义，作为使用方回归的一部分验证）：git-commit、current-title 删除私有归一化副本改用库函数；chatgpt 依赖挪正；model-hub、zhihu、web-search-manager、classmates、dev-index 改用共享常量。

## 最终包与指纹

| 包 | 当前版本 | acceptedContentHash |
| --- | --- | --- |
| `@klarkxy/dsh-plugin-kit` | `0.3.0` | `b2ac92650f02fbfbd1f8a5cff876be8494abbf4e93fc736ae0c531590ea6e01a` |
| `@klarkxy/dsh-model-route` | `0.2.0` | `974b1532eefd681a03a3d0fd409d336c643ff517bc8ddafbd75387ca5c5872dd` |

指纹来自 2026-10-12 整改后 `pnpm release:fingerprint` 的最终归档（`.artifacts/npm-release/`）。复核了归档文件清单、SATA 许可证、双语说明与公共入口；kit 减少的 2 个文件即被删除的 `model-menu-ui` 产物，无其他意外增删；无凭据或临时数据。未修改版本号、未执行 npm 发布。

## 检查与目标宿主证据

- 2026-10-12 整改后 `pnpm check` 退出码 0：两库及全部 12 个功能包的构建、类型检查、vitest 套件（含 model-settings 订阅、official-ui token 守卫、current-title/git-commit 归一化行为测试）与打包检查全部通过。
- 库的宿主行为证据沿用 shared-libraries-2026-10-12.md：model-hub 的隔离宿主验收（acceptance-2026-10-11）与浏览器回归（test:e2e:model-hub）、session-manager 归档验收覆盖的打包 kit 代码路径。本次库侧运行时变更仅为官方 token 回落清理与纯新增导出，订阅/通知/调用链路代码未变；消费方全部重构建并重测通过即为使用方差异回归。
- model-hub 与 classmates 的构建链（esbuild 装饰器降级）已在整改后重新构建成功，产物完整。

## 限制

本补录不授权提交、推送、发布或部署；正式发布仍会重新校验指纹与依赖状态。消费方功能插件各自的验收状态不变。
