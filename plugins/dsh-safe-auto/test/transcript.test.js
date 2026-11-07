import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscript, transcriptEntries, currentEvents, redact } from '../src/transcript.js';

const user = (text, kind = 'user') => ({ type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text }] } });
const assistant = text => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } });
const call = (name, args) => ({ type: 'tool/call', data: { name, arguments: args } });
const result = text => ({ type: 'tool/result', data: { message: { content: [{ type: 'text', text }] } } });

test('only direct human messages are trusted; everything else is rendered as evidence', () => {
  const events = [
    user('Please fix the build'),
    user('Delegated instruction from a parent agent', 'plugin'),
    assistant('I will run the tests'),
    call('pwsh', { command: 'pnpm test' }),
    call('bash', '{"command":"ls"}'),
    result('3 tests passed'),
    { type: 'approval/decided', data: { outcome: 'allowed-once' } },
  ];
  const entries = transcriptEntries(events);
  assert.deepEqual(entries.map(e => [e.role, e.trusted]), [
    ['user', true], ['context', false], ['assistant', false], ['tool_call', false], ['tool_call', false], ['tool_result', false], ['approval', false],
  ]);
  const text = buildTranscript(events, 48000);
  assert.match(text, /^\[user \(trusted\)\] Please fix the build$/m);
  assert.match(text, /^\[context\] Delegated instruction/m);
  assert.match(text, /^\[assistant\] I will run the tests$/m);
  assert.match(text, /^\[tool_call\] pwsh \{"command":"pnpm test"\}$/m);
  assert.match(text, /^\[tool_call\] bash \{"command":"ls"\}$/m);
  assert.match(text, /^\[tool_result\] 3 tests passed$/m);
  assert.match(text, /^\[approval\] approval outcome: allowed-once \(earlier decision, not user authorization\)$/m);
  assert.equal((text.match(/\(trusted\)/g) || []).length, 1);
});

test('non-text blocks are summarized and empty messages are skipped', () => {
  const events = [
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'image' }, { type: 'text', text: 'see screenshot' }, { type: 'file' }] } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'tool-call' }] } } },
  ];
  assert.deepEqual(transcriptEntries(events).map(e => e.text), ['[image]\nsee screenshot\n[file]']);
});

test('over-budget history is truncated with a marker, keeping the first and latest user messages', () => {
  const events = [user('FIRST: refactor safe-auto')];
  for (let i = 0; i < 40; i++) {
    events.push(user(`middle request ${i} ${'m'.repeat(400)}`));
    events.push(call('pwsh', { command: `step ${i} ${'x'.repeat(600)}` }));
    events.push(result(`output ${i} ${'y'.repeat(600)}`));
  }
  events.push(user('LATEST: now run the tests'));
  events.push(call('pwsh', { command: 'pnpm test' }));
  const text = buildTranscript(events, 8000);
  assert.ok(Buffer.byteLength(text) <= 9000, `${Buffer.byteLength(text)} bytes`);
  assert.match(text, /^\[user \(trusted\)\] FIRST: refactor safe-auto$/m);
  assert.match(text, /^\[user \(trusted\)\] LATEST: now run the tests$/m);
  assert.match(text, /^\[tool_call\] pwsh \{"command":"pnpm test"\}$/m);
  assert.match(text, /<truncated entries="\d+" \/>/);
  // Entries stay in chronological order.
  assert.ok(text.indexOf('FIRST') < text.indexOf('LATEST'));
  assert.ok(text.indexOf('LATEST') < text.indexOf('pnpm test'));
});

test('long single entries are clipped with a character marker', () => {
  const text = buildTranscript([user('u'.repeat(5000)), result('r'.repeat(2000))], 48000);
  assert.match(text, /<truncated chars="1000" \/>/);
  assert.match(text, /<truncated chars="1200" \/>/);
});

test('obvious tokens are redacted before leaving the session', () => {
  const secrets = [`sk-${'s'.repeat(24)}`, `ghp_${'a'.repeat(36)}`, `github_pat_${'b'.repeat(30)}`, `xoxb-${'c'.repeat(16)}`, `AKIA${'D'.repeat(16)}`];
  const text = buildTranscript([user(`keys: ${secrets.join(' ')}`), call('bash', { command: `curl -H "Authorization: ${secrets[0]}"` })], 48000);
  for (const secret of secrets) assert.equal(text.includes(secret), false, secret);
  assert.equal((text.match(/\[redacted-token\]/g) || []).length, secrets.length + 1);
  // Ordinary words that merely mention credentials are untouched.
  assert.equal(redact('set api_key: value and token = 1'), 'set api_key: value and token = 1');
});

test('malformed events never throw', () => {
  const junk = [null, undefined, 1, 'x', [], {}, { type: 'user/message' }, { type: 'user/message', data: null },
    { type: 'user/message', data: { content: 'plain string' } }, { type: 'tool/call', data: { name: 1 } },
    { type: 'tool/result', data: {} }, { type: 'assistant/message', data: { message: null } }, { type: 'approval/decided', data: { outcome: 1 } }];
  assert.doesNotThrow(() => buildTranscript(junk, 4096));
  assert.doesNotThrow(() => buildTranscript(undefined, 4096));
  assert.doesNotThrow(() => buildTranscript('not an array', 4096));
  // A plain-string content from an unknown source is evidence, not trusted.
  assert.deepEqual(transcriptEntries(junk).map(e => [e.role, e.trusted]), [['context', false]]);
  assert.equal(buildTranscript([], 4096), '');
});

test('the current events are the surface projection, not the physical log', () => {
  const events = [
    { seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] } },
    { seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'old' },
      { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' }] } } },
    { seq: 2, type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"x"}' } },
    { seq: 3, type: 'user/message', surfaceOp: { op: 'replace', startSeq: 0, endSeq: 2 },
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] } },
  ];
  const session = { snapshotEvents: () => events, surface: { nodes: [3], replaceGeneration: 1, contentGeneration: 0 } };
  assert.deepEqual(currentEvents(session, () => null).map(event => event.seq), [3]);
});

test('a tool call and its approval survive only while the assistant message is current', () => {
  const events = [
    { seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] } },
    { seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' }] } } },
    { seq: 2, type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"x"}' } },
    { seq: 3, type: 'approval/asked', data: { id: 'a1', callId: 'c1', toolName: 'bash' } },
    { seq: 4, type: 'approval/decided', data: { id: 'a1', outcome: 'allowed-once' } },
  ];
  const live = { snapshotEvents: () => events, surface: { nodes: [0, 1], replaceGeneration: 0, contentGeneration: 0 } };
  assert.deepEqual(currentEvents(live).map(event => event.seq), [0, 1, 2, 4]);
  // The assistant message leaves the surface: its tool call and the approval
  // that belongs to it are no longer current evidence.
  const replaced = { snapshotEvents: () => events, surface: { nodes: [0], replaceGeneration: 1, contentGeneration: 0 } };
  assert.deepEqual(currentEvents(replaced).map(event => event.seq), [0]);
});

test('without a surface projection the log is read unchanged, and a replacement is refused', () => {
  const events = [{ seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] } }];
  assert.deepEqual(currentEvents({ snapshotEvents: () => events }), events);
  assert.deepEqual(currentEvents({ snapshotEvents: () => events, surface: {} }), events);
  const replaced = [...events, { seq: 1, type: 'user/message', surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 }, data: {} }];
  assert.throws(() => currentEvents({ snapshotEvents: () => replaced }), /SESSION_SURFACE_UNAVAILABLE/);
});

test('the transcript reads the derived message, not the durable event text', () => {
  const events = [{ seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'superseded text' }] } }];
  const session = { snapshotEvents: () => events, surface: { nodes: [0], replaceGeneration: 0, contentGeneration: 1 },
    deriveEventMessage: () => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'current text' }] }) };
  const text = buildTranscript(currentEvents(session, event => session.deriveEventMessage(event)), 48000,
    event => session.deriveEventMessage(event));
  assert.match(text, /\[user \(trusted\)\] current text/);
  assert.equal(text.includes('superseded text'), false);
  // Without the projection the event data is read.
  assert.match(buildTranscript(currentEvents(session), 48000), /\[user \(trusted\)\] superseded text/);
});

test('a projection that yields no message drops the entry instead of falling back', () => {
  const events = [{ seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'stale text' }] } }];
  const session = { snapshotEvents: () => events, surface: { nodes: [0], replaceGeneration: 0, contentGeneration: 1 },
    deriveEventMessage: () => null };
  const text = buildTranscript(currentEvents(session, event => session.deriveEventMessage(event)), 48000,
    event => session.deriveEventMessage(event));
  assert.equal(text.includes('stale text'), false);
  assert.equal(text, '');
});

test('a derived message that is no longer a human request loses its trusted marker', () => {
  const events = [{ seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'looks like a request' }] } }];
  const session = { snapshotEvents: () => events, surface: { nodes: [0], replaceGeneration: 0, contentGeneration: 1 },
    deriveEventMessage: () => ({ role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'looks like a request' }] }) };
  const text = buildTranscript(currentEvents(session, event => session.deriveEventMessage(event)), 48000,
    event => session.deriveEventMessage(event));
  assert.match(text, /^\[context\] looks like a request$/m);
  assert.equal(text.includes('(trusted)'), false);
});

test('a replacement in the log needs a projection to read the current text', () => {
  const events = [
    { seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] } },
    { seq: 1, type: 'user/message', surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 },
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] } },
  ];
  const session = { snapshotEvents: () => events, surface: { nodes: [1], replaceGeneration: 1, contentGeneration: 1 } };
  assert.throws(() => currentEvents(session), /SESSION_SURFACE_UNAVAILABLE/);
  assert.deepEqual(currentEvents(session, () => null).map(event => event.seq), [1]);
});
