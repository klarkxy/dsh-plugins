import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginRegistry } from '../registry.mjs';
import { registryTools, installRegistryTools } from '../registry-tools.mjs';
const reply = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const name = '@sample/dsh-example';
const manifest = (version, patch = './cordis.patch.yml') => ({ name, version, dsh: { bundle: { patch } }, engines: { dsh: '>=0.1.7-0 <0.2.0' }, dependencies: { helper: '^1.0.0' } });
const metadata = () => ({ name, 'dist-tags': { latest: '1.0.0', next: '2.0.0-beta.1' }, versions: {
  '1.0.0': manifest('1.0.0'), '2.0.0-beta.1': manifest('2.0.0-beta.1'), '0.9.0': { ...manifest('0.9.0', undefined), dsh: {}, deprecated: 'Use 1.0.0' },
}, time: { '0.9.0': '2026-01-01', '1.0.0': '2026-02-01', '2.0.0-beta.1': '2026-03-01' } });

test('search is paginated registry discovery and does not assert bundle compatibility', async () => {
  const client = new PluginRegistry({ fetcher: async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://registry.npmjs.org');
    assert.equal(parsed.searchParams.get('text'), 'memory keywords:dsh-plugin');
    assert.equal(parsed.searchParams.get('from'), '2');
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { accept: 'application/json' });
    return reply({ total: 4, objects: [{ package: { name, version: '1.0.0', description: 'A candidate', links: { homepage: 'javascript:bad' } } }] });
  } });
  const result = await client.search({ query: 'memory', source: 'npm', offset: 2, limit: 1 });
  assert.equal(result.nextOffset, 3); assert.equal(result.results[0].verification, 'candidate-only');
  assert.equal(result.results[0].homepage, null);
});

test('versions resolves tags to exact identities and returns selected-version contracts', async () => {
  const client = new PluginRegistry({ fetcher: async url => {
    assert.equal(url, 'https://registry.npmjs.org/%40sample%2Fdsh-example'); return reply(metadata());
  } });
  const latest = await client.versions({ package: name, limit: 1 });
  assert.equal(latest.selected.version, '1.0.0');
  assert.equal(latest.selected.bundleDeclared, true);
  assert.equal(latest.selected.engines.dsh, '>=0.1.7-0 <0.2.0');
  assert.deepEqual(latest.selected.dependencies, { helper: '^1.0.0' });
  assert.equal(latest.versions[0].version, '2.0.0-beta.1');
  assert.equal(latest.nextOffset, 1);
  const next = await client.versions({ package: name, version: 'next', offset: latest.nextOffset, limit: 1 });
  assert.equal(next.selected.version, '2.0.0-beta.1'); assert.equal(next.versions[0].version, '1.0.0');
  const old = await client.versions({ package: name, version: '0.9.0', offset: 2 });
  assert.equal(old.selected.bundleDeclared, false); assert.equal(old.selected.deprecated, 'Use 1.0.0');
  assert.equal(old.nextOffset, null);
  await assert.rejects(client.versions({ package: name, version: 'missing' }), /not published/);
  await assert.rejects(client.versions({ package: name, version: '9.0.0' }), /not published/);
});

test('invalid names, ranges and pagination fail before network access', async () => {
  const client = new PluginRegistry({ fetcher: () => { throw new Error('unexpected network'); } });
  for (const bad of ['https://evil.invalid', '../file', '@scope/name@latest', 'example?url=evil', 'a\\b']) {
    await assert.rejects(client.versions({ package: bad }), /exact npm package name/);
  }
  for (const version of ['^1.0.0', '*', '../latest', '', null]) await assert.rejects(client.versions({ package: name, version }), /version|Invalid/);
  for (const args of [{ query: '  ' }, { query: 'x', limit: 0 }, { query: 'x', offset: -1 }, { query: 'x', url: 'https://evil.invalid' }]) {
    await assert.rejects(client.search(args), /blank|integer|Invalid/);
  }
});

test('registry errors and malformed identities never become an empty success', async () => {
  for (const [fetcher, expected] of [
    [() => new Response('not found', { status: 404 }), /HTTP 404/],
    [() => new Response('<html>', { headers: { 'content-type': 'text/html' } }), /did not return JSON/],
    [() => reply({ ...metadata(), name: 'other' }), /Invalid npm package/],
    [() => { const data = metadata(); data.versions['1.0.0'].name = 'other'; return reply(data); }, /identity/],
    [() => { throw new Error('offline'); }, /offline/],
  ]) await assert.rejects(new PluginRegistry({ fetcher }).versions({ package: name }), expected);
  await assert.rejects(new PluginRegistry({ fetcher: () => reply({ total: 0 }) }).search({ query: 'x', source: 'npm' }), /Invalid npm search/);
});

test('oversized bodies are cancelled with and without content-length', async () => {
  for (const declared of [true, false]) {
    let cancelled = false;
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(17 * 1024 * 1024)); }, cancel() { cancelled = true; } });
    const headers = { 'content-type': 'application/json', ...declared ? { 'content-length': String(17 * 1024 * 1024) } : {} };
    await assert.rejects(new PluginRegistry({ fetcher: () => new Response(body, { headers }) }).versions({ package: name }), /16 MiB/);
    assert.equal(cancelled, true);
  }
});

test('caller cancellation and plugin disposal abort registry requests and stale handlers', async () => {
  for (const stop of ['caller', 'dispose']) {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const client = new PluginRegistry({ fetcher: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }); started();
    }) });
    const caller = new AbortController();
    const pending = client.versions({ package: name }, caller.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await ready;
    if (stop === 'caller') caller.abort(); else client.dispose();
    await rejected;
    client.dispose();
    await assert.rejects(client.search({ query: 'x' }), { name: 'AbortError' });
  }
});

test('tools forward cancellation and register/dispose with the host tool service', async () => {
  const calls = [], signal = new AbortController().signal;
  const tools = registryTools({ search: (...args) => { calls.push(args); return {}; }, versions: (...args) => { calls.push(args); return {}; } });
  await tools[0].execute({ query: 'x' }, { signal }); await tools[1].execute({ package: name }, { signal });
  assert.equal(calls[0][1], signal); assert.equal(calls[1][1], signal);
  const registrations = new Map(), disposers = [];
  installRegistryTools({ inject(services, callback) {
    assert.deepEqual(services, ['tools']);
    callback({ effect(fn) { disposers.push(fn()); }, tools: { register(tool) { registrations.set(tool.name, tool); return () => registrations.delete(tool.name); } } });
  } });
  assert.deepEqual([...registrations.keys()], ['blueprint_search_plugins', 'blueprint_plugin_versions']);
  const held = registrations.get('blueprint_plugin_versions');
  for (const dispose of disposers.reverse()) dispose();
  assert.equal(registrations.size, 0);
  await assert.rejects(held.execute({ package: name }, { signal }), { name: 'AbortError' });
});

test('catalog searches Chinese and English, prioritizes exact names and reports its scope', async () => {
  const plugins = [
    { package: '@sample/dsh-memory', version: '1.0.0', title: { zh: '长期记忆', en: 'Memory' }, summary: { zh: '跨会话记忆' } },
    { package: '@sample/dsh-theme', version: '1.0.0', title: { zh: '主题', en: 'Theme' } },
  ];
  const client = new PluginRegistry({ fetcher: async url => {
    assert.equal(url, 'https://klarkxy.github.io/dsh-plugins/plugins.json');
    return reply({ generatedAt: '2026-09-27', plugins });
  } });
  for (const query of ['记忆', 'memory']) {
    const result = await client.search({ query });
    assert.equal(result.total, 1); assert.equal(result.results[0].name, plugins[0].package);
    assert.match(result.searchScope, /not all npm/); assert.equal(result.catalogGeneratedAt, '2026-09-27');
  }
  const exact = await client.search({ query: '@sample/dsh-theme', limit: 1 });
  assert.equal(exact.results[0].name, plugins[1].package);
  assert.equal(exact.nextOffset, 1);
  assert.equal((await client.search({ query: 'no-such-capability' })).total, 0);
  await assert.rejects(client.search({ query: 'x', source: 'other' }), /catalog or npm/);
});

test('filtered npm pages advance by raw candidates even when none are DSH packages', async () => {
  const client = new PluginRegistry({ fetcher: () => reply({ total: 3, objects: [
    { package: { name: 'unrelated', version: '1.0.0', keywords: ['memory'] } },
    { package: { name: 'also-unrelated', version: '1.0.0' } },
  ] }) });
  const result = await client.search({ query: 'memory', source: 'npm', limit: 2 });
  assert.deepEqual(result.results, []); assert.equal(result.nextOffset, 2);
});

test('an aborted response arriving after disposal is cancelled before being read', async () => {
  let finish, start, cancelled = false;
  const ready = new Promise(resolve => { start = resolve; });
  const client = new PluginRegistry({ fetcher: () => new Promise(resolve => { finish = resolve; start(); }) });
  const pending = client.versions({ package: name });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await ready; client.dispose();
  finish(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
  await rejected; assert.equal(cancelled, true);
});
