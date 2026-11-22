// Adapted from @deepseek-ai/dsh-util-workspace-path 0.2.2-rc.5 (MIT License).
// Copyright (c) 2026 DeepSeek.
// `dsh-resource://file/…` address grammar shared by the show_canvas tool (Host)
// and the canvas renderer (Web Client); keeps encoding identical to the host so
// addresses the tool emits resolve to the same resource the Sidebar reads.
const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/** Component-encode one id or path segment, keeping `:` literal for drive letters. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

/** Encode a `/`-separated path segment by segment. */
function encodePath(path: string): string {
  return path.split('/').map(encodeSegment).join('/')
}

/** Whether a path uses a Windows drive or UNC prefix. */
function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\')
}

/** Whether a path is absolute in either spelling the Host accepts: POSIX (`/a/b`) or Windows drive or UNC. */
export function isAbsoluteWorkspacePath(path: string): boolean {
  return path.startsWith('/') || isWindowsStylePath(path)
}

/** Build the address of a file read through one Session; leading `./` prefixes are dropped. */
export function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`
}

/**
 * The address for a path as a caller holds it: a relative path, or an absolute
 * path inside the Session's workspace, becomes a `session`-scoped address; an
 * absolute path outside it, or one whose workspace root is unknown, keeps its
 * absolute path in that Session's address.
 */
export function fileAddressFor(sessionId: string, cwd: string | undefined, path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized)
  const root = cwd === undefined ? '' : cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (root !== '' && normalized === root) return sessionFileAddress(sessionId, '')
  if (root !== '' && normalized.startsWith(`${root}/`)) return sessionFileAddress(sessionId, normalized.slice(root.length + 1))
  return sessionFileAddress(sessionId, normalized)
}

/** The file one session address names: the Session the read runs under and the path handed to the Host. */
export type SessionFile = {
  readonly sessionId: string
  readonly path: string
}

/**
 * Read a `dsh-resource://file/session/…` address back into its parts without
 * resolving `.` or `..`. Query and fragment suffixes are ignored; encoded path
 * segments are decoded. Other scopes (or malformed escapes) return `undefined`.
 */
export function sessionFileOf(address: string): SessionFile | undefined {
  try {
    if (!address.startsWith(FILE_ADDRESS_PREFIX)) return undefined
    const end = address.search(/[?#]/)
    const [scope, id, ...segments] = address.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end).split('/')
    if (scope !== 'session' || id === undefined || id === '' || segments.length === 0) return undefined
    return { sessionId: decodeURIComponent(id), path: segments.map(decodeURIComponent).join('/') }
  } catch {
    return undefined
  }
}
