import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import SettingsForms from '@deepseek-ai/dsh-settings';
import { RoleConfig } from '../src/config.js';
import { Config } from '../src/index.js';
import {
  applyModelProfileChanges,
  lookupModelProfile,
  profileModelBinding,
  validateModelProfile,
  validateModelProfileChanges,
  validateModelProfiles,
} from '../src/model-profiles.js';
import type { ModelProfile } from '../src/contracts.js';

const profile: ModelProfile = {
  id: 'coding-high',
  revision: 0,
  name: 'Deep coding',
  description: 'careful implementation',
  enabled: true,
  model: { provider: 'test', id: 'one', reasoningEffort: 'high' },
};

it('validates preset identity like roles and keeps omitted effort omitted', () => {
  expect(validateModelProfile(profile)).toEqual(profile);
  expect(validateModelProfile({ ...profile, model: { provider: 'test', id: 'one' } }).model.reasoningEffort).toBeUndefined();
  expect(profileModelBinding({ ...profile, model: { provider: 'test', id: 'one' } })).toEqual({ provider: 'test', id: 'one' });
  expect(lookupModelProfile(validateModelProfiles([profile]), 'coding-high')?.name).toBe('Deep coding');
  expect(() => validateModelProfile({ ...profile, id: 'Bad_Id' })).toThrow('标识');
  expect(() => validateModelProfile({ ...profile, model: null })).toThrow('模型');
  expect(() => validateModelProfiles([profile, profile])).toThrow('重复');
  expect(validateModelProfiles(undefined)).toEqual([]);
});

it('rejects unknown batch envelopes and duplicate targets before applying', () => {
  expect(() => validateModelProfileChanges([{ op: 'rename', id: 'coding-high' }])).toThrow();
  expect(() => validateModelProfileChanges([
    { op: 'upsert', profile },
    { op: 'remove', id: 'coding-high', revision: 0 },
  ])).toThrow('重复');
  const next = applyModelProfileChanges([], [{ op: 'upsert', profile }]);
  expect(next[0].revision).toBe(1);
  expect(() => applyModelProfileChanges(next, [{ op: 'upsert', profile }])).toThrow('版本');
});

const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose();
});

it('commits profile and role edits through the real settings CAS without partial writes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'classmates-profile-cas-'));
  const ctx = new Context();
  contexts.push(ctx);
  let stored: Record<string, unknown> = { roles: [] };
  const entry: {
    id: string;
    options: { id: string; config: Record<string, unknown> };
    fiber: { uid: number; state: number; runtime: { Config: typeof Config }; config: Record<string, unknown>; ctx: Context };
  } = {
    id: 'classmates',
    options: { id: 'classmates', config: stored },
    fiber: { uid: 1, state: 2, runtime: { Config }, config: stored, ctx },
  };
  ctx.provide('profileContext', { dir: root, home: root, name: 'test' } as never);
  ctx.provide('loader', { await: async () => {} } as never);
  ctx.provide('configEditor', {
    configuration: () => [{ entry, inherited: stored, override: stored }],
    entries: () => [entry],
    edit: async (_target: unknown, apply: (raw: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>) => {
      stored = apply(stored, stored);
      entry.options.config = stored;
      entry.fiber.config = stored;
    },
  } as never);
  ctx.provide('llm', {
    listProviders: () => [{ id: 'test', name: 'Test' }],
    listModels: async () => [{ id: 'one', name: 'One' }],
    resolveModelInfo: async (provider: string, id: string) => {
      if (provider !== 'test' || id !== 'one') throw new Error('Model unavailable');
      return { id, name: 'One', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } };
    },
  } as never);
  await ctx.plugin(SettingsForms);
  const store = new RoleConfig(ctx);
  const initial = await store.load();
  expect(initial.modelProfiles).toEqual([]);
  expect(initial.settingsRevision).toBeTypeOf('number');

  const saved = await store.batchModelProfiles([
    { op: 'upsert', profile: { ...profile, id: 'fast', name: 'fast', model: { provider: 'test', id: 'one', reasoningEffort: 'low' } } },
    { op: 'upsert', profile: { ...profile, id: 'deep' } },
  ], initial.settingsRevision);
  expect(saved.modelProfiles?.map(item => item.id)).toEqual(['fast', 'deep']);
  expect(stored.roles).toEqual([]);
  expect(stored.modelProfiles).toHaveLength(2);

  await expect(store.batchModelProfiles([
    { op: 'upsert', profile: { ...saved.modelProfiles![0], name: 'stale' } },
  ], initial.settingsRevision)).rejects.toThrow();
  expect((stored.modelProfiles as ModelProfile[]).map(item => item.name)).toEqual(['fast', 'Deep coding']);

  const afterRoles = await store.batch([
    {
      op: 'upsert',
      role: {
        schemaVersion: 1, id: 'researcher', revision: 0, name: 'Researcher',
        description: 'research', instructions: 'Research the question.', enabled: false, model: null,
      },
    },
  ], saved.settingsRevision);
  expect(afterRoles.roles.map(role => role.id)).toEqual(['researcher']);
  expect(afterRoles.modelProfiles?.map(item => item.id)).toEqual(['fast', 'deep']);
  const route = { provider: 'test', id: 'one' };
  const locked = await store.setModelProtection(route, true, afterRoles.settingsRevision);
  expect(locked.protectedModels).toEqual([route]);
  await expect(store.setModelProtection(route, false, afterRoles.settingsRevision)).rejects.toThrow('其他页面');
  expect(store.read().protectedModels).toEqual([route]);
  const removed = await store.removeModelProfile('fast', 1, locked.settingsRevision);
  expect(removed.protectedModels).toEqual([route]);
  const unavailable = await store.setModelProtection({ provider: 'gone', id: 'missing' }, true, removed.settingsRevision);
  expect(unavailable.protectedModels).toHaveLength(2);
  const unlocked = await store.setModelProtection({ provider: 'gone', id: 'missing' }, false, unavailable.settingsRevision);
  expect(unlocked.protectedModels).toEqual([route]);
  expect(unlocked.modelProfiles?.map(item => item.id)).toEqual(['deep']);
  rmSync(root, { recursive: true, force: true });
});
