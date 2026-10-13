import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';

const DEPENDENCIES_TOOL = 'load_workspace_dependencies';
const MAX_PATH = 4096;
const MAX_COMMAND = 32768;
const attestations = new WeakMap();
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pathKey = value => process.platform === 'win32' ? normalize(value).toLowerCase() : normalize(value);
const absolutePath = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH &&
  !/[\x00-\x1f]/.test(value) && isAbsolute(value) && !value.startsWith('\\\\') && !value.startsWith('//') &&
  !value.split(/[\\/]/).includes('..');

/** Local host paths only. A symlink/junction alias is not an attested entry.
 * This checks file identity, not executable safety, and grants no permission.
 * No directory traversal or executable hashing is performed.
 */
export function snapshotHostRuntimeFile(path) {
  if (!absolutePath(path)) return undefined;
  try {
    const canonical = realpathSync.native(path);
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || pathKey(canonical) !== pathKey(path)) return undefined;
    return Object.freeze({ path, identity: [canonical, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].join(':') });
  } catch { return undefined; }
}

function dependencyPair(value) {
  if (!record(value) || Object.keys(value).some(key => !['python', 'node', 'pnpm', 'pythonPackages', 'nodePackages', 'pythonDistributions'].includes(key))) return undefined;
  if (![value.python, value.pythonPackages, value.node, value.pnpm].every(absolutePath) ||
      value.nodePackages !== undefined && !absolutePath(value.nodePackages) || !record(value.pythonDistributions)) return undefined;
  if (pathKey(value.node) === pathKey(value.pnpm)) return undefined;
  return { node: value.node, pnpm: value.pnpm };
}

/** Observe the native tools pipeline, never transcript/content text or replay.
 * begin is called from tools/pre-execute; observe from tools/result; get from
 * the shell guard. tools.get(global) and tools.get(agent) must be the SAME
 * pinned definition throughout. Scope shadows and registration changes fail
 * closed. Host plugins themselves remain part of the trusted host boundary.
 */
export function createHostRuntimeRegistry(tools, { snapshot = snapshotHostRuntimeFile } = {}) {
  let owner = tools?.get?.(DEPENDENCIES_TOOL);
  let disposed = false;
  const pending = new Map(), sessions = new WeakMap();
  const definitionMatches = agent => !disposed && !!owner && tools?.get?.(DEPENDENCIES_TOOL) === owner &&
    tools?.get?.(DEPENDENCIES_TOOL, agent) === owner;
  const forgetPending = token => {
    const item = pending.get(token);
    if (item) { pending.delete(token); item.signal?.removeEventListener('abort', item.abort); }
    return item;
  };
  const valid = (agent, entry) => {
    if (sessions.get(agent) !== entry || !definitionMatches(agent)) return false;
    try {
      return entry.files.every(file => snapshot(file.path)?.identity === file.identity);
    } catch { return false; }
  };
  return {
    begin(exec) {
      if (disposed) return;
      if (exec?.name !== DEPENDENCIES_TOOL || !record(exec.agent) || typeof exec.token !== 'symbol' || exec.signal?.aborted) return;
      forgetPending(exec.token);
      owner ??= tools?.get?.(DEPENDENCIES_TOOL);
      if (!definitionMatches(exec.agent) || !record(exec.arguments) || Object.keys(exec.arguments).length) return;
      // Bound interrupted-call retention without relying on a lifecycle event.
      if (pending.size >= 64) forgetPending(pending.keys().next().value);
      const item = { agent: exec.agent, signal: exec.signal, abort: () => forgetPending(exec.token) };
      pending.set(exec.token, item);
      exec.signal?.addEventListener('abort', item.abort, { once: true });
    },
    observe(exec, result) {
      if (disposed) return;
      if (exec?.name !== DEPENDENCIES_TOOL || !record(exec.agent)) return;
      const started = forgetPending(exec.token);
      sessions.delete(exec.agent);
      if (!started || started.agent !== exec.agent || exec.signal?.aborted || result?.isError !== false || !definitionMatches(exec.agent)) return;
      const pair = dependencyPair(result.value);
      if (!pair) return;
      let files;
      try { files = [snapshot(pair.node), snapshot(pair.pnpm)]; } catch { return; }
      if (files.some(file => !file || typeof file.identity !== 'string')) return;
      const runtime = Object.freeze({ ...pair, identity: Object.freeze(files.map(file => file.identity)) });
      const entry = { runtime, files };
      sessions.set(exec.agent, entry);
      attestations.set(runtime, () => valid(exec.agent, entry));
    },
    get(exec) {
      if (disposed) return undefined;
      if (!record(exec?.agent) || exec.signal?.aborted) return undefined;
      const entry = sessions.get(exec.agent);
      if (!entry) return undefined;
      if (!valid(exec.agent, entry)) { sessions.delete(exec.agent); return undefined; }
      return entry.runtime;
    },
    dispose() {
      disposed = true;
      owner = undefined;
      for (const token of pending.keys()) forgetPending(token);
    },
  };
}

/** A deliberately small single-invocation grammar, not a general shell parser.
 * No interpolation, escapes, concatenated quotes, wrappers, redirections,
 * pipelines, assignments or additional commands can earn an exemption.
 * Single-quoted content is literal in both shells. For PowerShell, doubled
 * quotes are deliberately unsupported; unsupported syntax keeps full policy.
 */
function literalInvocation(command, tool) {
  if (typeof command !== 'string' || !command.length || command.length > MAX_COMMAND || /[\x00-\x1f]/.test(command)) return undefined;
  const powershell = tool === 'pwsh';
  if (!powershell && tool !== 'bash') return undefined;
  let cursor = 0;
  const spaces = () => { while (command[cursor] === ' ') cursor++; };
  spaces();
  let callOperator = false;
  if (powershell && command[cursor] === '&') { callOperator = true; cursor++; spaces(); }
  const tokens = [];
  while (cursor < command.length) {
    const start = cursor, quote = command[cursor];
    let value;
    if (quote === "'" || quote === '"') {
      cursor++;
      const from = cursor;
      while (cursor < command.length && command[cursor] !== quote) cursor++;
      if (cursor === command.length) return undefined;
      value = command.slice(from, cursor++);
      if (quote === '"' && (powershell ? /[$`]/ : /[$`\\]/).test(value)) return undefined;
      if (powershell && tokens.length === 0 && !callOperator) return undefined;
      if (cursor < command.length && command[cursor] !== ' ') return undefined;
    } else {
      while (cursor < command.length && command[cursor] !== ' ') cursor++;
      value = command.slice(start, cursor);
      if (!(powershell ? /^[A-Za-z0-9_.\/:\\=-]+$/ : /^[A-Za-z0-9_.\/:=-]+$/).test(value)) return undefined;
    }
    tokens.push({ start, end: cursor, value });
    spaces();
  }
  return tokens.length >= 2 ? tokens : undefined;
}

/** Return a screening-only projection. NEVER execute it or send it for review.
 * Only the attested Node argv[0] + pnpm argv[1] pair is removed; every data
 * argument remains verbatim. This does not classify pnpm or its scripts safe.
 */
export function commandForPolicy(call) {
  const command = call?.args?.command;
  const runtime = call?.trustedRuntime;
  const validate = runtime && attestations.get(runtime);
  if (!validate || !validate()) return command;
  const tokens = literalInvocation(command, call.tool);
  if (!tokens || tokens[0].value !== runtime.node || tokens[1].value !== runtime.pnpm) return command;
  // The validated PowerShell call operator is omitted from this projection:
  // the policy's refusal decoder parses POSIX commands and otherwise misses
  // quoted sensitive operands after a leading '&'. The real call is intact.
  return '__DSH_HOST_NODE__' +
    command.slice(tokens[0].end, tokens[1].start) + '__DSH_HOST_PNPM__' + command.slice(tokens[1].end);
}
