import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { orderedPackages, packRelease, publishManifest, releaseCandidates } from './release-workspace.mjs';
function fixture(t) { const root = mkdtempSync(join(tmpdir(), 'dsh-workspace-release-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
function writePackage(root, name, dependencies = {}) {
  const directory = `plugins/${name.split('/').pop()}`;
  mkdirSync(join(root, directory), { recursive: true });
  const pkg = { name, version: '1.2.3', directory };
  writeFileSync(join(root, directory, 'package.json'), JSON.stringify({ name, version: pkg.version, type: 'module', files: ['index.js'], dependencies }));
  writeFileSync(join(root, directory, 'index.js'), 'export const ready = true;\n'); return pkg;
}
const npm = (args, cwd) => execFileSync('npm', args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' } });
test('orders workspace dependencies before dependants regardless of directory order', t => {
  const root = fixture(t), memory = writePackage(root, '@klarkxy/dsh-memory');
  const feature = writePackage(root, '@klarkxy/dsh-feature', { [memory.name]: 'workspace:*' });
  assert.deepEqual(orderedPackages(root, [feature, memory]).map(p => p.name), [memory.name, feature.name]);
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
