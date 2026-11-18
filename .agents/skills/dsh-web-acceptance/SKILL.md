---
name: dsh-web-acceptance
description: "在临时 home 里启动与维护者日常配置隔离的 DeepSeek Harness (dsh web)，验收本仓库 plugins/ 下的插件界面，并录制真实交互 GIF。改了用户可见界面、要截图、要录 GIF、或要并行拉起干净 web 实例时使用。不用于只跑单元测试或夹具 e2e。"
---

# dsh-web-acceptance

在临时目录里启动 `dsh web`：独立的 `DSH_HOME`、`DSH_AGENTS_HOME` 和子进程 `HOME`，空的 npm userconfig，随机回环端口，以及只保留 HttpOnly `dsh-auth-*` cookie 的录屏上下文。默认使用本仓库安装的 `node_modules/@deepseek-ai/dsh/lib/bin.js`，用来验收 `plugins/` 里的本地构建，而不是维护者日常在用的那一份配置。

## 何时使用

- 改了用户在 DeepSeek Harness 里看得见或点得到的界面（客户端组件、文案、图标、会改变操作结果的样式），合并前要在 PR 正文附上真实 GIF
- 要确认某个插件在真实 `dsh web` 里的入口、布局、语言或主题，而不是只跑该包的单元测试
- 本机已经有一个日常 `dsh web` 或 Desktop，需要再拉起一个互不干扰的实例

纯文档、发布脚本、服务端逻辑且界面不变时，不要为了凑 GIF 去录。PR 正文写明原因。GIF 不能代替 `pnpm check` 和独立审查。

## 1. 先构建要挂的插件

`dsh web` 加载的是已经构建的 `main` 和 `./client`。只改 `src/` 不构建，录到的是旧界面。

在仓库根目录构建涉及到的包，例如：

```sh
pnpm --filter @klarkxy/dsh-font build
```

没有 `--plugin` 时只启动官方 web 模板，用来跑下面的无服务外壳场景，不需要先构建插件。

## 2. 用捆绑脚本跑隔离验收

在仓库根目录执行。产物目录必须在 git checkout 外面；脚本拒绝写进仓库。

无模型、无付费接口的外壳冒烟（不挂任何插件，不提交对话）：

```sh
node .agents/skills/dsh-web-acceptance/scripts/dsh-qa-harness.js \
  --mock-shell \
  --gif-name shell.gif \
  --out-dir "<temp-dir>/dsh-qa"
```

验收一个或几个本仓插件。`--plugin` 可重复，值是 `plugins/<目录>` 或包名。脚本会按依赖顺序把该插件在 `plugins/` 里的 `workspace:` 依赖一并 `link:` 进临时 profile（含只写在 devDependencies 里、但运行时会 import 的共享库）。不会因此把仓库里其余插件全部装上，也不会按 npm 包名去注册表下载。

```sh
node .agents/skills/dsh-web-acceptance/scripts/dsh-qa-harness.js \
  --plugin plugins/dsh-font \
  --scenario "<temp-dir>/font-settings.mjs" \
  --locale zh-CN \
  --gif-name font-settings.gif \
  --out-dir "<temp-dir>/dsh-font-qa"
```

场景模块导出 `run(ctx)`。`ctx` 里的 `page` 已经换成 cookie 并打开了不带 `?token=` 的 `http://localhost:<端口>/`。页面错误，以及 `/api/*`、`/plugins/*` 的 4xx/5xx，会在场景返回后判失败；场景自己吞掉异常也一样失败。示例见 `references/plugin-recipes.md` 和 `references/mock-shell-scenario.mjs`。

常用参数：

- `--viewport 1440x900`、`--color-scheme dark`、`--locale en-US`
- `--gif-name` 会打开双通道调色板 GIF。没有 ffmpeg 时，用场景里的 `captureFrame` 拼 Pillow GIF
- `--dsh-cmd` 仅在不用本仓安装的 `dsh` 时才传。默认是 `node` 加上本仓的 `lib/bin.js`，不会去 PATH 里找另一份 `dsh`
- `--allow-env 某个密钥名` 只能加回一个已被清掉的非隔离变量。它不能改回 `DSH_HOME`、`DSH_AGENTS_HOME`、`HOME`、`USERPROFILE`、XDG 配置目录或 npm userconfig。界面验收不要加模型密钥，也不要打生产或付费接口

## 3. 自己写控制脚本时仍要守的隔离

优先调用上面的脚本。自行编排时保持同一契约：

1. 子进程环境先丢掉全部 `DSH_*`、home、XDG 配置目录、npm userconfig，以及名称里带 `KEY`、`PASSWORD`、`SECRET`、`TOKEN`、`COOKIE` 的变量，再写回临时 home。日志里的 `token=`、`dsh-auth-*` 和用户 home 路径要脱敏。
2. 用 `dsh plugin --profile web add link:<绝对路径>` 挂本地构建。`link:` 指向临时 mount，mount 里的 `workspace:` 已改成其它 mount 的绝对 `link:`，仓库里的 `package.json` 保持原样。
3. 只绑定 `127.0.0.1` 的空闲端口，并声明 `--public-url http://localhost:<端口>/` 与对应的 `--trusted-host`。不要用 `0.0.0.0`。
4. 只接受主机是 `localhost`、`127.0.0.1` 或 `::1`、且端口就是这次监听端口的启动 URL，再规范成 `http://localhost:<端口>/`。先用未录屏的上下文换 HttpOnly `dsh-auth-*` cookie，录屏上下文只带这枚 cookie，不带 token、其它 cookie 或 localStorage。
5. GIF 用 ffmpeg 的 `palettegen` + `paletteuse`（12 fps，宽度不超过 1280）。交互之间留大约 350–650ms，结果态停留大约 1–1.5s。

## 4. 回收顺序

无论成功还是失败，都按这个顺序收尾：

1. 关闭浏览器上下文，让录屏写完。
2. 结束 `dsh web` 进程树并确认进程已经退出。POSIX 先向进程组发 `SIGTERM`，超时再 `SIGKILL`。Windows 用 `taskkill /PID <pid> /T`，仍不退出再加 `/F`。
3. 确认进程退出之后再删除临时 home。进程在强制结束后仍活着时，保留临时目录并报错，不要在进程还在时删目录。

`dsh-hmr` 会监听 profile。进程还活着就删 `DSH_HOME`，可能留下空转的 `node`。

## 5. PR 里的 GIF

改变用户可见界面的 PR，在合并前把这次运行写出的 GIF 放进 PR 正文，或放一个能在正文里渲染的图片地址。文件不要提交进分支。正文写上：

- 录制时的 commit（`git rev-parse HEAD`）
- 这段 GIF 覆盖的操作和结果
- 若录制 commit 不是当前 head：差了什么；和界面有关的后续改动要重录

不接受生成动画、静态 mock 页面、夹具里的假页面，或旧 head 的录屏。`qa-report.json` 里的 `commit` 是这次隔离进程看到的 HEAD。

报告写在 PR 正文里。不要把验收过程写进插件 README。
