import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { SessionId } from '@deepseek-ai/dsh-session';
import { BindingStore } from '../src/bindings.js';
import { PROFILE_ID, role } from './helpers/harness.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function store(): { store: BindingStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'classmates-bindings-'));
  roots.push(root);
  return { store: new BindingStore(root, PROFILE_ID), root };
}

function snapshot() {
  return role({
    id: 'reviewer',
    revision: 3,
    name: 'Reviewer',
    description: 'Review changes',
    instructions: 'SECRET_BINDINGS_INSTRUCTIONS',
    model: { provider: 'mock', id: 'specialist-a' },
  });
}

it('persists and reads back a subagent binding with a verifiable checksum', async () => {
  const { store: bindings, root } = store();
  const created = await bindings.recordSubagent({
    childId: SessionId('child-1'),
    parentSessionId: 'lead-1',
    createdAt: '2026-10-06T12:00:00.000Z',
    role: { id: 'reviewer', revision: 3, name: 'Reviewer', description: 'Review changes' },
    modelSource: 'profile',
    modelProfileId: 'coding-high',
    model: { provider: 'mock', id: 'specialist-a', effort: 'high' },
  });
  expect(created.checksum).toMatch(/^[0-9a-f]{64}$/);
  const files = readdirSync(root).filter(name => name.endsWith('.json'));
  expect(files).toHaveLength(1);
  const onDisk = JSON.parse(readFileSync(join(root, files[0]!), 'utf8')) as Record<string, unknown>;
  expect(onDisk).toMatchObject({
    schemaVersion: 1,
    kind: 'subagent',
    childId: 'child-1',
    parentSessionId: 'lead-1',
    createdAt: '2026-10-06T12:00:00.000Z',
    role: { id: 'reviewer', revision: 3, name: 'Reviewer', description: 'Review changes' },
    modelSource: 'profile',
    modelProfileId: 'coding-high',
    model: { provider: 'mock', id: 'specialist-a', effort: 'high' },
  });

  const { bindings: rows, warnings } = await bindings.listSubagentBindings('lead-1');
  expect(warnings).toBe(0);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual(created);
  // Checksum verified on read: tampering turns the record into a skipped warning.
  onDisk.role = { ...(onDisk.role as object), name: 'Renamed' };
  writeFileSync(join(root, files[0]!), JSON.stringify(onDisk));
  const tampered = await bindings.listSubagentBindings('lead-1');
  expect(tampered.bindings).toHaveLength(0);
  expect(tampered.warnings).toBe(1);
});

it('is idempotent per childId and rejects a conflicting record under the same childId', async () => {
  const { store: bindings } = store();
  const input = {
    childId: SessionId('child-1'),
    parentSessionId: 'lead-1',
    role: { id: 'reviewer', revision: 3, name: 'Reviewer', description: 'Review changes' },
    modelSource: 'inherit' as const,
  };
  const first = await bindings.recordSubagent(input);
  const again = await bindings.recordSubagent(input);
  expect(again).toEqual(first);
  await expect(bindings.recordSubagent({ ...input, parentSessionId: 'lead-2' })).rejects.toThrow('conflict');
  expect((await bindings.listSubagentBindings()).bindings).toHaveLength(1);
});

it('coexists with Team bindings: enumeration skips them silently and Team read/write is unaffected', async () => {
  const { store: bindings, root } = store();
  await bindings.prepare('lead-1', 'alpha', snapshot(), 'alpha task');
  const claimed = await bindings.claim('lead-1', 'alpha', SessionId('team-child'));
  expect(claimed.childId).toBe(SessionId('team-child'));
  await bindings.recordSubagent({
    childId: SessionId('child-1'),
    parentSessionId: 'lead-1',
    createdAt: '2026-10-06T12:00:00.000Z',
    role: { id: 'reviewer', revision: 3, name: 'Reviewer', description: 'Review changes' },
    modelSource: 'fixed',
    model: { provider: 'mock', id: 'specialist-a' },
  });
  expect(readdirSync(root).filter(name => name.endsWith('.json'))).toHaveLength(2);

  const team = await bindings.read('lead-1', 'alpha');
  expect(team?.role.id).toBe('reviewer');
  const { bindings: rows, warnings } = await bindings.listSubagentBindings('lead-1');
  expect(warnings).toBe(0);
  expect(rows).toHaveLength(1);
  expect(rows[0].childId).toBe(SessionId('child-1'));
  expect(rows[0].model).toEqual({ provider: 'mock', id: 'specialist-a' });
  expect(JSON.stringify(rows[0])).not.toContain('SECRET_BINDINGS_INSTRUCTIONS');
});

it('filters by parentSessionId and counts corrupt files as warnings without failing the read', async () => {
  const { store: bindings, root } = store();
  for (const [childId, parent] of [['child-1', 'lead-1'], ['child-2', 'lead-2'], ['child-3', 'lead-1']] as const) {
    await bindings.recordSubagent({
      childId: SessionId(childId),
      parentSessionId: parent,
      createdAt: `2026-10-06T12:00:0${childId.at(-1)}.000Z`,
      role: { id: 'reviewer', revision: 3, name: 'Reviewer', description: 'Review changes' },
      modelSource: 'inherit',
    });
  }
  writeFileSync(join(root, 'broken.json'), '{not json');
  const all = await bindings.listSubagentBindings();
  expect(all.bindings.map(row => row.childId)).toEqual(['child-1', 'child-2', 'child-3']);
  expect(all.warnings).toBe(1);
  const filtered = await bindings.listSubagentBindings('lead-1');
  expect(filtered.bindings.map(row => row.childId)).toEqual(['child-1', 'child-3']);
  expect(filtered.warnings).toBe(1);
});
