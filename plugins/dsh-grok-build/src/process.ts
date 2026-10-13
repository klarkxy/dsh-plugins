import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { insideDirectory } from '@klarkxy/dsh-plugin-kit/cli-media'
import { runCli, type CliExecutable } from '@klarkxy/dsh-plugin-kit/cli-process'
import { GrokBuildError, type Capability } from './contracts.ts'

export const NATIVE_TOOLS = {
  search: 'web_search', fetch: 'web_fetch', generate_image: 'image_gen', edit_image: 'image_edit',
  image_to_video: 'image_to_video', reference_to_video: 'reference_to_video',
} as const satisfies Record<Capability, string>
const MINIMUM = [1, 0, 50]
const COMPAT = ['claude', 'cursor', 'codex'] as const
const COMPAT_SURFACES = ['skills', 'rules', 'agents', 'mcps', 'hooks'] as const

export type InspectReport = {
  version: string
  plugins: { name: string; scope: string; path: string }[]
  skills: { name: string; path: string; disabled: boolean; source: string }[]
  servers: { name: string; disabled: boolean; source: string }[]
  instructions: { path: string; status: string }[]
  layers: string[]
  warnings?: string[]
}
export type ChildEnv = { home: string; authPath: string; env: NodeJS.ProcessEnv }

export function parseVersion(text: string): number[] {
  const match = text.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) throw new GrokBuildError('unsupported-runtime', '无法识别 Grok Build 版本。')
  return match.slice(1, 4).map(Number)
}
export function versionAccepted(version: number[]): boolean {
  // Unknown --tools names fall back to the full toolset in the native CLI.
  // Only this verified protocol profile may reach paid execution.
  return version.length === MINIMUM.length && version.every((part, index) => part === MINIMUM[index])
}
export function nativeTool(capability: Capability): string {
  const tool = NATIVE_TOOLS[capability]
  if (!Object.values(NATIVE_TOOLS).includes(tool)) throw new GrokBuildError('incompatible', '该能力没有已验证的原生工具。')
  return tool
}

/** JSON basic strings use the same escapes as TOML basic strings. */
export function tomlString(value: string): string {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new GrokBuildError('incompatible', '隔离配置包含不受支持的路径。')
  return JSON.stringify(value)
}
export function tomlArray(values: string[]): string {
  return `[\n${[...new Set(values)].map(value => `  ${tomlString(value)}`).join(',\n')}\n]`
}
export function pluginId(scope: string, root: string, name: string): string {
  const hex = createHash('sha256').update(Buffer.from(root)).digest('hex').slice(0, 8)
  return `${scope}/${hex}/${name}`
}

export function isolationConfig(report: InspectReport): string {
  const ids = report.plugins.flatMap(plugin => [plugin.name, pluginId(plugin.scope || 'user', plugin.path, plugin.name)])
  const skillNames = report.skills.map(skill => skill.name)
  const roots = report.skills.map(skill => skill.path ? dirname(skill.path) : '').filter(Boolean)
  const compat = COMPAT.map(vendor => [`[compat.${vendor}]`, ...COMPAT_SURFACES.map(surface => `${surface} = false`)].join('\n')).join('\n\n')
  return [
    '# Private per-request home. This file is not the user profile.',
    '[plugins]', `disabled = ${tomlArray(ids)}`, 'enabled = []', '',
    '[skills]', `disabled = ${tomlArray(skillNames)}`, `ignore = ${tomlArray(roots)}`, '',
    '[features]', 'image_gen = true', 'video_gen = true', 'web_fetch = true', '',
    compat, '',
  ].join('\n')
}

export function originalAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.GROK_AUTH_PATH?.trim()
  if (explicit) return resolve(explicit)
  return resolve(env.GROK_HOME?.trim() || join(homedir(), '.grok'), 'auth.json')
}
export function childEnvironment(home: string, authPath: string, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(parent)) {
    if (key === 'GROK_HOME' || key === 'GROK_AUTH_PATH' || key === 'GROK_CONFIG' || key === 'GROK_CONFIG_PATH') continue
    if (key.startsWith('GROK_') || key === 'XAI_API_KEY' || key.endsWith('_API_KEY') || key.endsWith('_BASE_URL')) continue
    env[key] = value
  }
  const flags: Record<string, string> = {
    GROK_HOME: home, GROK_AUTH_PATH: authPath, GROK_MEMORY: '0', GROK_SUBAGENTS: '0', GROK_WORKFLOWS: '0',
    GROK_DISABLE_AUTOUPDATER: '1', GROK_AGENT_DASHBOARD: '0', GROK_FOLDER_TRUST: '1', GROK_BACKEND_SEARCH: '0',
  }
  if (process.platform === 'win32') flags.GROK_SHELL = 'powershell'
  for (const vendor of ['CLAUDE', 'CURSOR', 'CODEX']) {
    for (const surface of ['HOOKS', 'SKILLS', 'MCPS', 'RULES', 'AGENTS']) flags[`GROK_${vendor}_${surface}_ENABLED`] = '0'
  }
  return { ...env, ...flags }
}

export function parseInspect(value: unknown): InspectReport {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const list = (key: string) => Array.isArray(root[key]) ? root[key] as Record<string, unknown>[] : []
  const sourcePath = (source: unknown) => source && typeof source === 'object' ? String((source as { path?: unknown }).path ?? '') : ''
  const sourceType = (source: unknown) => source && typeof source === 'object' ? String((source as { type?: unknown }).type ?? '') : ''
  return {
    version: String(root.grokVersion ?? ''),
    plugins: list('plugins').map(plugin => ({ name: String(plugin.name ?? ''), scope: String(plugin.scope ?? 'user'), path: String(plugin.path ?? '') })).filter(plugin => plugin.name && plugin.path),
    skills: list('skills').map(skill => ({ name: String(skill.name ?? ''), path: sourcePath(skill.source), disabled: skill.disabled === true, source: sourceType(skill.source) })).filter(skill => skill.name),
    servers: list('mcpServers').map(server => ({ name: String(server.name ?? ''), disabled: server.disabled === true, source: sourceType(server.source) })),
    instructions: list('projectInstructions').map(item => ({ path: String(item.path ?? ''), status: String(item.compatibilityStatus ?? '') })),
    layers: ((root.configSources as { layers?: unknown[] } | undefined)?.layers ?? []).map(layer => typeof layer === 'string' ? layer : String((layer as { path?: unknown })?.path ?? '')),
    warnings: list('configWarnings').map(warning => String(warning.message ?? warning.key ?? 'config warning')),
  }
}
export function isolationHolds(report: InspectReport, home: string): string | undefined {
  if (report.warnings?.length) return 'Grok 未能完整读取隔离配置。'
  const externalSkill = report.skills.find(skill => skill.source && skill.source !== 'builtin' && skill.source !== 'bundled' && !skill.disabled)
  if (externalSkill) return `技能 ${externalSkill.name} 在隔离配置后仍然可用。`
  const server = report.servers.find(item => item.name && !item.disabled)
  if (server) return `MCP 服务 ${server.name} 在隔离配置后仍然启用。`
  const instruction = report.instructions.find(item => item.path && item.status !== 'disabled')
  if (instruction) return '隔离进程仍会加载外部项目说明。'
  const leaked = report.layers.find(layer => layer && !insideDirectory(resolve(home), resolve(layer)))
  if (leaked) return '隔离进程读取了私有主目录以外的配置。'
  return
}

export async function discoverGrok(setting: string, env: NodeJS.ProcessEnv = process.env): Promise<CliExecutable> {
  const requested = setting.trim() || env.GROK_EXECUTABLE?.trim() || ''
  const names = process.platform === 'win32' ? ['grok.exe', 'grok.cmd'] : ['grok']
  const candidates = requested ? [requested] : (env.PATH ?? '').split(delimiter).flatMap(dir => names.map(name => join(dir, name)))
  for (const candidate of candidates) {
    try {
      if ((await lstat(candidate)).isFile()) return { command: resolve(candidate), displayPath: resolve(candidate) }
    } catch { /* try the next PATH entry */ }
  }
  throw new GrokBuildError('unavailable', requested ? '配置的 Grok Build 可执行文件不存在。' : '未在 PATH 中找到 Grok Build。')
}

export function gateArgs(tool: string): string[] {
  if (!Object.values(NATIVE_TOOLS).includes(tool as typeof NATIVE_TOOLS[Capability])) throw new GrokBuildError('incompatible', '未验证的原生工具名称。')
  return ['--tools', tool, '--disallowed-tools', 'search_tool,use_tool,Agent', '--deny', 'MCPTool']
}
export function grokArgs(capability: Capability, sessionId: string, cwd: string, prompt: string): string[] {
  const tool = nativeTool(capability)
  return [
    '--cwd', cwd, '--session-id', sessionId, '--output-format', 'streaming-json',
    ...gateArgs(tool),
    '--permission-mode', 'bypassPermissions', '--max-turns', '4', '--no-plan', '--no-subagents',
    '--no-memory', '--verbatim', '--no-auto-update',
    '--system-prompt-override', 'Use only the one named native tool. Do not answer from memory or describe a file you did not receive from that tool.',
    '--prompt-json', JSON.stringify([{ type: 'text', text: prompt }]),
  ]
}

export async function runGrok(executable: CliExecutable, args: string[], env: NodeJS.ProcessEnv, cwd: string, signal: AbortSignal, onLine: ((line: string) => void | Promise<void>) | undefined, timeoutMs: number) {
  const child: CliExecutable = { ...executable, env: { ...env, GROK_WEB_FETCH: args.includes('web_fetch') ? '1' : '0' } }
  return runCli(child, args, { cwd, signal, timeoutMs, onLine })
}
