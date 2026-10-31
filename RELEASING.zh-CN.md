# 插件生命周期与发布

[English](RELEASING.md) · [当前清单](README.zh-CN.md#插件生命周期)

`scripts/plugin-release-states.json` 记录所有 `plugins/*` 包（含共享库、私有开发包）的生命周期，单向向前推进：**草稿 → 测试中 → 已发布**。

| 阶段 | 含义 | 发布行为 |
| --- | --- | --- |
| 草稿 `draft` | 尚在开发，待进入测试 | 仅本地开发 |
| 测试中 `testing` | 正在完成首次交付的检查与验收 | 需明确指定首次发布才可发布 |
| 已发布 `published` | 已有 npm 发布记录（含预发布版本） | 按正常流程维护与更新 |

已发布包的修复、README 调整、新功能测试和升版均保持 `published`；检查失败仅中止当次更新。暂缓、封存、迁移冻结和私有属性独立管理，与 `latest` / `next` 渠道相互独立。

## 正常维护

1. 修改源码、配置、依赖或包内文档，保持 `published` 状态。
2. 按兼容性选择版本，运行相关测试、构建、打包检查及目标宿主验收。
3. 发布流程比对当前归档与 npm，运行 `pnpm check`，核对计划仍对应当前源码，发布并下载验证归档；中途失败时保持原阶段不变。`README*.md`、`ACCEPTANCE.md`、`NOTICE.md`、`CHANGELOG*.md` 与 `docs/` 的改动照常打包，随下次代码发布一起更新到 npm；版本号、依赖和代码改动照常发布。

发布暂缓在满足 `scripts/npm-release-holds.json` 声明的解除条件后移除。私有包仅在仓库内使用。移除废弃源码时，将原清单条目设为 `retired: true`，保留生命周期和发布凭据，同时移出构建、状态表和发布流程。

## 首次发布

新包登记为 `draft`，具备可测试功能后人工推进至 `testing` 并同步文档。首次发布前在当次交付中核对最终归档、许可证、依赖、入口、相关测试和目标宿主用户场景。

经明确授权后，在 Actions 手动运行 **Publish npm plugins**，于 `first_release` 填入完整包名（多个用空格分隔）。也可在本地生成计划：

```sh
pnpm build
node scripts/publish-npm.mjs plan --first-release @klarkxy/dsh-example
pnpm check
# 明确获得 npm 发布授权后执行：
node scripts/publish-npm.mjs publish
```

- 普通推送和未填写首次发布选项的计划只更新 `published` 公开包。
- 草稿、私有、暂缓和迁移冻结的包保持各自的限制。
- 处于 `testing` 的新公共依赖须一并列入 `first_release`，或先单独完成发布。
- 当 npm 归档可匿名下载且完整性匹配时，才记录 `published` 与历史 `publication` 凭据并同步根 README。

已验证结果逐包即时保存到 `.artifacts/npm-release/verified-publications.json`；若后续包失败，前面已验证的包仍会保留，CI 也会上传计划、归档和验证记录。恢复部分成功的批次时，在最新 `main` 上用相同 `first_release` 重跑：已接收且完整性一致的版本会直接复用，重新验证后补齐生命周期写回。

## 生命周期校验

```sh
pnpm release:status     # 显示生命周期、私有属性及发布阻断
pnpm release:docs       # 同步根 README 中英文表格
pnpm release:check      # 阶段、文档及发布脚本回归
pnpm release:fingerprint @klarkxy/dsh-example  # 诊断当前归档内容（只读）
```

清单采用 `schemaVersion: 2`：已发布条目的 `publication` 保存一个已存在的 npm 版本、发布时间和归档完整性，作为不可变的历史凭据。旧版 schema 1 仅用作一次性迁移输入。

本地检查比较工作区与 `HEAD`；发布 CI 的 `RELEASE_STATE_BASE` 使用推送前提交，手动重跑用 `HEAD^`。校验要求阶段依次向前推进、保留所有历史条目（移除源码时设 `retired: true`）并保持历史 `publication` 凭据不变。缺少旧清单时按首次初始化处理，Git 基准读取错误则直接报错。当前生命周期状态以 `pnpm release:status` 为准。

## 每次计划的内容与依赖检查

计划保存本次包及本地依赖闭包的 `sourceHashes`，发布前重新计算，要求源码、依赖和打包内容与计划完全一致；版本号、CI 自有元数据和工作区版本替换在源码哈希中归并处理，实际发布归档仍校验解析后的依赖版本。

所有本仓库依赖字段都参与闭包检查：公共依赖须为 `published` 或同批列入 `first_release`；私有的 `testing` 开发依赖允许随使用方构建、检查与打包；公开包的运行时、可选和 peer 依赖须全部为公开包。暂缓依赖若提供 npm 版本，该确切版本须已存在于 npm，且打包源码同样接受当前计划的内容检查。

提交、推送、npm 发布和站点部署均需用户明确授权。
