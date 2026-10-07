import { parse } from 'unbash';

/**
 * Strict bash command analysis for permission decisions.
 * Design references (concepts, not code): ZCode build/edit static policy and
 * Codex execpolicy. A strict, fully literal parse may PROVE safety; anything
 * the parser cannot fully explain fails closed into the model review path —
 * partial parsing is never used to prove safety.
 */

const MAX_PARSE_LENGTH = 10000;
// Refusal decoding covers every command that can fit the existing maximum
// 32768-byte approval argument budget, even beyond the smaller proof limit.
const MAX_REFUSAL_PARSE_LENGTH = 32768;
// Characters the shell expands even though the parser reports no expansion
// parts (plain globs and braces arrive as plain unquoted words).
const NON_LITERAL = /[{}\[\]*?\\^#$`!]/;
// Tilde expansion applies at word start, or after : and = in assignments.
const TILDE_EXPANSION = /(?:^|[:=])~/;

function literalPart(part, quoted = false, strict = true) {
  switch (part?.type) {
    case 'Literal': {
      const text = part.text ?? part.value;
      return typeof text === 'string' && (!strict || quoted || !NON_LITERAL.test(text) && !TILDE_EXPANSION.test(text));
    }
    case 'SingleQuoted': return true;
    case 'DoubleQuoted':
      return Array.isArray(part.parts) && part.parts.every(child => literalPart(child, true, strict));
    default: return false;
  }
}

/** Literal argv value of one word, or undefined when the shell would expand it. */
function literalWord(word, strict = true) {
  if (!word || word.type !== 'Word') return undefined;
  if (word.parts) return word.parts.every(part => literalPart(part, false, strict)) ? (word.value ?? word.text) : undefined;
  const text = word.value ?? word.text;
  if (typeof text !== 'string' || text === '' || strict && (text.startsWith('=') || NON_LITERAL.test(text) || TILDE_EXPANSION.test(text))) return undefined;
  return text;
}

/** Decoded literal values for hard refusals only, NEVER a safety proof.
 * Unlike analyzeShell, an unrelated dynamic word/control-flow node must not
 * hide a known literal secret or protected path elsewhere in the command.
 */
export function shellRefusals(command) {
  const result = { values: [], dangerousRoot: undefined };
  if (typeof command !== 'string' || !command.length || command.length > MAX_REFUSAL_PARSE_LENGTH) return result;
  let script;
  try { script = parse(command); } catch { return result; }
  if (!script || script.errors?.length) return result;
  const values = result.values, pending = [script];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'Word') {
      const value = literalWord(node, false);
      if (typeof value === 'string') { values.push(value); continue; }
    }
    if (node.type === 'Assignment' && typeof node.name === 'string') {
      const value = node.value === undefined ? '' : literalWord(node.value, false);
      if (typeof value === 'string') values.push(node.name + '=' + value);
    }
    if (node.type === 'Command' && result.dangerousRoot === undefined) {
      const argv = [];
      for (const word of [node.name, ...(node.suffix ?? [])]) {
        if (word?.type === 'Redirect') continue;
        const value = literalWord(word, false);
        if (value === undefined) break;
        argv.push(value);
      }
      // A literal dangerous program remains a refusal even if later arguments
      // expand. Wrappers are checked only as far as their identity is known.
      result.dangerousRoot = dangerousArgv(argv, 0);
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) pending.push(...child);
      else if (child && typeof child === 'object') pending.push(child);
    }
  }
  return result;
}

function invocationOf(node, inheritedRedirects) {
  const env = [];
  for (const assignment of node.prefix ?? []) {
    if (assignment?.type !== 'Assignment' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(assignment.name ?? '')) return undefined;
    const value = assignment.value === undefined ? '' : literalWord(assignment.value);
    if (value === undefined) return undefined;
    env.push({ name: assignment.name, value });
  }
  const argv = [];
  const ownRedirects = [];
  // unbash v5 interleaves Redirect nodes inside the suffix stream.
  for (const item of [node.name, ...(node.suffix ?? [])]) {
    if (item === null || item === undefined) continue;
    if (item.type === 'Redirect') { ownRedirects.push(item); continue; }
    const value = literalWord(item);
    if (value === undefined) return undefined;
    argv.push(value);
  }
  const redirects = [];
  for (const redirect of [...inheritedRedirects, ...ownRedirects, ...(node.redirects ?? [])]) {
    if (redirect?.type !== 'Redirect' || typeof redirect.operator !== 'string') return undefined;
    if (redirect.body !== undefined) return undefined; // heredoc bodies may expand
    const target = redirect.target !== undefined ? literalWord(redirect.target) : (redirect.content ?? '');
    if (target === undefined) return undefined;
    redirects.push({ operator: redirect.operator, target, fileDescriptor: redirect.descriptor?.value ?? redirect.fileDescriptor });
  }
  return { argv, env, redirects };
}

/**
 * Fully literal parse of one shell command into simple invocations.
 * { ok: false } means the command is beyond static proof: pipes with dynamic
 * words, substitutions, control flow, backgrounding or parse errors.
 */
export function analyzeShell(command) {
  const fail = { ok: false, invocations: [] };
  if (typeof command !== 'string' || command.length === 0 || command.length > MAX_PARSE_LENGTH) return fail;
  let script;
  try { script = parse(command); } catch { return fail; }
  if (!script || script.errors?.length || !Array.isArray(script.commands) || script.commands.length === 0) return fail;
  const invocations = [];
  const visit = (node, inherited) => {
    if (!node || typeof node !== 'object') return false;
    switch (node.type) {
      case 'Statement':
        if (node.background) return false;
        return visit(node.command, [...inherited, ...(node.redirects ?? [])]);
      case 'AndOr':
      case 'Pipeline':
        return Array.isArray(node.commands) && node.commands.length > 0 &&
          node.commands.every(child => visit(child, inherited));
      case 'Time': // `time [-p] cmd` is transparent; the inner command governs
        return visit(node.command, inherited);
      case 'Command': {
        const invocation = invocationOf(node, inherited);
        if (!invocation) return false;
        invocations.push(invocation);
        return true;
      }
      default: return false;
    }
  };
  return script.commands.every(statement => visit(statement, [])) && invocations.length > 0
    ? { ok: true, invocations } : fail;
}

/** Program identity without directory or Windows extension decoration. */
export function rootName(argv0) {
  return String(argv0).split(/[\\/]/).pop().toLowerCase().replace(/\.(?:exe|bat|cmd|ps1|com)$/i, '');
}

const DANGEROUS_ROOTS = new Set([
  'sudo', 'su', 'doas', 'rm', 'rmdir', 'del', 'erase', 'dd', 'shutdown', 'reboot', 'poweroff', 'halt',
  'mount', 'umount', 'fdisk', 'mkfs', 'chmod', 'chown', 'chgrp', 'chattr', 'curl', 'wget', 'nc', 'ncat', 'netcat',
  'ssh', 'scp', 'sftp', 'bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'cmd', 'powershell', 'pwsh',
  'eval', 'exec', 'xargs', 'env',
]);
const DANGEROUS_ROOT_PATTERN = /^mkfs(?:\..*)?$/;
const TRANSPARENT_WRAPPERS = new Set(['command', 'builtin', 'nohup', 'time']);
const MAX_UNWRAP_DEPTH = 8;

function dangerousArgv(argv, depth) {
  if (argv.length === 0 || depth > MAX_UNWRAP_DEPTH) return undefined;
  const root = rootName(argv[0]);
  if (DANGEROUS_ROOTS.has(root) || DANGEROUS_ROOT_PATTERN.test(root)) return root;
  if (argv[0] === 'command') {
    // Bash command [-pVv]: -v/-V only describe names, including clustered
    // -pv/-pV. Options stop at -- or the first operand; later -v is an
    // argument to the executed program, not a metadata query.
    let index = 1, query = false;
    while (index < argv.length && argv[index].startsWith('-') && argv[index] !== '-') {
      const option = argv[index++];
      if (option === '--') break;
      if (!/^-[pvV]+$/.test(option)) return undefined;
      if (/[vV]/.test(option)) query = true;
    }
    return query ? undefined : dangerousArgv(argv.slice(index), depth + 1);
  }
  if (TRANSPARENT_WRAPPERS.has(root)) {
    let index = 1;
    while (index < argv.length && argv[index].startsWith('-')) index++;
    if (index < argv.length) return dangerousArgv(argv.slice(index), depth + 1);
  }
  return undefined;
}

/** First provably dangerous program root across every invocation, if any. */
export function firstDangerousRoot(analysis) {
  if (!analysis.ok) return undefined;
  for (const invocation of analysis.invocations) {
    const hit = dangerousArgv(invocation.argv, 0);
    if (hit) return hit;
  }
  return undefined;
}

// PATH resolution and the installed runtimes are operator-trusted (ADR-0006).
// Prefixes cannot choose programs, config, loaders or executable pagers.
const SAFE_ENV = {
  CI: /^(?:true|false|0|1)$/,
  LANG: /^(?:C|POSIX|[a-z]{2,3}_[A-Z]{2}(?:\.[A-Za-z0-9-]+)?(?:@[A-Za-z0-9-]+)?)$/,
  LC_ALL: /^(?:C|POSIX|[a-z]{2,3}_[A-Z]{2}(?:\.[A-Za-z0-9-]+)?(?:@[A-Za-z0-9-]+)?)$/,
  LC_CTYPE: /^(?:C|POSIX|[a-z]{2,3}_[A-Z]{2}(?:\.[A-Za-z0-9-]+)?(?:@[A-Za-z0-9-]+)?)$/,
  NO_COLOR: /^(?:|1)$/, FORCE_COLOR: /^[0-3]$/,
  TERM: /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/,
  COLUMNS: /^[1-9][0-9]{0,3}$/, LINES: /^[1-9][0-9]{0,3}$/,
  TZ: /^(?:UTC|GMT)(?:[+-](?:[0-9]|1[0-2]))?$/,
};
function safeEnvironment(env) {
  const seen = new Set();
  return env.every(({ name, value }) => {
    if (seen.has(name) || !Object.hasOwn(SAFE_ENV, name) || !SAFE_ENV[name].test(value)) return false;
    seen.add(name); return true;
  });
}

function safeRedirect({ operator, target }) {
  if (operator === '<<<') return true; // literal here-string, not a path open
  // Bash implements these pathname redirects as sockets, including input-only
  // and numbered fd redirects. Quoting does not disable that special meaning.
  if (/^\/dev\/(?:tcp|udp)(?:\/|$)/.test(target)) return false;
  if (operator === '<') return true;
  if (operator === '>&' && /^\d+$/.test(target)) return true;
  return (operator === '>' || operator === '>>' || operator === '>&') && target === '/dev/null';
}

// Exact tokens, never flag-prefix deny lists, long-option abbreviations, or
// arbitrary short-option clusters. A value option consumes exactly one value.
// '--' changes all remaining tokens to operands, including flag-shaped names.
const textValue = value => value.length > 0 && !value.startsWith('-');
const numberValue = value => /^[0-9]+$/.test(value);
const positiveValue = value => /^[1-9][0-9]*$/.test(value);
const choice = (...values) => value => values.includes(value);
function options(args, flags = '', values = {}, { min = 0, max = Infinity, operand = () => true, numeric = false } = {}) {
  const allowed = new Set(flags.split(' ').filter(Boolean)), found = new Map(), operands = [];
  let end = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!end && arg === '--') { end = true; continue; }
    if (!end && arg.startsWith('-') && arg !== '-') {
      if (numeric && /^-[0-9]+$/.test(arg)) {
        if (found.has('#')) return undefined;
        found.set('#', arg.slice(1)); continue;
      }
      if (allowed.has(arg)) {
        if (found.has(arg)) return undefined;
        found.set(arg, true); continue;
      }
      const equal = arg.startsWith('--') ? arg.indexOf('=') : -1;
      const key = equal < 0 ? arg : arg.slice(0, equal);
      if (found.has(key)) return undefined;
      if (!Object.hasOwn(values, key)) return undefined;
      const value = equal < 0 ? args[++index] : arg.slice(equal + 1);
      if (typeof value !== 'string' || !values[key](value)) return undefined;
      found.set(key, value); continue;
    }
    if (!operand(arg)) return undefined;
    operands.push(arg);
  }
  return operands.length >= min && operands.length <= max ? { found, operands } : undefined;
}
const grammar = (flags = '', values = {}, limits = {}) => args => Boolean(options(args, flags, values, limits));
const oneMode = (parsed, names) => parsed && names.filter(name => parsed.found.has(name)).length <= 1;

function dateReadonly(args) {
  const parsed = options(args, '-u --utc --universal -R --rfc-email -I --debug --resolution', {
    '-d': textValue, '--date': textValue, '-f': textValue, '--file': textValue, '-r': textValue, '--reference': textValue,
    '--iso-8601': choice('date', 'hours', 'minutes', 'seconds', 'ns'),
    '--rfc-3339': choice('date', 'seconds', 'ns'),
  }, { max: 1, operand: value => value.startsWith('+') });
  return Boolean(oneMode(parsed, ['-d', '--date', '-f', '--file', '-r', '--reference']) &&
    oneMode(parsed, ['-R', '--rfc-email', '-I', '--iso-8601', '--rfc-3339', '--resolution']));
}

function findReadonly(args) {
  let index = 0;
  if (['-H', '-L', '-P'].includes(args[index])) index++;
  while (index < args.length && !args[index].startsWith('-') && !['!', '(', ')'].includes(args[index])) index++;
  const expressionStart = index;
  const flags = new Set(['-print', '-print0', '-ls', '-prune', '-quit', '-true', '-false', '-empty',
    '-readable', '-writable', '-executable', '-xdev', '-mount', '-depth', '-noleaf']);
  const values = {
    '-name': textValue, '-iname': textValue, '-path': textValue, '-ipath': textValue,
    '-regex': textValue, '-iregex': textValue, '-newer': textValue,
    '-type': choice('b', 'c', 'd', 'p', 'f', 'l', 's'),
    '-maxdepth': numberValue, '-mindepth': numberValue,
    '-mtime': value => /^[+-]?[0-9]+$/.test(value), '-mmin': value => /^[+-]?[0-9]+$/.test(value),
    '-size': value => /^[+-]?[0-9]+[bcwkMG]?$/.test(value),
  };
  let needTest = true, depth = 0;
  for (; index < args.length; index++) {
    const arg = args[index];
    if (arg === '(') { depth++; needTest = true; continue; }
    if (arg === ')') { if (needTest || --depth < 0) return false; continue; }
    if (arg === '!' || arg === '-not') { needTest = true; continue; }
    if (['-a', '-and', '-o', '-or'].includes(arg)) { if (needTest) return false; needTest = true; continue; }
    if (flags.has(arg)) { needTest = false; continue; }
    if (!Object.hasOwn(values, arg) || typeof args[index + 1] !== 'string' || !values[arg](args[++index])) return false;
    needTest = false;
  }
  return depth === 0 && (expressionStart === args.length || !needTest);
}

function printfReadonly(args) {
  if (args[0] === '--') args = args.slice(1);
  const [format] = args;
  // Bash printf %n and -v assign shell variables and can affect later commands.
  if (typeof format !== 'string' || format.startsWith('-')) return false;
  return !/%/.test(format.replace(/%[-+ #0]*[0-9]*(?:\.[0-9]+)?[bdiouxXfFeEgGcs%]/g, ''));
}
function searchReadonly(args, ripgrep = false) {
  const parsed = options(args, ripgrep
    ? '-n -i -v -l -L -q -s -S -w -x -F -U --files --hidden --no-ignore --line-number --ignore-case --fixed-strings --count --files-with-matches'
    : '-n -r -R -rn -nr -rni -i -v -l -L -q -s -w -x -E -F -P -c -h -H --line-number --recursive --ignore-case --fixed-strings --extended-regexp --count',
  { '-e': textValue, '--regexp': textValue, '-f': textValue, '--file': textValue,
    '-m': positiveValue, '--max-count': positiveValue, '-A': numberValue, '-B': numberValue, '-C': numberValue,
    '--after-context': numberValue, '--before-context': numberValue, '--context': numberValue,
    ...(ripgrep ? { '-g': textValue, '--glob': textValue, '-t': textValue, '--type': textValue } : {}) });
  if (!parsed || !oneMode(parsed, ['-E', '-F', '-P'])) return false;
  const explicitPattern = ['-e', '--regexp', '-f', '--file'].some(key => parsed.found.has(key));
  if (parsed.found.has('--files')) return !explicitPattern;
  return explicitPattern || parsed.operands.length > 0;
}

// Git's built-in commands can still run a configured pager, fsmonitor,
// textconv, external diff, signature verifier, submodule or transport helper.
// Proof only recognizes disabling controls already present in ORIGINAL argv.
const GIT_GLOBAL_FLAGS = new Set(['--no-pager', '--no-optional-locks', '--no-lazy-fetch', '--literal-pathspecs', '--no-literal-pathspecs']);
const GIT_DIFF_FLAGS = '--no-ext-diff --no-textconv -p --patch -s --no-patch --stat --numstat --shortstat --name-only --name-status --raw --check --cached --staged --exit-code --quiet --no-color --color=never';
const GIT_DIFF_VALUES = { '--ignore-submodules': choice('all'), '--unified': numberValue, '-U': numberValue };
const GIT_HISTORY_FLAGS = '--oneline --no-show-signature --no-decorate --all --first-parent --reverse --no-merges --merges --date-order --topo-order';
// Signature-format placeholders (%G*) can launch gpg even with no-show-signature.
const gitFormat = value => ['oneline', 'short', 'medium', 'full', 'fuller', 'reference', '%H', '%h', '%s', '%h %s'].includes(value);
function gitReadonly(args) {
  if (args.length === 1 && ['--version', 'version'].includes(args[0])) return true;
  const controls = new Set();
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    const arg = args[index++];
    if (GIT_GLOBAL_FLAGS.has(arg)) {
      if (controls.has(arg)) return false;
      controls.add(arg); continue;
    }
    if (arg === '-c' && args[index] === 'core.fsmonitor=false' && !controls.has('fsmonitor')) {
      index++; controls.add('fsmonitor'); continue;
    }
    return false;
  }
  const sub = args[index++], rest = args.slice(index);
  if (!controls.has('--no-pager')) return false;
  if (sub === 'config') {
    // One read operation and its exact arity; no mutation, file, editor or
    // implicit get/set interpretation is inferred from a mixed option list.
    const parsed = options(rest, '--get --get-all --get-regexp -l --list', {}, { max: 2 });
    if (!parsed || !oneMode(parsed, ['--get', '--get-all', '--get-regexp', '-l', '--list']) || parsed.found.size !== 1) return false;
    if (parsed.found.has('-l') || parsed.found.has('--list')) return parsed.operands.length === 0;
    return parsed.operands.length === 1 || parsed.found.has('--get-regexp') && parsed.operands.length === 2;
  }
  if (!controls.has('--no-optional-locks') || !controls.has('--no-lazy-fetch') || !controls.has('fsmonitor')) return false;
  switch (sub) {
    // Index refresh and worktree comparisons can run arbitrary named clean/
    // process filters. No argv-only generic switch disables all such filters.
    case 'status': return false;
    case 'diff':
    case 'log':
    case 'show': {
      const history = sub !== 'diff';
      const parsed = options(rest, (history ? GIT_DIFF_FLAGS.replace(' --cached --staged', '') + ' ' + GIT_HISTORY_FLAGS : GIT_DIFF_FLAGS), {
        ...GIT_DIFF_VALUES,
        ...(history ? { '-n': positiveValue, '--max-count': positiveValue, '--format': gitFormat, '--pretty': gitFormat } : {}),
      }, { numeric: history, max: history ? Infinity : 1 });
      if (!parsed?.found.has('--no-ext-diff') || !parsed.found.has('--no-textconv') ||
          parsed.found.get('--ignore-submodules') !== 'all') return false;
      // Cached/staged diff reads index/object content, not worktree conversion.
      // At most one operand also excludes implicit two-path --no-index mode.
      if (!history) return Boolean(oneMode(parsed, ['--cached', '--staged']) &&
        (parsed.found.has('--cached') || parsed.found.has('--staged')));
      return parsed.found.has('--no-show-signature') && oneMode(parsed, ['--oneline', '--format', '--pretty']) &&
        ['--oneline', '--format', '--pretty'].some(flag => parsed.found.has(flag));
    }
    case 'branch':
      return grammar('-a --all -r --remotes -v -vv --verbose --list --show-current --no-color', {},
        { max: rest.includes('--list') ? Infinity : 0 })(rest);
    case 'tag':
      return rest.includes('--list') || rest.includes('-l')
        ? grammar('-l --list -n -i --ignore-case --no-color')(rest) : false;
    case 'remote': return rest.length === 0 || rest.length === 1 && ['-v', '--verbose'].includes(rest[0]);
    case 'cat-file': {
      const parsed = options(rest, '-p -s -t -e', {}, { min: 1, max: 1 });
      return Boolean(parsed && parsed.found.size === 1);
    }
    case 'grep': {
      const parsed = options(rest, '--no-textconv -n -i -v -l -L -q -w -E -F --cached --no-index',
        { '-e': textValue }, { min: 1 });
      return Boolean(parsed?.found.has('--no-textconv') && oneMode(parsed, ['-E', '-F']));
    }
    case 'rev-parse': {
      const parsed = options(rest, '--show-toplevel --show-prefix --show-cdup --git-dir --is-inside-work-tree --is-bare-repository --verify --short --abbrev-ref --symbolic-full-name', {}, { max: 1 });
      if (!parsed || !parsed.found.size && !parsed.operands.length) return false;
      return !['--verify', '--short', '--abbrev-ref', '--symbolic-full-name'].some(flag => parsed.found.has(flag)) || parsed.operands.length === 1;
    }
    // --modified calls ie_modified -> index_fd -> configured clean/process
    // filters. Deleted/other listings only stat or enumerate; no refresh.
    case 'ls-files': return grammar('-s --stage -o --others -c --cached -d --deleted -z --exclude-standard')(rest);
    case 'ls-tree': return grammar('-r -t -l --name-only --name-status -z', {}, { min: 1 })(rest);
    default: return false; // includes reflog mutations, stash and transport helpers
  }
}

/** Each supported program has a positive grammar and operand constraints.
 * Unsupported syntax means reviewer/manual fallback, never a hard denial. */
const READONLY_COMMANDS = new Map(Object.entries({
  ls: grammar('-a -A -l -la -al -h -lh -hl -lah -alh -R -d -i -s -t -r -S -1 --all --almost-all --long --human-readable --recursive --directory --help --version',
    { '--color': choice('always', 'auto', 'never'), '--sort': choice('none', 'time', 'size', 'extension', 'version'), '--time-style': textValue }),
  cat: grammar('-n -b -s -v -E -T -A --number --number-nonblank --squeeze-blank --show-all --help --version'),
  head: grammar('-q -v --quiet --verbose', { '-n': numberValue, '--lines': numberValue, '-c': numberValue, '--bytes': numberValue }, { numeric: true }),
  tail: grammar('-q -v --quiet --verbose', { '-n': numberValue, '--lines': numberValue, '-c': numberValue, '--bytes': numberValue }, { numeric: true }),
  wc: grammar('-l -w -c -m -L --lines --words --bytes --chars --max-line-length'),
  file: grammar('-b -i -I -L -h -N --brief --mime --mime-type --mime-encoding --dereference --no-dereference', {}, { min: 1 }),
  stat: grammar('-L -f --dereference --file-system', { '-c': textValue, '--format': textValue, '--printf': textValue }, { min: 1 }),
  pwd: grammar('-L -P --logical --physical', {}, { max: 0 }),
  which: grammar('-a --all', {}, { min: 1 }),
  echo: grammar('-n -e -E'),
  printf: printfReadonly,
  printenv: grammar('-0 --null'),
  uname: grammar('-a -s -n -r -v -m -p -i -o --all --kernel-name --nodename --kernel-release --kernel-version --machine --processor --hardware-platform --operating-system', {}, { max: 0 }),
  id: grammar('-u -g -G -n -r -un -gn --user --group --groups --name --real', {}, { max: 1 }),
  whoami: grammar('', {}, { max: 0 }), groups: grammar(),
  uptime: grammar('-p -s --pretty --since', {}, { max: 0 }),
  df: grammar('-h -H -k -i -a -l -T --human-readable --local --print-type'),
  du: grammar('-h -s -sh -hs -a -c -k -x --human-readable --summarize --total --one-file-system', { '-d': numberValue, '--max-depth': numberValue }),
  ps: args => grammar('-ef -e -f -A -a -x --forest', { '-p': value => /^[0-9]+(?:,[0-9]+)*$/.test(value),
    '-o': value => /^[A-Za-z0-9_,=% -]+$/.test(value), '--sort': value => /^[A-Za-z0-9_,+-]+$/.test(value) }, { max: 0 })(['aux', 'ax'].includes(args[0]) ? args.slice(1) : args),
  free: grammar('-h -b -k -m -g --human --bytes --kibi --mebi --gibi', {}, { max: 0 }),
  true: grammar('', {}, { max: 0 }), false: grammar('', {}, { max: 0 }),
  basename: grammar('-a --multiple', { '-s': textValue, '--suffix': textValue }, { min: 1, max: 2 }),
  dirname: grammar('-z --zero', {}, { min: 1 }),
  realpath: grammar('-e -m -s -z --canonicalize-existing --canonicalize-missing --no-symlinks --zero', {}, { min: 1 }),
  readlink: grammar('-f -e -m -n -z --canonicalize --canonicalize-existing --canonicalize-missing --no-newline --zero', {}, { min: 1 }),
  diff: grammar('-u -q -r -s -w -b -i -B --unified --brief --recursive --report-identical-files --ignore-all-space --ignore-space-change --ignore-case', {}, { min: 2, max: 2 }),
  comm: grammar('-1 -2 -3 -12 -13 -23 --check-order --nocheck-order', {}, { min: 2, max: 2 }),
  uniq: grammar('-c -d -u -i -z --count --repeated --unique --ignore-case --zero-terminated',
    { '-f': numberValue, '--skip-fields': numberValue, '-s': numberValue, '--skip-chars': numberValue, '-w': numberValue, '--check-chars': numberValue }, { max: 1 }),
  tr: args => {
    const parsed = options(args, '-d -s -c -C --delete --squeeze-repeats --complement', {}, { min: 1, max: 2 });
    if (!parsed) return false;
    const deleting = parsed.found.has('-d') || parsed.found.has('--delete');
    const squeezing = parsed.found.has('-s') || parsed.found.has('--squeeze-repeats');
    return squeezing && !deleting || parsed.operands.length === (deleting ? squeezing ? 2 : 1 : 2);
  },
  cut: args => {
    const fields = value => /^[0-9,-]+$/.test(value);
    const parsed = options(args, '-s --only-delimited --complement -z --zero-terminated', { '-b': fields, '--bytes': fields,
      '-c': fields, '--characters': fields, '-f': fields, '--fields': fields,
      '-d': value => value.length === 1, '--delimiter': value => value.length === 1 });
    return Boolean(parsed && ['-b', '--bytes', '-c', '--characters', '-f', '--fields'].filter(key => parsed.found.has(key)).length === 1);
  },
  paste: grammar('-s --serial -z --zero-terminated', { '-d': textValue, '--delimiters': textValue }),
  join: grammar('-i --ignore-case --check-order --nocheck-order', { '-1': positiveValue, '-2': positiveValue, '-t': textValue }, { min: 2, max: 2 }),
  grep: args => searchReadonly(args), egrep: args => searchReadonly(args), fgrep: args => searchReadonly(args),
  rg: args => searchReadonly(args, true),
  jq: grammar('-r -c -s -e -n -R -S -M --raw-output --compact-output --slurp --exit-status --null-input --raw-input --sort-keys --monochrome-output', {}, { min: 1 }),
  strings: grammar('-a -d -f --all --data --print-file-name', { '-n': positiveValue, '--bytes': positiveValue, '-t': choice('d', 'o', 'x'), '--radix': choice('d', 'o', 'x') }),
  od: grammar('-a -b -c -d -f -o -s -x -v', { '-A': choice('d', 'o', 'x', 'n'), '-j': numberValue, '-N': numberValue, '-t': textValue }),
  xxd: args => {
    const parsed = options(args, '-p -i -a -u', { '-l': numberValue, '-c': positiveValue, '-g': positiveValue, '-s': numberValue }, { max: 1 });
    return Boolean(oneMode(parsed, ['-p', '-i']));
  },
  hexdump: grammar('-b -c -C -d -o -x -v', { '-n': numberValue, '-s': numberValue }),
  sort: args => {
    const parsed = options(args, '-r -n -g -h -V -f -b -d -i -u -c --reverse --numeric-sort --general-numeric-sort --human-numeric-sort --version-sort --unique --check',
      { '-k': textValue, '--key': textValue, '-t': textValue, '--field-separator': textValue });
    // An ordinary sort may spill to temporary files; only streaming check mode
    // is proven read-only from argv without reading/attesting the input size.
    return Boolean(oneMode(parsed, ['-n', '-g', '-h', '-V', '--numeric-sort', '--general-numeric-sort', '--human-numeric-sort', '--version-sort']) &&
      (parsed.found.has('-c') || parsed.found.has('--check')));
  },
  tree: grammar('-a -d -f -i -l -p -s -h -u -g --dirsfirst', { '-L': numberValue, '-P': textValue, '-I': textValue }),
  find: findReadonly, date: dateReadonly, git: gitReadonly,
}));

function readonlyInvocation(invocation) {
  if (!invocation.redirects.every(safeRedirect) || !safeEnvironment(invocation.env)) return false;
  // Assignment-only statements persist into later invocations (PATH=.; ls).
  if (invocation.argv.length === 0) return false;
  const [program, ...args] = invocation.argv;
  // Proof is case-sensitive POSIX identity, not danger detection's rootName.
  // Paths, suffixes and case variants do not inherit another program's policy.
  const check = READONLY_COMMANDS.get(program);
  return check ? check(args) : false;
}

/** Every invocation must satisfy its whole positive grammar. */
export function isReadonly(analysis) {
  return analysis.ok && analysis.invocations.length > 0 && analysis.invocations.every(readonlyInvocation);
}
