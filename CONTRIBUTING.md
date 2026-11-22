# 参与贡献

简体中文 / [English](CONTRIBUTING.en.md)

本仓库是 DeepSeek Harness 插件的 monorepo。改某个插件时，构建和测试用该包自己的脚本；隔离界面验收用仓库根的 `dsh-web-acceptance`，不要把 `ds-dot` 或别的单包路径套进来。

## 提交前

```sh
pnpm check
```

只动了某一个包时，至少跑那个包的 `build`、`typecheck` 和 `test`。改了验收脚本时跑 `pnpm test:acceptance`。`pnpm check` 会带上它。

不要在这个流程里改插件版本或发布。发布规则见 [RELEASING.zh-CN.md](RELEASING.zh-CN.md)。

## Pull request

PR 目标分支是 `main`。一个 PR 只做一件事。标题用能看懂的完整句子。

合并由维护者决定。施工和审查用的自动化代理不合并 PR，不开启 auto-merge，不直接推 `main`，不删除分支，也不强推。

## 用户可见界面

这条规则每个作者自己遵守，审查时对照 diff 看正文。CI 不检查 GIF 在不在。

PR 改变了用户在 DeepSeek Harness 里看得见或点得到的界面时，合并前正文里要有一段用**本 PR 的代码**在 DeepSeek Harness 里录的真实 GIF。包括客户端组件、界面文案、图标，以及任何会改变操作或画面的 diff。

GIF 要盖住改动的操作和屏幕上的结果，并写明：

- 录制 commit（`git rev-parse HEAD`）
- 覆盖了哪些场景
- 录制 commit 如果不是当前 head，差在哪里。和界面有关的后续改动要重录

把 GIF 嵌进正文，或给一个正文里能渲染出来的图片地址。文件不要提交进分支。

下面这些不算数：生成动画、静态 mock、夹具页面、口头说已经录过、以及旧 commit 的录屏。

录制用 `.agents/skills/dsh-web-acceptance/`。脚本在临时 home 里启动隔离的 `dsh web`，把启动 token 换成 HttpOnly cookie，并把截图和 GIF 写到仓库外面。不要用个人 home、密钥、账号、生产环境或付费接口。不需要真实服务的外壳冒烟用 `--mock-shell`。

界面没变时，正文写清楚原因，例如只改了文档、服务端或测试。不要为了表格齐而补一段无意义的 GIF。改动很小、在内部、或不容易注意到，都不能代替上面的 GIF。

GIF 不代替自动测试，也不代替独立审查。

## 插件 README 与站点介绍

这条规则约束插件的双语 README 和站点插件页。新插件合入时就要满足；旧插件由维护者逐步补齐。

**README 必须有演示图**。有用户可见界面的插件，README（中文与英文）在概述之后放至少一张能说明插件在干什么的真实截图或 GIF。图片来源与上一节同一套标准：用该插件代码在隔离 `dsh web` 里录制的界面验收产物；生成动画、静态 mock、口头声明和过时的旧录屏都不算。界面大改后要换上演示图。纯共享库等没有界面的包在 README 里写明原因即可豁免。

**图片不进 npm 包**。GIF 与大尺寸图片统一提交到 `docs/demo-assets` 分支（文件名带插件名或 PR 号），README 用绝对地址引用：

```text
https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/<文件名>
```

小尺寸静态截图也可以放在插件目录下的 `screenshots/` 或 `docs/`（确认 `package.json` 的 `files` 不收录它们），README 里用相对路径引用。

**README 只写概述**：一段定位、演示图、安装、核心用法和主要限制。完整的功能清单、逐项配置说明和更多截图放进站点插件页。

**站点放详细介绍**。收录进 `site/catalog.json` 的插件要填 `details.zh` / `details.en`（Markdown，可带图），站点插件页会把它渲染为「详细介绍」一节，位于 README 摘录之前。新增插件不允许长期空着这一节。

## 验收脚本不进 npm 包

`.agents/` 是仓库里的开发工具。各插件的 `files` 不收录它，根目录的 `.npmignore` 也排除它。不要把验收产物放进插件包。
