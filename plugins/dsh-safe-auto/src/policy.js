import { shellRefusals } from './shell-command.js';

const SHELL_TOOLS = new Set(['shell', 'bash', 'pwsh']);
const PROTECTED = /(?:^|[\\/])(?:\.git|\.ssh|\.aws|\.gnupg|\.dsh|\.claude|\.agents|\.github|\.kube|\.azure|\.config)(?:[\\/]|$)|(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.npmrc|\.netrc|\.pypirc|\.gitconfig|\.bashrc|\.zshrc|\.profile|AGENTS(?:\.local)?\.md|CLAUDE\.md|id_rsa|id_ed25519|credentials)(?:[\\/]|$)|\.(?:pem|key|p12|pfx)$/i;
const DANGEROUS_PROGRAM = /^(?:sudo|su|doas|rm|rmdir|del|erase|mkfs(?:\..*)?|shutdown|reboot|curl|wget|nc|ncat|ssh|scp|sftp|powershell|pwsh|bash|sh|eval|exec|env|xargs)$/i;
const SECRET = /\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}|\bBearer\s+\S+|(?:password|api[_-]?key|token|secret)["']?\s*[:=]\s*\S+/i;
const verdict = (kind, code) => ({ kind, code });
export const containsSecret = text => SECRET.test(text);

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
    if (typeof path === 'string' && PROTECTED.test(path)) return verdict('deny', 'PROTECTED_PATH');
  }
  if (SHELL_TOOLS.has(call?.tool) && typeof args.command === 'string') {
    if (args.command.split(/\s+/).some(p => PROTECTED.test(p)) || containsSecret(args.command)) return verdict('deny', 'SENSITIVE_COMMAND');
    // Check decoded literal argv, assignment and redirect values, including
    // quote concatenation. Refusal-only decoding also survives an unrelated
    // dynamic fragment; it cannot establish safety or grant permission.
    const refusals = shellRefusals(args.command);
    for (const value of refusals.values) {
      if (containsSecret(value) || PROTECTED.test(value) ||
          value.split(/[=:]/).some(part => PROTECTED.test(part))) return verdict('deny', 'SENSITIVE_COMMAND');
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
