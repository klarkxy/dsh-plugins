import { containsSecret, hardRisk } from './policy.js';

const verdict = (kind, code, extra = {}) => ({ kind, code, ...extra });
const TOOLS = new Set(['write', 'edit', 'pwsh', 'bash']);
const nonempty = value => typeof value === 'string' && Boolean(value.trim());

/** Native one-call review, not a standing capability grant or a static shell proof.
 * The adapter must verify locality/root identity and bind the eventual request.
 */
export function assessApproval(call, config) {
  if (!call || !call.args || typeof call.args !== 'object' || Array.isArray(call.args)) return verdict('ask', 'INVALID_ARGUMENTS');
  const hard = hardRisk(call);
  if (hard) return hard;
  if (config.approvalReview !== true) return verdict('ask', 'APPROVAL_REVIEW_DISABLED');
  if (call.sandbox?.mode !== 'workspace-write') return verdict('deny', 'WORKSPACE_SANDBOX_REQUIRED');
  if (!call.session || typeof call.session !== 'object' || call.subagent !== false || call.nested !== false) return verdict('ask', 'NO_DIRECT_USER_AUTHORITY');
  if (call.localExecution !== true || call.remote === true) return verdict('ask', 'LOCAL_EXECUTION_UNVERIFIED');
  if (!nonempty(call.cwd)) return verdict('ask', 'INVALID_CWD');
  if (!TOOLS.has(call.tool)) return verdict('ask', 'UNSUPPORTED_TOOL');
  const args = call.args;
  if (!['workspace-write', 'danger-full-access'].includes(args.sandbox_permissions)) return verdict('ask', 'UNSUPPORTED_ESCALATION');
  const file = call.tool === 'write' || call.tool === 'edit';
  const allowed = file ? (call.tool === 'write'
    ? ['file_path', 'content', 'sandbox_permissions', 'justification']
    : ['file_path', 'old_string', 'new_string', 'replace_all', 'sandbox_permissions', 'justification'])
    : ['command', 'description', 'timeoutMs', 'workdir', 'run_in_background', 'sandbox_permissions', 'justification'];
  // Only plain JSON arguments with known fields: no getters, toJSON or invisible data.
  if (Object.getPrototypeOf(args) !== Object.prototype && Object.getPrototypeOf(args) !== null) return verdict('ask', 'INVALID_ARGUMENTS');
  for (const key of Reflect.ownKeys(args)) {
    if (typeof key !== 'string' || !allowed.includes(key)) return verdict('ask', 'UNREVIEWED_ARGUMENTS');
    const descriptor = Object.getOwnPropertyDescriptor(args, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return verdict('ask', 'INVALID_ARGUMENTS');
  }
  if (!nonempty(args.justification) || args.justification.length > 4096) return verdict('ask', 'INVALID_JUSTIFICATION');
  if (file) {
    if (!nonempty(args.file_path) || /[\x00-\x1f\x7f]/.test(args.file_path)) return verdict('ask', 'INVALID_PATH');
    if (call.tool === 'write' ? typeof args.content !== 'string' :
      typeof args.old_string !== 'string' || !args.old_string || typeof args.new_string !== 'string' ||
      (Object.hasOwn(args, 'replace_all') && typeof args.replace_all !== 'boolean')) return verdict('ask', 'INVALID_FILE_ARGUMENTS');
  } else {
    if (!nonempty(args.command) || !nonempty(args.description)) return verdict('ask', 'INVALID_COMMAND_ARGUMENTS');
    if (Object.hasOwn(args, 'timeoutMs') && (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs <= 0 || args.timeoutMs > 60000)) return verdict('ask', 'INVALID_TIMEOUT');
    if (Object.hasOwn(args, 'workdir') && !nonempty(args.workdir)) return verdict('ask', 'INVALID_WORKDIR');
    if (Object.hasOwn(args, 'run_in_background') && typeof args.run_in_background !== 'boolean') return verdict('ask', 'INVALID_BACKGROUND');
  }
  let serialized;
  try {
    // Every permitted argument must survive JSON intact, including empty file contents.
    if (Object.values(args).some(v => !['string', 'boolean', 'number'].includes(typeof v))) return verdict('ask', 'INVALID_ARGUMENTS');
    serialized = JSON.stringify(args);
  } catch { return verdict('ask', 'INVALID_ARGUMENTS'); }
  if (Buffer.byteLength(serialized) > config.maxInputBytes) return verdict('ask', 'REVIEW_INPUT_TOO_LARGE');
  if (containsSecret(serialized)) return verdict('deny', 'SENSITIVE_ARGUMENTS');
  return verdict('review', 'NATIVE_APPROVAL_REVIEW', { action: {
    tool: call.tool, arguments: JSON.parse(serialized), cwd: call.cwd,
    permission: { from: call.sandbox.mode, to: args.sandbox_permissions, scope: 'this-call-only' },
  } });
}
