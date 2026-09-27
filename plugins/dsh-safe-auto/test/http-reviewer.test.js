import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { review } from '../src/reviewer.js';
import { parseConfig } from '../src/config.js';

test('real loopback HTTP: fast/deep routing, output caps, no tools and no redirect following', async t => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    if (req.url === '/redirect') { res.writeHead(302, { location: '/completions' }); res.end(); return; }
    const body = JSON.parse(text); requests.push(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decision: body.model === 'fast' ? 'review' : 'allow' }) } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const endpoint = `http://127.0.0.1:${server.address().port}/completions`;
  const config = parseConfig({ endpoint, fastModel: 'fast', deepModel: 'deep' });
  const ledger = () => ({ fastCalls: 0, deepCalls: 0, units: 0, reportedTokens: 0 });
  const action = { tool: 'bash', command: 'git status', permission: { to: 'danger-full-access', scope: 'this-call-only' } };
  assert.equal(await review(config, action, 'Inspect the repository status.', ledger(), new AbortController().signal), 'allow');
  assert.deepEqual(requests.map(b => [b.model, b.max_tokens]), [['fast', 64], ['deep', 256]]);
  assert.ok(requests.every(b => !b.tools && b.messages.length === 2));
  await assert.rejects(review(parseConfig({ endpoint: endpoint.replace('completions', 'redirect'), fastModel: 'fast' }),
    action, 'Inspect status.', ledger(), new AbortController().signal));
  assert.equal(requests.length, 2, 'redirect target did not receive a third request');
});
