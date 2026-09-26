import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { discoverPackages } from './release-target.mjs';
import { contentHash, selectRelease, readRegistry, writeVersion, isAcceptedVersionConflict } from './publish-npm.mjs';

const pkg = { name: '@klarkxy/dsh-one', directory: 'plugins/dsh-one', version: '1.2.3' };
function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const slug of ['dsh-one', 'dsh-two']) {
    const directory = join(root, 'plugins', slug);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      name: `@klarkxy/${slug}`, version: '1.2.3',
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' }, ...overrides,
    }));
  }
  return root;
}
function registry(versions, distTags = { latest: '1.2.3' }) {
  return { versions: Object.fromEntries(Object.entries(versions).map(([version, hash]) =>
    [version, { version, dshRelease: { contentHash: hash } }])), 'dist-tags': distTags };
}
function fingerprint(files) {
  return contentHash(Object.keys(files).map(path => ({ path, mode: 420 })), path => Buffer.from(files[path]));
}

test('discovers all independent scoped plugins', t => {
  assert.equal(discoverPackages(fixture(t)).length, 2);
});
test('rejects invalid names, private packages, versions and registries', t => {
  for (const overrides of [{ name: 'dsh-one' }, { private: true }, { version: '1.0' },
    { version: '1.2.3\n' }, { version: '1.2.3+build' },
    { publishConfig: { access: 'restricted', registry: 'https://registry.npmjs.org/' } },
    { publishConfig: { access: 'public', registry: 'https://example.com/' } }]) {
    assert.throws(() => discoverPackages(fixture(t, overrides)));
  }
});
test('first publication keeps the requested source version', () => {
  assert.equal(selectRelease(pkg, 'new', registry({}, {})).version, '1.2.3');
});
test('changed contents automatically increment patch; explicit higher version wins', () => {
  const metadata = registry({ '1.2.3': 'old' });
  assert.equal(selectRelease(pkg, 'new', metadata).version, '1.2.4');
  assert.equal(selectRelease({ ...pkg, version: '1.3.0' }, 'new', metadata).version, '1.3.0');
});
test('unchanged package skips publishing on reruns and unrelated plugin changes', () => {
  const metadata = registry({ '1.2.3': 'same' });
  assert.equal(selectRelease(pkg, 'same', metadata).publish, false);
  assert.equal(selectRelease(pkg, 'changed', metadata).publish, true);
  assert.equal(selectRelease({ ...pkg, version: '1.3.0' }, 'same', metadata).publish, true);
});
test('a stale source version cannot overwrite a newer published version', () => {
  const metadata = registry({ '1.2.3': 'old', '1.2.4': 'newer' }, { latest: '1.2.4' });
  assert.equal(selectRelease(pkg, 'new', metadata).version, '1.2.5');
  const recovered = selectRelease(pkg, 'newer', metadata);
  assert.equal(recovered.publish, false);
  assert.equal(recovered.version, '1.2.4');
});
test('prereleases stay on next, stable releases ignore future prereleases', () => {
  const metadata = registry({ '1.2.3': 'old', '1.3.0-rc.1': 'rc' }, { latest: '1.2.3', next: '1.3.0-rc.1' });
  const release = selectRelease({ ...pkg, version: '1.3.0-rc.1' }, 'new', metadata);
  assert.equal(release.version, '1.3.0-rc.2');
  assert.equal(release.distTag, 'next');
  assert.equal(selectRelease(pkg, 'new', metadata).version, '1.2.4');
});
test('fingerprint ignores version/writeback formatting but includes file names and content', () => {
  const files = { 'package.json': '{"name":"pkg","version":"1.0.0"}', 'lib/index.js': 'export const n = 1;',
    'dsh.plugin.json': '{"version":"1.0.0","id":"pkg"}' };
  const hash = fingerprint(files);
  assert.equal(fingerprint({ ...files, 'package.json': '{"dshRelease":{"contentHash":"ignored"}, "version":"1.0.1", "name":"pkg"}',
    'dsh.plugin.json': '{ "id":"pkg", "version":"1.0.1" }' }), hash);
  assert.notEqual(fingerprint({ ...files, 'lib/index.js': 'export const n = 2;' }), hash);
  assert.notEqual(fingerprint({ ...files, 'new.js': '' }), hash);
  assert.notEqual(fingerprint({ 'package.json': files['package.json'] }), hash);
});
test('writeback updates both manifests without changing plugin IDs and is idempotent', t => {
  const root = fixture(t);
  const path = join(root, pkg.directory, 'dsh.plugin.json');
  writeFileSync(path, '{"id":"dsh-one","version":"1.2.3"}\n');
  const release = { ...pkg, version: '1.2.4', hash: 'new' };
  assert.equal(writeVersion(root, release).length, 2);
  assert.deepEqual(JSON.parse(readFileSync(path)), { id: 'dsh-one', version: '1.2.4' });
  assert.equal(writeVersion(root, release).length, 0);
});
test('only registry 404 means first publication; authentication/server failures stop release', async () => {
  assert.deepEqual(await readRegistry(pkg.name, async () => ({ status: 404 })), registry({}, {}));
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(readRegistry(pkg.name, async () => ({ status, ok: false })), /HTTP/);
  }
});

test('pending scanned version is recognized even while public package metadata is 404', async () => {
  const accepted = { name: pkg.name, version: pkg.version, dshRelease: { contentHash: 'same' } };
  const metadata = await readRegistry(pkg.name, async url => url.endsWith('/1.2.3')
    ? { status: 200, ok: true, json: async () => accepted }
    : { status: 404 }, pkg.version);
  assert.equal(selectRelease(pkg, 'same', metadata).publish, false);
  assert.equal(selectRelease(pkg, 'changed', metadata).version, '1.2.4');
});


test('only an explicit duplicate-version rejection can enter pending verification', () => {
  const failure = (code, summary) => ({ stdout: JSON.stringify({ error: { code, summary } }) });
  assert.equal(isAcceptedVersionConflict(failure('E403', 'You cannot publish over the previously published versions: 1.2.3.')), true);
  assert.equal(isAcceptedVersionConflict(failure('EPUBLISHCONFLICT', 'version exists')), true);
  for (const error of [failure('E403', 'Access denied'), failure('E401', 'Unauthorized'),
    failure('E500', 'Server failure'), { stdout: 'invalid json' }]) {
    assert.equal(isAcceptedVersionConflict(error), false);
  }
});
