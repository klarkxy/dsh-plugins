/**
 * Host-side credential file masking and ambient token guards for `@klarkxy/dsh-secret-manager`.
 *
 * Complements `secret://<slot>` reference management with three defense-in-depth layers:
 * 1. Credential file masking (`maskCredentialFiles`):
 *    - Masks host credential files (`.dsh/.credentials.yaml`, cloud CLI configs, package
 *      registry tokens; `git` and `npm` remain opt-in so SSH/gh/npm workflows keep working)
 *      inside Linux `bwrap` sandboxes (`HIDDEN-BY-DSH.txt` bind-mounts) and macOS
 *      `sandbox-exec` Seatbelt profiles (`(deny file-read* ...)`), including WSL
 *      `/mnt/c/Users/*` profiles when present.
 *    - Blocks direct `read`, `read_image`, `write`, `edit`, `open_sidebar`, and `grep`
 *      access to masked paths in `tools/pre-execute`.
 * 2. Pre-execute credential solicitation & raw token guard (`guardToolSecrets`):
 *    - Blocks `ask_user_question` / `ask_view` prompts that ask the user to paste API keys,
 *      tokens, or passwords into chat, steering the model to `request_secret` or `gh`.
 *    - Blocks raw token literals (`github_pat_`, `gh[pousr]_`, `sk-`) in non-secret tool
 *      arguments and `gh auth token` shell extraction in `bash` / `pwsh`.
 * 3. Ambient token pattern redaction (`redactTokenPatterns`):
 *    - Masks `github_pat_*`, `gh[pousr]_*`, and `sk-*` tokens in `tools/post-execute`
 *      (`{ prepend: true }`) before tool results commit to session history.
 *
 * Adapted from `herenfor/dsh-runtime-tuning` (MIT License).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { PluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import {
  ALL_SECRET_MASK_GROUPS,
  DEFAULT_SECRET_MASK_GROUPS,
  type SandboxGuardConfig,
  type SecretMaskGroup,
} from './contracts.ts'
import { SAFE_BLOCK_TEXT } from './redact.ts'

export interface MaskedTarget {
  readonly group: SecretMaskGroup | 'extra'
  readonly path: string
  readonly kind: 'file' | 'dir'
}

export interface SandboxCommandLike {
  readonly argv?: readonly string[]
  readonly [key: string]: unknown
}

export interface SandboxServiceLike {
  confine(command: SandboxCommandLike, options?: unknown): Promise<SandboxCommandLike> | SandboxCommandLike
}

export interface ResolvedSandboxGuardConfig {
  readonly maskCredentialFiles: boolean
  readonly maskGroups: readonly SecretMaskGroup[]
  readonly extraMaskedPaths: readonly string[]
  readonly guardToolSecrets: boolean
  readonly redactTokenPatterns: boolean
}

export const HIDDEN_NOTE_FILENAME = 'HIDDEN-BY-DSH.txt'
export const HIDDEN_NOTE_CONTENT =
  'Hidden by DeepSeek Harness (@klarkxy/dsh-secret-manager): host credential files are masked inside agent tool sandboxes. ' +
  'Use request_secret / secret_http or pre-configured CLI helpers instead.\n'

const WSL_SYSTEM_USERS = new Set(['Public', 'Default', 'Default User', 'All Users'])

export function resolveSandboxGuardConfig(config: SandboxGuardConfig = {}): ResolvedSandboxGuardConfig {
  const validGroups = new Set<string>(ALL_SECRET_MASK_GROUPS)
  const rawGroups = Array.isArray(config.maskGroups) ? config.maskGroups : DEFAULT_SECRET_MASK_GROUPS
  const maskGroups = [...new Set(rawGroups.filter((group): group is SecretMaskGroup => validGroups.has(group)))]
  const extraMaskedPaths = Array.isArray(config.extraMaskedPaths)
    ? config.extraMaskedPaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
  return {
    maskCredentialFiles: config.maskCredentialFiles ?? true,
    maskGroups,
    extraMaskedPaths,
    guardToolSecrets: config.guardToolSecrets ?? true,
    redactTokenPatterns: config.redactTokenPatterns ?? true,
  }
}

function expandHome(rawPath: string, homeDir: string): string {
  if (rawPath === '~') return homeDir
  if (rawPath.startsWith('~/') || rawPath.startsWith('~\\')) {
    return path.join(homeDir, rawPath.slice(2))
  }
  return path.resolve(rawPath)
}

function normalizeComparePath(inputPath: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = path.resolve(inputPath).replaceAll('\\', '/')
  const trimmed = resolved.length > 1 && resolved.endsWith('/') ? resolved.slice(0, -1) : resolved
  return platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

function resolveRealOrLexical(inputPath: string, realpathSync: (p: string) => string): string {
  try {
    return realpathSync(inputPath)
  } catch {
    return path.resolve(inputPath)
  }
}

export function isWithinPath(
  candidate: string,
  root: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normCandidate = normalizeComparePath(candidate, platform)
  const normRoot = normalizeComparePath(root, platform)
  return normCandidate === normRoot || normCandidate.startsWith(`${normRoot}/`)
}

function groupTargetsForHome(
  homeDir: string,
  groups: ReadonlySet<SecretMaskGroup>,
  options: { readonly dshHome?: string; readonly includeWindowsRoaming?: boolean },
): MaskedTarget[] {
  const out: MaskedTarget[] = []
  const add = (group: SecretMaskGroup, relOrAbs: string, kind: 'file' | 'dir', isAbs = false) => {
    if (!groups.has(group)) return
    out.push({ group, path: isAbs ? path.resolve(relOrAbs) : path.join(homeDir, relOrAbs), kind })
  }

  if (groups.has('dsh')) {
    const dshDir = options.dshHome && options.dshHome.trim().length > 0
      ? path.resolve(options.dshHome)
      : path.join(homeDir, '.dsh')
    add('dsh', path.join(dshDir, '.credentials.yaml'), 'file', true)
  }

  add('cloud', path.join('.aws', 'credentials'), 'file')
  add('cloud', path.join('.config', 'gcloud'), 'dir')
  if (options.includeWindowsRoaming) {
    add('cloud', path.join('AppData', 'Roaming', 'gcloud'), 'dir')
  }
  add('cloud', '.azure', 'dir')
  add('cloud', path.join('.kube', 'config'), 'file')
  add('cloud', path.join('.docker', 'config.json'), 'file')

  add('registry', path.join('.cargo', 'credentials.toml'), 'file')
  add('registry', path.join('.cargo', 'credentials'), 'file')
  add('registry', '.pypirc', 'file')

  add('git', '.ssh', 'dir')
  add('git', '.git-credentials', 'file')
  add('git', '.netrc', 'file')
  add('git', '_netrc', 'file')
  add('git', path.join('.config', 'gh', 'hosts.yml'), 'file')
  if (options.includeWindowsRoaming) {
    add('git', path.join('AppData', 'Roaming', 'GitHub CLI', 'hosts.yml'), 'file')
  }

  add('npm', '.npmrc', 'file')
  return out
}

export interface ResolveTargetsEnv {
  readonly homeDir?: string
  readonly dshHome?: string
  readonly platform?: NodeJS.Platform
  readonly wslUsersRoot?: string
  readonly readdirSync?: (dir: string, opts: { withFileTypes: true }) => fs.Dirent[]
  readonly statSync?: (p: string) => { isDirectory(): boolean }
  readonly realpathSync?: (p: string) => string
}

export function resolveMaskedTargets(
  config: ResolvedSandboxGuardConfig,
  env: ResolveTargetsEnv = {},
): MaskedTarget[] {
  if (!config.maskCredentialFiles) return []
  const homeDir = env.homeDir ?? os.homedir()
  const platform = env.platform ?? process.platform
  const dshHome = env.dshHome ?? process.env.DSH_HOME
  const readdirSync = env.readdirSync ?? ((dir, opts) => fs.readdirSync(dir, opts))
  const statSync = env.statSync ?? (p => fs.statSync(p))
  const realpathSync = env.realpathSync ?? (p => fs.realpathSync(p))
  const groups = new Set<SecretMaskGroup>(config.maskGroups)

  const rawTargets: MaskedTarget[] = [
    ...groupTargetsForHome(homeDir, groups, {
      dshHome,
      includeWindowsRoaming: platform === 'win32',
    }),
  ]

  // WSL mounts Windows user profiles under `/mnt/c/Users/<name>`.
  if (platform === 'linux') {
    const wslRoot = env.wslUsersRoot ?? '/mnt/c/Users'
    try {
      for (const entry of readdirSync(wslRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || WSL_SYSTEM_USERS.has(entry.name)) continue
        const winHome = path.join(wslRoot, entry.name)
        rawTargets.push(...groupTargetsForHome(winHome, groups, { includeWindowsRoaming: true }))
      }
    } catch {
      /* not running under WSL or `/mnt/c/Users` unavailable */
    }
  }

  for (const extra of config.extraMaskedPaths) {
    const expanded = expandHome(extra, homeDir)
    let kind: 'file' | 'dir' = 'file'
    try {
      if (statSync(expanded).isDirectory()) kind = 'dir'
    } catch {
      /* default non-existent custom paths to file literal; directory check updates once created */
    }
    rawTargets.push({ group: 'extra', path: expanded, kind })
  }

  const dedup = new Map<string, MaskedTarget>()
  for (const target of rawTargets) {
    const lexicalKey = normalizeComparePath(target.path, platform)
    if (!dedup.has(lexicalKey)) dedup.set(lexicalKey, target)
    const real = resolveRealOrLexical(target.path, realpathSync)
    const realKey = normalizeComparePath(real, platform)
    if (!dedup.has(realKey)) {
      dedup.set(realKey, real === target.path ? target : { ...target, path: real })
    }
  }
  return [...dedup.values()]
}

export function ensureHiddenNoteFile(dir = path.join(os.tmpdir(), 'dsh-secret-manager-mask')): string {
  const notePath = path.join(dir, HIDDEN_NOTE_FILENAME)
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
    if (!fs.existsSync(notePath) || fs.readFileSync(notePath, 'utf8') !== HIDDEN_NOTE_CONTENT) {
      fs.writeFileSync(notePath, HIDDEN_NOTE_CONTENT, { mode: 0o444 })
    }
  } catch {
    /* read-only tmpdir fallback: callers degrade gracefully if notePath cannot be created */
  }
  return notePath
}

function escapeSeatbeltString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

/**
 * Inject credential file masks into Linux `bwrap` or macOS `sandbox-exec` command lines.
 */
export function maskSandboxArgv(
  argv: readonly string[],
  targets: readonly MaskedTarget[],
  notePath: string,
  existsSync: (p: string) => boolean = p => fs.existsSync(p),
  statSync: (p: string) => { isDirectory(): boolean } = p => fs.statSync(p),
): string[] {
  if (argv.length === 0 || targets.length === 0) return [...argv]
  const bin = path.basename(argv[0]).toLowerCase()

  // Linux bubblewrap: `bwrap ... --ro-bind / / ... -- <cmd>`
  if (bin === 'bwrap' || bin === 'bubblewrap') {
    const sepIndex = argv.indexOf('--')
    if (sepIndex < 0) return [...argv]
    const hasNote = existsSync(notePath)
    if (!hasNote) return [...argv]
    const extraArgs: string[] = []
    for (const target of targets) {
      if (!existsSync(target.path)) continue
      let isDir = target.kind === 'dir'
      try { isDir = statSync(target.path).isDirectory() } catch { /* keep declared kind */ }
      if (isDir) {
        extraArgs.push(
          '--tmpfs', target.path,
          '--ro-bind', notePath, path.posix.join(target.path.replaceAll('\\', '/'), HIDDEN_NOTE_FILENAME),
          '--remount-ro', target.path,
        )
      } else {
        extraArgs.push('--ro-bind', notePath, target.path)
      }
    }
    if (extraArgs.length === 0) return [...argv]
    return [...argv.slice(0, sepIndex), ...extraArgs, ...argv.slice(sepIndex)]
  }

  // macOS Seatbelt: `sandbox-exec -p "(version 1)..." ...`
  if (bin === 'sandbox-exec') {
    const flagIndex = argv.indexOf('-p')
    if (flagIndex < 0 || flagIndex + 1 >= argv.length) return [...argv]
    const profile = argv[flagIndex + 1]
    if (typeof profile !== 'string' || !profile.trimStart().startsWith('(version 1)')) return [...argv]
    const rules = targets.map(target => {
      const escaped = escapeSeatbeltString(target.path)
      return target.kind === 'dir'
        ? `(deny file-read* (subpath "${escaped}"))`
        : `(deny file-read* (literal "${escaped}"))`
    })
    const next = [...argv]
    next[flagIndex + 1] = `${profile}\n${rules.join('\n')}`
    return next
  }

  return [...argv]
}

const DIRECT_FILE_TOOLS = new Set(['read', 'read_image', 'write', 'edit'])

export function findBlockedTargetForTool(
  toolName: string,
  args: unknown,
  targets: readonly MaskedTarget[],
  options: {
    readonly cwd?: string
    readonly homeDir?: string
    readonly platform?: NodeJS.Platform
    readonly realpathSync?: (p: string) => string
  } = {},
): MaskedTarget | undefined {
  if (targets.length === 0 || args === null || typeof args !== 'object') return undefined
  const rec = args as Record<string, unknown>
  const homeDir = options.homeDir ?? os.homedir()
  const cwd = options.cwd ?? process.cwd()
  const platform = options.platform ?? process.platform
  const realpathSync = options.realpathSync ?? (p => fs.realpathSync(p))

  const resolveInput = (raw: unknown): string | undefined => {
    if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
    const trimmed = raw.trim()
    const lexical = trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')
      ? expandHome(trimmed, homeDir)
      : path.resolve(cwd, trimmed)
    return resolveRealOrLexical(lexical, realpathSync)
  }

  if (DIRECT_FILE_TOOLS.has(toolName)) {
    const candidate = resolveInput(rec.file_path ?? rec.path)
    if (!candidate) return undefined
    return targets.find(target => isWithinPath(candidate, target.path, platform))
  }

  if (toolName === 'open_sidebar') {
    const candidate = resolveInput(rec.path)
    if (!candidate) return undefined
    return targets.find(target => isWithinPath(candidate, target.path, platform))
  }

  if (toolName === 'grep') {
    const candidate = resolveInput(rec.path ?? cwd)
    if (!candidate) return undefined
    return targets.find(
      target => isWithinPath(candidate, target.path, platform) || isWithinPath(target.path, candidate, platform),
    )
  }

  return undefined
}

/* -------------------------------------------------------------------------- */
/* Secret Solicitation, Raw Token Arguments & Ambient Token Redaction         */
/* -------------------------------------------------------------------------- */

export interface SecretPatternSpec {
  readonly label: 'github-token' | 'api-key'
  readonly pattern: RegExp
}

export const AMBIENT_SECRET_PATTERNS: readonly SecretPatternSpec[] = [
  { label: 'github-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/g },
  { label: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { label: 'api-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}/g },
]

const CREDENTIAL_NOUN_RE =
  /\b(?:pat|personal\s+access\s+token|access\s+token|auth(?:entication)?\s+token|bearer\s+token|github\s+token|gh_token|github_token|api[-_\s]?key|secret[-_\s]?key|private[-_\s]?key|client[-_\s]?secret|password|passphrase)\b|(?:访问令牌|个人令牌|密钥|密码|口令)/i

const CREDENTIAL_SOLICIT_RE =
  /\b(?:paste|enter|provide|input|supply|share|send|give|type)\b|(?:粘贴|输入|提供|填写|发送|发给|贴出|填入)/i

const GH_AUTH_TOKEN_CMD_RE = /(?:^|[\s;&|(`$])gh\s+auth\s+token\b/

const SHELL_TOOL_NAMES = new Set(['bash', 'pwsh', 'powershell', 'shell'])
const QUESTION_TOOL_NAMES = new Set(['ask_user_question', 'ask_view'])

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out)
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, out)
  }
  return out
}

export function detectAmbientTokenLabels(value: unknown): string[] {
  const found = new Set<string>()
  for (const text of collectStrings(value)) {
    for (const { label, pattern } of AMBIENT_SECRET_PATTERNS) {
      pattern.lastIndex = 0
      if (pattern.test(text)) found.add(label)
    }
  }
  return [...found]
}

export function maskAmbientTokenText(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text
  let out = text
  for (const { label, pattern } of AMBIENT_SECRET_PATTERNS) {
    out = out.replace(pattern, `[REDACTED:${label}]`)
  }
  return out
}

function sanitizeJsonTokens<T>(value: T): T {
  if (typeof value === 'string') return maskAmbientTokenText(value) as unknown as T
  if (Array.isArray(value)) return value.map(item => sanitizeJsonTokens(item)) as unknown as T
  if (value !== null && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      next[maskAmbientTokenText(key)] = sanitizeJsonTokens(item)
    }
    return next as unknown as T
  }
  return value
}

function sanitizeBlocksTokens(blocks: readonly ContentBlock[]): ContentBlock[] {
  return blocks.map(block => {
    if (block.type === 'text') {
      const text = maskAmbientTokenText(block.text)
      return text === block.text ? block : { ...block, text }
    }
    return sanitizeJsonTokens(block)
  })
}

export function guardToolSecretCall(toolName: string, args: unknown): string | undefined {
  if (QUESTION_TOOL_NAMES.has(toolName)) {
    const combined = collectStrings(args).join('\n')
    if (CREDENTIAL_NOUN_RE.test(combined) && CREDENTIAL_SOLICIT_RE.test(combined)) {
      return (
        'Blocked credential solicitation in chat: never ask the user to paste tokens, API keys, or passwords into conversation prompts. ' +
        'Call `request_secret` (from @klarkxy/dsh-secret-manager) so the user can enter the secret in a masked local dialog, or run `gh` CLI subcommands directly for GitHub operations.'
      )
    }
  }

  if (SHELL_TOOL_NAMES.has(toolName) && args !== null && typeof args === 'object') {
    const rec = args as Record<string, unknown>
    const command = typeof rec.command === 'string' ? rec.command : ''
    if (GH_AUTH_TOKEN_CMD_RE.test(command)) {
      return (
        'Blocked `gh auth token`: printing keyring tokens into command output exposes plaintext credentials. ' +
        'Run `gh api`, `gh pr`, or `gh issue` directly so `gh` authenticates internally, or request a scoped token via `request_secret`.'
      )
    }
  }

  if (toolName !== 'request_secret') {
    const labels = detectAmbientTokenLabels(args)
    if (labels.length > 0) {
      return (
        `Blocked literal credential (${labels.join(', ')}) in \`${toolName}\` arguments. ` +
        'Store secrets with `request_secret` and pass `secret://<slot>` to `secret_http` or reference granted `$DSH_SECRET_*` environment variables instead of hardcoding tokens.'
      )
    }
  }

  return undefined
}

export function redactAmbientTokensInDecision(
  decision: PostToolDecision,
  result: Readonly<ToolExecutionResult>,
): PostToolDecision {
  const hasToken = (value: unknown) => detectAmbientTokenLabels(value).length > 0

  const errorLeak = result.isError && (
    hasToken(result.content) || hasToken(result.value) || hasToken(result.error)
  )
  if (errorLeak || hasToken(result.meta) || hasToken(result.additionalContexts)) {
    return { kind: 'block', feedback: [{ type: 'text', text: SAFE_BLOCK_TEXT }] }
  }

  if (decision.kind === 'block') {
    const feedback = sanitizeBlocksTokens(decision.feedback)
    const contexts = decision.additionalContexts === undefined
      ? undefined
      : sanitizeJsonTokens(decision.additionalContexts) as UserMessage[]
    if (feedback === decision.feedback && contexts === decision.additionalContexts) return decision
    return {
      kind: 'block',
      feedback,
      ...(contexts === undefined ? {} : { additionalContexts: contexts }),
    }
  }

  const sanitizedContexts = decision.additionalContexts === undefined
    ? undefined
    : sanitizeJsonTokens(decision.additionalContexts) as UserMessage[]

  if (decision.value !== undefined) {
    if (!hasToken(decision.value) && !hasToken(decision.additionalContexts)) return decision
    return {
      kind: 'accept',
      value: sanitizeJsonTokens(decision.value),
      ...(sanitizedContexts === undefined ? {} : { additionalContexts: sanitizedContexts }),
    }
  }

  if (hasToken(result.value)) {
    return {
      kind: 'accept',
      value: sanitizeJsonTokens(result.value),
      ...(sanitizedContexts === undefined ? {} : { additionalContexts: sanitizedContexts }),
    }
  }

  const source = decision.content ?? result.content
  if (!hasToken(source) && !hasToken(decision.additionalContexts)) return decision
  return {
    kind: 'accept',
    content: sanitizeBlocksTokens(source),
    ...(sanitizedContexts === undefined ? {} : { additionalContexts: sanitizedContexts }),
  }
}

/* -------------------------------------------------------------------------- */
/* Host Wiring                                                                */
/* -------------------------------------------------------------------------- */

function resolveExecutionCwd(exec: unknown): string | undefined {
  const rec = exec as {
    cwd?: unknown
    workingDirectory?: unknown
    agent?: { session?: { workingDirectory?: unknown; cwd?: unknown } }
  } | undefined
  for (const candidate of [
    rec?.cwd,
    rec?.workingDirectory,
    rec?.agent?.session?.workingDirectory,
    rec?.agent?.session?.cwd,
  ]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate
  }
  return undefined
}

export function installSandboxAndSecretGuard(
  ctx: Context,
  config: SandboxGuardConfig = {},
  logger?: PluginLogger,
): void {
  const resolved = resolveSandboxGuardConfig(config)
  const host = ctx as unknown as {
    inject(deps: string[], callback: (inner: Context) => void): unknown
    effect(fn: () => void | (() => void), label?: string): void
    on(event: string, listener: (...args: any[]) => unknown, options?: { prepend?: boolean }): () => void
  }

  if (resolved.maskCredentialFiles) {
    const notePath = ensureHiddenNoteFile()
    host.inject(['sandbox'], inner => {
      const sandbox = (inner as unknown as { sandbox?: SandboxServiceLike }).sandbox
      if (!sandbox || typeof sandbox.confine !== 'function') return
      const originalConfine = sandbox.confine
      const wrappedConfine: SandboxServiceLike['confine'] = async function (
        this: unknown,
        command: SandboxCommandLike,
        options?: unknown,
      ) {
        const confined = await originalConfine.call(this ?? sandbox, command, options)
        if (!confined || !Array.isArray(confined.argv)) return confined
        const targets = resolveMaskedTargets(resolved)
        const nextArgv = maskSandboxArgv(confined.argv, targets, notePath)
        return nextArgv.length === confined.argv.length && nextArgv.every((arg, idx) => arg === confined.argv![idx])
          ? confined
          : { ...confined, argv: nextArgv }
      }
      inner.effect(() => {
        sandbox.confine = wrappedConfine
        return () => {
          if (sandbox.confine === wrappedConfine) sandbox.confine = originalConfine
        }
      }, 'secret-manager.sandbox-mask')
    })
  }

  if (resolved.maskCredentialFiles || resolved.guardToolSecrets) {
    host.effect(() => host.on('tools/pre-execute', async (
      exec: { name?: unknown; args?: unknown; input?: unknown },
      next: () => Promise<unknown>,
    ) => {
      const toolName = typeof exec?.name === 'string' ? exec.name : ''
      const toolArgs = exec?.args !== undefined ? exec.args : exec?.input

      if (resolved.maskCredentialFiles && toolName !== '') {
        const targets = resolveMaskedTargets(resolved)
        const blocked = findBlockedTargetForTool(toolName, toolArgs, targets, {
          cwd: resolveExecutionCwd(exec),
        })
        if (blocked) {
          logger?.info('sandbox-guard.file-blocked', 'Blocked direct tool access to masked credential path.', {
            tool: toolName,
            group: blocked.group,
          })
          return {
            kind: 'block',
            reason:
              `Access to host credential path (${blocked.group}) is blocked by @klarkxy/dsh-secret-manager. ` +
              'Use `request_secret` / `secret_http` or pre-configured CLI helpers instead of reading credential files directly.',
          }
        }
      }

      if (resolved.guardToolSecrets && toolName !== '') {
        const reason = guardToolSecretCall(toolName, toolArgs)
        if (reason !== undefined) {
          logger?.info('sandbox-guard.call-blocked', 'Blocked unsafe credential usage in tool call.', { tool: toolName })
          return { kind: 'block', reason }
        }
      }

      return await next()
    }), 'secret-manager.pre-guard')
  }

  if (resolved.redactTokenPatterns) {
    host.effect(() => host.on(
      'tools/post-execute',
      async (
        _exec: unknown,
        result: Readonly<ToolExecutionResult>,
        next: () => Promise<PostToolDecision>,
      ): Promise<PostToolDecision> => {
        const decision = await next()
        return redactAmbientTokensInDecision(decision, result)
      },
      { prepend: true },
    ), 'secret-manager.ambient-redact')
  }
}
