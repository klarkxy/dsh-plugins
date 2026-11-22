#!/usr/bin/env node
/**
 * Isolated DeepSeek Harness (dsh web) acceptance runner for this monorepo.
 *
 * The child gets a temporary DSH_HOME and DSH_AGENTS_HOME, a temporary HOME,
 * a blank npm user config, and no inherited secret-shaped variables.
 * --allow-env cannot restore those isolation variables. Only a loopback launch
 * URL on this process's port is accepted, then rewritten to
 * http://localhost:<port>/ so the auth cookie and the recording share one Host.
 * Recording keeps the HttpOnly dsh-auth-* cookie and drops other cookies and
 * web storage. The dsh process tree is killed and confirmed exited before the
 * temporary home is removed. Screenshots and GIFs are refused inside a git
 * checkout.
 *
 * --plugin takes a plugins/<dir> path or a workspace package name. The runner
 * also links workspace dependencies found under plugins/, in dependency order,
 * through temporary mounts. It does not rewrite package.json in the checkout
 * and it does not install registry specs.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN|COOKIE/i
const COLOR_SCHEMES = new Set(['light', 'dark', 'no-preference'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']
const LOCKED_ENV_NAMES = new Set([
  'HOME',
  'USERPROFILE',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
  'NPM_CONFIG_USERCONFIG',
  'NPM_CONFIG_GLOBALCONFIG',
])
const SKIP_MOUNT_ENTRIES = new Set(['node_modules', '.git', 'package.json'])
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const MOCK_SHELL_SCENARIO = path.join(SCRIPT_DIR, '..', 'references', 'mock-shell-scenario.mjs')

export function redactTokens(input) {
  if (typeof input !== 'string') return ''
  return input
    .replace(/((?:token|access_token|id_token)=)[^&\s#]+/gi, '$1<REDACTED>')
    .replace(/(dsh-auth-[A-Za-z0-9_-]+=)[^;\s]+/gi, '$1<REDACTED>')
    .replace(/((?:authorization|bearer)["']?\s*[:=]\s*["']?)[^\s&,"']+/gi, '$1<REDACTED>')
}

export function redactForLog(input, homeDir = os.homedir()) {
  let text = redactTokens(typeof input === 'string' ? input : String(input ?? ''))
  if (typeof homeDir === 'string' && homeDir.length > 1) {
    text = text.split(homeDir).join('<HOME>')
  }
  return text
}

function requireInteger(flag, raw, { min, max }) {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw < min || raw > max) throw new Error(`${flag} must be an integer from ${min} to ${max}.`)
    return raw
  }
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new Error(`${flag} expects an integer from ${min} to ${max}.`)
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${flag} must be an integer from ${min} to ${max}.`)
  }
  return value
}

export function parseArgs(argv, cwd = process.cwd()) {
  const opts = {
    pluginSpecs: [],
    patches: [],
    allowEnv: [],
    dshCmd: '',
    dshCwd: undefined,
    cwdSpecified: false,
    pluginsRoot: undefined,
    profile: 'web',
    outDir: path.join(os.tmpdir(), `dsh-qa-artifacts-${Date.now()}`),
    scenarioPath: undefined,
    useMockShell: false,
    viewportWidth: 1440,
    viewportHeight: 900,
    gifWidth: 1280,
    gifFps: 12,
    locale: 'zh-CN',
    colorScheme: 'light',
    bootTimeoutMs: 45_000,
    commandTimeoutMs: 180_000,
    keepTempHome: false,
    recordGif: false,
    gifName: 'acceptance.gif',
    screenshotName: 'acceptance.png',
    waitSelector: undefined,
    clickSelectors: [],
    settleMs: 1200,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`)
      i += 1
      return argv[i]
    }
    if (arg === '-h' || arg === '--help') opts.help = true
    else if (arg === '--plugin') opts.pluginSpecs.push(next())
    else if (arg === '--patch') opts.patches.push(path.resolve(next()))
    else if (arg === '--dsh-cmd') opts.dshCmd = next()
    else if (arg === '--cwd') {
      opts.dshCwd = path.resolve(next())
      opts.cwdSpecified = true
    } else if (arg === '--plugins-root') opts.pluginsRoot = path.resolve(next())
    else if (arg === '--profile') opts.profile = next()
    else if (arg === '--out-dir') opts.outDir = path.resolve(next())
    else if (arg === '--scenario') opts.scenarioPath = path.resolve(next())
    else if (arg === '--mock-shell') opts.useMockShell = true
    else if (arg === '--viewport') {
      const match = /^(\d+)x(\d+)$/i.exec(next())
      if (!match) throw new Error('Expected --viewport <WIDTHxHEIGHT>, e.g. 1440x900')
      opts.viewportWidth = requireInteger('--viewport width', match[1], { min: 1, max: 8192 })
      opts.viewportHeight = requireInteger('--viewport height', match[2], { min: 1, max: 8192 })
    } else if (arg === '--gif') opts.recordGif = true
    else if (arg === '--gif-name') {
      opts.recordGif = true
      opts.gifName = next()
    } else if (arg === '--gif-width') opts.gifWidth = requireInteger('--gif-width', next(), { min: 1, max: 4096 })
    else if (arg === '--gif-fps') opts.gifFps = requireInteger('--gif-fps', next(), { min: 1, max: 60 })
    else if (arg === '--screenshot-name') opts.screenshotName = next()
    else if (arg === '--locale') opts.locale = next()
    else if (arg === '--color-scheme') opts.colorScheme = next()
    else if (arg === '--wait-selector') opts.waitSelector = next()
    else if (arg === '--click') opts.clickSelectors.push(next())
    else if (arg === '--settle-ms') opts.settleMs = requireInteger('--settle-ms', next(), { min: 0, max: 120_000 })
    else if (arg === '--boot-timeout-ms') opts.bootTimeoutMs = requireInteger('--boot-timeout-ms', next(), { min: 1, max: 600_000 })
    else if (arg === '--command-timeout-ms') opts.commandTimeoutMs = requireInteger('--command-timeout-ms', next(), { min: 1, max: 600_000 })
    else if (arg === '--allow-env') opts.allowEnv.push(next())
    else if (arg === '--keep-temp-home') opts.keepTempHome = true
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (!opts.cwdSpecified) opts.dshCwd = workspaceRootFrom(cwd)
  if (opts.useMockShell && opts.scenarioPath) throw new Error('--mock-shell cannot be combined with --scenario.')
  if (opts.useMockShell) opts.scenarioPath = MOCK_SHELL_SCENARIO
  if (!opts.help) validateOpts(opts)
  return opts
}

export function validateOpts(opts) {
  requireInteger('viewport width', opts.viewportWidth, { min: 1, max: 8192 })
  requireInteger('viewport height', opts.viewportHeight, { min: 1, max: 8192 })
  requireInteger('gif width', opts.gifWidth, { min: 1, max: 4096 })
  requireInteger('gif fps', opts.gifFps, { min: 1, max: 60 })
  requireInteger('settle ms', opts.settleMs, { min: 0, max: 120_000 })
  requireInteger('boot timeout', opts.bootTimeoutMs, { min: 1, max: 600_000 })
  requireInteger('command timeout', opts.commandTimeoutMs, { min: 1, max: 600_000 })
  if (!COLOR_SCHEMES.has(opts.colorScheme)) throw new Error('Expected --color-scheme light, dark, or no-preference.')
  if (!opts.profile || opts.profile.startsWith('-') || /[\0\r\n]/.test(opts.profile)) throw new Error('Invalid --profile value.')
  if (typeof opts.dshCmd !== 'string') throw new Error('Invalid --dsh-cmd value.')
  if (typeof opts.locale !== 'string' || opts.locale.trim() === '' || /[\0\r\n]/.test(opts.locale)) throw new Error('Invalid --locale value.')
  if (!opts.gifName || !opts.screenshotName) throw new Error('Output filename is empty.')
  if (!opts.outDir) throw new Error('Output directory is empty.')
  if (!opts.dshCwd) throw new Error('Working directory is empty.')
}

function printHelp() {
  console.log(`Usage: node dsh-qa-harness.js [options]

Starts an isolated dsh web for this workspace. The default dsh binary is
node_modules/@deepseek-ai/dsh/lib/bin.js. Repeat --plugin with a plugins/<dir>
path or a workspace package name. Workspace dependencies under plugins/ are
linked too. Registry specs are refused.

  --plugin <dir|name>       Local plugin to link (repeatable)
  --plugins-root <dir>      Workspace plugins directory (default: <root>/plugins)
  --mock-shell              Bundled shell scenario; no model and no paid API
  --scenario <file.mjs>     Scenario module exporting run(ctx)
  --out-dir <dir>           Artifacts outside the git checkout
  --viewport <WxH>          Browser viewport, default 1440x900
  --locale <bcp47>          Browser locale, default zh-CN
  --color-scheme <scheme>   light, dark, or no-preference
  --wait-selector <css>     Selector to await before the default capture
  --click <css>             Click during the default run (repeatable)
  --screenshot-name <name>  Default screenshot filename
  --gif / --gif-name <name> Record a palette GIF
  --gif-width <px>          GIF max width, default 1280
  --gif-fps <fps>           GIF frame rate, default 12
  --settle-ms <ms>          Hold on the last frame, default 1200
  --patch <yml>             Extra Cordis patch (repeatable)
  --dsh-cmd <cmd>           Override the dsh command. Empty uses the workspace binary.
                            Inside the value, wrap any path that contains spaces in double
                            quotes, e.g. "C:\\Program Files\\nodejs\\node.exe" bin.js; quote or
                            escape the whole value as your shell requires. Double quotes only group
                            and are never passed through; put arguments that need literal
                            quotes in a wrapper script.
  --cwd <dir>               Working directory (default: workspace root)
  --allow-env <VAR>         Reintroduce one scrubbed non-isolation variable
  --boot-timeout-ms <ms>    Wait for the loopback launch URL
  --keep-temp-home          Keep the temporary DSH_HOME after the process exits
  -h, --help                Show this help
`)
}

export function gitToplevel(cwd) {
  if (!cwd || !existsSync(cwd)) return null
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (res.status !== 0) return null
  return res.stdout.trim() || null
}

export function workspaceRootFrom(cwd) {
  const top = gitToplevel(cwd)
  for (const candidate of [top, cwd].filter(Boolean)) {
    if (existsSync(path.join(candidate, 'pnpm-workspace.yaml'))) return path.resolve(candidate)
  }
  return path.resolve(cwd)
}

export function findWorkspaceDshBin(start) {
  let dir = path.resolve(start)
  const root = path.parse(dir).root
  for (;;) {
    const candidate = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (existsSync(candidate)) return candidate
    if (dir === root) return null
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function splitCommand(cmdString) {
  // Whitespace separates arguments outside double quotes; a quoted segment
  // joins adjacent unquoted text in the same argument, and backslashes stay
  // literal so Windows paths need no escaping.
  const parts = []
  let current = null
  let quoted = false
  for (const ch of String(cmdString)) {
    if (ch === '"') { quoted = !quoted; current ??= ''; continue }
    if (!quoted && /\s/.test(ch)) { if (current !== null) { parts.push(current); current = null } continue }
    current = (current ?? '') + ch
  }
  if (quoted) throw new Error('Invalid --dsh-cmd value: unbalanced double quote.')
  if (current !== null) parts.push(current)
  if (!parts[0]) throw new Error('Invalid --dsh-cmd value.')
  return { bin: parts[0], prefixArgs: parts.slice(1) }
}

export function resolveDshInvocation(opts) {
  if (typeof opts.dshCmd === 'string' && opts.dshCmd.trim() !== '') return splitCommand(opts.dshCmd)
  const bin = findWorkspaceDshBin(opts.dshCwd)
  if (!bin) {
    throw new Error('Could not find node_modules/@deepseek-ai/dsh/lib/bin.js. Install workspace dependencies, or pass --dsh-cmd.')
  }
  return { bin: process.execPath, prefixArgs: [bin] }
}

export function readPluginManifest(dir) {
  const pkgPath = path.join(dir, 'package.json')
  if (!existsSync(pkgPath)) throw new Error(`Plugin directory missing package.json: ${dir}`)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (error) {
    throw new Error(`Unreadable package.json in ${dir}: ${error.message}`)
  }
  if (!manifest || typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    throw new Error(`Plugin package.json is missing a name: ${dir}`)
  }
  return manifest
}

export function indexWorkspacePlugins(pluginsRoot) {
  const byName = new Map()
  if (!pluginsRoot || !existsSync(pluginsRoot)) return byName
  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(pluginsRoot, entry.name)
    if (!existsSync(path.join(dir, 'package.json'))) continue
    const manifest = readPluginManifest(dir)
    if (byName.has(manifest.name)) throw new Error(`Duplicate workspace package name ${manifest.name}`)
    byName.set(manifest.name, { dir, manifest, folder: entry.name })
  }
  return byName
}

export function workspaceDependencyNames(manifest) {
  const names = []
  for (const field of DEPENDENCY_FIELDS) {
    const block = manifest?.[field]
    if (!block || typeof block !== 'object') continue
    for (const [name, spec] of Object.entries(block)) {
      if (typeof spec === 'string' && spec.startsWith('workspace:')) names.push(name)
    }
  }
  return names
}

export function isInsideDir(parent, target) {
  const root = path.resolve(parent)
  const resolved = path.resolve(target)
  const rel = path.relative(root, resolved)
  if (rel === '') return true
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return false
  return true
}

export function assertSafePluginDir(dir, homeDir = os.homedir()) {
  const resolved = path.resolve(dir)
  for (const root of [path.join(homeDir, '.dsh'), path.join(homeDir, '.agents')]) {
    if (isInsideDir(root, resolved)) {
      throw new Error('Refusing to link a plugin from a personal DSH or agents home.')
    }
  }
  return resolved
}

export function resolvePluginDir(spec, { cwd = process.cwd(), pluginsRoot, byName, homeDir } = {}) {
  if (typeof spec !== 'string' || spec.trim() === '') throw new Error('Plugin spec is empty.')
  const trimmed = spec.trim()
  if (/[\0\r\n]/.test(trimmed)) throw new Error('Plugin spec contains a newline or NUL.')
  if (/^(?:npm:|jsr:|https?:|git\+|github:|gitlab:|file:|link:)/i.test(trimmed)) {
    throw new Error('Pass a local plugins/<dir> path or a workspace package name. Registry and URL specs are not accepted.')
  }
  const index = byName || indexWorkspacePlugins(pluginsRoot)
  if (index.has(trimmed)) return assertSafePluginDir(index.get(trimmed).dir, homeDir)

  const candidates = []
  if (pluginsRoot && (trimmed === 'plugins' || trimmed.startsWith('plugins/') || trimmed.startsWith('plugins\\'))) {
    candidates.push(path.resolve(path.dirname(pluginsRoot), trimmed))
  }
  candidates.push(path.resolve(cwd, trimmed))
  if (pluginsRoot && !trimmed.includes('/') && !trimmed.includes('\\')) {
    candidates.push(path.join(pluginsRoot, trimmed))
  }
  const seen = new Set()
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    if (!existsSync(path.join(resolved, 'package.json'))) continue
    return assertSafePluginDir(resolved, homeDir)
  }
  throw new Error(`No workspace plugin matches ${JSON.stringify(trimmed)}. Use plugins/<directory> or the package name.`)
}

export function resolvePluginClosure(specs, options) {
  const pluginsRoot = options.pluginsRoot
  const byName = options.byName || indexWorkspacePlugins(pluginsRoot)
  const visiting = new Set()
  const done = new Set()
  const ordered = []

  function visit(specOrDir) {
    const asDir = String(specOrDir)
    const dir = path.isAbsolute(asDir) && existsSync(path.join(asDir, 'package.json'))
      ? assertSafePluginDir(asDir, options.homeDir)
      : resolvePluginDir(asDir, { ...options, byName })
    if (done.has(dir)) return
    if (visiting.has(dir)) throw new Error(`Cyclic workspace plugin dependency involving ${dir}`)
    visiting.add(dir)
    const manifest = readPluginManifest(dir)
    for (const name of workspaceDependencyNames(manifest)) {
      const dep = byName.get(name)
      if (!dep) {
        throw new Error(`${manifest.name} depends on workspace package ${name}, which is not under the workspace plugins directory.`)
      }
      visit(dep.dir)
    }
    visiting.delete(dir)
    done.add(dir)
    ordered.push({ dir, manifest })
  }

  for (const spec of specs) visit(spec)
  return ordered
}

export function rewriteWorkspaceProtocol(manifest, mountByName) {
  const result = structuredClone(manifest)
  for (const field of DEPENDENCY_FIELDS) {
    const block = result[field]
    if (!block || typeof block !== 'object') continue
    for (const [name, spec] of Object.entries(block)) {
      if (typeof spec !== 'string' || !spec.startsWith('workspace:')) continue
      const mount = mountByName.get(name)
      if (!mount) throw new Error(`Missing mount for workspace dependency ${name}`)
      if (!path.isAbsolute(mount)) throw new Error(`Mount for ${name} must be absolute.`)
      block[name] = `link:${mount}`
    }
  }
  const leftover = JSON.stringify(result)
  if (leftover.includes('workspace:')) {
    throw new Error(`Refusing to mount ${manifest.name}: a workspace: specifier is still present.`)
  }
  return result
}

function mountFolderName(name, index) {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '__')
  return `${String(index).padStart(2, '0')}-${safe}`
}

export function pluginAddArguments(profile, mountDir) {
  if (!path.isAbsolute(mountDir)) throw new Error('Plugin mount path must be absolute.')
  return ['plugin', '--profile', profile, 'add', `link:${mountDir}`]
}

function clientBundleRelative(pkg) {
  const client = pkg.exports?.['./client']
  if (typeof client === 'string') return client
  if (client && typeof client === 'object') {
    if (typeof client.default === 'string') return client.default
    if (typeof client.import === 'string') return client.import
  }
  return null
}

export function assertPluginBuilt(realDir, manifest) {
  if (typeof manifest.main === 'string' && !existsSync(path.join(realDir, manifest.main))) {
    throw new Error(`Built entry "${manifest.main}" is missing in ${realDir}. Build that package before acceptance.`)
  }
  const clientEntry = clientBundleRelative(manifest)
  if (clientEntry && !existsSync(path.join(realDir, clientEntry))) {
    throw new Error(`Built client bundle "${clientEntry}" is missing in ${realDir}. Build that package before acceptance.`)
  }
}

export async function materializePluginMounts(closure, tempHome) {
  const mountsRoot = path.join(tempHome, 'plugin-mounts')
  if (!isInsideDir(tempHome, mountsRoot)) throw new Error('Refusing to materialize plugin mounts outside the temporary home.')
  await fs.mkdir(mountsRoot, { recursive: true })
  const mountByName = new Map()
  const planned = closure.map((item, index) => {
    const mountDir = path.join(mountsRoot, mountFolderName(item.manifest.name, index))
    if (!isInsideDir(tempHome, mountDir)) throw new Error('Refusing to materialize a plugin mount outside the temporary home.')
    mountByName.set(item.manifest.name, mountDir)
    return { ...item, mountDir }
  })
  const mounts = []
  for (const item of planned) {
    const rewritten = rewriteWorkspaceProtocol(item.manifest, mountByName)
    await fs.mkdir(item.mountDir, { recursive: true })
    await fs.writeFile(path.join(item.mountDir, 'package.json'), `${JSON.stringify(rewritten, null, 2)}\n`)
    for (const entry of await fs.readdir(item.dir, { withFileTypes: true })) {
      if (SKIP_MOUNT_ENTRIES.has(entry.name)) continue
      const source = path.join(item.dir, entry.name)
      const dest = path.join(item.mountDir, entry.name)
      const type = entry.isDirectory() ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file'
      try {
        await fs.symlink(source, dest, type)
      } catch (error) {
        // Windows without Developer Mode denies unprivileged file symlinks.
        // A copied mount serves the same read-only purpose for the isolated
        // profile; directory junctions still work, so only files fall back.
        if (type !== 'file' || !(['EPERM', 'EACCES'].includes(error?.code))) throw error
        await fs.copyFile(source, dest)
      }
    }
    mounts.push({ ...item, manifest: rewritten })
  }
  return mounts
}

export function buildIsolatedEnv(tempHome, allowEnv = [], source = process.env) {
  const allow = new Set()
  for (const name of allowEnv) {
    if (typeof name !== 'string' || name.trim() === '') throw new Error('--allow-env requires an environment variable name.')
    const upper = name.toUpperCase()
    if (upper.startsWith('DSH_') || LOCKED_ENV_NAMES.has(upper)) {
      throw new Error(`--allow-env cannot keep ${name}; isolated homes and shared config stay inside the temporary directory.`)
    }
    allow.add(upper)
  }

  const env = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue
    const upper = key.toUpperCase()
    if (upper.startsWith('DSH_')) continue
    if (LOCKED_ENV_NAMES.has(upper)) continue
    if (SENSITIVE_ENV_PATTERN.test(key) && !allow.has(upper)) continue
    env[key] = value
  }
  env.DSH_HOME = tempHome
  env.DSH_AGENTS_HOME = path.join(tempHome, 'agents-home')
  env.DSH_TELEMETRY_DISABLED = '1'
  env.DSH_TELEMETRY_MODE = 'DISABLED'
  env.NO_COLOR = '1'
  return env
}

export function sealIsolatedEnv(env, tempHome) {
  const sealed = { ...env }
  for (const key of Object.keys(sealed)) {
    const upper = key.toUpperCase()
    if (upper.startsWith('DSH_') || LOCKED_ENV_NAMES.has(upper)) delete sealed[key]
    if (/^npm_config_(userconfig|globalconfig)$/i.test(key)) delete sealed[key]
  }
  sealed.HOME = tempHome
  sealed.USERPROFILE = tempHome
  sealed.DSH_HOME = tempHome
  sealed.DSH_AGENTS_HOME = path.join(tempHome, 'agents-home')
  sealed.DSH_TELEMETRY_DISABLED = '1'
  sealed.DSH_TELEMETRY_MODE = 'DISABLED'
  sealed.NO_COLOR = '1'
  const npmrc = path.join(tempHome, 'blank-npmrc')
  sealed.npm_config_userconfig = npmrc
  sealed.NPM_CONFIG_USERCONFIG = npmrc
  return sealed
}

export function quoteWindowsCmdArg(arg) {
  const value = String(arg)
  if (value.length === 0) return '""'
  if (!/[\s"%&|<>^]/.test(value)) return value
  return `"${value.replace(/%/g, '%%').replace(/"/g, '""')}"`
}

function spawnCrossPlatform(bin, args, options) {
  if (process.platform === 'win32') {
    const inner = [bin, ...args].map(quoteWindowsCmdArg).join(' ')
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${inner}"`], {
      ...options,
      windowsHide: true,
      windowsVerbatimArguments: true,
    })
  }
  return spawn(bin, args, { ...options, detached: true })
}

function hasExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null
}

export async function terminateProcessTree(child, graceMs = 5000) {
  if (!child) return true
  const pid = child.pid
  if (!Number.isInteger(pid) || pid <= 0) return true

  const signalGroup = signal => {
    if (process.platform === 'win32') return
    try { process.kill(-pid, signal) } catch { try { child.kill(signal) } catch { /* already gone */ } }
  }

  if (hasExited(child)) {
    signalGroup('SIGKILL')
    return true
  }

  const exited = new Promise(resolve => {
    if (hasExited(child)) {
      resolve()
      return
    }
    child.once('exit', () => resolve())
  })

  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T'], { stdio: 'ignore', windowsHide: true })
    else signalGroup('SIGTERM')
  } catch { /* exited between the check and the signal */ }

  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), graceMs)),
  ])

  if (!graceful && !hasExited(child)) {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      else signalGroup('SIGKILL')
    } catch { /* disappeared while signalling */ }
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))])
  }
  return hasExited(child)
}

export async function removeIsolatedHome(tempHome, { exited, keep = false } = {}) {
  if (keep || !exited) return false
  await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {})
  return !existsSync(tempHome)
}

export async function releaseIsolatedHome(tempHome, child, { keep = false, graceMs = 5000 } = {}) {
  const exited = await terminateProcessTree(child, graceMs)
  const removed = await removeIsolatedHome(tempHome, { exited, keep })
  return { exited, removed, tempHome }
}

async function runCapturedCommand(invocation, args, options) {
  const child = spawnCrossPlatform(invocation.bin, [...invocation.prefixArgs, ...args], {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let settled = false
  child.stdout.on('data', chunk => { stdout += chunk.toString() })
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      void terminateProcessTree(child, 1000).finally(() => {
        if (settled) resolve(null)
        else reject(new Error(`Command timed out after ${options.timeoutMs}ms: ${invocation.bin}`))
      })
    }, options.timeoutMs)
  })
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => resolve(code))
  })
  try {
    const code = await Promise.race([closed, timeout])
    settled = true
    if (code !== 0) {
      throw new Error(
        `Command failed (exit ${code}): ${invocation.bin} ${[...invocation.prefixArgs, ...args].join(' ')}\n` +
        `STDOUT:\n${redactForLog(stdout)}\nSTDERR:\n${redactForLog(stderr)}`,
      )
    }
    return { stdout, stderr }
  } finally {
    clearTimeout(timer)
    settled = true
  }
}

async function readStartupLogs(tempHome) {
  const logsDir = path.join(tempHome, 'logs')
  if (!existsSync(logsDir)) return ''
  try {
    const files = (await fs.readdir(logsDir)).filter(name => name.startsWith('startup-')).sort()
    if (files.length === 0) return ''
    const body = await fs.readFile(path.join(logsDir, files[files.length - 1]), 'utf8')
    return `\n--- Startup diagnostic ---\n${redactForLog(body.slice(0, 4000))}`
  } catch {
    return ''
  }
}

function cleanPrintedUrl(raw) {
  return String(raw).trim().replace(/[)\].,;>'"]+$/u, '')
}

export function launchUrlForCookieExchange(raw, expectedPort) {
  let url
  try { url = new URL(cleanPrintedUrl(raw)) } catch { throw new Error('Refusing dsh web launch URL: not a URL.') }
  if (url.username || url.password) throw new Error('Refusing dsh web launch URL: embedded credentials.')
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Refusing dsh web launch URL: protocol must be http or https.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!LOOPBACK_HOSTS.has(host)) throw new Error('Refusing dsh web launch URL: host is not a loopback address.')
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  if (port !== String(expectedPort)) throw new Error('Refusing dsh web launch URL: port does not match the isolated listener.')
  if (!url.searchParams.get('token')) throw new Error('Refusing dsh web launch URL: missing token query parameter.')
  url.hostname = 'localhost'
  return url.toString()
}

export function selectLaunchUrl(output, expectedPort) {
  const re = /dsh web:\s+(https?:\/\/\S+)/gi
  for (const match of String(output).matchAll(re)) {
    try { return launchUrlForCookieExchange(match[1], expectedPort) } catch { /* a later line may be the real URL */ }
  }
  return null
}

export function cleanBaseUrl(launchUrl) {
  const url = new URL(launchUrl)
  url.search = ''
  url.hash = ''
  url.pathname = '/'
  return url.toString()
}

export function recordingStorageState(storageState) {
  const cookies = (storageState?.cookies ?? []).filter(cookie =>
    cookie
    && typeof cookie.name === 'string'
    && cookie.name.startsWith('dsh-auth-')
    && cookie.httpOnly === true
    && typeof cookie.value === 'string'
    && cookie.value.length > 0,
  )
  if (cookies.length === 0) throw new Error('Auth exchange did not set an HttpOnly dsh-auth-* cookie. Refusing to record.')
  return { cookies, origins: [] }
}

export function isPluginOrApiUrl(raw) {
  try {
    const pathname = new URL(raw).pathname
    return pathname === '/api' || pathname.startsWith('/api/')
      || pathname === '/plugins' || pathname.startsWith('/plugins/')
  } catch {
    return false
  }
}

export function urlHasLaunchToken(raw) {
  try { return new URL(raw).searchParams.has('token') } catch { return /[?&#]token=/i.test(String(raw)) }
}

export function acceptanceProblems({ pageUrl, diagnostics }) {
  const problems = []
  if (urlHasLaunchToken(pageUrl)) problems.push('Token leak detected in the current URL.')
  const pageErrors = diagnostics?.pageErrors ?? []
  if (pageErrors.length > 0) problems.push(`Uncaught pageerror(s):\n${pageErrors.join('\n')}`)
  const httpErrors = diagnostics?.httpErrors ?? []
  if (httpErrors.length > 0) {
    problems.push(`HTTP error(s) on /api or /plugins:\n${httpErrors.map(entry => `${entry.status} ${entry.url}`).join('\n')}`)
  }
  return problems
}

export function assertAcceptanceClean(input) {
  const problems = acceptanceProblems(input)
  if (problems.length > 0) throw new Error(problems.join('\n\n'))
}

export function notePageError(diagnostics, err) {
  diagnostics.pageErrors.push(redactForLog(err?.stack || err?.message || String(err)))
}

export function noteHttpError(diagnostics, status, url) {
  if (status >= 400 && isPluginOrApiUrl(url)) {
    diagnostics.httpErrors.push({ status, url: redactForLog(url) })
  }
}

export async function pickFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, host, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server.close(err => {
        if (err) reject(err)
        else if (!port) reject(new Error('Failed to allocate a loopback port.'))
        else resolve(port)
      })
    })
  })
}

function spawnDshWeb({ invocation, dshCwd, profile, port, patches, env }) {
  const publicUrl = `http://localhost:${port}/`
  const args = [
    ...invocation.prefixArgs,
    '--profile', profile,
    ...patches.flatMap(patch => ['--patch', patch]),
    '--no-open',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--public-url', publicUrl,
    '--trusted-host', `localhost:${port}`,
    '--trusted-host', 'localhost',
  ]
  return spawnCrossPlatform(invocation.bin, args, { cwd: dshCwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
}

export function waitForDshReady(child, { port, bootTimeoutMs, tempHome }) {
  return new Promise((resolve, reject) => {
    let combined = ''
    let settled = false
    let timer
    function finish(error, value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('error', onError)
      child.off('close', onClose)
      if (error) reject(error)
      else resolve(value)
    }
    function onChunk(chunk) {
      if (settled) return
      combined += chunk.toString()
      const selected = selectLaunchUrl(combined, port)
      if (selected) {
        finish(null, selected)
        return
      }
      if (combined.length > 200_000) combined = combined.slice(-200_000)
    }
    function onError(err) { finish(err) }
    async function onClose(code) {
      const diag = tempHome ? await readStartupLogs(tempHome) : ''
      finish(new Error(`dsh web exited prematurely with code ${code}.\nOutput:\n${redactForLog(combined)}${diag}`))
    }
    timer = setTimeout(() => {
      void (async () => {
        const diag = tempHome ? await readStartupLogs(tempHome) : ''
        finish(new Error(
          `Timed out after ${bootTimeoutMs}ms waiting for a loopback "dsh web:" launch URL.\n` +
          `Output so far:\n${redactForLog(combined)}${diag}`,
        ))
      })()
    }, bootTimeoutMs)
    if (!child.stdout || !child.stderr) {
      finish(new Error('dsh web was started without pipes, so its launch URL cannot be read.'))
      return
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.once('error', onError)
    child.once('close', onClose)
  })
}

async function loadPlaywrightChromium() {
  for (const specifier of ['playwright', 'playwright-core', '@playwright/test']) {
    try {
      const mod = await import(specifier)
      if (mod.chromium) return mod.chromium
    } catch { /* try the next package */ }
  }
  for (const candidate of [
    path.join(process.cwd(), 'node_modules', 'playwright', 'index.mjs'),
    path.join(process.cwd(), 'node_modules', 'playwright-core', 'index.mjs'),
  ]) {
    if (!existsSync(candidate)) continue
    const mod = await import(pathToFileURL(candidate).href)
    if (mod.chromium) return mod.chromium
  }
  throw new Error('Playwright was not found. Install playwright before running UI capture.')
}

async function launchBrowserWithFallback(chromium) {
  const attempts = [
    { label: 'bundled-chromium', opts: { headless: true } },
    { label: 'msedge', opts: { headless: true, channel: 'msedge' } },
    { label: 'chrome', opts: { headless: true, channel: 'chrome' } },
  ]
  const errors = []
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch(attempt.opts)
      return { browser, channelUsed: attempt.label }
    } catch (err) {
      errors.push(`${attempt.label}: ${String(err.message || err).split('\n')[0]}`)
    }
  }
  throw new Error(`Unable to launch any Chromium browser:\n${errors.join('\n')}`)
}

export function prepareBrowserEnv() {
  delete process.env.PWDEBUG
  if (process.env.DEBUG && /playwright|pw:/i.test(process.env.DEBUG)) delete process.env.DEBUG
}

function hasCommand(cmd, checkArgs = ['-version']) {
  return spawnSync(cmd, checkArgs, { stdio: 'ignore', windowsHide: true }).status === 0
}

export async function convertVideoToGifWithFfmpeg(inputVideo, outputGif, { fps = 12, width = 1280, trimStartSec = 0 } = {}) {
  const safeFps = requireInteger('gif fps', fps, { min: 1, max: 60 })
  const safeWidth = requireInteger('gif width', width, { min: 1, max: 4096 })
  if (!Number.isFinite(trimStartSec) || trimStartSec < 0) throw new Error('GIF trim start must be a non-negative number.')
  const palettePath = `${outputGif}.palette.png`
  const trimArgs = trimStartSec > 0 ? ['-ss', trimStartSec.toFixed(2)] : []
  const scaleFilter = `fps=${safeFps},scale='min(${safeWidth},iw)':-1:flags=lanczos`
  try {
    const pass1 = spawnSync('ffmpeg', ['-y', ...trimArgs, '-i', inputVideo, '-vf', `${scaleFilter},palettegen=stats_mode=diff:max_colors=256`, palettePath], { encoding: 'utf8', windowsHide: true })
    if (pass1.status !== 0) throw new Error(`ffmpeg palettegen failed: ${redactForLog(pass1.stderr || '')}`)
    const pass2 = spawnSync('ffmpeg', ['-y', ...trimArgs, '-i', inputVideo, '-i', palettePath, '-lavfi', `${scaleFilter} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0', outputGif], { encoding: 'utf8', windowsHide: true })
    if (pass2.status !== 0) throw new Error(`ffmpeg paletteuse failed: ${redactForLog(pass2.stderr || '')}`)
  } finally {
    await fs.rm(palettePath, { force: true }).catch(() => {})
  }
}

export async function convertFramesToGifFallback(frames, outputGif, { width = 1280 } = {}) {
  if (!frames || frames.length === 0) throw new Error('No frames captured for fallback GIF generation.')
  const safeWidth = requireInteger('gif width', width, { min: 1, max: 4096 })
  const manifestPath = `${outputGif}.frames.json`
  await fs.writeFile(manifestPath, JSON.stringify({ frames, outputGif, width: safeWidth }), 'utf8')
  const pyScript = `
import json, sys
from PIL import Image
cfg = json.load(open(sys.argv[1], 'r', encoding='utf-8'))
frames_meta = cfg['frames']
out_path = cfg['outputGif']
max_w = int(cfg['width'])
pil_frames = []
durations = []
for item in frames_meta:
    im = Image.open(item['path']).convert('RGB')
    if im.width > max_w:
        new_h = max(1, round(im.height * (max_w / im.width)))
        im = im.resize((max_w, new_h), Image.Resampling.LANCZOS)
    q = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    pil_frames.append(q)
    durations.append(max(40, int(item.get('durationMs', 500))))
pil_frames[0].save(out_path, save_all=True, append_images=pil_frames[1:], duration=durations, loop=0, optimize=True)
`
  try {
    for (const pyBin of ['python3', 'python']) {
      const res = spawnSync(pyBin, ['-c', pyScript, manifestPath], { encoding: 'utf8', windowsHide: true })
      if (res.status === 0 && existsSync(outputGif)) return { encoder: `${pyBin}:Pillow` }
    }
    throw new Error('Neither ffmpeg nor Python Pillow is available on PATH to encode GIF. Install ffmpeg (recommended) or pip install pillow.')
  } finally {
    await fs.rm(manifestPath, { force: true }).catch(() => {})
  }
}

function getGitHeadCommit(cwd) {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', windowsHide: true })
  return res.status === 0 ? res.stdout.trim() : null
}

export function checkoutRootsFor(dirs) {
  const roots = []
  for (const cwd of dirs) {
    if (!cwd) continue
    const top = gitToplevel(cwd)
    if (top && !roots.includes(top)) roots.push(top)
  }
  return roots
}

export function assertOutsideCheckouts(target, roots) {
  for (const root of roots) {
    if (root && isInsideDir(root, target)) {
      throw new Error(`Refusing to write QA output inside the git checkout (${root}). Pass --out-dir outside the repository.`)
    }
  }
}

export function resolveArtifactPath(outDir, name, checkoutRoots = []) {
  const outRoot = path.resolve(outDir)
  const resolved = path.isAbsolute(name) ? path.resolve(name) : path.resolve(outRoot, name)
  if (!path.isAbsolute(name)) {
    const rel = path.relative(outRoot, resolved)
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error('Refusing an output filename that escapes the output directory.')
    }
  }
  assertOutsideCheckouts(resolved, checkoutRoots)
  return resolved
}

function gitStatusLines(cwd) {
  const res = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', windowsHide: true })
  if (res.status !== 0) return []
  return res.stdout.trim().split('\n').filter(Boolean)
}

async function closeQuietly(closable) {
  if (!closable) return
  await Promise.race([
    closable.close().catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 10_000)),
  ])
}

export async function runIsolatedAcceptance(opts) {
  validateOpts(opts)
  const pluginsRoot = opts.pluginsRoot || path.join(workspaceRootFrom(opts.dshCwd), 'plugins')
  const closure = resolvePluginClosure(opts.pluginSpecs, { cwd: opts.dshCwd, pluginsRoot })
  for (const item of closure) assertPluginBuilt(item.dir, item.manifest)
  const checkoutRoots = checkoutRootsFor([opts.dshCwd, ...closure.map(item => item.dir)])
  assertOutsideCheckouts(opts.outDir, checkoutRoots)
  await fs.mkdir(opts.outDir, { recursive: true })
  let tempHome = null
  let dshChild = null
  let browser = null
  let context = null
  const diagnostics = { pageErrors: [], consoleErrors: [], httpErrors: [] }
  const capturedFrames = []
  const screenshots = []
  const dirtyBefore = new Set(gitStatusLines(opts.dshCwd))

  try {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-qa-home-'))
    try {
      assertOutsideCheckouts(tempHome, checkoutRoots)
      const rawVideoDir = path.join(tempHome, 'raw-video')
      const framesDir = path.join(tempHome, 'frames')
      await fs.mkdir(rawVideoDir, { recursive: true })
      await fs.mkdir(path.join(tempHome, 'agents-home'), { recursive: true })
      await fs.mkdir(framesDir, { recursive: true })
      const env = sealIsolatedEnv(buildIsolatedEnv(tempHome, opts.allowEnv), tempHome)
      await fs.writeFile(env.npm_config_userconfig, 'fund=false\naudit=false\n')
      const invocation = resolveDshInvocation(opts)
      const mounts = await materializePluginMounts(closure, tempHome)
      for (const mount of mounts) {
        console.log(`[dsh-qa] Linking ${mount.manifest.name} from the workspace checkout into the isolated profile.`)
        await runCapturedCommand(invocation, pluginAddArguments(opts.profile, mount.mountDir), {
          cwd: opts.dshCwd,
          env,
          timeoutMs: opts.commandTimeoutMs,
        })
      }

      const port = await pickFreePort('127.0.0.1')
      console.log(`[dsh-qa] Booting isolated dsh web on localhost:${port}.`)
      dshChild = spawnDshWeb({
        invocation,
        dshCwd: opts.dshCwd,
        profile: opts.profile,
        port,
        patches: opts.patches,
        env,
      })
      const launchUrl = await waitForDshReady(dshChild, { port, bootTimeoutMs: opts.bootTimeoutMs, tempHome })
      const baseUrl = cleanBaseUrl(launchUrl)
      console.log(`[dsh-qa] Ready: ${redactTokens(launchUrl)}`)

      prepareBrowserEnv()
      const chromium = await loadPlaywrightChromium()
      const launched = await launchBrowserWithFallback(chromium)
      browser = launched.browser
      const ffmpegAvailable = hasCommand('ffmpeg', ['-version'])
      const authProbeCtx = await browser.newContext({
        viewport: { width: opts.viewportWidth, height: opts.viewportHeight },
        deviceScaleFactor: 2,
        locale: opts.locale,
        colorScheme: opts.colorScheme,
      })
      try {
        const authPage = await authProbeCtx.newPage()
        await authPage.goto(launchUrl, { waitUntil: 'domcontentloaded' })
        await authPage.waitForURL(url => !url.searchParams.has('token'), { timeout: 15_000 })
        if (urlHasLaunchToken(authPage.url())) throw new Error('Security check failed: token query parameter is still visible after auth exchange.')
        const storageState = recordingStorageState(await authProbeCtx.storageState())
        await authProbeCtx.close()

        const videoWidth = Math.min(opts.viewportWidth, opts.gifWidth)
        const videoHeight = Math.max(1, Math.round(opts.viewportHeight * (videoWidth / opts.viewportWidth)))
        context = await browser.newContext({
          storageState,
          viewport: { width: opts.viewportWidth, height: opts.viewportHeight },
          deviceScaleFactor: 2,
          locale: opts.locale,
          colorScheme: opts.colorScheme,
          ...(opts.recordGif && ffmpegAvailable
            ? { recordVideo: { dir: rawVideoDir, size: { width: videoWidth, height: videoHeight } } }
            : {}),
        })
        const page = await context.newPage()
        const recordStartMs = Date.now()
        page.on('pageerror', err => notePageError(diagnostics, err))
        page.on('console', msg => { if (msg.type() === 'error') diagnostics.consoleErrors.push(redactForLog(msg.text())) })
        page.on('response', res => noteHttpError(diagnostics, res.status(), res.url()))
        await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30_000 }).catch(async () => {
          await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        })
        if (urlHasLaunchToken(page.url())) throw new Error('Security check failed: token query parameter is still visible in page URL.')
        await page.waitForFunction(
          () => !document.body || !/loading plugins/i.test(document.body.innerText || ''),
          { timeout: 20_000 },
        ).catch(() => {})
        const uiReadyElapsedSec = Math.max(0, (Date.now() - recordStartMs) / 1000 - 0.15)
        const assertClean = () => assertAcceptanceClean({ pageUrl: page.url(), diagnostics })
        const captureFrame = async (durationMs = 500) => {
          const framePath = path.join(framesDir, `frame-${String(capturedFrames.length).padStart(4, '0')}.png`)
          await page.screenshot({ path: framePath, fullPage: false })
          capturedFrames.push({ path: framePath, durationMs })
          return framePath
        }
        const screenshot = async (name = opts.screenshotName, screenshotOpts = {}) => {
          const outPath = resolveArtifactPath(opts.outDir, name, checkoutRoots)
          await fs.mkdir(path.dirname(outPath), { recursive: true })
          await page.screenshot({ path: outPath, fullPage: false, ...screenshotOpts })
          screenshots.push(outPath)
          return outPath
        }

        if (opts.scenarioPath) {
          const scenarioMod = await import(pathToFileURL(opts.scenarioPath).href)
          const fn = scenarioMod.run || scenarioMod.default
          if (typeof fn !== 'function') throw new Error(`Scenario file ${opts.scenarioPath} must export an async run(ctx) function.`)
          if (opts.recordGif && !ffmpegAvailable) await captureFrame(500)
          await fn({ page, context, baseUrl, outDir: opts.outDir, screenshot, captureFrame, assertClean, diagnostics })
          if (opts.recordGif && !ffmpegAvailable) await captureFrame(opts.settleMs)
        } else {
          if (opts.waitSelector) await page.locator(opts.waitSelector).first().waitFor({ state: 'visible', timeout: 15_000 })
          if (opts.recordGif && !ffmpegAvailable) await captureFrame(600)
          for (const sel of opts.clickSelectors) {
            await page.locator(sel).first().click()
            await page.waitForTimeout(550)
            if (opts.recordGif && !ffmpegAvailable) await captureFrame(600)
          }
          await screenshot(opts.screenshotName)
          if (opts.recordGif && !ffmpegAvailable) await captureFrame(opts.settleMs)
        }
        await page.waitForTimeout(opts.settleMs)
        assertClean()
        const video = page.video()
        await context.close()
        context = null

        let gifPath = null
        let gifEncoder = null
        if (opts.recordGif) {
          gifPath = resolveArtifactPath(opts.outDir, opts.gifName, checkoutRoots)
          await fs.mkdir(path.dirname(gifPath), { recursive: true })
          if (ffmpegAvailable && video) {
            const webmPath = await video.path()
            await convertVideoToGifWithFfmpeg(webmPath, gifPath, { fps: opts.gifFps, width: opts.gifWidth, trimStartSec: uiReadyElapsedSec })
            gifEncoder = 'ffmpeg:palettegen+paletteuse'
          } else {
            gifEncoder = (await convertFramesToGifFallback(capturedFrames, gifPath, { width: opts.gifWidth })).encoder
          }
        }

        const dirtyAfter = gitStatusLines(opts.dshCwd)
        const introduced = dirtyAfter.filter(line => !dirtyBefore.has(line))
        if (introduced.length > 0) throw new Error(`QA wrote into the git checkout:\n${introduced.join('\n')}`)
        const report = {
          ok: true,
          commit: getGitHeadCommit(opts.dshCwd),
          browserChannel: launched.channelUsed,
          viewport: `${opts.viewportWidth}x${opts.viewportHeight}`,
          locale: opts.locale,
          colorScheme: opts.colorScheme,
          plugins: mounts.map(item => ({ name: item.manifest.name, dir: item.dir })),
          scenario: opts.scenarioPath ? path.basename(opts.scenarioPath) : null,
          outDir: opts.outDir,
          screenshots,
          gifPath,
          gifEncoder,
          diagnostics,
          gitDirtyEntries: dirtyAfter,
        }
        const reportPath = path.join(opts.outDir, 'qa-report.json')
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
        console.log(`[dsh-qa] Completed. Report written to ${reportPath}`)
        if (gifPath) console.log(`[dsh-qa] GIF saved to ${gifPath} (${gifEncoder})`)
        return report
      } finally {
        await authProbeCtx.close().catch(() => {})
      }
    } catch (err) {
      const wrapped = new Error(redactForLog(err?.stack || err?.message || String(err)))
      wrapped.cause = err
      throw wrapped
    }
  } finally {
    await closeQuietly(context)
    context = null
    await closeQuietly(browser)
    browser = null
    const released = tempHome
      ? await releaseIsolatedHome(tempHome, dshChild, { keep: opts.keepTempHome })
      : { exited: true, removed: true, tempHome: null }
    if (!released.exited) console.error(`[dsh-qa] Left temporary DSH_HOME in place because dsh is still running: ${tempHome}`)
    else if (opts.keepTempHome && tempHome) console.log(`[dsh-qa] Retained temporary DSH_HOME at ${tempHome}`)
    else if (!released.removed) console.error(`[dsh-qa] Could not delete temporary DSH_HOME at ${tempHome}`)
  }
}

function invokedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  try { return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url)) } catch { return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url)) }
}

if (invokedAsCli()) {
  try {
    const opts = parseArgs(process.argv.slice(2))
    if (opts.help) {
      printHelp()
      process.exit(0)
    }
    await runIsolatedAcceptance(opts)
  } catch (err) {
    console.error(`[dsh-qa] ERROR: ${redactForLog(err?.stack || err?.message || String(err))}`)
    process.exit(1)
  }
}
