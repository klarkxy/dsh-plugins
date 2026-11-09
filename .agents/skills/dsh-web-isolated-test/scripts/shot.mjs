// 对隔离 dsh web 页面做最小验收截图：打开带 token 的 URL，等首屏，截 desktop（1280x900）
// 与 narrow（390x844）两张整页 PNG，抓取 pageerror/console error，写 report.json。
// 用法（仓库根目录）：
//   node .agents/skills/dsh-web-isolated-test/scripts/shot.mjs <带token的URL> <输出目录> [--wait ms]
// 已知限制：DSH 文件沙箱内 playwright 无法 spawn 浏览器（spawn EPERM）也无权写
// ~/AppData/ms-playwright；被拦时在沙箱外（协调方/用户环境）跑同一命令。
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(resolve(process.cwd(), 'package.json'))
const { chromium } = require('playwright')

const [url, outDirArg, ...rest] = process.argv.slice(2)
if (!url || !outDirArg) {
  console.error('用法: node shot.mjs <带token的URL> <输出目录> [--wait ms]')
  process.exit(2)
}
const waitFlag = rest.indexOf('--wait')
const waitMs = waitFlag >= 0 ? Number(rest[waitFlag + 1]) : 6000
const outDir = resolve(process.cwd(), outDirArg)
mkdirSync(outDir, { recursive: true })

const errors = []
const browser = await chromium.launch({ headless: true })
const report = { url, screenshots: [], pageErrors: errors }
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(waitMs)
  await page.screenshot({ path: resolve(outDir, 'desktop.png'), fullPage: true })
  report.screenshots.push('desktop.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: resolve(outDir, 'narrow.png'), fullPage: true })
  report.screenshots.push('narrow.png')
  report.title = await page.title()
  report.finalUrl = page.url()
  report.ok = errors.length === 0
  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} finally {
  await browser.close()
}
process.exit(report.ok ? 0 : 1)
