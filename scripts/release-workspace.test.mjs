import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { orderedPackages, packRelease, publishManifest, releaseCandidates, releaseWorkspace } from './release-workspace.mjs';
import { validateHeldDependencies } from './publish-npm.mjs';
import { discoverPackages } from './release-target.mjs';
import { fileURLToPath } from 'node:url';
function fixture(t) { const root = mkdtempSync(join(tmpdir(), 'dsh-workspace-release-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
function writePackage(root, name, dependencies = {}) {
  const directory = `plugins/${name.split('/').pop()}`;
  mkdirSync(join(root, directory), { recursive: true });
  const pkg = { name, version: '1.2.3', directory };
  writeFileSync(join(root, directory, 'package.json'), JSON.stringify({ name, version: pkg.version, type: 'module', files: ['index.js'], dependencies }));
  writeFileSync(join(root, directory, 'index.js'), 'export const ready = true;\n'); return pkg;
}
const npm = (args, cwd) => execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm', ...args] : args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' } });
test('orders workspace dependencies before dependants regardless of directory order', t => {
  const root = fixture(t), base = writePackage(root, '@klarkxy/dsh-base');
  const feature = writePackage(root, '@klarkxy/dsh-feature', { [base.name]: 'workspace:*' });
  assert.deepEqual(orderedPackages(root, [feature, base]).map(p => p.name), [base.name, feature.name]);
});
test('rejects missing release targets and cycles', t => {
  const root = fixture(t), a = writePackage(root, '@klarkxy/dsh-a', { '@klarkxy/dsh-b': 'workspace:*' });
  assert.throws(() => orderedPackages(root, [a]), /not a release target/);
  const b = writePackage(root, '@klarkxy/dsh-b', { [a.name]: 'workspace:*' });
  assert.throws(() => orderedPackages(root, [a, b]), /Cyclic/);
});
test('resolves all supported workspace ranges without mutating source manifests', () => {
  const manifest = { dependencies: { a: 'workspace:*' }, optionalDependencies: { a: 'workspace:^' }, peerDependencies: { a: 'workspace:~' }, devDependencies: { a: 'workspace:*' } };
  const result = publishManifest(manifest, new Map([['a', '2.3.4']]));
  assert.equal(result.dependencies.a, '2.3.4'); assert.equal(result.optionalDependencies.a, '^2.3.4');
  assert.equal(result.peerDependencies.a, '~2.3.4'); assert.equal(result.devDependencies.a, '2.3.4');
  assert.equal(manifest.dependencies.a, 'workspace:*');
  assert.throws(() => publishManifest(manifest, new Map()), /Missing workspace version/);
  assert.throws(() => publishManifest({ dependencies: { a: 'workspace:../a' } }, new Map([['a', '1.0.0']])), /Unsupported/);
});
test('real tarball contains resolved workspace dependencies and keeps source untouched', t => {
  const root = fixture(t), dependency = writePackage(root, '@klarkxy/dsh-dep');
  const feature = writePackage(root, '@klarkxy/dsh-feature', { [dependency.name]: 'workspace:*' });
  const packed = packRelease(root, feature, [dependency, feature], npm, (files, read) => {
    const manifest = JSON.parse(read('package.json')); assert.equal(manifest.dependencies[dependency.name], '1.2.3');
    assert.ok(files.some(file => file.path === 'index.js')); return 'verified';
  });
  const tarManifest = JSON.parse(execFileSync('tar', ['-xOf', packed.archive, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(tarManifest.dependencies[dependency.name], '1.2.3'); assert.equal(packed.hash, 'verified');
  assert.equal(JSON.parse(readFileSync(join(root, feature.directory, 'package.json'))).dependencies[dependency.name], 'workspace:*');
});
test('staging preserves archive integrity without workspace dependencies', t => {
  const root = fixture(t), pkg = writePackage(root, '@klarkxy/dsh-plain');
  const file = join(root, pkg.directory, 'package.json');
  writeFileSync(file, JSON.stringify(JSON.parse(readFileSync(file)), null, 2) + '\n');
  const [original] = JSON.parse(npm(['pack', '--ignore-scripts', '--json'], join(root, pkg.directory)));
  const staged = packRelease(root, pkg, [pkg], npm, () => 'unused');
  assert.equal(staged.packed.integrity, original.integrity);
});
test('release handoff gate holds only migrated packages and rejects malformed data', t => {
  const root = fixture(t), migrated = writePackage(root, '@klarkxy/dsh-migrated'), other = writePackage(root, '@klarkxy/dsh-other');
  const packages = [migrated, other]; mkdirSync(join(root, 'scripts'));
  const file = join(root, 'scripts/editor-plugin-migration.json');
  writeFileSync(file, JSON.stringify({ holdPublish: true, packages: [migrated] }));
  assert.deepEqual(releaseCandidates(root, packages), [other]);
  writeFileSync(file, JSON.stringify({ holdPublish: false, packages: [migrated] }));
  assert.deepEqual(releaseCandidates(root, packages), packages);
  writeFileSync(file, JSON.stringify({ packages: [migrated] }));
  assert.throws(() => releaseCandidates(root, packages), /Invalid/);
});

test('held dependencies supply versions without joining the publication targets', t => {
  const root = fixture(t), held = writePackage(root, '@klarkxy/dsh-held');
  const child = writePackage(root, '@klarkxy/dsh-child', { [held.name]: 'workspace:*' });
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts/editor-plugin-migration.json'), JSON.stringify({ holdPublish: true, packages: [held] }));
  const workspace = releaseWorkspace(root, [child, held]);
  assert.deepEqual(workspace.packages, [held, child]);
  assert.deepEqual(workspace.candidates, [child]);
  assert.deepEqual(workspace.heldDependencies, [held]);
  const packed = packRelease(root, child, workspace.packages, npm, (_files, read) => {
    assert.equal(JSON.parse(read('package.json')).dependencies[held.name], held.version);
    return 'verified-held-version';
  });
  assert.equal(packed.hash, 'verified-held-version');
});

test('held dependency versions must already exist on npm', async () => {
  const dependency = { name: '@klarkxy/dsh-held', version: '1.2.3' };
  const calls = [];
  await validateHeldDependencies([dependency], async (name, _fetcher, version) => {
    calls.push([name, version]);
    return { versions: { '1.2.3': { name, version } } };
  });
  assert.deepEqual(calls, [[dependency.name, dependency.version]]);
  await assert.rejects(validateHeldDependencies([dependency], async () => ({ versions: {} })), /not published/);
  await assert.rejects(validateHeldDependencies([dependency], async () => { throw new Error('registry unavailable'); }), /registry unavailable/);
});

test('review holds compose with the migration gate and can hold every public package', t => {
  const root = fixture(t), a = writePackage(root, '@klarkxy/dsh-a'), b = writePackage(root, '@klarkxy/dsh-b');
  mkdirSync(join(root, 'scripts'));
  const file = join(root, 'scripts/npm-release-holds.json');
  writeFileSync(file, JSON.stringify({ packages: [{ name: a.name, reason: 'Pending host acceptance' }] }));
  assert.deepEqual(releaseCandidates(root, [a, b]), [b]);
  writeFileSync(join(root, 'scripts/editor-plugin-migration.json'), JSON.stringify({ holdPublish: true, packages: [b] }));
  assert.deepEqual(releaseCandidates(root, [a, b]), []);
  assert.deepEqual(releaseWorkspace(root, [a, b]).heldDependencies, []);
});

test('review holds reject malformed, duplicate and unknown package entries', t => {
  const root = fixture(t), a = writePackage(root, '@klarkxy/dsh-a');
  mkdirSync(join(root, 'scripts'));
  for (const holds of [{}, { packages: null }, { packages: [null] },
    { packages: [{ name: a.name, reason: '' }] },
    { packages: [{ name: '@klarkxy/dsh-typo', reason: 'Pending' }] },
    { packages: [{ name: a.name, reason: 'Pending' }, { name: a.name, reason: 'Pending' }] }]) {
    writeFileSync(join(root, 'scripts/npm-release-holds.json'), JSON.stringify(holds));
    assert.throws(() => releaseCandidates(root, [a]), /Invalid npm release hold/);
  }
});

test('this repository excludes review holds and private development packages', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const holds = JSON.parse(readFileSync(join(root, 'scripts/npm-release-holds.json'), 'utf8'));
  const candidates = new Set(releaseWorkspace(root, discoverPackages(root)).candidates.map(pkg => pkg.name));
  for (const entry of holds.packages) assert.equal(candidates.has(entry.name), false, entry.name);
  for (const entry of readdirSync(join(root, 'plugins'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = JSON.parse(readFileSync(join(root, 'plugins', entry.name, 'package.json'), 'utf8'));
    if (manifest.private === true) assert.equal(candidates.has(manifest.name), false, manifest.name);
  }
});
