---
name: dsh-web-isolated-test
description: 需要在一个与当前会话完全隔离的 dsh web 实例里实测本仓插件（加载、点界面、截图、写验收结论）时使用；仅跑单元测试/夹具 e2e（e2e/*.mjs）或不碰浏览器时使用对应插件的 test 脚本，不用本 skill。
---

# 隔离 dsh web 实测本仓插件

在 `DSH_HOME=<隔离目录>` 下启动一个全新的 `dsh --profile web` 进程：它有独立的 profile、会话存储和凭据层，与用户正在用的实例（当前会话 GUI，端口见会话运行时上下文的 `DSH_WEB_URL`）和用户主 home `~/.dsh`（`$env:DSH_HOME` 原值）完全隔离。

## 关键约束（先读）

- **绝不动用户正在使用的实例**：不重启/不 kill 当前 GUI 端口上的进程，不读写 `~/.dsh`（即父进程 `DSH_HOME`）。隔离 home 只放 `<repo>/.scratch/<run>/home`（`.scratch/` 已被 .gitignore）。
- **端口不用当前 GUI 端口**，也不用占位常见值；`--port 0` 让系统分配最稳。
- **DSH 文件沙箱限制（Windows，实测）**：`spawn` 子进程必须 `stdio:'inherit'`（piped stdio → `spawn EPERM`）；playwright `chromium.launch` 同样 `spawn EPERM`，playwright-cli daemon 写 `~/AppData` 也 EPERM。被拦时把同一命令交给无沙箱限制的调用方（协调 agent 或让用户跑），不要换着花样重试。
- **隔离实例没有模型凭据**：需要调用模型的流程在隔离实例的设置界面里单独配置测试用 key，不要从 `~/.dsh` 复制凭据或配置。
- **token URL 是会话凭据**：`dsh web:` 打印的 `?token=…` URL 等价于该实例的登录态，只进 `.scratch/`、不进 README/commit。

## 前置事实（已核实）

- 仓库根 `node_modules/@deepseek-ai/dsh` 是完整运行时（与本仓 devDependency 同版本）；`bin.js` 即 `dsh` CLI。用 `node node_modules/@deepseek-ai/dsh/lib/bin.js …` 直接调用，保证测的是本仓声明的 DSH 版本。
- `DSH_HOME` 环境变量决定 home 根；profile 在 `$DSH_HOME/profiles/<name>`。`web` 是 shipped template，首启自动初始化（bundles = `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`）。
- `dsh plugin --profile web add ./plugins/<pkg>`：pnpm `link:` 装进 profile（只动隔离 home，不写插件自己的 node_modules），并把带 `dsh.bundle` 的包自动追加进 `dsh.profile.bundles`。
- web 参数（`dsh --profile web --help`）：`--host <具体本机IP>`（通配被拒）、`--port <n>`（0=自动）、`--no-open`（不开浏览器）、`--public-url`、`--trusted-host`、`--tls-*`。启动后 stdout 打印 `dsh web: http://127.0.0.1:<port>/?token=…`；token 换 cookie 是 303 + Set-Cookie，无 token 访问一律 401。
- 插件 UI 的客户端 bundle 走构建产物（`dsh.bundle.client` → `lib/client.js`）。**改插件源码后须先 `pnpm --filter <pkg> build` 再重启实例**；此模式无 client HMR（HMR 只服务 `pnpm run dev:web`）。
- 环境层：`dsh` 还会读启动 cwd 的 `.env` 和 `$DSH_HOME/.env`（本项目根无 `.env`；隔离 home 下没有用户 `.env`）。父会话注入的 `DSH_PROFILE`/`DSH_WEB_URL`/`DSH_SESSION_ID`/`DSH_SHELL` 会被辅助脚本清掉。

## 步骤

### 1. 启动（后台 job）

```powershell
# 在仓库根目录，pwsh 的 run_in_background 参数开 job
node .agents/skills/dsh-web-isolated-test/scripts/start-web.mjs .scratch/e2e-<场景> ./plugins/<包> --port 3210
```

- 多插件就追加多个 `./plugins/…` 参数；不装插件则只留 `<runDir>`。
- 启动后用 `job_output` 读日志，抓 `dsh web: (http://127.0.0.1:\d+/\?token=\S+)`；`run.json` 里有 pid/port/home 备查。
- 健康判定：`Invoke-WebRequest <根URL> -MaximumRedirection 0` 返回 401（未带 token）即服务在听；带 token URL 返回 303 + `Set-Cookie` 即鉴权门正常。
- 手工等价命令（脚本只是封装）：`$env:DSH_HOME='.scratch/<run>/home'; node node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile web add ./plugins/<pkg>`，再 `… --profile web --no-open --host 127.0.0.1 --port <port>`。
- 预检：`… --profile web --dump-config` 看组合后的层（应有 `# == @klarkxy/<pkg>` 段），不必起进程。

### 2. 给用户看：侧边浏览器

`sidebar_open` 的 `target` 传完整带 token 的 URL（`http://127.0.0.1:<port>/?token=…`），会在当前会话侧边的沙箱 iframe 里打开（侧边栏未显示时会排队，下次显示时出现）。实例销毁后这个标签页会失效，交付时告诉用户可以关掉。侧边浏览器是**给人看**的：agent 够不到 iframe 里的 DOM，自动化与截图一律走 playwright 直接打这个 URL。

### 3. 截图与自动化

```powershell
node .agents/skills/dsh-web-isolated-test/scripts/shot.mjs 'http://127.0.0.1:<port>/?token=…' .scratch/e2e-<场景>/shots --wait 8000
```

- 产出 `desktop.png`（1280×900）、`narrow.png`（390×844 整页）、`report.json`（title、最终 URL、pageerror/console error 列表）。之后用 `read_image` 逐张自查画面是否符合预期。
- 新建的隔离 home 首屏会弹「预览版说明」对话框，`shot.mjs` 的截图会带着它；验收插件界面前先在交互脚本里点「继续」关掉。
- 需要交互时加载 `playwright-cli` skill，或照 `e2e/web-search-settings.mjs` 的 playwright 写法自写脚本；仓库先例（viewport、整页截图、`page.on('pageerror')`、report.json 落地 `e2e/out/`）照抄即可。
- 沙箱下 playwright 起不来（见约束）；`playwright-cli` 被 daemon 文件 EPERM 拦时同样交无沙箱调用方。
- 视角按需覆盖：桌面/窄屏必留；明暗主题与中英语言在插件有相关界面时各留一张（页面内切语言/主题后截）。命名 `<视角>-<语言>-<主题>.png`，目录 `e2e/out/<场景>/`（已 gitignore，长期保留）或 `.scratch/`（临时）。

### 4. 验收清单（声称通过前逐项有证据）

- 入口：插件的设置席位/按钮/区块在 UI 中可见（截图）。
- 主流程：核心操作走通，结果状态出现（截图 + DOM/role 断言）。
- 错误态：断凭据/坏输入时插件给出错误展示而非白屏（截图）。
- `pageerror` 与 console error 为空；network 层面 RPC 无未处理失败。
- 持久化：刷新页面后设置/状态仍在（重开后截图比对）。
- i18n：中英文界面无漏键（显示 `i18n:xxx` 原始 key 即失败）。
- 结论写进 `report.json`：每项检查一个布尔字段 + 证据文件名 + `scope` 说明测的什么面（照 `e2e/out/*/report.json` 的格式）。**没有截图或日志证据的项不得写 true。**

### 5. 写验收文档

遵循根 `AGENTS.md` 的「文档」规则：

- 验收报告是**开发记录**，不进包内 README；临时产物整体放 `.scratch/` 用完删，需要留档的回归材料放 `e2e/out/<场景>/`（gitignore，随 e2e 先例管理）。
- 只有用户实际用得到的入口变化才改 README，且中英文成对改；README 不写验收过程、不写版本号/日期。
- 报告正文要克制：场景、跑的命令、结论布尔表、截图文件名、遗留问题；不贴大段日志。

### 6. 清理销毁

```powershell
# job_kill <启动 job id>，然后：
Get-NetTCPConnection -LocalPort <port> -State Listen   # 无输出 = 已释放
$t = (Resolve-Path '.scratch/e2e-<场景>').Path         # 打印核对后再删
Remove-Item -LiteralPath $t -Recurse -Force
```

- 先 `job_kill` 确认端口释放；仍有监听就找到 `run.json` 里的 pid 核实身份（命令行须含隔离 home 路径）再 `Stop-Process`。
- 删目录前**必须 `Resolve-Path` 打印并核对是绝对路径且在 `.scratch/` 下**，只删本次创建的 run 目录。
- 保留规则：有价值回归材料挪进 `e2e/out/<场景>/` 后删 `.scratch` run 目录；一次性验证整个目录删。
- 收尾确认：当前 GUI 仍响应（401 也算活着）、`~/.dsh` 未改动、没有遗留自己起的 node 进程。

## 文件

- `scripts/start-web.mjs`：隔离启动器（建隔离 home → `dsh plugin add` link 插件 → spawn web → run.json）。用法见文件头注释。
- `scripts/shot.mjs`：playwright 最小截图验收（desktop+narrow+report.json）。用法见文件头注释。
