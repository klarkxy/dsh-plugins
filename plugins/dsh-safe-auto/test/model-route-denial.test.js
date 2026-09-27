import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.js';
import { createGate } from '../src/gate.js';

test('a native semantic denial remains final even if the conversation model changes', async () => {
  let route = { provider: 'p', model: 'before' };
  const session = { requestHeader: () => ({ config: route }) };
  const llm = { async *stream() {
    route = { provider: 'p', model: 'after' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"decision":"deny"}' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } };
  const gate = createGate(parseConfig({ mode: 'smart', workspaceRoots: ['/workspace'], shellCandidates: ['git status'] }), { getLlm: () => llm });
  const result = await gate.decide({ session, agent: { session }, tool: 'bash', args: { command: 'git status' },
    cwd: '/workspace', sandbox: { mode: 'workspace-write', workspaceRoot: '/workspace' },
    signal: new AbortController().signal, task: 1, intent: 'Inspect status',
  });
  assert.equal(result.kind, 'deny');
  assert.equal(result.code, 'MODEL_NOT_ALLOWED');
});
