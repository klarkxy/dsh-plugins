import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep, parse } from 'node:path';

export const SHELL_TOOLS = new Set(['shell', 'bash', 'pwsh']);
const FILE_TOOLS = new Set(['read', 'read_image', 'write', 'edit']);
const PROTECTED = /(?:^|[\\/])(?:\.git|\.ssh|\.aws|\.gnupg|\.dsh|\.claude|\.agents|\.github|\.kube|\.azure|\.config)(?:[\\/]|$)|(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.npmrc|\.netrc|\.pypirc|\.gitconfig|\.bashrc|\.zshrc|\.profile|AGENTS(?:\.local)?\.md|CLAUDE\.md|id_rsa|id_ed25519|credentials)(?:[\\/]|$)|\.(?:pem|key|p12|pfx)$/i;
const DANGEROUS_PROGRAM = /^(?:sudo|su|doas|rm|rmdir|del|erase|mkfs(?:\..*)?|shutdown|reboot|curl|wget|nc|ncat|ssh|scp|sftp|powershell|pwsh|bash|sh|eval|exec|env|xargs)$/i;
const SECRET = /\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}|\bBearer\s+\S+|(?:password|api[_-]?key|token|secret)\s*[:=]\s*\S+/i;
const verdict = (kind, code, extra = {}) => ({ kind, code, ...extra });
export const containsSecret = text => SECRET.test(text);

/** Narrow lexer, NOT a shell parser. Unsupported grammar never enters the review envelope. */
export function simpleCommand(command) {
  return typeof command === 'string' && command.length <= 4096 &&
    /^[A-Za-z0-9_./:= -]+$/.test(command) && command === command.trim() &&
    !command.includes('  ') && !command.split(' ').some(x => x === '..') &&
    !command.split(' ')[0].includes('=') && !command.split(' ')[0].includes('/');
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/** Refuse symlink components (including dangling links), hard-linked writes and ambiguous spelling. */
export function inspectPath(root, raw, writing = false) {
  if (typeof raw !== 'string' || !raw || raw.length > 4096 || /[\x00-\x1f\x7f]/.test(raw)) return verdict('ask', 'INVALID_PATH');
  if (PROTECTED.test(raw)) return verdict('deny', 'PROTECTED_PATH');
  // Explicitly limit v0.1 to POSIX local filesystems. UNC/ADS/remote paths are not normalized optimistically.
  if (sep !== '/' || /[\\:]/.test(raw) || raw.split('/').includes('..')) return verdict('ask', 'AMBIGUOUS_PATH');
  const target = resolve(root, raw);
  if (!inside(root, target)) return verdict('ask', 'OUTSIDE_WORKSPACE');
  if (PROTECTED.test(target)) return verdict('deny', 'PROTECTED_PATH');
  try {
    if (realpathSync(root) !== root || !lstatSync(root).isDirectory()) return verdict('ask', 'NONCANONICAL_ROOT');
    let at = root;
    const parts = relative(root, target).split(sep).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      at = resolve(at, parts[i]);
      let stat;
      try { stat = lstatSync(at); }
      catch (error) {
        if (error.code === 'ENOENT' && writing) break;
        return verdict('ask', 'PATH_UNAVAILABLE');
      }
      if (stat.isSymbolicLink()) return verdict('ask', 'SYMLINK');
      if (i < parts.length - 1 && !stat.isDirectory()) return verdict('ask', 'INVALID_PARENT');
      if (i === parts.length - 1 && (!stat.isFile() || (writing && stat.nlink > 1))) return verdict('ask', 'NONREGULAR_TARGET');
    }
    if (target === root || target === parse(target).root) return verdict('ask', 'DIRECTORY_TARGET');
    return verdict('allow', writing ? 'WORKSPACE_EDIT' : 'WORKSPACE_READ', { target });
  } catch { return verdict('ask', 'PATH_UNAVAILABLE'); }
}

/** A candidate is only a bounded operator grant; an LLM can narrow it, never enlarge it. */
export function assess(call, config) {
  if (!call || !call.args || typeof call.args !== 'object' || Array.isArray(call.args)) return verdict('ask', 'INVALID_ARGUMENTS');
  const args = call.args;
  const rawPath = args.file_path ?? args.path;
  if (typeof rawPath === 'string' && PROTECTED.test(rawPath)) return verdict('deny', 'PROTECTED_PATH');
  if (call.sandbox?.mode !== 'workspace-write') return verdict('deny', 'WORKSPACE_SANDBOX_REQUIRED');
  if (args.sandbox_permissions !== undefined && args.sandbox_permissions !== 'use_default') return verdict('ask', 'SANDBOX_ESCALATION');
  const root = call.sandbox.workspaceRoot;
  if (typeof root !== 'string' || !config.workspaceRoots.includes(root) || root !== call.cwd) return verdict('ask', 'UNTRUSTED_WORKSPACE');
  if (FILE_TOOLS.has(call.tool)) {
    if (args.file_path !== undefined && args.path !== undefined && args.file_path !== args.path) return verdict('ask', 'AMBIGUOUS_PATH');
    return inspectPath(root, rawPath, call.tool === 'write' || call.tool === 'edit');
  }
  if (SHELL_TOOLS.has(call.tool)) {
    const cmd = args.command;
    if (typeof cmd !== 'string') return verdict('ask', 'MISSING_COMMAND');
    if (cmd.split(/\s+/).some(p => PROTECTED.test(p)) || containsSecret(cmd)) return verdict('deny', 'SENSITIVE_COMMAND');
    if (!simpleCommand(cmd) || call.tool === 'pwsh') return verdict('ask', 'UNSUPPORTED_SHELL');
    const argv = cmd.split(' ');
    if (DANGEROUS_PROGRAM.test(argv[0])) return verdict('deny', 'DANGEROUS_PROGRAM');
    // Extra process/environment/cwd arguments are not covered by the exact-command grant.
    if (Object.keys(args).some(k => !['command', 'description', 'timeout', 'sandbox_permissions'].includes(k))) return verdict('ask', 'UNREVIEWED_ARGUMENTS');
    if (!config.shellCandidates.includes(cmd)) return verdict('ask', 'OUTSIDE_REVIEW_ENVELOPE');
    return verdict('review', 'ENROLLED_COMMAND', { action: { tool: call.tool, command: cmd, cwd: root } });
  }
  // No name-based exemptions for MCP, run_code, subagents, test/build, or search tools.
  return verdict('ask', 'UNSUPPORTED_TOOL');
}
