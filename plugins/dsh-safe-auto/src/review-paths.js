import path from 'node:path';

const shellTools = new Set(['bash', 'pwsh']);
const fileTools = new Set(['write', 'edit']);
const pathText = value => typeof value === 'string' && Boolean(value.trim()) && !/[\x00-\x1f\x7f]/.test(value);

/**
 * Resolve only the coordinates used for review, never execution arguments.
 * These are lexical absolute paths, NOT realpath/canonical filesystem identities.
 * Evidence collection must still use fs.resolve/processPath/contains before reads.
 *
 * Native tool-pwsh resolves relative workdir against header.cwd; tool-bash uses
 * sandboxPolicy.workspaceRoot first. File mutations pass that policy root as
 * fs.resolve's cwd. Keep these separate even when a normal session makes them equal.
 * processPathFromHostPath is an optional, synchronous host-world identity check;
 * it cannot establish locality when a provider translates or withholds a path.
 */
export function resolveReviewPaths(call, fs, pathImpl = path) {
  const unavailable = () => ({ localExecution: false });
  try {
    if (typeof fs?.processPathFromHostPath !== 'function') return unavailable();
    const fullyAbsolute = value => pathText(value) && pathImpl.isAbsolute(value) &&
      (pathImpl.sep !== '\\' || /^[A-Za-z]:[\\/]|^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(value));
    const normalizeAbsolute = value => fullyAbsolute(value) ? pathImpl.normalize(value) : undefined;
    const cwd = normalizeAbsolute(call?.cwd);
    const root = normalizeAbsolute(call?.sandbox?.workspaceRoot ?? call?.cwd);
    if (!cwd || !root) return unavailable();
    const resolveFrom = (value, base) => {
      if (!pathText(value)) return undefined;
      if (pathImpl.isAbsolute(value)) return normalizeAbsolute(value);
      // Windows drive-relative paths consult ambient per-drive cwd; do not infer it.
      if (pathImpl.sep === '\\' && /^[A-Za-z]:/.test(value)) return undefined;
      return pathImpl.resolve(base, value);
    };
    let result;
    if (shellTools.has(call.tool)) {
      const base = call.tool === 'pwsh' ? cwd : root;
      const workdir = call.args?.workdir === undefined ? base : resolveFrom(call.args.workdir, base);
      if (!workdir) return unavailable();
      result = { workdir };
    } else if (fileTools.has(call.tool)) {
      const filePath = resolveFrom(call.args?.file_path, root);
      if (!filePath) return unavailable();
      result = { filePath };
    } else return unavailable();
    for (const value of [cwd, root, ...Object.values(result)]) {
      if (fs.processPathFromHostPath(value) !== value) return unavailable();
    }
    return { localExecution: true, ...result };
  } catch {
    return unavailable();
  }
}
