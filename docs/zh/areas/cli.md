# 命令行

[English](../../areas/cli.md)

`dsh` 是唯一支持的 Node 启动器。`dsh plugin --profile <name>` 把参数转给该 profile 目录里的 pnpm。`--dump-config` 只打印组合结果，不启动应用。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

`@deepseek-ai/dsh` 解析启动器标志，叠上 profile 的 bundle 补丁，然后启动那棵树、转储配置，或把 `dsh plugin` 转给 pnpm。SDK 和 ACP 是 profile，不是另外的公开二进制。无法识别的记号会变成已启动应用的 `ctx.cmdlineArgs`。

## 它在哪里

- 命令表：[apps/cli/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/README.md)
- 标志、层、模式转储：[apps/cli/reference/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/reference/README.md)
- 标志解析器：[apps/cli/src/args.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/src/args.ts)
- 插件子命令：[apps/cli/src/plugin.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/src/plugin.ts)
- 应用自己的 argv：[packages/boot/cmdline/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/cmdline/README.md)

## 约定

| 命令 | 作用 |
| --- | --- |
| `dsh <name>` / `dsh --profile <name>` | 启动 `$DSH_HOME/profiles/<name>`。 |
| `dsh --profile <name> --from-default-profile <template>` | 用随发行的模板创建自定义 profile，然后启动它。 |
| `dsh web` | 启动 Web profile。`--profile web` 的简写。 |
| `dsh --profile headless "job"` | 一个持久会话，打印最终答案，然后退出。 |
| `dsh --profile sdk` | SDK 的 JSON-RPC 标准输入输出。 |
| `dsh --profile sdk-minimal` | 同一协议上的最小 agent 树。 |
| `dsh --profile acp` | ACP 标准输入输出，直到断开。 |
| `dsh plugin --profile <name> <pnpm args>` | 在 profile 目录里运行 pnpm。 |

首次使用时会自动初始化的 profile：`web`、`headless`、`sdk`、`sdk-minimal`、`acp`。这些名字也是合法的 `--from-default-profile` 模板。名字 `desktop` 被保留并拒绝。`dsh plugin` 是包管理器，不是 profile 启动。要启动一个真的叫 `plugin` 的 profile，用 `dsh --profile plugin`。

启动器标志包括 `--profile`、`--from-default-profile`、可重复的 `--patch`、`--dump-config`、`--dump-default-config`、`--dump-config-schema`，以及 `-V` / `--version`。转储标志互斥，并且拒绝应用参数。

应用参数不是另一层补丁。Web profile 接受 `--host`、`--port`、可重复的 `--trusted-host` 和 `--no-open`。headless 把任务当作位置参数。想要自己的标志的 bundle，应导出一个 `inject = ['cmdlineArgs']` 的插件，并调用 `@deepseek-ai/dsh-cmdline` 的 `parseCmdline`。

`dsh plugin` 在把声明了 `dsh.bundle` 的包和 `dsh.profile.bundles` 对齐之后，转发普通的 pnpm 动词（`add`、`remove`、`update`、`why` 等）。它还拥有：

- `dsh plugin --profile <profile> version-exemptions`
- `dsh plugin --profile <profile> allow-version <package@version> --dsh-version <runtime> --accept-risk`
- `dsh plugin --profile <profile> revoke-version <package@version> --dsh-version <runtime>`

profile 导入插件之前，DSH 会把 `@deepseek-ai/dsh` 和 `@deepseek-ai/dsh-*` 上的 `peerDependencies` 对照 `getDshRuntimeVersion()` 给出的那一个运行时版本来检查。每一个声明的范围都必须匹配。预发布版本也参与。缺少 DSH 对等依赖就不施加约束。与 profile 的 `compatibility.json` 里精确豁免不符的不兼容 bundle 会被跳过，并列入 `skippedBundles`。当被拒绝的插件行本身已配置时，`--dump-config` 仍会显示该行，而被拒绝的 bundle 不贡献任何行。

git 安装会获取源码。发布教程要求有一个 `prepare` 脚本，它构建入口，并且不假设处于 monorepo 中。pnpm 在用户把该脚本列入允许名单之前会拦住它。CLI 会告诉用户把 pnpm 打印出的那个精确键加到 profile 的 `pnpm-workspace.yaml` 里的 `allowBuilds` 下：

```yaml
allowBuilds:
  dsh-hello-plugin: true
```

这份允许会在安装时于本机执行包代码。源码不能移动时，钉住一个提交（`github:you/plugin#<sha>`）。子目录选择器用文档里写的 git 主机 `#path:`；只有在 shell 不会吞掉 `&` 的平台上，才把提交和路径组合在一起。

从源码检出里，先 `pnpm run build`，再 `pnpm dsh <args...>`，运行的是 TypeScript 入口。

## 插件作者怎么用

```sh
dsh plugin --profile web add ./your-bundle
dsh --profile web --dump-config
```

从 git 安装用 `dsh plugin --profile web add github:you/repo`。如果 pnpm 拒绝构建，抄下打印出的 `allowBuilds` 键，再运行一次 add。不想让用户允许构建脚本时，发布到 npm，或用 `pnpm pack` 打一个 tarball。

当 `dsh plugin` 或 `plugin_manager` 能做这件事时，不要手改 profile 的 `package.json` 里的 bundle 列表。这些写入者共用 profile 锁。

界面 bundle 在自己的启动插件里通过 `ctx.cmdlineArgs` 读取应用标志。它不添加启动器标志。

## 来源

- [apps/cli/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/README.md)
- [apps/cli/reference/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/reference/README.md)
- [apps/cli/src/args.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/src/args.ts)
- [apps/cli/src/plugin.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/src/plugin.ts)
- [packages/boot/cmdline/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/cmdline/README.md)
- [docs/user/develop/basic/publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/publish.md)
- [packages/boot/app-boot/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/app-boot/README.md)
