import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { containsSecret, hardRisk, inspectPath, simpleCommand } from './policy.js';

const verdict = (kind, code, extra = {}) => ({ kind, code, ...extra });
const TOOLS = new Set(['bash', 'write', 'edit']);
const SYSTEM_PATH = /^\/(?:etc|proc|sys|dev|boot|root|usr|bin|sbin|lib|lib64|run)(?:\/|$)/;

/** This adapter recognizes only the native, pinned DSH widening vocabulary. */
export function isNativeEscalation(call) {
  return TOOLS.has(call.tool) && call.args?.sandbox_permissions === 'danger-full-access';
}

/** Load-time envelopes are exact, not command prefixes, globs, or directory grants. */
export function parseEscalationCandidates(value, workspaces) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('invalid escalationCandidates');
  return Object.freeze(value.map(rule => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || !TOOLS.has(rule.tool)) throw new Error('invalid escalation candidate tool');
    const targetKey = rule.tool === 'bash' ? 'command' : 'filePath';
    const keys = ['tool', 'cwd', 'mode', targetKey];
    if (Object.keys(rule).length !== keys.length || Object.keys(rule).some(key => !keys.includes(key))) throw new Error('escalation candidate requires exactly tool, cwd, mode and target');
    if (rule.mode !== 'danger-full-access' || !workspaces.includes(rule.cwd)) throw new Error('escalation candidate requires an enrolled cwd and explicit danger-full-access mode');
    if (rule.tool === 'bash') {
      if (!simpleCommand(rule.command)) throw new Error('escalation command must use the supported simple grammar');
    } else if (typeof rule.filePath !== 'string' || !isAbsolute(rule.filePath) || resolve(rule.filePath) !== rule.filePath || /[\x00-\x1f\x7f\\:*?]/.test(rule.filePath)) {
      throw new Error('escalation filePath must be an exact absolute local path');
    }
    return Object.freeze({ ...rule });
  }));
}

/** Include filesystem identity in the pending decision; do not cache authorization across calls. */
function fileStamp(path) {
  const parent = lstatSync(dirname(path));
  let target;
  try { target = lstatSync(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stamp = s => s ? [s.dev, s.ino, s.mode, s.nlink, s.size, s.mtimeMs, s.ctimeMs] : null;
  return [stamp(parent), stamp(target)];
}

/** Does not grant anything: a review result must still pass the native approval seam. */
export function assessEscalation(call, config) {
  const args = call.args;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return verdict('ask', 'INVALID_ARGUMENTS');
  const hard = hardRisk(call);
  if (hard) return hard;
  if (call.sandbox?.mode !== 'workspace-write') return verdict('deny', 'WORKSPACE_SANDBOX_REQUIRED');
  if (!isNativeEscalation(call)) return verdict('ask', 'UNSUPPORTED_ESCALATION');
  if (typeof args.justification !== 'string' || !args.justification.trim() || args.justification.length > 4096) return verdict('ask', 'INVALID_JUSTIFICATION');
  const root = call.sandbox.workspaceRoot;
  if (!config.workspaceRoots.includes(root) || call.cwd !== root) return verdict('ask', 'UNTRUSTED_WORKSPACE');
  if (!call.session || call.subagent || call.nested) return verdict('ask', 'NO_DIRECT_USER_AUTHORITY');
  if (!call.localExecution) return verdict('ask', 'LOCAL_EXECUTION_UNVERIFIED');
  if (sep !== '/') return verdict('ask', 'UNSUPPORTED_PLATFORM');
  try {
    if (realpathSync(root) !== root || !lstatSync(root).isDirectory()) return verdict('ask', 'NONCANONICAL_ROOT');
  } catch { return verdict('ask', 'PATH_UNAVAILABLE'); }
  // Full arguments, including file contents, are reviewed verbatim, or refused; never truncate into another action.
  const serialized = JSON.stringify(args);
  if (Buffer.byteLength(serialized) > config.maxInputBytes) return verdict('ask', 'REVIEW_INPUT_TOO_LARGE');
  if (containsSecret(serialized)) return verdict('deny', 'SENSITIVE_ARGUMENTS');
  let target;
  let stamp;
  if (call.tool === 'bash') {
    if (!simpleCommand(args.command)) return verdict('ask', 'UNSUPPORTED_SHELL');
    const allowed = ['command', 'description', 'timeoutMs', 'workdir', 'run_in_background', 'sandbox_permissions', 'justification'];
    if (Object.keys(args).some(k => !allowed.includes(k))) return verdict('ask', 'UNREVIEWED_ARGUMENTS');
    if (typeof args.description !== 'string' || !args.description.trim()) return verdict('ask', 'INVALID_DESCRIPTION');
    if (args.workdir !== undefined && args.workdir !== root) return verdict('ask', 'UNREVIEWED_WORKDIR');
    if (args.run_in_background !== undefined && args.run_in_background !== false) return verdict('ask', 'BACKGROUND_ESCALATION');
    // The native bash tool can promote even a foreground call when jobs is composed.
    if (call.jobsAvailable !== false || call.shellConfined !== true) return verdict('ask', 'PROCESS_LIFETIME_UNVERIFIED');
    if (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs <= 0 || args.timeoutMs > config.escalationMaxTimeoutMs) return verdict('ask', 'BOUNDED_TIMEOUT_REQUIRED');
    target = args.command;
  } else {
    const allowed = call.tool === 'write'
      ? ['file_path', 'content', 'sandbox_permissions', 'justification']
      : ['file_path', 'old_string', 'new_string', 'replace_all', 'sandbox_permissions', 'justification'];
    if (Object.keys(args).some(k => !allowed.includes(k))) return verdict('ask', 'UNREVIEWED_ARGUMENTS');
    target = args.file_path;
    if (typeof target !== 'string' || !isAbsolute(target) || resolve(target) !== target) return verdict('ask', 'EXACT_ABSOLUTE_PATH_REQUIRED');
    if (SYSTEM_PATH.test(target)) return verdict('deny', 'SYSTEM_TARGET');
    if (call.tool === 'write' ? typeof args.content !== 'string' :
      typeof args.old_string !== 'string' || !args.old_string || typeof args.new_string !== 'string' ||
      (args.replace_all !== undefined && typeof args.replace_all !== 'boolean')) return verdict('ask', 'INVALID_FILE_ARGUMENTS');
    const path = inspectPath(dirname(target), target, call.tool === 'write');
    if (path.kind !== 'allow') return path;
    // edit also changes a file: its existing target must not be a hard link.
    if (call.tool === 'edit' && lstatSync(target).nlink > 1) return verdict('ask', 'NONREGULAR_TARGET');
    try { stamp = fileStamp(target); }
    catch { return verdict('ask', 'PATH_UNAVAILABLE'); }
  }
  const matched = config.escalationCandidates.some(rule => rule.tool === call.tool && rule.cwd === root &&
    rule.mode === args.sandbox_permissions && (call.tool === 'bash' ? rule.command : rule.filePath) === target);
  if (!matched) return verdict('ask', 'OUTSIDE_ESCALATION_ENVELOPE');
  return verdict('review', 'ENROLLED_ESCALATION', {
    stamp,
    action: { tool: call.tool, arguments: args, cwd: root,
      permission: { from: call.sandbox.mode, to: args.sandbox_permissions, scope: 'this-call-only',
        filesystemConfinement: 'removed-for-this-call', networkIsolation: 'not-provided-by-DSH-file-mode' } },
  });
}

/** Both grant and request use the native helper's exact audited reason, not a prefix match. */
export function escalationReason(call) {
  return `escalate sandbox to ${call.args.sandbox_permissions}: ${call.args.justification}`;
}

export function bindingOf(call, assessment) {
  return createHash('sha256').update(JSON.stringify({
    tool: call.tool, args: call.args, cwd: call.cwd, sandbox: call.sandbox,
    task: call.task, intent: call.intent, subagent: call.subagent, nested: call.nested,
    localExecution: call.localExecution, jobsAvailable: call.jobsAvailable, shellConfined: call.shellConfined,
    code: assessment.code, stamp: assessment.stamp,
  })).digest('hex');
}
