import test from 'node:test';
import assert from 'node:assert/strict';
import { dangerousCommand, programName, tokenize } from '../src/dangerous.js';

const flagged = [
  ['bash', 'rm -rf node_modules', 'forced-rm'],
  ['bash', 'rm -f x', 'forced-rm'],
  ['bash', 'rm --force x', 'forced-rm'],
  ['bash', 'sudo rm -rf /', 'forced-rm'],
  ['bash', 'FOO=1 env -i rm -fr tmp', 'forced-rm'],
  ['bash', 'bash -lc "rm -rf build"', 'forced-rm'],
  ['bash', 'echo $(rm -rf x)', 'forced-rm'],
  ['bash', 'echo "$(rm -rf x)"', 'forced-rm'],
  ['bash', 'echo `rm -rf x`', 'forced-rm'],
  ['bash', 'git status && rm -rf dist', 'forced-rm'],
  ['bash', 'ls | xargs rm -f', 'forced-rm'],
  ['pwsh', 'Remove-Item -Recurse -Force dist', 'force-delete'],
  ['pwsh', 'ri x -Force', 'force-delete'],
  ['pwsh', 'Remove-Item x -Force:$true', 'force-delete'],
  ['pwsh', 'if ($true) { Remove-Item x -Force }', 'force-delete'],
  ['pwsh', 'Get-ChildItem *.tmp | ForEach-Object { Remove-Item $_ -Force }', 'force-delete'],
  ['pwsh', 'cmd /c del /f a.txt', 'force-delete'],
  ['pwsh', 'cmd /c rd /s /q dir', 'force-delete'],
  ['bash', 'cmd.exe /C "del /F /Q a.txt"', 'force-delete'],
  ['pwsh', 'Start-Process https://example.com', 'url-launch'],
  ['pwsh', 'start https://example.com', 'url-launch'],
  ['bash', 'explorer.exe https://example.com', 'url-launch'],
  ['bash', 'rundll32 url.dll,FileProtocolHandler https://example.com', 'url-launch'],
  ['pwsh', 'pwsh -Command "Remove-Item a -Force"', 'force-delete'],
  ['pwsh', 'powershell.exe -NoProfile -Command Remove-Item a -Force', 'force-delete'],
  ['bash', 'C:\\Windows\\System32\\cmd.exe /c del /f x', 'force-delete'],
];

const notFlagged = [
  // Reported false positives of the previous design.
  ['pwsh', 'Get-Content AGENTS.md'],
  ['pwsh', 'git log --oneline -5 -- .github/workflows'],
  ['bash', 'grep -rn "api_key:" src'],
  ['pwsh', '$token = 1; echo $token'],
  ['pwsh', 'Get-ChildItem $env:USERPROFILE\\.dsh\\sessions'],
  ['bash', 'cat .dsh/config.toml'],
  ['bash', 'curl --version'],
  ['bash', 'env | sort'],
  ['bash', 'find . -name "*.js" | xargs wc -l'],
  ['pwsh', 'Remove-Item .scratch\\tmp.txt'],
  ['bash', 'rm file.txt'],
  ['pwsh', 'pnpm --filter x test 2>&1 | Select-Object -Last 20'],
  ['bash', 'git status'],
  // Other ordinary development commands.
  ['bash', 'pnpm install && pnpm test'],
  ['bash', 'node --test test/*.test.js 2>&1 | tail -n 20'],
  ['pwsh', 'Select-String -Path .env.example -Pattern FOO'],
  ['pwsh', 'git diff --stat; git status --short'],
  ['bash', 'echo "remove -force is just text"'],
  ['pwsh', 'Write-Output "see https://example.com"'],
  ['bash', 'rm -r build'],
  ['bash', 'git rm -f --cached file'],
  ['pwsh', 'Remove-Item -Recurse dist'],
  ['bash', 'docker run --rm -f x'],
  ['bash', ''],
  ['bash', '   '],
];

for (const [tool, command, rule] of flagged) {
  test(`flags ${tool}: ${command}`, () => assert.equal(dangerousCommand(command, tool), rule));
}
for (const [tool, command] of notFlagged) {
  test(`does not flag ${tool}: ${JSON.stringify(command)}`, () => assert.equal(dangerousCommand(command, tool), undefined));
}

test('non-string commands are ignored and oversized commands are flagged for review', () => {
  for (const value of [undefined, null, 1, {}, []]) assert.equal(dangerousCommand(value, 'bash'), undefined);
  assert.equal(dangerousCommand(`echo ${'x'.repeat(40000)}`, 'bash'), 'command-too-long');
});

test('deep nesting fails closed into review', () => {
  let command = 'echo hi';
  for (let i = 0; i < 10; i++) command = `echo $(${command})`;
  assert.equal(dangerousCommand(command, 'bash'), 'nesting-too-deep');
});

test('programName strips directories, drive letters and Windows extensions', () => {
  assert.equal(programName('/usr/bin/rm'), 'rm');
  assert.equal(programName('C:\\Windows\\System32\\CMD.EXE'), 'cmd');
  assert.equal(programName('Remove-Item'), 'remove-item');
  assert.equal(programName(undefined), '');
});

test('tokenize keeps redirections inside a segment and splits on command separators', () => {
  assert.deepEqual(tokenize('a 2>&1 | b; c && d').segments, [['a', '2>&1'], ['b'], ['c'], ['d']]);
  assert.deepEqual(tokenize('echo "a b" \'c d\'').segments, [['echo', 'a b', 'c d']]);
  assert.deepEqual(tokenize('echo $(rm -rf x)').nested, ['rm -rf x']);
});
