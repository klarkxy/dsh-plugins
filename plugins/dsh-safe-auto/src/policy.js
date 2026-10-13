import { analyzeShell, isReadonly, isSafeStaticExposure, shellRefusals } from './shell-command.js';
import { commandForPolicy } from './host-runtime.js';
import { credentialSourcePath, isCredentialPath, isMutationProtectedPath } from './credential-paths.js';

const SHELL_TOOLS = new Set(['shell', 'bash', 'pwsh']);
const READ_TOOLS = new Set(['read', 'read_image', 'grep']);
const DANGEROUS_PROGRAM = /^(?:sudo|su|doas|rm|rmdir|del|erase|mkfs(?:\..*)?|shutdown|reboot|curl|wget|nc|ncat|ssh|scp|sftp|powershell|pwsh|bash|sh|eval|exec|env|xargs)$/i;
const SECRET = /\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}|\bBearer\s+\S+|(?:password|api[_-]?key|token|secret)["']?\s*[:=]\s*\S+/i;
const verdict = (kind, code) => ({ kind, code });
export const containsSecret = text => SECRET.test(text);

// These files mix normal settings with possible secrets. Native read can
// sanitize values; raw shell content readers cannot. Directory metadata and
// literal output remain usable, and package.json/generic JSON are not denied.
const shellMixedConfigPath = path => /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|\.gitconfig)$|(?:^|\/)\.(?:git|kube|aws)\/config$|(?:^|\/)\.docker\/config\.json$|(?:^|\/)\.(?:codex|dsh|claude|agents)\/(?:[^/]+\/)*(?:config|settings(?:\.local)?|cordis)\.(?:toml|ya?ml|jsonc?)$/.test(credentialSourcePath(path));
const readAccess = call => READ_TOOLS.has(call?.tool) || call?.tool === 'str_replace_editor' && call?.args?.command === 'view';

/** Narrow lexer, NOT a shell parser. Only used to recognize a bare dangerous program name. */
export function simpleCommand(command) {
  return typeof command === 'string' && command.length <= 4096 &&
    /^[A-Za-z0-9_./:= -]+$/.test(command) && command === command.trim() &&
    !command.includes('  ') && !command.split(' ').some(x => x === '..') &&
    !command.split(' ')[0].includes('=') && !command.split(' ')[0].includes('/');
}

/** Hard refusals are evaluated before any review; a model verdict cannot soften these. */
export function hardRisk(call) {
  const args = call?.args ?? {};
  for (const path of [args.file_path, args.path]) {
    if (typeof path === 'string' && (isCredentialPath(path) || !readAccess(call) && isMutationProtectedPath(path))) {
      return verdict('deny', 'PROTECTED_PATH');
    }
  }
  if (SHELL_TOOLS.has(call?.tool) && typeof args.command === 'string') {
    const screened = commandForPolicy(call);
    if (containsSecret(args.command)) return verdict('deny', 'SENSITIVE_COMMAND');
    const analysis = analyzeShell(screened), readonly = isReadonly(analysis);
    const safeExposure = isSafeStaticExposure(analysis);
    // Check decoded literal argv, assignment and redirect values, including
    // quote concatenation. Refusal-only decoding also survives an unrelated
    // dynamic fragment; it cannot establish safety or grant permission.
    // Only attested runner entry positions differ; all data operands remain.
    const refusals = shellRefusals(screened);
    for (const value of [...screened.split(/\s+/), ...refusals.values]) {
      const parts = [value, ...value.split(/[=:]/)];
      if (containsSecret(value) || parts.some(isCredentialPath) ||
          !readonly && parts.some(isMutationProtectedPath)) return verdict('deny', 'SENSITIVE_COMMAND');
      if (readonly && !safeExposure && parts.some(shellMixedConfigPath)) return verdict('deny', 'USE_SAFE_READ');
    }
    // Known literal roots remain refusals even when their arguments are not
    // statically provable. Unparseable commands keep the legacy bare check.
    if (refusals.dangerousRoot !== undefined ||
      simpleCommand(args.command) && DANGEROUS_PROGRAM.test(args.command.split(' ')[0])) {
      return verdict('deny', 'DANGEROUS_PROGRAM');
    }
  }
  return undefined;
}
