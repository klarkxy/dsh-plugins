import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeShell, isReadonly, firstDangerousRoot, rootName } from '../src/shell-command.js';
import { hardRisk } from '../src/policy.js';

const readonly = command => isReadonly(analyzeShell(command));
const danger = command => firstDangerousRoot(analyzeShell(command));
const git = 'git --no-pager --no-optional-locks --no-lazy-fetch -c core.fsmonitor=false ';
const diffControls = '--no-ext-diff --no-textconv --ignore-submodules=all ';
const g = rest => git + rest;
const history = rest => g('log ' + diffControls + '--no-show-signature --oneline ' + rest);

test('strict parse collects every simple invocation across chains and pipes', () => {
  const analysis = analyzeShell('git status && ls -la | head -5 ; pwd');
  assert.equal(analysis.ok, true);
  assert.deepEqual(analysis.invocations.map(i => i.argv), [
    ['git', 'status'], ['ls', '-la'], ['head', '-5'], ['pwd'],
  ]);
});
test('parse fails closed on anything beyond literal simple commands', () => {
  for (const command of [
    'ls $(id)', 'echo `whoami`', 'echo $HOME', 'echo a{1,2}', 'ls *.js', 'echo ~', 'echo "a $b c"',
    'cat <(ls)', 'echo $((1+2))', 'ls &', '(ls)', 'if true; then ls; fi', 'for f in a; do ls; done',
    'VAR=$(cmd) ls', '', 'x'.repeat(10001),
  ]) {
    assert.equal(analyzeShell(command).ok, false, JSON.stringify(command));
  }
});
test('env assignment prefixes are literal-checked and collected', () => {
  const analysis = analyzeShell('CI=true git status');
  assert.equal(analysis.ok, true);
  assert.deepEqual(analysis.invocations[0].env, [{ name: 'CI', value: 'true' }]);
  assert.equal(analyzeShell('FOO=$(cmd) ls').ok, false);
});
test('rootName strips directories and Windows extensions', () => {
  assert.equal(rootName('/usr/bin/git'), 'git');
  assert.equal(rootName('C:\\Tools\\RM.EXE'), 'rm');
  assert.equal(rootName('mkfs.ext4'), 'mkfs.ext4');
});
test('danger detection unwraps transparent wrappers and checks every invocation', () => {
  assert.equal(danger('sudo rm -rf /tmp/x'), 'sudo');
  assert.equal(danger('ls && rm -rf x'), 'rm');
  assert.equal(danger('ls | rm x'), 'rm');
  assert.equal(danger('time rm x'), 'rm');
  assert.equal(danger('command rm x'), 'rm');
  assert.equal(danger('command -- rm harmless-marker'), 'rm');
  assert.equal(danger('command -p -- rm harmless-marker'), 'rm');
  assert.equal(danger('/bin/rm x'), 'rm');
  assert.equal(danger('mkfs.ext4 /dev/sda'), 'mkfs.ext4');
  assert.equal(danger('curl https://example.com'), 'curl');
  assert.equal(danger('git status'), undefined);
  assert.equal(danger('ls | grep foo'), undefined);
  // Unparseable commands are outside static proof entirely.
  assert.equal(danger('echo "$(rm x)"'), undefined);
});

test('Bash command metadata queries do not execute the named dangerous program', () => {
  for (const command of [
    'command -v rm', 'command -V bash', 'command -pv rm', 'command -pV bash',
    'command -vp rm', 'command -Vp bash', 'command -v -p -- rm', 'command -V -- bash',
    'command -- -v rm', 'command -z rm',
  ]) {
    assert.equal(danger(command), undefined, command);
    assert.equal(hardRisk({ tool: 'bash', args: { command } }), undefined, command);
    assert.equal(readonly(command), false, 'query still requires review: ' + command);
  }
  for (const command of ['command rm harmless-marker', 'command -- rm harmless-marker', 'command -p rm harmless-marker', 'command rm -v']) {
    assert.equal(danger(command), 'rm', command);
    assert.equal(hardRisk({ tool: 'bash', args: { command } })?.code, 'DANGEROUS_PROGRAM', command);
  }
});
test('read-only proof retains ordinary reads and original controlled Git forms', () => {
  for (const command of [
    'ls -la /tmp', 'cat package.json | jq .name', 'grep -rn foo src | head -20',
    'find . -name "*.md"', 'find . -type f -maxdepth 2 -print0', 'ps aux | grep node',
    'df -h && du -sh .', 'echo hello world', 'printf "%s" hi', 'date', 'date -d 2020-01-01',
    'date --debug', 'date --resolution', 'date --date=2020-01-01 +%F',
    'CI=true LANG=C ls 2>&1', 'cat < in.txt', 'ls >> /dev/null', 'xxd -p input',
    'uniq -c input', 'file --mime-type input', 'rg -n pattern src', 'rg --files src',
    'ls -- -la', 'file -- -C', 'xxd -- -rps', 'uniq -- --output',
    'sort --check input', g('diff ' + diffControls + '--cached --stat HEAD~1'),
    history('-10'), g('show ' + diffControls + '--no-show-signature --format=%H HEAD'),
    g('branch -v'), g('branch --list "feature*"'), g('tag -l "v1*"'),
    g('remote -v'), g('cat-file -p HEAD'), g('rev-parse --show-toplevel'),
    g('grep --no-textconv pattern -- src'),
    g('ls-files -s'), g('ls-files --deleted'), g('ls-files --others --exclude-standard'),
    'git --version', 'git version', 'git --no-pager config --get user.name',
  ]) assert.equal(readonly(command), true, JSON.stringify(command));
});
test('read-only proof: write-capable or unknown commands fail closed', () => {
  for (const command of [
    'ls > out.txt', 'ls > /dev/tcp/evil', 'tee out.txt', 'npm install', 'pnpm ls', 'node -e 1',
    'git -C /x log', 'git -c a=b status', 'git log --output=x', 'git branch foo', 'git branch -d foo',
    'git tag v1', 'git tag -d v1', 'git remote add a b', 'git config user.name x', 'git stash pop',
    'sed s/a/b/ f', 'find . -delete', 'find . -exec ls {} ;', 'sort -o out f', 'tree -o out',
    'date -s 2020-01-01', 'date 010100002020', 'FOO=bar ls', './run.sh', '/bin/ls', 'xargs rm',
    'rm -rf x', 'curl https://example.com', 'wget https://example.com', 'chmod +x f',
  ]) {
    assert.equal(readonly(command), false, JSON.stringify(command));
  }
});
test('hardRisk denies dangerous roots anywhere in a fully parsed command', () => {
  assert.equal(hardRisk({ tool: 'bash', args: { command: 'ls && rm -rf /tmp/x' } })?.code, 'DANGEROUS_PROGRAM');
  assert.equal(hardRisk({ tool: 'bash', args: { command: 'echo ok | rm x' } })?.code, 'DANGEROUS_PROGRAM');
  assert.equal(hardRisk({ tool: 'bash', args: { command: 'time sudo ls' } })?.code, 'DANGEROUS_PROGRAM');
  assert.equal(hardRisk({ tool: 'pwsh', args: { command: 'ls; rm x' } })?.code, 'DANGEROUS_PROGRAM');
  // Unexplained command-substitution contents still require the reviewer.
  assert.equal(hardRisk({ tool: 'bash', args: { command: 'echo "$(rm x)"' } }), undefined);
  assert.equal(hardRisk({ tool: 'bash', args: { command: 'git status && ls' } }), undefined);
});

test('helper options, output operands and equivalent option forms never prove a read', () => {
  for (const command of [
    'rg --pre=node pattern src', 'rg --pre node pattern src', 'rg --p=node pattern src',
    'rg --pre= pattern src', 'rg --search-zip pattern a.gz', 'rg -z pattern a.gz',
    'xxd a b', 'xxd -r input output', 'xxd -rps input output', 'xxd -rps input',
    'uniq a b', 'file --mime-type --compile input', 'file -C', 'file --compile input',
    'file -z input', 'file --uncompress input', 'file --uncompress-noreport input',
    'rg --hostname-bin=node pattern src', 'file -iz input',
    'sort --compress-program=node input', 'sort --compress-program node input', 'sort --output=input',
    'tree -o input', 'find . -fprint input', 'find . -fls input', 'sort input',
    'date --debug --set=2020-01-01', 'date --debug --set 2020-01-01',
    'date --resolution -s 2020-01-01', 'date --resolution --set=2020-01-01',
    'date --de=now', 'date -d', 'date -r', 'date --date=now --reference=input',
    'xxd -p -i input', 'grep --unknown pattern input', 'ls -lZQ', 'ls --col=never',
    'head -n', 'head --lines=', 'strings -t', 'ps --sort', 'find . -name',
    'find . -type bogus', 'cut -b 1 -c 2', 'uniq input output', 'sort -c -n -g input', 'date --rfc-3339=hours',
    'printf %n PATH; ls', 'printf -v PATH .; ls',
  ]) {
    assert.equal(readonly(command), false, JSON.stringify(command));
    assert.equal(hardRisk({ tool: 'bash', args: { command } }), undefined, 'fallback is not hard denial: ' + command);
  }
});
test('environment is checked before empty argv; assignments cannot change later resolution', () => {
  for (const command of [
    'PATH=.; ls', 'PAGER=node; git log', 'GIT_PAGER=node git log', 'PAGER=node ls',
    'GIT_CONFIG_COUNT=1 git status', 'GIT_EXTERNAL_DIFF=node git diff', 'LD_PRELOAD=x ls',
    'LANG=C; ls', 'CI=true', 'FOO=bar', 'CI=true CI=false ls', 'LANG=node ls',
    'TERM="x;node" ls', 'COLUMNS=0 ls', 'FORCE_COLOR=4 ls',
  ]) assert.equal(readonly(command), false, JSON.stringify(command));
  assert.equal(readonly('CI=true LANG=en_US.UTF-8 NO_COLOR="" ls'), true);
});
test('proof uses exact POSIX executable names; normalization remains danger-only', () => {
  for (const command of ['LS -la', 'ls.exe -la', 'ls.cmd -la', '/bin/ls -la', './ls -la', 'Git status']) {
    assert.equal(readonly(command), false, command);
  }
  assert.equal(danger('RM.EXE x'), 'rm');
  assert.equal(danger('command /bin/rm x'), 'rm');
});
test('Git subcommands and disabling controls are positive grammar, never inferred or added', () => {
  for (const command of [
    'git status', 'git diff', 'git log --oneline', 'git --no-pager status',
    g('status'), g('status --ignore-submodules=all --short'),
    g('diff ' + diffControls + '--stat'), g('diff ' + diffControls + '--cached outside/a outside/b'),
    g('diff --no-ext-diff'), g('diff --no-textconv'),
    g('diff ' + diffControls + '--ext-diff'), g('diff ' + diffControls + '--textconv'),
    g('log ' + diffControls + '--oneline'), g('log ' + diffControls + '--no-show-signature'),
    g('log ' + diffControls + '--no-show-signature --format=%G?'),
    history('--show-signature'), history('--textconv'),
    g('cat-file --filters HEAD'), g('cat-file --textconv HEAD'), g('rev-parse --verify'),
    'git --no-pager --no-optional-locks -c core.fsmonitor=false cat-file -p HEAD',
    'git --no-pager --no-optional-locks --no-lazy-f -c core.fsmonitor=false cat-file -p HEAD',
    g('ls-files -m'), g('ls-files --modified'), g('ls-files -s --modified'),
    g('reflog expire --all'), g('reflog delete HEAD@{0}'), g('reflog show'),
    g('branch -e'), g('branch --edit-description'),
    g('grep --no-textconv --open-files-in-pager=node pattern'),
    g('grep --no-textconv --open-files-in-pager pattern'), g('grep --no-textconv -O pattern'),
    g('remote show origin'), g('remote get-url --add origin'), g('ls-remote origin'),
    'git --no-pager config --get --unset user.name',
    'git --no-pager config --get --rename-section a b',
    'git --no-pager config --list --remove-section a',
    'git --no-pager config --get user.name extra',
    'git --no-pager config --get', 'git --no-pager config --ge user.name',
    'git --no-pager config user.name',
    g('-c core.fsmonitor=true status --ignore-submodules=all'),
    g('status --ignore-submodules=all --unknown'), g('diff ' + diffControls + '--output=input'),
  ]) assert.equal(readonly(command), false, JSON.stringify(command));
});

test('mixed quote parts do not make unquoted glob/brace expansion literal', () => {
  for (const command of [
    'cat ".e"*', 'cat ".env"*', 'cat "."[e]nv', 'ls "x"*',
    'xxd ""*', 'uniq ""*', 'rg ""*', 'ls "x"{a,b}',
    'cat < ".e"*',
  ]) {
    assert.equal(analyzeShell(command).ok, false, command);
    assert.equal(readonly(command), false, command);
  }
  for (const command of ['ls "*"', "ls '[e]'", 'find . -name "*.md"', 'cat ordinary""name']) {
    assert.equal(readonly(command), true, command);
  }
  for (const command of ['rm "x"*', 'ls; rm "x"*', 'command rm "x"*', 'rm "$UNRESOLVED"', 'r\\m "x"*']) {
    assert.equal(hardRisk({ tool: 'bash', args: { command } })?.code, 'DANGEROUS_PROGRAM', command);
  }
});

test('network pseudo-file opens fall back; ordinary input, fd merges and null output remain read-only', () => {
  for (const command of [
    'true < /dev/tcp/127.0.0.1/43123', 'true < "/dev/tcp/127.0.0.1/43123"',
    "true 3< '/dev/tcp/127.0.0.1/43123'", 'true < /dev/udp/127.0.0.1/43123',
    'true < /dev/tcp/127.0.0.1/43123 > /dev/null', 'true < "/dev/"tcp/127.0.0.1/43123',
  ]) {
    assert.equal(readonly(command), false, command);
    assert.equal(hardRisk({ tool: 'bash', args: { command } }), undefined, 'network redirect is a review fallback');
  }
  for (const command of ['cat < input', 'true 3< input', 'ls 2>&1', 'ls > /dev/null']) {
    assert.equal(readonly(command), true, command);
  }
});

test('decoded argv, environment and redirects preserve sensitive hard refusals across quote concatenation', () => {
  for (const command of [
    "cat '.env'", 'cat ".git/config"', 'cat .e""nv', "cat .en'v'", "cat < '.env'", 'cat < .e""nv',
    "echo 'tok'en=fictional123", "printf '%s' 'tok'en=fictional123", 'CI="tok"en=fictional123 ls',
    "date --file='.env'", "cat '.git'/config", "cat 'dir with spaces/.env'",
    "git --no-pager config --get 'HEAD:.env'", "cat '.env' && echo \"$UNRESOLVED\"",
    "if true; then cat '.env'; fi",
    "cat '.env' " + 'x'.repeat(11000),
  ]) {
    for (const tool of ['bash', 'pwsh', 'shell']) {
      assert.equal(hardRisk({ tool, args: { command } })?.code, 'SENSITIVE_COMMAND', tool + ': ' + command);
    }
  }
});
