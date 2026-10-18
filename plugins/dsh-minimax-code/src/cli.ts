import { access, readFile, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, dirname, extname, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { Ajv, type ValidateFunction } from 'ajv'
import { cliEnvironment, runCli, type CliExecutable } from '@klarkxy/dsh-plugin-kit/cli-process'
import { MiniMaxCodeError, type Settings } from './contracts.ts'

export const CONNECTORS = {
  generate_image: 'connector__matrix__generate_image',
  search_images: 'connector__matrix__search_images',
  reverse_image_search: 'connector__matrix__reverse_image_search',
  generate_video: 'connector__matrix__submit_video_generation',
  video_status: 'connector__matrix__query_video_generation',
  list_voices: 'connector__matrix__get_voice_list',
  synthesize_speech: 'connector__matrix__synthesize_speech',
  batch_speech: 'connector__matrix__batch_text_to_audio',
  transcribe_audio: 'connector__matrix__listen_audio',
  understand_audio: 'connector__matrix__audios_understand',
  understand_video: 'connector__matrix__videos_understand',
} as const
export type ConnectorCapability = keyof typeof CONNECTORS
export type ConnectorSchema = { tool_name: string; input_schema: Record<string, unknown>; output_schema?: Record<string, unknown> | null }
const requiredProperties: Record<ConnectorCapability, string[]> = {
  generate_image: ['requests'], search_images: ['queries'], reverse_image_search: ['image_url'],
  generate_video: ['prompt', 'model'], video_status: ['task_id', 'model'], list_voices: [],
  synthesize_speech: ['text'], batch_speech: ['requests'], transcribe_audio: ['audio_info'],
  understand_audio: ['audio_info'], understand_video: ['video_info'],
}
const fail = (code: string, message: string) => new MiniMaxCodeError(code, message)
// Broker credentials are obtained by the signed-in CLI, never inherited from Harness.
export const minimaxEnvironment = () => cliEnvironment(process.env, ['MINIMAX_DATA_DIR', 'MAVIS_DATA_DIR', 'MCODE_HOME', 'MCODE_CONFIG_DIR'])

/** Parse the official generated Windows launcher as data; never invoke a command shell. */
export async function managedLauncher(path: string): Promise<CliExecutable> {
  const content = await readFile(path, 'utf8')
  if (content.length > 32_768) throw fail('unsupported-launcher', 'The MiniMax tools launcher is not supported.')
  const env = minimaxEnvironment()
  let command: string | undefined, script: string | undefined
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /^@?echo off$/i.test(line) || /^setlocal DisableDelayedExpansion$/i.test(line) || /^exit \/b %ERRORLEVEL%$/i.test(line)) continue
    const clearPrefix = /^for \/f "tokens=1 delims==" %%V in \('set (__MAVIS_PARENT_|__MAVIS_RUNTIME_|AGENTARCHON_|AGENT_ARCHON_) 2\^>nul'\) do set "%%V="$/.exec(line)
    if (clearPrefix) {
      for (const key of Object.keys(env)) if (key.startsWith(clearPrefix[1])) delete env[key]
      continue
    }
    const assignment = /^set "([A-Z_][A-Z0-9_]*)=([^"\r\n]*)"$/i.exec(line)
    if (assignment) {
      const [, key, value] = assignment
      if (!/^(?:MCODE_[A-Z0-9_]+|MAVIS_[A-Z0-9_]+|MINIMAX_DATA_DIR|ELECTRON_RUN_AS_NODE|IS_SANDBOX|__MAVIS_[A-Z0-9_]+)$/.test(key) || /[%!]/.test(value)) throw fail('unsupported-launcher', 'The MiniMax tools launcher contains unsupported environment settings.')
      if (value) env[key] = value; else delete env[key]
      continue
    }
    const launch = /^"([^"\r\n]+)" "([^"\r\n]+)" %\*$/.exec(line)
    if (launch && !command) { command = launch[1]; script = launch[2]; continue }
    throw fail('unsupported-launcher', 'Use the official regional mcode-tools launcher or its JavaScript entry.')
  }
  if (!command || !script || !/\.(?:mjs|js)$/i.test(script) || /[%!]/.test(command + script)) throw fail('unsupported-launcher', 'The MiniMax tools launcher is incomplete.')
  await access(command, constants.R_OK); await access(script, constants.R_OK)
  // The official child, not this plugin, reads broker capabilities and obtains its token lease.
  return { command, args: [script], env, displayPath: path }
}
async function resolveExecutable(path: string, kind: 'tools' | 'code'): Promise<CliExecutable> {
  const canonical = await realpath(path)
  if (!(await stat(canonical)).isFile()) throw fail('unavailable', 'The CLI path is not a file.')
  if (/\.(?:cmd|ps1)$/i.test(canonical)) {
    if (kind === 'tools' && /mcode-tools-(?:cn|global)\.cmd$/i.test(canonical)) return managedLauncher(canonical)
    const js = join(dirname(canonical), 'node_modules', '@minimax-ai', 'code', kind === 'tools' ? 'mcode-tools.js' : 'cli.js')
    try { await access(js, constants.R_OK); return { command: process.execPath, args: [js], env: minimaxEnvironment(), displayPath: canonical } }
    catch { throw fail('unsupported-launcher', 'This CLI launcher is unsupported or stale. Select the official JavaScript entry or regional mcode-tools launcher.') }
  }
  if (/\.[cm]?js$/i.test(canonical)) return { command: process.execPath, args: [canonical], env: minimaxEnvironment(), displayPath: canonical }
  await access(canonical, process.platform === 'win32' ? constants.R_OK : constants.X_OK)
  return { command: canonical, env: minimaxEnvironment(), displayPath: canonical }
}
export async function discoverCli(settings: Settings, kind: 'tools' | 'code'): Promise<CliExecutable> {
  const explicit = kind === 'tools' ? settings.toolsExecutable : settings.codeExecutable
  if (explicit) return resolveExecutable(resolve(explicit), kind)
  const candidates: string[] = [], paths = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  if (kind === 'tools') {
    for (const root of [join(homedir(), '.minimax', 'bin'), join(homedir(), '.minimax-code', 'bin'), ...paths]) {
      if (process.platform === 'win32') {
        const regions = settings.region === 'auto' ? ['cn', 'global'] : [settings.region]
        const found: string[] = []
        for (const region of regions) { const path = join(root, `mcode-tools-${region}.cmd`); try { await access(path); found.push(path) } catch { /* absent */ } }
        if (found.length > 1) throw fail('region-required', 'Both MiniMax regions are installed. Choose the account region in this plugin’s settings.')
        candidates.push(...found)
      } else candidates.push(join(root, 'mcode-tools'))
    }
  }
  const name = kind === 'tools' ? 'mcode-tools' : 'mcode'
  for (const root of [join(homedir(), '.minimax-code'), join(homedir(), '.minimax-code', 'bin'), ...paths]) candidates.push(...(process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`] : [name]).map(file => join(root, file)))
  for (const candidate of candidates) { try { return await resolveExecutable(candidate, kind) } catch { /* optional installation */ } }
  throw fail('unavailable', kind === 'tools' ? 'MiniMax Code media tools were not found. Start the official signed-in MiniMax Code host or select its mcode-tools launcher.' : 'The official mcode CLI was not found. Install it or select its cli.js entry to enable web search.')
}
export function parseCliJson(text: string): any {
  try {
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object') throw new Error()
    return value
  } catch { throw fail('invalid-output', 'The MiniMax CLI returned invalid JSON.') }
}
export function cliFailure(stderr: string): MiniMaxCodeError {
  if (/broker is unavailable|BROKER_UNAVAILABLE/i.test(stderr)) return fail('host-required', 'Open the signed-in MiniMax Code host, then refresh the connection.')
  if (/authenticat|login|sign.in|credential|token.*(?:expired|invalid)/i.test(stderr)) return fail('login-required', 'Sign in through official MiniMax Code, then refresh the connection.')
  if (/credit|quota|balance|insufficient|额度|余额/i.test(stderr)) return fail('quota', 'MiniMax reports insufficient quota or credits for this operation.')
  return fail('cli-failed', 'The MiniMax CLI failed. No generation request was retried.')
}
export type CliDeps = { discover?: typeof discoverCli; run?: typeof runCli }
export class MiniMaxCli {
  constructor(private settings: Settings, private deps: CliDeps = {}) {}
  private async json(args: string[], signal: AbortSignal, input?: unknown, cwd = tmpdir()): Promise<any> {
    const exe = await (this.deps.discover ?? discoverCli)(this.settings, 'tools')
    const result = await (this.deps.run ?? runCli)(exe, args, { cwd, signal, timeoutMs: this.settings.timeoutMs, ...(input === undefined ? {} : { input: JSON.stringify(input) }) })
    if (result.exitCode !== 0) throw cliFailure(result.stderr)
    return parseCliJson(result.stdout)
  }
  async status(signal: AbortSignal): Promise<{ executable: string; version: string; authenticated: boolean }> {
    const exe = await (this.deps.discover ?? discoverCli)(this.settings, 'tools')
    const version = await (this.deps.run ?? runCli)(exe, ['--version'], { cwd: tmpdir(), signal, timeoutMs: 30_000 })
    if (version.exitCode !== 0) throw cliFailure(version.stderr)
    const auth = await this.json(['auth', 'status', '--json'], signal)
    return { executable: exe.displayPath, version: version.stdout.trim().slice(0, 100), authenticated: auth.status === 'authenticated' && auth.auth_mode === 'shared-broker' }
  }
  async schema(capability: ConnectorCapability, signal: AbortSignal): Promise<ConnectorSchema> {
    if (!Object.hasOwn(CONNECTORS, capability)) throw fail('unsupported-capability', 'This connector capability is not supported.')
    const name = CONNECTORS[capability]
    if (!name) throw fail('unsupported-capability', 'This connector capability is not supported.')
    const result = await this.json(['connector', 'tool', name], signal)
    const schema = result?.input_schema
    if (result.tool_name !== name || !schema || schema.type !== 'object' || requiredProperties[capability].some(key => !schema.properties?.[key])) throw fail('unsupported-schema', `The MiniMax ${capability} schema is incompatible.`)
    return result as ConnectorSchema
  }
  async call(capability: ConnectorCapability, args: Record<string, unknown>, signal: AbortSignal, cwd?: string): Promise<any> {
    const schema = await this.schema(capability, signal)
    let validate: ValidateFunction
    try { validate = new Ajv({ strict: false, allErrors: false, validateFormats: false }).compile(schema.input_schema) }
    catch { throw fail('unsupported-schema', 'The MiniMax tool schema cannot be validated.') }
    if (!validate(args)) throw fail('bad-request', `MiniMax parameters do not match its current tool schema: ${validate.errors?.[0]?.instancePath || '/'} ${validate.errors?.[0]?.message || ''}`)
    return this.json(['connector', 'call', CONNECTORS[capability], '--args-file', '-'], signal, args, cwd)
  }
  async upload(path: string, mediaType: string, signal: AbortSignal, videoReference = false): Promise<{ url: string; mimeType: string; durationSeconds?: number }> {
    const result = await this.json(['upload-temp-url', path, '--mime-type', mediaType, ...(videoReference ? ['--video-reference'] : [])], signal)
    if (typeof result.temp_url !== 'string' || !result.temp_url.startsWith('https://')) throw fail('upload-failed', 'MiniMax did not return a temporary media URL.')
    if (videoReference && (!Number.isInteger(result.reference_video?.duration_seconds) || result.reference_video.duration_seconds < 2 || result.reference_video.duration_seconds > 15)) throw fail('invalid-media', 'MiniMax did not verify the reference video duration.')
    return { url: result.temp_url, mimeType: mediaType, ...(videoReference ? { durationSeconds: result.reference_video.duration_seconds } : {}) }
  }
  async assetUrl(id: string, signal: AbortSignal): Promise<string> {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw fail('invalid-output', 'MiniMax returned an invalid asset identifier.')
    const result = await this.json(['get-asset-url', id], signal)
    if (typeof result.download_url !== 'string') throw fail('download-failed', 'MiniMax did not return a download URL.')
    return result.download_url
  }
}
