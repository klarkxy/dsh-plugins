# dsh-dev-index

[English documentation](README.md)

这是一个 DeepSeek Harness bundle。Agent 在编写插件、Preset、补丁、Profile、Provider，或做其他 DSH 二次开发时，用它找到 DSH 功能与扩展点的索引。

索引正文不在这个包里。[klarkxy/dsh-plugins](https://github.com/klarkxy/dsh-plugins) 仓库的 `docs/` 是唯一副本，并发布在 [https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/)。`docs/meta.json` 记录这些页面所描述的 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 修订：`officialTag` 与 `officialCommit`。每个章节都标明官方文件路径。索引不发明 API。

## 为什么用 skill

DSH 面向 agent 的知识契约是 `ctx.skills` 上的 skill。`@deepseek-ai/dsh-skill` 用 `ctx.skills.register` 登记嵌入式说明，`@deepseek-ai/dsh-tool-skill` 把模型可调用的 skill 放进会话目录，并用 `skill` 工具加载。Preset 会换掉 agent 的组合。工具必须先被调用，agent 才知道索引存在。宿主层 skill 会和其他 skill 一起出现在目录里，base 上的 profile 都能用。

`apply` 时本插件登记 skill `dsh-dev-index`。正文只告诉 agent 去哪里读取当前索引：

- `https://klarkxy.github.io/dsh-plugins/llms.txt`
- `https://klarkxy.github.io/dsh-plugins/index.json`
- `https://klarkxy.github.io/dsh-plugins/meta.json`
- `https://klarkxy.github.io/dsh-plugins/areas/<id>.md`

英文是默认语言。给人读的页面在 `zh/` 下另有简体中文版（例如 `zh/llms.txt` 和 `zh/areas/<id>.md`）。`index.json` 和 `meta.json` 保持英文。Agent 默认仍读取上面的英文文件。

Pages 没有响应时，同样的路径在 GitHub 的 `main` 上：

`https://raw.githubusercontent.com/klarkxy/dsh-plugins/main/docs/`

正文还列出 area id，方便 agent 知道有哪些 `areas/<id>.md`。它不复制页面正文，也不写入被索引的 commit，因此每天刷新 `docs/` 不需要发布新的插件包。

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

然后再执行一次 add。该许可会在本机执行这个包的构建。需要固定插件来源时请钉住 commit。skill 读取的索引仍然跟随 `main` 和 Pages 站点。

`@deepseek-ai/dsh-skill` 上的 peer 范围会对照正在运行的 `dsh` 版本检查。本包要求 DSH `>=0.1.7-rc.2 <0.2.0`，因为 `ctx.skills.register` 来自该版本。加载器不强制 `engines.dsh`；生效的是 peer 范围。索引描述的官方修订记在 `docs/meta.json`，不由这个 peer 范围表示。

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
| `pagesBaseUrl` | `https://klarkxy.github.io/dsh-plugins/` | 写进 skill 正文的 http(s) 绝对基址。缺少末尾斜杠时会补上。GitHub 原始文件回退固定在本仓库的 `main`。 |

## 更新索引

每日步骤见 [docs/REFRESH.md](../../docs/REFRESH.md)。从 `docs/` 重新生成站点页面：

```bash
node plugins/dsh-dev-index/scripts/build-site.mjs
```

## 许可证

[SATA License 2.1](LICENSE)

## 卸载

```bash
dsh plugin --profile web remove dsh-dev-index
```
