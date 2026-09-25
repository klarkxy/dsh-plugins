# dsh-dev-index

[English documentation](README.md)

这是一个 DeepSeek Harness bundle。Agent 在编写插件、Preset、补丁、Profile、Provider，或做其他 DSH 二次开发时，用它查阅 DSH 的功能与扩展点。

索引整理自官方仓库 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的标签 `dsh-v0.1.7-rc.2`，commit `477b4f420553e8a52c2fbccc464d7561b239c443`。每个章节都标明官方文件路径。索引不发明 API。

## 为什么用 skill

DSH 面向 agent 的知识契约是 `ctx.skills` 上的 skill。`@deepseek-ai/dsh-skill` 用 `ctx.skills.register` 登记嵌入式说明，`@deepseek-ai/dsh-tool-skill` 把模型可调用的 skill 放进会话目录，并用 `skill` 工具加载。Preset 会换掉 agent 的组合。工具必须先被调用，agent 才知道索引存在。宿主层 skill 会和其他 skill 一起出现在目录里，base 上的 profile 都能用。

`apply` 时本插件登记 skill `dsh-dev-index`。正文只做路由，长度低于标准 preset 对工具结果的裁剪阈值，并列出每个章节文件。`resourceBase` 指向安装后的 `content/` 目录，agent 可以离线阅读 `index.json` 和 `areas/<id>.md`。同一批文件发布在 [https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/)。

`sdk-minimal` 没有挂载 `@deepseek-ai/dsh-skill`。本插件 `inject` 了 `skills`，在那里会一直等待。`web`、`headless`、`sdk` 和 `acp` 建立在 `@deepseek-ai/dsh-base` 上，base 会挂载这个注册表。

官方 DSH 不读取 `dsh.plugin.json`。本仓库其他 bundle 用这个文件做本地发现，所以这里也保留。加载器认的是 `package.json` 里的 `dsh.bundle.patch`。

## 从 GitHub 安装

```sh
dsh plugin --profile web add "github:klarkxy/dsh-plugins#path:/plugins/dsh-dev-index"
```

Git 安装会运行 `prepare` 来构建 `lib/`。pnpm 在允许之前会拦住这个脚本。DSH 0.1.7-rc.2 的 CLI 会要求把打印出的包名写进 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds`：

```yaml
allowBuilds:
  dsh-dev-index: true
```

然后再执行一次 add。该许可会在本机执行这个包的构建。需要固定来源时请钉住 commit。

`@deepseek-ai/dsh-skill` 上的 peer 范围会对照正在运行的 `dsh` 版本检查。本包要求 DSH `>=0.1.7-rc.2 <0.2.0`，也就是这份索引描述的版本。加载器不强制 `engines.dsh`；生效的是 peer 范围。

## 从本仓库安装

```bash
pnpm install
pnpm --filter dsh-dev-index build
dsh plugin --profile web add ./plugins/dsh-dev-index
```

安装后重启该 profile，或让 HMR 应用新 bundle。然后：

```bash
dsh --profile web --dump-config
```

组合结果里应有 `dsh-dev-index` 这一行。新会话在修改 DSH 插件或 Preset 之前，先加载 `dsh-dev-index` 这个 skill。

## 配置

补丁写出了唯一的键。后一层如果覆盖这一行，必须整份重写 `config`，因为补丁替换的是整个 `config` 对象。

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `pagesBaseUrl` | `https://klarkxy.github.io/dsh-plugins/` | 写进 skill 正文的 http(s) 绝对基址。缺少末尾斜杠时会补上。 |

## 更新索引

步骤见 [REFRESH.md](REFRESH.md)。重新生成站点：

```bash
node plugins/dsh-dev-index/scripts/build-site.mjs
```

## 许可证

[SATA License 2.1](LICENSE)

## 卸载

```bash
dsh plugin --profile web remove dsh-dev-index
```
