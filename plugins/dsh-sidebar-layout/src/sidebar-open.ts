/**
 * Host-side `open_sidebar` tool and system-prompt guidance for
 * `@klarkxy/dsh-sidebar-layout`.
 *
 * Validates that target files exist as regular files on the host filesystem
 * (converting workspace paths to session-relative POSIX coordinates) or that
 * URLs use explicit `http://` / `https://` without embedded credentials, then
 * records durable `presentationMeta` consumed by the Web client watcher.
 *
 * Adapted from `herenfor/dsh-runtime-tuning` (MIT License).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import {
  MAX_SIDEBAR_URL_LENGTH,
  SIDEBAR_OPEN_TOOL,
  type SidebarOpenDestination,
  type SidebarOpenPayload,
  type SidebarOpenPresentationMeta,
} from './contracts.ts'

export const SIDEBAR_OPEN_PROMPT = [
  "You can use `open_sidebar` to display an existing file or HTTP(S) URL directly in the user's right sidebar preview panel for immediate visual review (HTML/HTM pages, images, PDFs, Office documents, spreadsheets/CSV/TSV, Markdown, source files at a line, or a local/web URL).",
  'Call `open_sidebar` when showing a generated report, HTML page, chart, diagram, image, deliverable, or dev-server page lets the user inspect your work without opening it manually.',
  'Prefer files inside the workspace directory (isolated sandbox `/tmp` files are not readable by host preview). Pass either `path` or `url`, never both, and do not call it speculatively for routine edits or before the file exists.',
].join(' ')

export type ValidatedSidebarArgs =
  | {
      readonly kind: 'file'
      readonly path: string
      readonly line?: number | undefined
      readonly destination?: SidebarOpenDestination | undefined
    }
  | {
      readonly kind: 'url'
      readonly url: string
      readonly destination?: SidebarOpenDestination | undefined
    }

export interface HostFsEntryLike {
  readonly type: string
}

export interface HostFsServiceLike {
  lstat(path: string, options?: { cwd?: string | undefined } | undefined, signal?: AbortSignal | undefined): Promise<HostFsEntryLike | undefined>
  resolve(path: string, options?: { cwd?: string | undefined; signal?: AbortSignal | undefined } | undefined): Promise<unknown>
  stat(target: unknown, signal?: AbortSignal | undefined): Promise<HostFsEntryLike | undefined>
  processPath(target: unknown): string
}

export interface WorkingDirectoryServiceLike {
  ensure(agent: unknown, signal?: AbortSignal | undefined): Promise<string | undefined>
}

export interface SidebarToolExecLike {
  readonly agent?: {
    readonly session?: {
      readonly header?: {
        readonly cwd?: string | undefined
        readonly delegationDepth?: number | undefined
      } | undefined
    } | undefined
  } | undefined
  readonly signal?: AbortSignal | undefined
}

export interface SidebarOpenDeps {
  readonly fs: HostFsServiceLike
  readonly workingDirectory?: WorkingDirectoryServiceLike | undefined
  readonly now?: (() => number) | undefined
}

/** Parse and normalize an HTTP(S) URL for the sidebar browser; throws Error on invalid input. */
export function parseSidebarUrl(input: unknown): string {
  if (typeof input !== 'string') throw new Error('url must be a string')
  const trimmed = input.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_SIDEBAR_URL_LENGTH) {
    throw new Error(`url must be a non-empty string of at most ${MAX_SIDEBAR_URL_LENGTH} characters`)
  }
  if (!/^https?:/i.test(trimmed)) {
    throw new Error('url must use an explicit http:// or https:// scheme')
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('url is not a valid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url must use http:// or https://')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('url must not include embedded credentials')
  }
  return parsed.href
}

/** Normalize an absolute target path to a workspace-relative POSIX path when inside `workspaceRoot`. */
export function toSidebarAddressPath(absolutePath: string, workspaceRoot: string | undefined): string {
  const target = String(absolutePath).replace(/\\/g, '/')
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim().length === 0) return target
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  if (root.length > 0 && target.startsWith(`${root}/`)) {
    return target.slice(root.length + 1)
  }
  return target
}

/** Validate mutual exclusivity and field constraints for `open_sidebar` arguments. */
export function validateSidebarArgs(raw: unknown): ValidatedSidebarArgs {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('arguments must be an object')
  }
  const rec = raw as Record<string, unknown>
  const hasPath = rec.path !== undefined
  const hasUrl = rec.url !== undefined
  if (hasPath === hasUrl) {
    throw new Error('open_sidebar requires exactly one of `path` or `url`')
  }
  if (rec.destination !== undefined && rec.destination !== 'sidebar' && rec.destination !== 'float') {
    throw new Error('destination must be "sidebar" or "float"')
  }
  const dest = rec.destination === undefined ? {} : { destination: rec.destination as SidebarOpenDestination }
  if (hasUrl) {
    if (rec.line !== undefined) {
      throw new Error('line is only valid when opening a file `path`')
    }
    if (rec.destination === 'float') {
      throw new Error('destination "float" is only supported when opening a file `path`')
    }
    return { kind: 'url', url: parseSidebarUrl(rec.url), ...dest }
  }
  if (typeof rec.path !== 'string' || rec.path.trim().length === 0) {
    throw new Error('path must be a non-empty string')
  }
  if (rec.line !== undefined && (typeof rec.line !== 'number' || !Number.isSafeInteger(rec.line) || rec.line < 1)) {
    throw new Error('line must be a positive integer starting at 1')
  }
  return {
    kind: 'file',
    path: rec.path,
    ...(rec.line !== undefined ? { line: rec.line as number } : {}),
    ...dest,
  }
}

/** Format a concise single-line confirmation string returned to the model. */
export function formatOpenSidebarResult(value: SidebarOpenPayload): string {
  if (value.kind === 'url') {
    return `Opened ${value.url ?? ''} in right sidebar browser.`
  }
  const loc = `${value.path ?? ''}${value.line !== undefined ? `:${value.line}` : ''}`
  const extra = value.absolutePath && value.absolutePath !== value.path ? ` (${value.absolutePath})` : ''
  return `Opened ${loc} in right sidebar preview${extra}.`
}

function makeCodedError(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

/** Validate target existence on the host filesystem (for files) or normalize URLs, returning durable metadata. */
export async function executeOpenSidebar(
  args: unknown,
  exec: SidebarToolExecLike | undefined,
  deps: SidebarOpenDeps,
): Promise<SidebarOpenPayload> {
  const now = deps.now ?? Date.now
  const input = validateSidebarArgs(args)
  if (input.kind === 'url') {
    return {
      kind: 'url',
      url: input.url,
      ...(input.destination !== undefined ? { destination: input.destination } : {}),
      openedAt: now(),
    }
  }

  const cwd = exec?.agent !== undefined && deps.workingDirectory
    ? await deps.workingDirectory.ensure(exec.agent, exec.signal)
    : undefined
  const workspaceRoot = exec?.agent?.session?.header?.cwd ?? cwd
  const entry = await deps.fs.lstat(input.path, cwd !== undefined ? { cwd } : {}, exec?.signal)
  if (entry !== undefined && entry.type !== 'file') {
    throw makeCodedError(`Cannot open ${input.path} in sidebar: not a regular file (${entry.type})`, 'FS_NOT_REGULAR_FILE')
  }
  const target = await deps.fs.resolve(input.path, {
    ...(cwd !== undefined ? { cwd } : {}),
    ...(exec?.signal !== undefined ? { signal: exec.signal } : {}),
  })
  const info = await deps.fs.stat(target, exec?.signal)
  if (info === undefined) {
    const tmpHint = input.path.startsWith('/tmp/')
      ? ' Sandbox /tmp files are isolated from host preview; save into the workspace directory first.'
      : ' Check the path and retry.'
    throw makeCodedError(`Cannot open ${input.path} in sidebar: file not found.${tmpHint}`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw makeCodedError(`Cannot open ${input.path} in sidebar: not a regular file (${info.type})`, 'FS_NOT_REGULAR_FILE')
  }
  const absolutePath = deps.fs.processPath(target)
  const addressPath = toSidebarAddressPath(absolutePath, workspaceRoot)
  return {
    kind: 'file',
    path: addressPath,
    absolutePath,
    ...(input.line !== undefined ? { line: input.line } : {}),
    ...(input.destination !== undefined ? { destination: input.destination } : {}),
    openedAt: now(),
  }
}

/** Build the raw JSON-Schema tool definition expected by `ctx.tools.register`. */
export function createSidebarOpenToolDefinition(deps: SidebarOpenDeps): Record<string, unknown> {
  return {
    name: SIDEBAR_OPEN_TOOL,
    description: "Open an existing file (HTML, Markdown, code, image, PDF, Office, CSV/TSV) or an HTTP(S) URL in the user's right sidebar preview immediately.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Path to an existing regular file. Relative paths resolve from the session working directory.',
        },
        url: {
          type: 'string',
          description: 'Explicit http:// or https:// URL to open in the sidebar browser tab.',
        },
        line: {
          type: 'integer',
          description: 'Optional 1-based line number for text, code, or Markdown files.',
        },
        destination: {
          type: 'string',
          enum: ['sidebar', 'float'],
          description: 'Placement for files: docked "sidebar" (default) or "float" floating panel.',
        },
      },
    },
    timeoutMs: 10_000,
    hostEffect: 'read-only' as const,
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'openedAt'],
        properties: {
          kind: { type: 'string', enum: ['file', 'url'] },
          path: { type: 'string' },
          absolutePath: { type: 'string' },
          url: { type: 'string' },
          line: { type: 'integer' },
          destination: { type: 'string', enum: ['sidebar', 'float'] },
          openedAt: { type: 'integer' },
        },
      },
      render: (_args: unknown, value: SidebarOpenPayload) => [{ type: 'text', text: formatOpenSidebarResult(value) }],
      presentationMeta: (_args: unknown, value: SidebarOpenPayload): SidebarOpenPresentationMeta => ({
        tool: SIDEBAR_OPEN_TOOL,
        ...value,
      }),
    },
    execute: (args: unknown, exec?: SidebarToolExecLike | undefined) => executeOpenSidebar(args, exec, deps),
  }
}

interface HostServicesFace {
  tools: {
    get(name: string, scope?: unknown | undefined): unknown
    register(definition: Record<string, unknown>): () => void
  }
  fs: HostFsServiceLike
  workingDirectory?: WorkingDirectoryServiceLike | undefined
  systemPrompt?: {
    getSectionOrder?(name: string): number
    section?(contribution: {
      name: string
      order: number
      text: (context?: {
        scope?: unknown | undefined
        agent?: { session?: { header?: { delegationDepth?: number | undefined } | undefined } | undefined } | undefined
      } | undefined) => string
    }): () => void
  } | undefined
}

/** Attach `open_sidebar` and its top-level prompt guidance when host services are present. */
export function installSidebarOpenHost(ctx: Context, logger?: PluginLogger | undefined): void {
  const injectable = ctx as unknown as {
    inject?: (deps: readonly string[], callback: (scoped: Context) => void) => void
  }
  if (typeof injectable.inject !== 'function') return

  injectable.inject(['tools', 'fs'], scoped => {
    scoped.effect(() => {
      const host = scoped as unknown as HostServicesFace & { get?: (key: string) => unknown }
      if (host.tools.get(SIDEBAR_OPEN_TOOL) !== undefined) {
        logger?.warn('open-sidebar.conflict', 'open_sidebar is already registered by another plugin; skipping registration.')
        return () => {}
      }
      const workingDirectory = (typeof host.get === 'function'
        ? host.get('workingDirectory')
        : host.workingDirectory) as WorkingDirectoryServiceLike | undefined
      let disposeTool: () => void
      try {
        disposeTool = host.tools.register(createSidebarOpenToolDefinition({
          fs: host.fs,
          workingDirectory,
        }))
      } catch (error) {
        logger?.warn('open-sidebar.register-failed', 'Could not register open_sidebar tool.', error)
        return () => {}
      }

      let disposePrompt: (() => void) | undefined
      const systemPrompt = (typeof host.get === 'function'
        ? host.get('systemPrompt')
        : host.systemPrompt) as HostServicesFace['systemPrompt']
      if (typeof systemPrompt?.section === 'function') {
        try {
          const baseOrder = typeof systemPrompt.getSectionOrder === 'function'
            ? systemPrompt.getSectionOrder('DELIVERABLE_FILE_REFERENCES')
            : 650
          disposePrompt = systemPrompt.section({
            name: 'dsh-sidebar-layout:open-sidebar',
            order: (Number.isFinite(baseOrder) ? baseOrder : 650) + 1,
            text: (promptCtx = {}) => {
              if (host.tools.get(SIDEBAR_OPEN_TOOL, promptCtx.scope) === undefined) return ''
              if ((promptCtx.agent?.session?.header?.delegationDepth ?? 0) > 0) return ''
              return SIDEBAR_OPEN_PROMPT
            },
          })
        } catch (error) {
          logger?.warn('open-sidebar.prompt-failed', 'Could not register open_sidebar system prompt section.', error)
        }
      }

      return () => {
        disposePrompt?.()
        disposeTool()
      }
    }, 'sidebar-layout.open-tool')
  })
}
