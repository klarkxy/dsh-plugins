import { isAbsolute, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { containsSecret, hardRisk } from './policy.js';

const MAX_FILES = 8;
const MAX_FILE_BYTES = 6144;
const MAX_BYTES = 12288;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// This only locates possible evidence. It never interprets a shell, determines
// permission, or constructs an executable command. Unsupported syntax stays in
// the exact action for the reviewer. POSIX shell parsers would misread pwsh.
function fileHints(text) {
  return (text.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s;&|<>]+/g) ?? [])
    .map(value => value.replace(/^["']|["']$/g, ''))
    .filter(value => /\.(?:[cm]?js|tsx?|ps1|sh)$/i.test(value) && !/[\x00-\x1f$`*?{}]/.test(value));
}

/** Read bounded local evidence through the host's canonical filesystem seam.
 * Repository code is evidence, never authority. No subprocesses or network.
 */
export async function collectExecutionEvidence(call, fs, signal) {
  const files = [], omissions = [], snapshots = [];
  const unavailable = () => ({ data: { files, omissions: ['FILESYSTEM_EVIDENCE_UNAVAILABLE'], coverage: 'partial' }, verify: async () => true });
  if (!['bash', 'pwsh'].includes(call.tool)) return { data: undefined, verify: async () => true };
  if (!fs || ['resolve', 'contains', 'stat', 'readBytes', 'processPath'].some(key => typeof fs[key] !== 'function')) return unavailable();
  const rootPath = call.sandbox?.workspaceRoot;
  const workdir = call.args.workdir ?? call.cwd;
  if (!isAbsolute(rootPath ?? '') || !isAbsolute(workdir ?? '')) return unavailable();
  const root = await fs.resolve(rootPath, { signal });
  const cwd = await fs.resolve(workdir, { signal });
  if (!fs.contains(root, cwd)) return { data: { files, omissions: ['WORKDIR_OUTSIDE_WORKSPACE'], coverage: 'partial' }, verify: async () => true };
  const canonicalRoot = fs.processPath(root), canonicalCwd = fs.processPath(cwd);
  let bytes = 0;
  const queued = new Set();
  const queue = [];
  const enqueue = (path, base = canonicalCwd) => {
    const absolute = resolve(base, path);
    if (queued.has(absolute)) return;
    queued.add(absolute); queue.push(absolute);
  };
  enqueue('package.json');
  if (canonicalCwd !== canonicalRoot) enqueue('package.json', canonicalRoot);
  for (const path of fileHints(call.args.command)) enqueue(path);
  // Manifests expose lifecycle hooks as well as script definitions. Follow only
  // local file references in relevant scripts; no transitive dependency audit.
  const scriptNames = new Set(call.args.command.match(/[A-Za-z0-9_:-]+/g) ?? []);
  if (scriptNames.has('install')) for (const name of ['preinstall', 'postinstall', 'prepare']) scriptNames.add(name);
  for (let i = 0; i < queue.length; i++) {
    signal.throwIfAborted();
    const path = queue[i];
    if (snapshots.length >= MAX_FILES || bytes >= MAX_BYTES) { omissions.push('EVIDENCE_LIMIT'); break; }
    if (hardRisk({ tool: 'read', args: { file_path: path } })) { omissions.push('PROTECTED_EVIDENCE'); continue; }
    try {
      const target = await fs.resolve(path, { signal });
      const canonical = fs.processPath(target);
      if (!fs.contains(root, target) || hardRisk({ tool: 'read', args: { file_path: canonical } })) { omissions.push('EVIDENCE_OUTSIDE_WORKSPACE_OR_PROTECTED'); continue; }
      const before = await fs.stat(target, signal);
      if (!before) { snapshots.push({ path, canonical, absent: true }); continue; }
      if (before.type !== 'file') { omissions.push('EVIDENCE_NOT_REGULAR_FILE'); continue; }
      const remaining = Math.min(MAX_FILE_BYTES, MAX_BYTES - bytes);
      const contentBytes = await fs.readBytes(target, signal, remaining);
      if (!(contentBytes instanceof Uint8Array) || contentBytes.byteLength > remaining) throw new Error('EVIDENCE_PROVIDER_UNBOUNDED');
      const after = await fs.stat(target, signal);
      if (after?.type !== 'file' || before.version !== after.version) throw new Error('EVIDENCE_CHANGED');
      const hash = digest(contentBytes);
      snapshots.push({ path, canonical, version: after.version, hash });
      let content;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(contentBytes); }
      catch { omissions.push('NON_TEXT_EVIDENCE_WITHHELD'); continue; }
      // UTF-16/NUL and other binary/control encodings must not bypass secret
      // screening or make the model review a different source representation.
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content)) { omissions.push('NON_TEXT_EVIDENCE_WITHHELD'); continue; }
      if (containsSecret(content)) { omissions.push('SENSITIVE_EVIDENCE_WITHHELD'); continue; }
      // JSON keys can use escape sequences: screen their decoded form too.
      let manifest;
      if (path.endsWith('package.json')) {
        manifest = JSON.parse(content);
        if (containsSecret(JSON.stringify(manifest))) { omissions.push('SENSITIVE_EVIDENCE_WITHHELD'); continue; }
      }
      bytes += Buffer.byteLength(content);
      files.push({ path: relative(canonicalRoot, canonical), content, sha256: hash });
      if (path.endsWith('package.json')) {
        for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
          if (!scriptNames.has(name) || typeof command !== 'string') continue;
          for (const hint of fileHints(command)) enqueue(hint, resolve(path, '..'));
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      if (['EVIDENCE_CHANGED', 'EVIDENCE_PROVIDER_UNBOUNDED'].includes(error.message)) throw error;
      omissions.push(error.code === 'FS_TOO_LARGE' ? 'EVIDENCE_TOO_LARGE' : 'EVIDENCE_UNREADABLE');
    }
  }
  const data = { files, omissions: [...new Set(omissions)], coverage: 'partial' };
  return { data, async verify(signalForVerification = signal) {
    const signal = signalForVerification;
    signal.throwIfAborted();
    // Re-resolve containment and reread digests, including previously absent
    // manifests. Stat versions alone are not a content identity guarantee.
    const nextRoot = await fs.resolve(rootPath, { signal });
    const nextCwd = await fs.resolve(workdir, { signal });
    if (fs.processPath(nextRoot) !== canonicalRoot || fs.processPath(nextCwd) !== canonicalCwd || !fs.contains(nextRoot, nextCwd)) return false;
    for (const saved of snapshots) {
      const target = await fs.resolve(saved.path, { signal });
      if (fs.processPath(target) !== saved.canonical || !fs.contains(nextRoot, target)) return false;
      const info = await fs.stat(target, signal);
      if (saved.absent) { if (info) return false; continue; }
      if (info?.type !== 'file' || info.version !== saved.version) return false;
      if (digest(await fs.readBytes(target, signal, MAX_FILE_BYTES)) !== saved.hash) return false;
    }
    return true;
  } };
}
