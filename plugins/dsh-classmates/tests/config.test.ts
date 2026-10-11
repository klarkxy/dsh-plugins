import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { currentModelFromOwnRequestHeaders, RoleConfig, validateRole, validateRoles } from '../src/config.js';
import { validateModelProfiles } from '../src/model-profiles.js';
import { validateProtectedModels } from '../src/model-protection.js';
import { createPresets, SOFTWARE_COLLABORATION_RULES } from '../src/presets.js';
import type { ModelProfile, ModelRoute, NormalizedRole } from '../src/contracts.js';

function fixture() {
  let roles: NormalizedRole[] = validateRoles(createPresets().slice(0, 3));
  let profiles: ModelProfile[] | undefined;
  let protectedModels: ModelRoute[] = [];
  let revision = 2;
  let writable = true;
  const context = {
    settings: {
      get writable() { return writable; },
      describe: () => [{ ns: 'classmates', revision, value: { roles, protectedModels, ...profiles === undefined ? {} : { modelProfiles: profiles } } }],
      mutate: async (_ns: string, ops: { path: string[]; value: unknown }[], expected: number) => {
        if (revision !== expected) throw new Error('SETTINGS_CONFLICT');
        for (const op of ops) {
          if (op.path[0] === 'roles') roles = validateRoles(op.value);
          else if (op.path[0] === 'modelProfiles') profiles = validateModelProfiles(op.value);
          else if (op.path[0] === 'protectedModels') protectedModels = validateProtectedModels(op.value);
        }
        revision++;
      },
    },
    llm: {
      listProviders: () => [{ id: 'test', name: 'Test' }],
      listModels: async () => [{ id: 'one', name: 'One' }],
      listConfigurableProviders: () => { throw new Error('catalog must not read configurable credentials'); },
      resolveModelInfo: async (provider: string, id: string) => {
        if (provider !== 'test' || id !== 'one') throw new Error('Model unavailable');
        return {
          id, name: 'One',
          reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
        };
      },
    },
  } as unknown as Context;
  return {
    store: new RoleConfig(context), context,
    getRoles: () => roles, getProfiles: () => profiles,
    interfere: () => { revision++; },
    setWritable: (value: boolean) => { writable = value; },
  };
}

async function promptly<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Mutation waited for the model directory')), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

function profile(partial: Partial<ModelProfile> & Pick<ModelProfile, 'id'>): ModelProfile {
  return {
    revision: 0,
    name: partial.id,
    description: 'purpose preset',
    enabled: true,
    model: { provider: 'test', id: 'one' },
    ...partial,
  };
}

describe('role configuration', () => {
  it('starts with twelve inheriting disabled presets and a distinct Advisor', () => {
    const roles = createPresets();
    expect(roles).toHaveLength(12);
    expect(roles.map(role => role.id)).toContain('advisor');
    expect(roles.every(role => !role.enabled && role.model === null)).toBe(true);
    expect(roles.every(role => !/\p{Script=Han}/u.test(role.instructions))).toBe(true);
    const advisor = roles.find(role => role.id === 'advisor')!;
    expect(advisor.instructions).not.toContain(SOFTWARE_COLLABORATION_RULES);
    expect(advisor.description).toMatch(/只读咨询/);
    roles[0].instructions = 'edited';
    expect(createPresets()[0].instructions).not.toBe('edited');
    const bundled = JSON.stringify(createPresets());
    expect(bundled).not.toMatch(/扫雷|minesweeper/i);
    expect(bundled).toContain(SOFTWARE_COLLABORATION_RULES);
  });

  it('migrates recommendedModelProfileId into a strong profile reference on save', async () => {
    const { store, getRoles } = fixture();
    const state = store.read();
    const bound = await store.save({
      ...state.roles[0],
      model: null,
      recommendedModelProfileId: 'coding-high',
    }, state.settingsRevision);
    expect(bound.roles[0]).toMatchObject({ model: { kind: 'profile', profileId: 'coding-high' } });
    expect(bound.roles[0]).not.toHaveProperty('recommendedModelProfileId');
    expect(bound.roles[0]).not.toHaveProperty('migratedRecommendation');
    expect(getRoles()[0]).toMatchObject({ model: { kind: 'profile', profileId: 'coding-high' } });
    expect(getRoles()[0]).not.toHaveProperty('recommendedModelProfileId');

    expect(validateRole({ ...bound.roles[0], recommendedModelProfileId: '' })).not.toHaveProperty('recommendedModelProfileId');
    expect(validateRole({ ...bound.roles[0], recommendedModelProfileId: null as never })).not.toHaveProperty('recommendedModelProfileId');
    // An already-normalized model always wins over a stray legacy recommendation.
    expect(validateRole({ ...bound.roles[0], recommendedModelProfileId: 'gone-profile' })).toMatchObject({
      model: { kind: 'profile', profileId: 'coding-high' },
    });
    expect(validateRole({ ...bound.roles[0], model: null, recommendedModelProfileId: 'gone-profile' })).toMatchObject({
      model: { kind: 'profile', profileId: 'gone-profile' },
    });
    const profiles = await store.saveModelProfile(profile({ id: 'coding-high', name: 'Deep coding' }), bound.settingsRevision);
    expect(profiles.roles[0]).toMatchObject({ model: { kind: 'profile', profileId: 'coding-high' } });
    const removed = await store.removeModelProfile('coding-high', 1, profiles.settingsRevision);
    expect(removed.roles[0]).toMatchObject({ model: { kind: 'profile', profileId: 'coding-high' } });
    const cleared = await store.save({ ...removed.roles[0], model: { kind: 'inherit' } }, removed.settingsRevision);
    expect(cleared.roles[0]).toMatchObject({ model: { kind: 'inherit' } });
    expect(cleared.roles[0]).not.toHaveProperty('recommendedModelProfileId');
    expect(cleared.roles[0]).not.toHaveProperty('migratedRecommendation');
  });

  it('prefers a legacy fixed model over a stored recommendation and reports migratedRecommendation until saved', async () => {
    const { store, getRoles } = fixture();
    // Seed legacy storage directly: old versions could persist both fields.
    getRoles()[0] = {
      ...getRoles()[0],
      model: { provider: 'test', id: 'one', reasoningEffort: 'high' },
      recommendedModelProfileId: 'coding-high',
    } as never;
    const legacy = store.read();
    expect(legacy.roles[0]).toMatchObject({ model: { kind: 'fixed', provider: 'test', id: 'one', effort: 'high' } });
    expect(legacy.roles[0].migratedRecommendation).toBe('coding-high');
    expect(legacy.roles[0]).not.toHaveProperty('recommendedModelProfileId');

    const saved = await store.save(legacy.roles[0], legacy.settingsRevision);
    expect(saved.roles[0]).toMatchObject({ model: { kind: 'fixed', provider: 'test', id: 'one', effort: 'high' } });
    expect(saved.roles[0]).not.toHaveProperty('migratedRecommendation');
    expect(saved.roles[0]).not.toHaveProperty('recommendedModelProfileId');
    expect(getRoles()[0]).not.toHaveProperty('migratedRecommendation');
    expect(getRoles()[0]).toMatchObject({ model: { kind: 'fixed', provider: 'test', id: 'one', effort: 'high' } });
  });

  it('rejects unknown schemas, duplicate IDs, incomplete bindings and enabled drafts', () => {
    const role = createPresets()[0];
    expect(() => validateRole({ ...role, schemaVersion: 2 })).toThrow();
    expect(validateRole({ ...role, enabled: true, reasoningEffort: 'high' })).toMatchObject({ model: { kind: 'inherit' }, enabled: true, reasoningEffort: 'high' });
    expect(() => validateRole({ ...role, model: { provider: 'test' } })).toThrow();
    expect(() => validateRoles([role, role])).toThrow('重复');
    expect(() => validateRole({ ...role, description: 'a'.repeat(201) })).toThrow('200');
  });

  it('keeps unrelated catalog failures visible without turning a committed save or delete into failure', async () => {
    const { store, context } = fixture();
    context.llm.listProviders = () => [{ id: 'test', name: 'Test' }, { id: 'offline', name: 'Offline' }];
    context.llm.listModels = async provider => {
      if (provider === 'offline') throw new Error('catalog offline');
      return [{ provider, id: 'one', name: 'One' }];
    };
    const initial = await store.load();
    expect(initial.models).toHaveLength(1);
    expect(initial.models[0]).toMatchObject({
      provider: 'test',
      providerName: 'Test',
      availability: 'unverified',
      id: 'one',
      name: 'One',
    });
    expect(initial.catalogErrors).toHaveLength(1);
    const saved = await store.save({ ...initial.roles[0], name: 'Saved' }, initial.settingsRevision);
    expect(saved.roles[0].name).toBe('Saved');
    expect(saved.catalogErrors).toHaveLength(1);
    const deleted = await store.remove(saved.roles[0].id, saved.roles[0].revision, saved.settingsRevision);
    expect(deleted.roles).toHaveLength(2);
  });

  it('returns every settings mutation while an unrelated directory refresh never resolves', async () => {
    const { store, context } = fixture();
    context.llm.listProviders = () => [{ id: 'test', name: 'Test' }, { id: 'offline', name: 'Offline' }];
    context.llm.listModels = async provider => {
      if (provider === 'offline') throw new Error('catalog offline');
      return [{ provider, id: 'one', name: 'One' }];
    };
    const initial = await store.load();
    const calls: string[] = [];
    context.llm.listModels = provider => {
      calls.push(provider);
      return provider === 'offline' ? new Promise(() => {}) : Promise.resolve([{ provider, id: 'one', name: 'One' }]);
    };
    void store.load(); // A separately requested refresh is stuck in the unrelated provider.

    let next = await promptly(store.save({
      ...initial.roles[0], name: 'Saved promptly', enabled: true,
      model: { kind: 'fixed', provider: 'test', id: 'one', effort: 'high' },
    }, initial.settingsRevision));
    expect(next.roles[0]).toMatchObject({ name: 'Saved promptly', revision: 2 });
    expect(next.settingsRevision).toBe(initial.settingsRevision + 1);
    expect(next.models).toEqual(initial.models);
    expect(next.catalogErrors).toEqual(initial.catalogErrors);

    next = await promptly(store.batch([{ op: 'upsert', role: { ...next.roles[0], name: 'Batch saved' } }], next.settingsRevision));
    next = await promptly(store.remove(next.roles[1].id, next.roles[1].revision, next.settingsRevision));
    next = await promptly(store.saveModelProfile(profile({ id: 'quick' }), next.settingsRevision));
    next = await promptly(store.batchModelProfiles([{ op: 'upsert', profile: { ...next.modelProfiles![0], name: 'Updated' } }], next.settingsRevision));
    expect(next.modelProfiles![0]).toMatchObject({ name: 'Updated', revision: 2 });
    next = await promptly(store.removeModelProfile('quick', 2, next.settingsRevision));
    next = await promptly(store.setModelProtection({ provider: 'test', id: 'one' }, true, next.settingsRevision));
    expect(next.protectedModels).toEqual([{ provider: 'test', id: 'one' }]);
    expect(next.settingsRevision).toBe(initial.settingsRevision + 7);

    const revision = next.settingsRevision;
    next = await promptly(store.batch([], revision));
    next = await promptly(store.batchModelProfiles([], revision));
    next = await promptly(store.setModelProtection({ provider: 'test', id: 'one' }, true, revision));
    expect(next.settingsRevision).toBe(revision);
    expect(next.roles).toEqual(store.read().roles);
    expect(next.modelProfiles).toEqual([]);
    expect(next.catalogErrors).toEqual(initial.catalogErrors);
    expect(calls).toEqual(['test', 'offline']);

    // Returned state is detached: consumers cannot corrupt the saved directory snapshot.
    next.models.length = 0;
    next.catalogErrors!.length = 0;
    const again = await promptly(store.batch([], revision));
    expect(again.models).toEqual(initial.models);
    expect(again.catalogErrors).toEqual(initial.catalogErrors);
  });

  it('refreshes the advisory directory only when load is explicitly requested', async () => {
    const { store, context } = fixture();
    const initial = store.read();
    const saved = await store.save({ ...initial.roles[0], name: 'Before load' }, initial.settingsRevision);
    expect(saved.models).toEqual([]);
    const loaded = await store.load();
    expect(loaded.models).toHaveLength(1);
    context.llm.listProviders = () => [];
    const renamed = await store.save({ ...loaded.roles[0], name: 'After load' }, loaded.settingsRevision);
    expect(renamed.models).toEqual(loaded.models);
    const refreshed = await store.load();
    expect(refreshed.models).toEqual([]);
    expect(refreshed.roles[0].name).toBe('After load');
    expect(refreshed.settingsRevision).toBe(renamed.settingsRevision);
  });

  it.each(['save', 'batch', 'saveModelProfile', 'batchModelProfiles'] as const)(
    'preserves settings CAS when another edit arrives during %s model validation', async method => {
      const { store, context, interfere, getRoles, getProfiles } = fixture();
      const state = store.read();
      let release!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; });
      let validating!: () => void;
      const started = new Promise<void>(resolve => { validating = resolve; });
      const resolveModel = context.llm.resolveModelInfo.bind(context.llm);
      context.llm.resolveModelInfo = async (...args) => {
        validating();
        await waiting;
        return resolveModel(...args);
      };
      const role = { ...state.roles[0], name: 'Stale', enabled: true, model: { kind: 'fixed' as const, provider: 'test', id: 'one' } };
      const modelProfile = profile({ id: 'stale' });
      const operation = method === 'save' ? store.save(role, state.settingsRevision)
        : method === 'batch' ? store.batch([{ op: 'upsert', role }], state.settingsRevision)
        : method === 'saveModelProfile' ? store.saveModelProfile(modelProfile, state.settingsRevision)
        : store.batchModelProfiles([{ op: 'upsert', profile: modelProfile }], state.settingsRevision);
      const rejected = expect(operation).rejects.toThrow(method === 'save' ? '其他页面' : 'SETTINGS_CONFLICT');
      await started;
      interfere();
      release();
      await rejected;
      expect(getRoles()[0]).toMatchObject({ name: 'Researcher', revision: 1 });
      expect(getProfiles()).toBeUndefined();
      expect(store.read().settingsRevision).toBe(state.settingsRevision + 1);
    },
  );

  it('increments a persistent role revision only after a successful save', async () => {
    const { store, getRoles } = fixture();
    const original = store.read();
    const saved = await store.save({ ...original.roles[0], enabled: true, model: { provider: 'test', id: 'one', reasoningEffort: 'high' } }, original.settingsRevision);
    expect(saved.roles[0]).toMatchObject({ revision: 2, enabled: true });
    await expect(store.save({ ...saved.roles[0], model: { provider: 'test', id: 'one', reasoningEffort: 'invented' } }, saved.settingsRevision)).rejects.toThrow('思考强度');
    expect(getRoles()[0].revision).toBe(2);
  });

  it('rejects stale settings and role revisions without overwriting', async () => {
    const { store, interfere, getRoles } = fixture();
    const state = store.read();
    interfere();
    await expect(store.save({ ...state.roles[0], name: 'Lost edit' }, state.settingsRevision)).rejects.toThrow('其他页面');
    await expect(store.save({ ...state.roles[0], revision: 0 }, state.settingsRevision + 1)).rejects.toThrow('版本');
    expect(getRoles()[0].name).toBe('Researcher');
  });

  it('creates a role from revision zero and checks revision on deletion', async () => {
    const { store } = fixture();
    const state = store.read();
    const added = await store.save({ ...state.roles[0], id: 'custom', revision: 0 }, state.settingsRevision);
    expect(added.roles.find(role => role.id === 'custom')?.revision).toBe(1);
    await expect(store.remove('custom', 0, added.settingsRevision)).rejects.toThrow();
    const removed = await store.remove('custom', 1, added.settingsRevision);
    expect(removed.roles.some(role => role.id === 'custom')).toBe(false);
  });

  it('applies a whole batch after every op validates and never partially commits', async () => {
    const { store, getRoles } = fixture();
    const state = store.read();
    const researcher = state.roles[0];
    const writer = state.roles[1];
    const saved = await store.batch([
      { op: 'upsert', role: { ...researcher, name: '调研员', enabled: true, model: { provider: 'test', id: 'one' } } },
      { op: 'remove', id: writer.id, revision: writer.revision },
      { op: 'upsert', role: { ...researcher, id: 'custom', revision: 0, name: 'Custom', description: 'extra specialist', instructions: 'Do the extra work.' } },
    ], state.settingsRevision);
    expect(saved.roles.map(role => role.id).sort()).toEqual(['custom', 'researcher', 'verifier']);
    expect(saved.roles.find(role => role.id === 'researcher')).toMatchObject({ name: '调研员', revision: 2, enabled: true });
    expect(saved.roles.find(role => role.id === 'custom')?.revision).toBe(1);

    const next = store.read();
    await expect(store.batch([
      { op: 'upsert', role: { ...saved.roles[0], name: 'partial' } },
      { op: 'upsert', role: { ...saved.roles[0], name: 'again' } },
    ], next.settingsRevision)).rejects.toThrow('重复');
    expect(getRoles().find(role => role.id === 'researcher')?.name).toBe('调研员');

    await expect(store.batch([
      { op: 'upsert', role: { ...next.roles.find(role => role.id === 'researcher')!, name: 'lost', model: { provider: 'test', id: 'missing' } } },
      { op: 'remove', id: 'custom', revision: 1 },
    ], next.settingsRevision)).rejects.toThrow();
    expect(getRoles().some(role => role.id === 'custom')).toBe(true);
    expect(getRoles().find(role => role.id === 'researcher')?.name).toBe('调研员');
  });

  it('rejects stale, duplicate, and unknown batch envelopes without writing', async () => {
    const { store, interfere, getRoles } = fixture();
    const state = store.read();
    interfere();
    await expect(store.batch([
      { op: 'upsert', role: { ...state.roles[0], name: 'stale' } },
    ], state.settingsRevision)).rejects.toThrow('其他页面');
    await expect(store.batch([{ op: 'rename', id: 'researcher' }], state.settingsRevision + 1)).rejects.toThrow();
    await expect(store.batch([{ op: 'remove', id: 'researcher', revision: 1, extra: true }], state.settingsRevision + 1)).rejects.toThrow('未知');
    expect(getRoles()[0].name).toBe('Researcher');
    const latest = store.read();
    const empty = await store.batch([], latest.settingsRevision);
    expect(empty.roles).toHaveLength(3);
    expect(empty.settingsRevision).toBe(latest.settingsRevision);
  });

  it('can disable or remove a role after its provider vanishes without resolving the model', async () => {
    const { store, context } = fixture();
    const state = store.read();
    const enabled = await store.save({
      ...state.roles[0],
      enabled: true,
      model: { provider: 'test', id: 'one', reasoningEffort: 'high' },
    }, state.settingsRevision);
    context.llm.listProviders = () => [];
    context.llm.resolveModelInfo = async () => { throw new Error('provider gone'); };

    await expect(store.save({ ...enabled.roles[0], name: 'Still on' }, enabled.settingsRevision)).rejects.toThrow('模型供应商');
    expect(store.read().roles[0]).toMatchObject({ name: 'Researcher', enabled: true });

    const disabled = await store.save({ ...enabled.roles[0], enabled: false }, enabled.settingsRevision);
    expect(disabled.roles[0]).toMatchObject({
      enabled: false,
      name: 'Researcher',
      model: { kind: 'fixed', provider: 'test', id: 'one', effort: 'high' },
    });

    const renamed = await store.batch([
      { op: 'upsert', role: { ...disabled.roles[0], name: 'Parked researcher' } },
    ], disabled.settingsRevision);
    expect(renamed.roles[0]).toMatchObject({ enabled: false, name: 'Parked researcher' });

    await expect(store.save({ ...renamed.roles[0], enabled: true }, renamed.settingsRevision)).rejects.toThrow('模型供应商');
    await expect(store.save({
      ...renamed.roles[0],
      enabled: false,
      model: { provider: 'test' } as never,
    }, renamed.settingsRevision)).rejects.toThrow();
    expect(store.read().roles[0].name).toBe('Parked researcher');

    const removed = await store.batch([
      { op: 'remove', id: renamed.roles[0].id, revision: renamed.roles[0].revision },
    ], renamed.settingsRevision);
    expect(removed.roles.some(role => role.id === 'researcher')).toBe(false);
  });

  it('keeps public provider names on catalog rows and never treats registry listing as readiness', async () => {
    const { store, context } = fixture();
    const called: string[] = [];
    context.llm.listProviders = () => [
      { id: 'ocg', name: 'Local OCG' },
      { id: 'deepseek-official', name: 'DeepSeek' },
      { id: '', name: 'Nameless' },
    ];
    const llm = context.llm as {
      listModels: (provider: string) => Promise<unknown>;
      listConfigurableProviders: () => unknown;
      resolveModelInfo: (provider: string, id: string) => Promise<unknown>;
    };
    llm.listModels = async provider => {
      called.push(`listModels:${provider}`);
      if (provider === 'ocg') {
        return [
          { provider, id: 'step-5-preview', name: 'Step 5 Preview' },
          { provider, id: 'mimo-v2.6-flash', name: 'MiMo v2.6 Flash' },
          { provider, id: 'space-bunny', name: 'space-bunny' },
          { provider, id: '', name: 'missing-id' },
        ];
      }
      if (provider === 'deepseek-official') return [{ provider, id: 'deepseek-chat', name: 'DeepSeek Chat' }];
      throw new Error(`unexpected provider ${provider}`);
    };
    llm.listConfigurableProviders = () => {
      called.push('listConfigurableProviders');
      return [];
    };
    llm.resolveModelInfo = async (provider, id) => {
      called.push(`resolve:${provider}/${id}`);
      if (provider === 'ocg' && id === 'space-bunny') throw new Error('metadata missing');
      return {
        provider,
        id,
        name: id,
        reasoning: { efforts: provider === 'ocg' && id === 'step-5-preview' ? [{ id: 'high', name: 'High' }] : [] },
      };
    };

    const catalog = await store.catalog();
    expect(called.some(item => item.startsWith('listConfigurableProviders'))).toBe(false);
    expect(catalog.models.map(model => `${model.provider}:${model.id}`)).toEqual([
      'deepseek-official:deepseek-chat',
      'ocg:mimo-v2.6-flash',
      'ocg:step-5-preview',
    ]);
    expect(catalog.models.every(model => model.availability === 'unverified')).toBe(true);
    expect(catalog.models.find(model => model.provider === 'ocg')).toMatchObject({
      provider: 'ocg',
      providerName: 'Local OCG',
    });
    expect(catalog.models.find(model => model.provider === 'deepseek-official')).toMatchObject({
      providerName: 'DeepSeek',
      availability: 'unverified',
    });
    expect(JSON.stringify(catalog.models)).not.toMatch(/connected|ready|凭证|apiKey|baseURL/i);
    expect(catalog.catalogErrors.some(item => item.includes('Local OCG') && item.includes('space-bunny'))).toBe(true);
    expect(catalog.catalogErrors.some(item => item.includes('Nameless') || item.includes('未命名'))).toBe(true);
    expect(catalog.catalogErrors.some(item => item.includes('缺少公开标识'))).toBe(true);
    expect(catalog.models.find(model => model.id === 'step-5-preview')?.efforts).toEqual([{ id: 'high', name: 'High' }]);
  });

  it('reads only own request/header routes and rejects unknown or inherited shapes', () => {
    const inherited = [
      { type: 'request/header', seq: 0, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-chat' } } } },
      { type: 'request/header', seq: 1, data: { header: { config: { provider: 'ocg', model: 'parent-only' } } } },
    ];
    expect(currentModelFromOwnRequestHeaders(inherited, 2)).toBeNull();
    expect(currentModelFromOwnRequestHeaders(inherited, 0)).toEqual({ provider: 'ocg', id: 'parent-only' });

    const own = [
      ...inherited,
      { type: 'request/context', seq: 2, data: { provider: 'deepseek-official', model: 'ignored' } },
      { type: 'request/header', seq: 3, data: { header: { config: { provider: 'ocg', model: 'step-5-preview', reasoningEffort: 'high', temperature: 0.2 } } } },
    ];
    expect(currentModelFromOwnRequestHeaders(own, 2)).toEqual({
      provider: 'ocg',
      id: 'step-5-preview',
      reasoningEffort: 'high',
    });

    expect(currentModelFromOwnRequestHeaders([
      { type: 'request/header', seq: 0, data: { header: { config: { provider: 'ocg', id: 'mimo-v2.6-flash' } } } },
    ], 0)).toEqual({ provider: 'ocg', id: 'mimo-v2.6-flash' });

    expect(currentModelFromOwnRequestHeaders([
      { type: 'request/header', seq: 4, data: { header: { config: { provider: 'ocg', model: 'space-bunny', reasoningEffort: '   ' } } } },
      { type: 'request/header', seq: 5, data: { header: { config: { provider: '', model: 'x' } } } },
      { type: 'request/header', seq: 6, data: { header: { config: { provider: 'ocg' } } } },
      { type: 'request/header', data: { header: { config: { provider: 'ocg', model: 'no-seq' } } } },
      { type: 'request/header', seq: 7, data: { header: 'not-an-object' } },
      { type: 'request/header', seq: 8, data: null },
      { type: 'user/message', seq: 9, data: { header: { config: { provider: 'ocg', model: 'not-a-header' } } } },
    ], 0)).toBeNull();

    expect(currentModelFromOwnRequestHeaders({ type: 'request/header' }, 0)).toBeNull();
    expect(currentModelFromOwnRequestHeaders(own, -1)).toBeNull();
  });
});

describe('model-use presets', () => {
  it('treats a missing modelProfiles field as an empty array and keeps it off role writes', async () => {
    const { store, getProfiles, getRoles } = fixture();
    const initial = await store.load();
    expect(initial.modelProfiles).toEqual([]);
    expect(getProfiles()).toBeUndefined();
    const saved = await store.save({ ...initial.roles[0], name: '调研员' }, initial.settingsRevision);
    expect(saved.modelProfiles).toEqual([]);
    expect(getProfiles()).toBeUndefined();
    expect(getRoles()[0].name).toBe('调研员');
  });

  it('stores two purpose presets on the same route with different efforts', async () => {
    const { store, getRoles } = fixture();
    const state = store.read();
    const saved = await store.batchModelProfiles([
      { op: 'upsert', profile: profile({ id: 'coding-low', name: 'Fast coding', description: 'cheap draft', model: { provider: 'test', id: 'one', reasoningEffort: 'low' } }) },
      { op: 'upsert', profile: profile({ id: 'coding-high', name: 'Deep coding', description: 'careful review', model: { provider: 'test', id: 'one', reasoningEffort: 'high' } }) },
    ], state.settingsRevision);
    expect(saved.modelProfiles?.map(item => item.id)).toEqual(['coding-low', 'coding-high']);
    expect(saved.modelProfiles?.map(item => item.model)).toEqual([
      { provider: 'test', id: 'one', reasoningEffort: 'low' },
      { provider: 'test', id: 'one', reasoningEffort: 'high' },
    ]);
    expect(saved.modelProfiles?.every(item => item.revision === 1)).toBe(true);
    expect(getRoles().map(role => role.id)).toEqual(state.roles.map(role => role.id));

    const renamed = await store.save({ ...saved.roles[0], name: 'Still researcher' }, saved.settingsRevision);
    expect(renamed.roles[0].name).toBe('Still researcher');
    expect(renamed.modelProfiles?.map(item => item.id)).toEqual(['coding-low', 'coding-high']);
  });

  it('omits effort as the selected model default and rejects unsupported effort without writing', async () => {
    const { store, getProfiles } = fixture();
    const state = store.read();
    const omitted = await store.saveModelProfile(profile({ id: 'default-effort' }), state.settingsRevision);
    expect(omitted.modelProfiles?.[0]).toMatchObject({
      id: 'default-effort',
      revision: 1,
      model: { provider: 'test', id: 'one' },
    });
    expect(omitted.modelProfiles?.[0].model.reasoningEffort).toBeUndefined();

    await expect(store.saveModelProfile({
      ...omitted.modelProfiles![0],
      model: { provider: 'test', id: 'one', reasoningEffort: 'invented' },
    }, omitted.settingsRevision)).rejects.toThrow('思考强度');
    expect(getProfiles()?.[0]).toMatchObject({ revision: 1, model: { provider: 'test', id: 'one' } });
  });

  it('skips catalog resolve for disabled presets and refuses read-only writes', async () => {
    const { store, context, setWritable, getProfiles } = fixture();
    const state = store.read();
    const parked = await store.saveModelProfile(profile({
      id: 'parked',
      enabled: false,
      model: { provider: 'gone', id: 'missing' },
    }), state.settingsRevision);
    expect(parked.modelProfiles?.[0]).toMatchObject({ enabled: false, model: { provider: 'gone', id: 'missing' } });

    context.llm.listProviders = () => [];
    await expect(store.saveModelProfile({ ...parked.modelProfiles![0], enabled: true }, parked.settingsRevision)).rejects.toThrow('模型供应商');
    expect(getProfiles()?.[0].enabled).toBe(false);

    const disabled = await store.saveModelProfile({ ...parked.modelProfiles![0], name: 'Still parked' }, parked.settingsRevision);
    expect(disabled.modelProfiles?.[0].name).toBe('Still parked');

    setWritable(false);
    await expect(store.saveModelProfile({ ...disabled.modelProfiles![0], name: 'blocked' }, disabled.settingsRevision)).rejects.toThrow('只读');
    await expect(store.save({ ...disabled.roles[0], name: 'blocked role' }, disabled.settingsRevision)).rejects.toThrow('只读');
    expect(getProfiles()?.[0].name).toBe('Still parked');
  });

  it('applies an atomic profile batch and leaves roles untouched on conflict', async () => {
    const { store, interfere, getProfiles, getRoles } = fixture();
    const state = store.read();
    const seeded = await store.batchModelProfiles([
      { op: 'upsert', profile: profile({ id: 'keep' }) },
    ], state.settingsRevision);
    const next = store.read();
    await expect(store.batchModelProfiles([
      { op: 'upsert', profile: { ...seeded.modelProfiles![0], name: 'partial' } },
      { op: 'upsert', profile: { ...seeded.modelProfiles![0], name: 'again' } },
    ], next.settingsRevision)).rejects.toThrow('重复');
    expect(getProfiles()?.[0].name).toBe('keep');

    await expect(store.batchModelProfiles([
      { op: 'upsert', profile: { ...next.modelProfiles![0], name: 'lost', model: { provider: 'test', id: 'missing' } } },
      { op: 'remove', id: 'keep', revision: 1 },
    ], next.settingsRevision)).rejects.toThrow();
    expect(getProfiles()?.some(item => item.id === 'keep')).toBe(true);
    expect(getRoles()[0].name).toBe('Researcher');

    interfere();
    await expect(store.batchModelProfiles([
      { op: 'upsert', profile: { ...next.modelProfiles![0], name: 'stale' } },
    ], next.settingsRevision)).rejects.toThrow('其他页面');
    expect(getProfiles()?.[0].name).toBe('keep');
  });

  it('forwards catalog model and effort descriptions without inventing ranking text', async () => {
    const { store, context } = fixture();
    const llm = context.llm as {
      listModels: (provider: string) => Promise<unknown>;
      resolveModelInfo: (provider: string, id: string) => Promise<unknown>;
    };
    llm.listModels = async () => [{ id: 'one', name: 'One' }];
    llm.resolveModelInfo = async (provider, id) => {
      if (provider !== 'test' || id !== 'one') throw new Error('Model unavailable');
      return {
        id, name: 'One', description: 'Catalog model blurb',
        reasoning: { efforts: [{ id: 'high', name: 'High', description: 'Think longer' }] },
      };
    };
    const catalog = await store.catalog();
    expect(catalog.models[0]).toMatchObject({
      id: 'one',
      description: 'Catalog model blurb',
      efforts: [{ id: 'high', name: 'High', description: 'Think longer' }],
    });
    expect(JSON.stringify(catalog.models)).not.toMatch(/connected|ready|排名|最强|定价/i);
  });
});

