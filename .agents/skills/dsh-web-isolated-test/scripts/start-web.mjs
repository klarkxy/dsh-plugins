// 在隔离的 DSH_HOME 下启动一个独立的 `dsh web` 进程，用于实测本仓插件。
// 用法（在仓库根目录后台运行）：
//   node .agents/skills/dsh-web-isolated-test/scripts/start-web.mjs <运行目录> [插件目录...] [--port N]
// 例：
//   node .agents/skills/dsh-web-isolated-test/scripts/start-web.mjs .scratch/e2e-my-plugin ./plugins/dsh-model-picker --port 3210
// 行为：
//   1. 在 <运行目录>/home 建隔离 DSH_HOME（不含则跳过初始化，复用已有 profile）；
//   2. 逐个 `dsh plugin --profile web add <插件目录>`（pnpm link + 自动维护 dsh.profile.bundles）；
//   3. spawn `dsh --profile web --no-open --host 127.0.0.1 --port <N>`（N 缺省 0，由系统分配空闲端口）；
//      子进程 stdout/stderr 继承父进程 → 全部进后台 job 输出，里面含 `dsh web: <带 token 的 URL>`；
//   4. pid/home 写进 <运行目录>/run.json。
// 退出方式：父进程仅作托管壳，用 pwsh run_in_background + job_kill 一起结束父子进程。
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const args = process.argv.slice(2)
const portFlag = args.indexOf('--port')
const port = portFlag >= 0 ? args.splice(portFlag, 2)[1] : '0'
const [runDirArg, ...pluginDirs] = args
if (!runDirArg) {
  console.error('用法: node start-web.mjs <运行目录> [插件目录...] [--port N]')
  process.exit(2)
}
const runDir = resolve(root, runDirArg)
const home = resolve(runDir, 'home')
const bin = resolve(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
mkdirSync(resolve(home, 'profiles'), { recursive: true })
mkdirSync(runDir, { recursive: true })

// 启动环境：换掉 DSH_HOME 做隔离；清掉父会话注入的受管变量，避免污染隔离实例。
const env = { ...process.env, DSH_HOME: home }
for (const name of ['DSH_PROFILE', 'DSH_PROFILE_DIR', 'DSH_SESSION_ID', 'DSH_WEB_URL', 'DSH_SHELL']) delete env[name]

// 装插件：官方入口 `dsh plugin --profile web add <本地目录>` → pnpm link 进 profile，
// 并自动把带 dsh.bundle 声明的包追加进 dsh.profile.bundles。首次使用顺带初始化 profile。
for (const dir of pluginDirs) {
  const result = spawnSync(process.execPath, [bin, 'plugin', '--profile', 'web', 'add', dir],
    { stdio: 'inherit', env, cwd: root, windowsHide: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
// 无插件时仍直接 boot：web 是 shipped template，缺省自动 init（base + web-app）

// spawn 必须 stdio:'inherit'：Windows 沙箱禁止 piped stdio 的子进程（spawn EPERM）。
// 日志直接写进后台 job 输出；带 token 的 URL 从 job_output 里抓 /dsh web: (http\S+)/。
const child = spawn(process.execPath, [bin, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', port],
  { cwd: root, env, stdio: 'inherit', windowsHide: true })
const meta = { pid: child.pid, home, runDir, port }
child.on('exit', code => {
  writeFileSync(resolve(runDir, 'run.json'), JSON.stringify({ ...meta, exitCode: code }, null, 2) + '\n')
  process.exit(code ?? 1)
})
writeFileSync(resolve(runDir, 'run.json'), JSON.stringify(meta, null, 2) + '\n')
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
