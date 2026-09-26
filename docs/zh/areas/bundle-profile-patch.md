# Bundle、Profile 与补丁

[English](../../areas/bundle-profile-patch.md)

作者发布的是 **bundle**（`package.json` 的 `dsh.bundle.patch` 指向一份补丁）。用户启动的是 **profile**（`$DSH_HOME/profiles/<name>`）。后应用的层按行覆盖，`config` 是整对象替换，不是深合并。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

安装用两份清单，都在 `package.json` 的 `dsh` 键下，回答的是不同的问题。

- **bundle** 是发布配置层的 npm 包。`dsh.bundle.patch` 是一个补丁文件，或一组有序的补丁文件，在 profile 列出该 bundle 时应用。
- **profile** 是 `$DSH_HOME/profiles/<name>` 下的一个目录，描述一份可运行的组合。`dsh.profile.bundles` 是有序的 bundle 列表。profile 自己的 `cordis.patch.yml` 是用户层。

二者不会同时成立。没有 `dsh.bundle` 的包仍然可以安装，但 `dsh plugin` 会警告，并且不会激活任何层。其他插件要 import 的库用这种形状。

官方包不使用 `dsh.plugin.json`。在这一提交的官方树里按这个文件名查找，什么也找不到。

## 它在哪里

- 教程：[docs/user/develop/basic/publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/publish.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)）
- 随发行的 bundle：[packages/bundle/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/README.md)
- base 补丁：[packages/bundle/base/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/base/cordis.patch.yml)
- profile 启动：[packages/boot/app-boot/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/app-boot/README.md)
- 设计笔记：[.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md)
- 展示元数据：[packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md)

盒内 bundle 的包名是 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`、`@deepseek-ai/dsh-acp-app`、`@deepseek-ai/dsh-sdk-app` 和 `@deepseek-ai/dsh-sdk-minimal`。`web`、`headless`、`acp` 和 `sdk` 建立在 `dsh-base` 上。`sdk-minimal` 用一个 bundle 提供完整的树。

## 约定

bundle 清单：

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`patch` 可以是一个有序列表。启动器把这些文件当作一层来应用。相对的插件路径相对于点名它们的那个文件来解析。

profile 清单（由 `dsh plugin` 写入，不要手写）：

```json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "dsh-hello-plugin"] } }
```

有效配置在空的根上组合。后出现的层按行获胜：

1. 按 `dsh.profile.bundles` 的顺序应用每个 bundle 补丁。在基于 base 的 profile 上，`@deepseek-ai/dsh-base` 最先，然后是按添加顺序安装的 bundle。
2. profile 自己的 `cordis.patch.yml`。
3. `$DSH_HOME/cordis.patch.yml`，这台机器上的每个 profile 共用。这份 home 文件压过单个 profile 的补丁。
4. 每个 `--patch <path>` 覆盖层，按 argv 顺序。

补丁会替换一行的整个 `config` 值。它不会深合并键。这一行需要的每个键都要重新写上。

补丁文档是 YAML 数组。常见条目形状：

- `- insert:` 后面跟着新行（`id`、`name`、`config`、`disabled`）。
- `- id: <entryId>` 用来覆盖已有行，可选 `name`、`disabled` 和 `config`。
- `disabled: !!js "..."`，这样加载器在该行激活时求值这个表达式。

加载器也理解原生的 `group`、`cordis:include` 和 `isolate`。这些是 Cordis 的组合特性，见入门文档。没有名为 `fork` 的补丁操作码。

盒内 bundle 的名字先从 dsh 安装位置解析，再从 profile 的 `node_modules` 解析。

插件管理器卡片在不激活插件的情况下读取 `locale/en.json`（以及 `locale/zh.json`）：

```json
{ "meta": { "title": "My plugin", "description": "What the card shows." } }
```

导出 `./locale/*.json` 和 `./package.json`。可选的顶层 `icon` 是包目录内的相对 SVG、PNG、JPEG 或 WebP，最大 256 KiB。缺字段时回退到 `name` 和 `description`。

对等依赖：当你 import 必须共享同一实例的宿主包（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-*`）时，把它们同时写进 `peerDependencies` 和 `devDependencies`。发布教程写明，在清单的查找位置上，正在运行的 dsh 里已有的对等依赖使用安装副本。`engines.dsh` 是作者声明的范围；[packages/util/package-manifest/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/util/package-manifest/README.md) 说当前的安装器和加载器并不强制它。`@deepseek-ai/dsh` 和 `@deepseek-ai/dsh-*` 上的对等范围会对照 `getDshRuntimeVersion()` 检查。见[命令行](cli.md)。

## 插件作者怎么用

- 发布 `dsh.bundle.patch`，以及一份用包名（不是源码检出路径）`insert` 你的插件行的补丁。
- 包名和每一行的 `id` 都要唯一。
- 只有在稳定 `id` 上才覆盖更早的行，并且把打算保留的完整 `config` 抄下来。
- 用户可调的默认值放进模式。你预期多数用户会保留的值放进补丁。
- 不启动即可验证：`dsh --profile <name> --dump-config`。类似 `# == your-package` 的层标题说明这个 bundle 有贡献。`--dump-config-schema` 会为组合后的插件打印 JSON Schema，并 import 那些模块，所以只对你信任的插件运行它。
- 链接的检出保留自己的 `node_modules`。git 安装不会运行 `build`，除非 `prepare` 去运行。见[命令行](cli.md)。

## 来源

- [docs/user/develop/basic/publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/publish.md)（[官方文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)）
- [packages/bundle/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/README.md)
- [packages/bundle/base/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/base/README.md)
- [packages/bundle/base/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/base/cordis.patch.yml)
- [packages/boot/app-boot/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/app-boot/README.md)
- [.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md)
- [packages/util/package-manifest/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/util/package-manifest/README.md)
