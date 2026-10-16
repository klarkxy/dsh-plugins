/**
 * Small dangerous-command list for commands that run inside the sandbox.
 *
 * Modeled on Codex `shell-command/src/command_safety/is_dangerous_command.rs`
 * and `windows_dangerous_commands.rs` (openai/codex, Apache-2.0): instead of
 * proving commands read-only, flag the few patterns whose damage the
 * workspace sandbox cannot contain, and send only those to review. A match
 * never denies by itself; it turns an ordinary sandboxed call into a reviewed
 * one. Parsing is best-effort tokenization, not a shell parser.
 */

const MAX_DEPTH = 8;
const MAX_COMMAND = 32768;
const SEGMENT_OPERATORS = new Set([';', '&', '&&', '|', '||', '\n']);
const WRAPPERS = new Set(['sudo', 'doas', 'command', 'builtin', 'nohup', 'time', 'nice', 'xargs', 'exec']);
const DELETE_CMDLETS = new Set(['remove-item', 'ri', 'rm', 'del', 'erase', 'rd', 'rmdir']);
const LAUNCH_CMDLETS = new Set(['start-process', 'start', 'saps', 'invoke-item', 'ii']);
const BROWSERS = new Set(['chrome', 'msedge', 'firefox', 'iexplore', 'brave', 'opera']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const POWERSHELLS = new Set(['pwsh', 'powershell']);
const SOFT_SEPARATORS = /[{}()[\],]/;

/** Program identity without directories, drive letters or Windows extensions. */
export function programName(token) {
  return String(token ?? '').split(/[\\/]/).pop().replace(/^[A-Za-z]:/, '').toLowerCase()
    .replace(/\.(?:exe|cmd|bat|com|ps1)$/, '');
}

/**
 * Split one command string into segments of words. Quotes group words and are
 * removed; `$(...)` and backtick substitutions are returned separately so
 * their contents are checked as commands too.
 */
export function tokenize(command) {
  const segments = [[]];
  const nested = [];
  let word = '', inWord = false;
  const push = () => { if (inWord) segments.at(-1).push(word); word = ''; inWord = false; };
  const cut = () => { push(); if (segments.at(-1).length) segments.push([]); };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'" || ch === '"') {
      const end = command.indexOf(ch, i + 1);
      const body = end < 0 ? command.slice(i + 1) : command.slice(i + 1, end);
      if (ch === '"') for (const match of body.matchAll(/\$\(([^()]*)\)/g)) nested.push(match[1]);
      word += body; inWord = true; i = end < 0 ? command.length : end;
      continue;
    }
    if (ch === '$' && command[i + 1] === '(') {
      let depth = 0, j = i + 1;
      for (; j < command.length; j++) {
        if (command[j] === '(') depth++;
        else if (command[j] === ')' && --depth === 0) break;
      }
      nested.push(command.slice(i + 2, j));
      word += command.slice(i, j + 1); inWord = true; i = j;
      continue;
    }
    if (ch === '`' && command.indexOf('`', i + 1) > i) {
      const end = command.indexOf('`', i + 1);
      nested.push(command.slice(i + 1, end));
      i = end;
      continue;
    }
    if (ch === '\n' || ch === '\r' || ch === ';') { cut(); continue; }
    if (ch === '&' || ch === '|') {
      if (command[i + 1] === ch) i++;
      // `2>&1` and `>|` are redirections, not command separators.
      if (ch === '&' && /[<>]$/.test(word)) { word += ch; inWord = true; continue; }
      cut(); continue;
    }
    if (/\s/.test(ch)) { push(); continue; }
    word += ch; inWord = true;
  }
  push();
  return { segments: segments.filter(segment => segment.length), nested };
}

const hasUrl = words => words.some(word => /https?:\/\//i.test(word));
const isForcedRm = args => args.some(arg => arg === '--force' || /^-[A-Za-z]*f[A-Za-z]*$/.test(arg) && !arg.startsWith('--'));

/** Inner script of `bash -c`, `pwsh -Command` or `cmd /c`, if this is such an invocation. */
function innerScript(name, args) {
  if (SHELLS.has(name)) {
    const index = args.findIndex(arg => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg));
    return index >= 0 && args[index + 1] !== undefined ? { script: args[index + 1], shell: 'bash' } : undefined;
  }
  if (POWERSHELLS.has(name)) {
    const index = args.findIndex(arg => /^[-/](?:c|command)$/i.test(arg));
    if (index >= 0) return { script: args.slice(index + 1).join(' '), shell: 'pwsh' };
    const inline = args.find(arg => /^[-/]command:/i.test(arg));
    return inline ? { script: inline.slice(inline.indexOf(':') + 1), shell: 'pwsh' } : undefined;
  }
  if (name === 'cmd') {
    const index = args.findIndex(arg => /^[-/][cr]$/i.test(arg));
    return index >= 0 ? { script: args.slice(index + 1).join(' '), shell: 'cmd' } : undefined;
  }
  return undefined;
}

function matchSegment(words, shell, depth) {
  let index = 0;
  // Leading assignments (`FOO=1 cmd`) and transparent wrappers do not change the program.
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) index++;
  let name = programName(words[index]);
  while (WRAPPERS.has(name) || name === 'env') {
    index++;
    while (index < words.length && (words[index].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]))) index++;
    name = programName(words[index]);
  }
  const args = words.slice(index + 1);
  if (!name) return undefined;
  const inner = innerScript(name, args);
  if (inner) return scan(inner.script, inner.shell, depth + 1);
  if (name === 'rm' && isForcedRm(args)) return 'forced-rm';
  if ((name === 'del' || name === 'erase') && args.some(arg => /^\/f$/i.test(arg))) return 'force-delete';
  if ((name === 'rd' || name === 'rmdir') && args.some(arg => /^\/s$/i.test(arg)) && args.some(arg => /^\/q$/i.test(arg))) return 'force-delete';
  if (shell === 'pwsh') {
    // PowerShell script blocks and parentheses can hide the cmdlet inside one segment.
    const atoms = words.flatMap(word => word.split(SOFT_SEPARATORS)).map(atom => atom.trim().toLowerCase()).filter(Boolean);
    if (atoms.some(atom => DELETE_CMDLETS.has(atom)) && atoms.some(atom => atom === '-force' || atom.startsWith('-force:'))) return 'force-delete';
    if (hasUrl(words) && atoms.some(atom => LAUNCH_CMDLETS.has(atom) || atom.includes('shellexecute') || atom.includes('shell.application'))) return 'url-launch';
  }
  if (name === 'start' && hasUrl(args)) return 'url-launch';
  if ((name === 'explorer' || name === 'mshta' || BROWSERS.has(name)) && hasUrl(args)) return 'url-launch';
  if (name === 'rundll32' && args.some(arg => /url\.dll,fileprotocolhandler/i.test(arg)) && hasUrl(args)) return 'url-launch';
  return undefined;
}

function scan(command, shell, depth) {
  if (depth > MAX_DEPTH) return 'nesting-too-deep';
  const { segments, nested } = tokenize(command);
  for (const words of segments) {
    const hit = matchSegment(words, shell, depth);
    if (hit) return hit;
  }
  for (const inner of nested) {
    const hit = scan(inner, shell, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Dangerous-command rule matched by one shell tool command, or undefined.
 * @param {string} command - the exact `command` argument.
 * @param {'bash' | 'pwsh'} tool - the shell tool that will run it.
 * @returns {string | undefined} rule id such as `forced-rm`, `force-delete` or `url-launch`.
 */
export function dangerousCommand(command, tool) {
  if (typeof command !== 'string' || !command.trim()) return undefined;
  if (command.length > MAX_COMMAND) return 'command-too-long';
  return scan(command, tool === 'pwsh' ? 'pwsh' : 'bash', 0);
}
