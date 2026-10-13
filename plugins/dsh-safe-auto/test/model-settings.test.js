import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/ui-host.js';
import { parseConfig } from '../src/config.js';

test('reviewer contributor preserves prompt, invalidates approvals, uses CAS and unloads', async () => {
  let row = { revision: 4, values: { provider: 'p', model: 'old', reasoningEffort: 'low', reviewerPrompt: 'Only inspect files.' } };
  let collect, invalidations = 0;
  const off = [];
  const ctx = {
    safeAutoRuntime: { base: parseConfig(), attach: () => () => {}, invalidateApprovals() { invalidations++; } },
    storageDomain: { open: async () => ({ table: () => ({ get: () => row, put: async (_key, value) => { row = value; } }), close: async () => {} }) },
    permissionPresets: { catalog: () => ({ options: [] }) }, sandboxPolicy: {}, sessions: {},
    connection: { requestRejection: () => undefined }, webServer: { register: () => () => {} },
    effect(fn) { off.push(fn()); }, on(_event, callback) { collect = callback; return () => { collect = undefined; }; },
  };
  await apply(ctx);
  let owner;
  collect(value => { owner = value; });
  assert.deepEqual(owner.title, { zh: '安全自动', en: 'Safe Auto' });
  const signal = new AbortController().signal;
  assert.deepEqual((await owner.read(signal)).fields[0].current, { provider: 'p', model: 'old', reasoningEffort: 'low' });
  assert.deepEqual((await owner.read(signal)).fields[0].label, { zh: '审查模型', en: 'Reviewer model' });
  await owner.write(['model'], { provider: 'q', model: 'new', reasoningEffort: 'high' }, 4, signal);
  assert.deepEqual(row, { revision: 5, values: { provider: 'q', model: 'new', reasoningEffort: 'high', reviewerPrompt: 'Only inspect files.' } });
  assert.equal(invalidations, 1);
  await assert.rejects(owner.write(['model'], { provider: '', model: '' }, 4, signal), /changed/);
  await assert.rejects(owner.write(['reviewerPrompt'], { provider: '', model: '' }, 5, signal), /Unknown/);
  await owner.write(['model'], { provider: '', model: '' }, 5, signal);
  assert.equal(row.values.reviewerPrompt, 'Only inspect files.');
  assert.equal(row.values.reasoningEffort, '');
  assert.equal(invalidations, 2);
  for (const dispose of off.reverse()) await dispose();
  assert.equal(collect, undefined);
  await assert.rejects(owner.write(['model'], { provider: 'p', model: 'late' }, 6, signal), /unloaded/);
});
