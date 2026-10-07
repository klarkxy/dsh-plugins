import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session';
import type { SessionObservation } from '@deepseek-ai/dsh-session-query';
import type { ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection';
import { ClassmatesController } from '../src/controller.js';
import { validateRole, type RoleConfig } from '../src/config.js';
import { readTeamDetails } from '../src/team-info.js';
import { createRuntime, modelProfile, role, SIGNAL, spawnClassmate, type Runtime } from './helpers/harness.js';

const runtimes: Runtime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0).reverse()) {
    await runtime.ctx.fiber.dispose();
    for (const path of [runtime.bindingsRoot, runtime.storageRoot]) rmSync(path, { recursive: true, force: true });
  }
});

function researcher() {
  return role({
    id: 'researcher',
    revision: 1,
    name: 'Researcher',
    description: 'research',
    instructions: 'SECRET_FROZEN_INSTRUCTIONS',
    model: { provider: 'mock', id: 'specialist-a' },
  });
}

async function setup() {
  const runtime = await createRuntime({ bindingsRoot: mkdtempSync(join(tmpdir(), 'classmates-team-')) });
  runtimes.push(runtime);
  return runtime;
}

it('joins frozen classmate identity by exact child id and last used request route', async () => {
  const runtime = await setup();
  const { ctx, lead, store, adapter } = runtime;
  await store.prepare(lead.id, 'alpha', researcher(), 'alpha task');
  const started = await spawnClassmate(ctx, lead, 'alpha', 'alpha task');
  await vi.waitFor(() => expect(adapter.requests.some(request => request.model === 'specialist-a')).toBe(true), { timeout: 15_000 });

  const details = await readTeamDetails(ctx, lead.id, store);
  expect(details.leadId).toBe(lead.id);
  const names = details.members.map(member => member.memberName);
  expect(names).toContain('lead');
  expect(names).toContain('alpha');
  const alpha = details.members.find(member => member.memberName === 'alpha');
  expect(alpha).toMatchObject({
    memberId: started.member.id,
    roleId: 'researcher',
    roleName: 'Researcher',
    description: 'research',
    configuredModel: { provider: 'mock', id: 'specialist-a' },
    lastUsedModel: { provider: 'mock', id: 'specialist-a' },
  });
  expect(JSON.stringify(details)).not.toContain('SECRET_FROZEN_INSTRUCTIONS');
  const nativeLead = details.members.find(member => member.memberName === 'lead');
  expect(nativeLead?.roleName).toBeUndefined();
  expect(nativeLead?.configuredModel).toBeNull();
  expect(nativeLead?.lastUsedModel?.id).not.toBe('specialist-a');
});

it('keeps native members and old bindings after the live template is gone', async () => {
  const runtime = await setup();
  const { ctx, lead, store, adapter } = runtime;
  await store.prepare(lead.id, 'alpha', researcher(), 'alpha task');
  await spawnClassmate(ctx, lead, 'alpha', 'alpha task');
  await vi.waitFor(() => expect(adapter.requests.some(request => request.model === 'specialist-a')).toBe(true), { timeout: 15_000 });
  await ctx.agentTeams.spawnTeammate(lead, {
    name: 'ordinary',
    description: 'ordinary teammate',
    prompt: [{ type: 'text', text: 'ordinary task' }],
    context: 'fresh',
    provider: 'spawn',
    signal: SIGNAL,
  });

  const snapshot = researcher();
  snapshot.name = 'Edited later';
  const details = await readTeamDetails(ctx, lead.id, store);
  const alpha = details.members.find(member => member.memberName === 'alpha');
  const ordinary = details.members.find(member => member.memberName === 'ordinary');
  expect(alpha?.roleName).toBe('Researcher');
  expect(ordinary?.roleName).toBeUndefined();
  expect(ordinary?.configuredModel).toBeNull();
  expect(ordinary?.lastUsedModel?.id === undefined || ordinary?.lastUsedModel?.id === 'mock').toBe(true);
});

it('isolates a corrupt binding and still returns the official roster', async () => {
  const runtime = await setup();
  const { ctx, lead, store, adapter, bindingsRoot } = runtime;
  await store.prepare(lead.id, 'alpha', researcher(), 'alpha task');
  await spawnClassmate(ctx, lead, 'alpha', 'alpha task');
  await vi.waitFor(() => expect(adapter.requests.some(request => request.model === 'specialist-a')).toBe(true), { timeout: 15_000 });
  const files = readdirSync(bindingsRoot).filter(name => name.endsWith('.json'));
  writeFileSync(join(bindingsRoot, files[0]!), '{broken');
  const details = await readTeamDetails(ctx, lead.id, store);
  const alpha = details.members.find(member => member.memberName === 'alpha');
  expect(alpha?.roleName).toBeUndefined();
  expect(alpha?.issue).toMatch(/corrupt binding|checksum/);
  expect(details.members.some(member => member.memberName === 'lead')).toBe(true);
});

it('exposes team over the controller without waking a second store', async () => {
  const runtime = await setup();
  const controller = new ClassmatesController(runtime.ctx, { load: async () => ({ roles: [], models: [], settingsRevision: 0, writable: true }) } as never, runtime.store);
  await runtime.store.prepare(runtime.lead.id, 'alpha', researcher(), 'alpha task');
  await spawnClassmate(runtime.ctx, runtime.lead, 'alpha', 'alpha task');
  const details = await controller.team(runtime.lead.id);
  expect(details.members.map(member => member.memberName)).toEqual(expect.arrayContaining(['lead', 'alpha']));
});

function libraryConfig(roles: unknown[], profiles: unknown[] = []): RoleConfig {
  return {
    read: () => ({
      roles: roles.map(item => validateRole(item)),
      modelProfiles: profiles,
      protectedModels: [],
      settingsRevision: 1,
      writable: true,
    }),
  } as unknown as RoleConfig;
}

it('enriches members with template status and the original profile choice', async () => {
  const runtime = await setup();
  const { ctx, lead, store, adapter } = runtime;
  await store.prepare(lead.id, 'alpha', researcher(), 'alpha task', 'coding-low');
  await spawnClassmate(ctx, lead, 'alpha', 'alpha task');
  await vi.waitFor(() => expect(adapter.requests.some(request => request.model === 'specialist-a')).toBe(true), { timeout: 15_000 });

  const ok = libraryConfig([researcher()], [modelProfile({ id: 'coding-low', name: 'Fast coding' })]);
  const alpha = (await readTeamDetails(ctx, lead.id, store, ok)).members.find(member => member.memberName === 'alpha');
  expect(alpha).toMatchObject({ modelProfileId: 'coding-low', modelProfileName: 'Fast coding', templateStatus: 'ok' });
  expect(alpha).not.toHaveProperty('currentRoleName');

  const renamed = libraryConfig([{ ...researcher(), name: 'Edited later' }]);
  const afterRename = (await readTeamDetails(ctx, lead.id, store, renamed)).members.find(member => member.memberName === 'alpha');
  expect(afterRename).toMatchObject({ templateStatus: 'renamed', currentRoleName: 'Edited later', modelProfileId: 'coding-low' });
  // The preset name degrades silently when the preset is gone; the id stays visible.
  expect(afterRename).not.toHaveProperty('modelProfileName');

  const parked = libraryConfig([{ ...researcher(), enabled: false }]);
  const afterDisable = (await readTeamDetails(ctx, lead.id, store, parked)).members.find(member => member.memberName === 'alpha');
  expect(afterDisable).toMatchObject({ templateStatus: 'disabled' });
  expect(afterDisable).not.toHaveProperty('currentRoleName');

  const gone = libraryConfig([]);
  const afterDelete = (await readTeamDetails(ctx, lead.id, store, gone)).members.find(member => member.memberName === 'alpha');
  expect(afterDelete).toMatchObject({ templateStatus: 'deleted' });

  // Members without a binding never gain a template status.
  const leadRow = (await readTeamDetails(ctx, lead.id, store, ok)).members.find(member => member.memberName === 'lead');
  expect(leadRow).not.toHaveProperty('templateStatus');
});

it('serves subagent bindings over the controller filtered by parent session', async () => {
  const runtime = await setup();
  const { ctx, lead, store, bindingsRoot } = runtime;
  const controller = new ClassmatesController(ctx, libraryConfig([researcher()], [modelProfile({ id: 'coding-low', name: 'Fast coding' })]), store);
  await store.recordSubagent({
    childId: SessionId('child-1'),
    parentSessionId: lead.id,
    createdAt: '2026-10-06T12:00:00.000Z',
    role: { id: 'researcher', revision: 1, name: 'Researcher', description: 'research' },
    modelSource: 'override',
    modelProfileId: 'coding-low',
    model: { provider: 'mock', id: 'specialist-a', effort: 'low' },
  });
  await store.recordSubagent({
    childId: SessionId('child-2'),
    parentSessionId: 'other-parent',
    createdAt: '2026-10-06T12:01:00.000Z',
    role: { id: 'researcher', revision: 1, name: 'Researcher', description: 'research' },
    modelSource: 'inherit',
  });

  const rows = await controller.subagents(lead.id);
  expect(rows.warnings).toBeUndefined();
  expect(rows.subagents).toHaveLength(1);
  expect(rows.subagents[0]).toMatchObject({
    childId: 'child-1',
    roleId: 'researcher',
    roleName: 'Researcher',
    roleRevision: 1,
    roleDescription: 'research',
    modelSource: 'override',
    modelProfileId: 'coding-low',
    modelProfileName: 'Fast coding',
    configuredModel: { provider: 'mock', id: 'specialist-a', effort: 'low' },
    templateStatus: 'ok',
    createdAt: '2026-10-06T12:00:00.000Z',
  });
  expect(rows.subagents[0]).not.toHaveProperty('currentRoleName');

  // Omitted parentSessionId never enumerates across sessions.
  expect((await controller.subagents()).subagents).toHaveLength(0);

  // Corrupt files degrade to a warnings count; valid rows still come back.
  writeFileSync(join(bindingsRoot, 'zz-broken.json'), '{broken');
  const degraded = await controller.subagents(lead.id);
  expect(degraded.warnings).toBe(1);
  expect(degraded.subagents).toHaveLength(1);

  // Status fields follow the live template: renaming flips the row to renamed.
  const second = new Context();
  try {
    const renamed = new ClassmatesController(second, libraryConfig([{ ...researcher(), name: 'Edited later' }]), store);
    const afterRename = await renamed.subagents(lead.id);
    expect(afterRename.subagents[0]).toMatchObject({ templateStatus: 'renamed', currentRoleName: 'Edited later' });
  } finally {
    await second.fiber.dispose();
  }
});

function memberEvent(seq: number, teamId: string, id: string, name: string): SessionEvent {
  return {
    type: 'team/member',
    seq: SessionSeq(seq),
    time: seq + 1,
    data: {
      version: 2,
      teamId: teamId as never,
      member: {
        id: SessionId(id),
        name,
        description: `${name} teammate`,
        provider: 'spawn',
        context: 'fresh',
        phase: 'active',
      },
    },
  } as SessionEvent;
}

function headerEvent(seq: number, model: string, provider = 'mock'): SessionEvent {
  return {
    type: 'request/header',
    seq: SessionSeq(seq),
    time: seq + 1,
    data: {
      header: { config: { provider, model } },
      reason: 'initial',
    },
  } as SessionEvent;
}

function cut(input: {
  id: string;
  inherited: number;
  events: SessionEvent[];
  projections?: { asOfSeq: number; values: Record<string, unknown> };
}): SessionObservation {
  const header = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(input.id),
    createdAt: 1,
    isSeeded: input.inherited > 0,
    ...input.inherited > 0 ? { parentSession: SessionId('parent-lead') } : {},
  } as SessionHeader;
  const lease = (): SessionObservation => ({
    source: 'prepared',
    header,
    inheritedEventCount: SessionLogOffset(input.inherited),
    events: input.events,
    cursor: input.events.at(-1)?.seq ?? -1,
    ...input.projections ? { projections: input.projections as ProjectionSnapshot } : {},
    retain: lease,
    [Symbol.dispose]: () => {},
  });
  return lease();
}

function queryContext(sessions: Record<string, SessionObservation>) {
  const ctx = new Context();
  ctx.provide('sessionQuery', {
    observeSession: async (sessionId: string) => {
      const found = sessions[sessionId];
      if (!found) throw new Error(`missing observation ${sessionId}`);
      return found.retain();
    },
  });
  return ctx;
}

it('does not present inherited ancestor teammates as the current Team roster', async () => {
  const forkId = 'fork-lead';
  const ctx = queryContext({
    [forkId]: cut({
      id: forkId,
      inherited: 2,
      events: [
        memberEvent(0, 'parent-lead', 'alpha', 'alpha'),
        memberEvent(1, 'parent-lead', 'beta', 'beta'),
        memberEvent(2, forkId, 'own-child', 'own-child'),
      ],
    }),
    'own-child': cut({ id: 'own-child', inherited: 0, events: [] }),
  });
  const details = await readTeamDetails(ctx, forkId);
  expect(details.members.map(member => member.memberName)).toEqual(['lead', 'own-child']);
  expect(details.members.map(member => member.memberId)).toEqual([forkId, 'own-child']);
});

it('keeps an official projection failure visible instead of folding a plausible inherited roster', async () => {
  const forkId = 'fork-lead';
  const failure = 'persisted Agent Teams team/member payload is invalid';
  const ctx = queryContext({
    [forkId]: cut({
      id: forkId,
      inherited: 1,
      events: [memberEvent(0, 'parent-lead', 'alpha', 'alpha')],
      projections: {
        asOfSeq: SessionSeq(0),
        values: { agentTeam: { members: [], tasks: [], failure } },
      },
    }),
  });
  const details = await readTeamDetails(ctx, forkId);
  expect(details.members.map(member => member.memberName)).toEqual(['lead']);
  expect(details.members[0]?.issue).toBe(failure);
});

it('does not treat an inherited parent request as a fork last-used model', async () => {
  const forkId = 'fork-lead';
  const childId = 'fork-child';
  const inherited = [
    headerEvent(0, 'parent-model'),
    memberEvent(1, 'parent-lead', 'other', 'other'),
  ];
  const before = queryContext({
    [forkId]: cut({
      id: forkId,
      inherited: 0,
      events: [memberEvent(0, forkId, childId, 'forked')],
      projections: {
        asOfSeq: SessionSeq(0),
        values: { agentTeam: { members: [{ id: forkId, name: 'lead', role: 'lead' }, { id: childId, name: 'forked', role: 'teammate' }], tasks: [] } },
      },
    }),
    [childId]: cut({
      id: childId,
      inherited: 2,
      events: inherited,
      projections: {
        asOfSeq: SessionSeq(1),
        values: { modelSelection: { lastUsed: { provider: 'mock', model: 'parent-model' }, next: { provider: 'mock', model: 'parent-model' } } },
      },
    }),
  });
  const unseen = await readTeamDetails(before, forkId);
  const beforeChild = unseen.members.find(member => member.memberName === 'forked');
  expect(beforeChild?.lastUsedModel).toBeNull();

  const after = queryContext({
    [forkId]: cut({
      id: forkId,
      inherited: 0,
      events: [memberEvent(0, forkId, childId, 'forked')],
    }),
    [childId]: cut({
      id: childId,
      inherited: 2,
      events: [...inherited, headerEvent(2, 'fork-model')],
      projections: {
        asOfSeq: SessionSeq(2),
        values: { modelSelection: { lastUsed: { provider: 'mock', model: 'parent-model' }, next: { provider: 'mock', model: 'parent-model' } } },
      },
    }),
  });
  const seen = await readTeamDetails(after, forkId);
  expect(seen.members.find(member => member.memberName === 'forked')?.lastUsedModel).toEqual({
    provider: 'mock',
    id: 'fork-model',
  });
});
