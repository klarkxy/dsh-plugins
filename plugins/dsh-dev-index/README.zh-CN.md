# dsh-dev-index

[English documentation](README.md)

这是一个很轻的 DeepSeek Harness skill。它把 agent 指到官方材料，不携带、也不维护一份文档副本。

在正在运行的 DSH 里，优先用官方技能 `cordis-plugin-development`，以及只读的 `cordis_inspect_list` 和 `cordis_inspect_query`。`plugin_manager` 的每个动作都需要 `danger-full-access` 或一次性审批。环境自己的工具策略仍然适用。

给人读的文档在官方站点 [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)（简体中文在根路径，英文在 `/en/`）和 [llms.txt](https://deepseek-harness.github.io/deepseek-harness/llms.txt)。该站点是最近发布的版本。源码和类型声明默认看 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 `master`。目标版本不同时，改用对应的 `dsh-v*` 标签，不要混用版本。

[https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/) 只做跳转。该主机上的旧路径也会跳走。

## 为什么用 skill

DSH 面向 agent 的知识契约是 `ctx.skills` 上的 skill。`@deepseek-ai/dsh-skill` 用 `ctx.skills.register` 登记嵌入式说明，`@deepseek-ai/dsh-tool-skill` 把模型可调用的 skill 放进会话目录，并用 `skill` 工具加载。Preset 会换掉 agent 的组合。工具必须先被调用，agent 才知道这个指针存在。宿主层 skill 会和其他 skill 一起出现在目录里，base 上的 profile 都能用。

`apply` 时本插件登记 skill `dsh-dev-index`。正文是静态的。它不写入提交、标签，也不写入本仓库的 URL。

`sdk-minimal` 没有挂载 `@deepseek-ai/dsh-skill`。本插件 `inject` 了 `skills`，在那里会一直等待。`web`、`headless`、`sdk` 和 `acp` 建立在 `@deepseek-ai/dsh-base` 上，base 会挂载这个注册表。

官方 DSH 不读取 `dsh.plugin.json`。本仓库其他 bundle 用这个文件做本地发现，所以这里也保留。加载器认的是 `package.json` 里的 `dsh.bundle.patch`。

## 从 npm 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
```

npm 包包含已构建的 `lib/`。

## 从 GitHub 安装

```sh
dsh plugin --profile web add "github:klarkxy/dsh-plugins#path:/plugins/dsh-dev-index"
```

Git 安装会运行 `prepare` 来构建 `lib/`。pnpm 在允许之前会拦住这个脚本。DSH 0.1.7-rc.2 的 CLI 会要求把打印出的包名写进 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds`：

```yaml
allowBuilds:
  '@klarkxy/dsh-dev-index': true
```

然后再执行一次 add。该许可会在本机执行这个包的构建。需要固定插件来源时请钉住 commit。

`@deepseek-ai/dsh-skill` 上的 peer 范围会对照正在运行的 `dsh` 版本检查。本包要求 DSH `>=0.1.7-rc.2 <0.2.0`，因为 `ctx.skills.register` 来自该版本。加载器不强制 `engines.dsh`；生效的是 peer 范围。

## 从本仓库安装

```bash
pnpm install
pnpm --filter @klarkxy/dsh-dev-index build
dsh plugin --profile web add ./plugins/dsh-dev-index
```

安装后重启该 profile，或让 HMR 应用新 bundle。然后：

```bash
dsh --profile web --dump-config
```

组合结果里应有 `dsh-dev-index` 这一行。新会话在修改 DSH 插件或 Preset 之前，先加载 `dsh-dev-index` 这个 skill。

没有配置项。补丁只插入插件，不设置键。

## 许可证

[SATA License 2.1](LICENSE)

## 卸载

```bash
dsh plugin --profile web remove @klarkxy/dsh-dev-index
```
