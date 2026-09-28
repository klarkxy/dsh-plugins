import { expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway';
import { ClassmatesController } from '../src/controller.js';
import type { RoleConfig } from '../src/config.js';
import { classmatesRemote } from '../src/rpc.js';

it('dispatches the packaged JSON contract through the official gateway and rejects extra arguments', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(TypertRegistry);
    await ctx.plugin(TypertGatewayService, {});
    new ClassmatesController(ctx, {
      load: async () => ({ roles: [], models: [], settingsRevision: 0, writable: true }),
      save: async (_role: unknown, expected: number) => { if (expected !== 0) throw new Error('revision conflict'); return { saved: true }; },
      remove: async () => ({ removed: true }),
      batch: async (changes: unknown, expected: number) => {
        if (expected !== 0) throw new Error('revision conflict');
        return { batched: true, changes };
      },
      saveModelProfile: async (_profile: unknown, expected: number) => {
        if (expected !== 0) throw new Error('revision conflict');
        return { profileSaved: true };
      },
      removeModelProfile: async () => ({ profileRemoved: true }),
      batchModelProfiles: async (changes: unknown, expected: number) => {
        if (expected !== 0) throw new Error('revision conflict');
        return { profileBatched: true, changes };
      },
    } as unknown as RoleConfig);
    const load = classmatesRemote.descriptors.find(item => item.method === 'load')!;
    expect(classmatesRemote.descriptors.map(item => item.method)).toEqual([
      'load', 'save', 'deleteRole', 'batch', 'saveModelProfile', 'deleteModelProfile', 'batchModelProfiles', 'setModelProtection', 'team',
    ]);
    await expect(ctx.typertGateway.invoke({ namespace: load.namespace, method: load.method, args: {} })).resolves.toMatchObject({ writable: true });
    await expect(ctx.typertGateway.invoke({ namespace: 'classmates', method: 'save', args: { role: {}, expected: 0 } })).resolves.toEqual({ saved: true });
    await expect(ctx.typertGateway.invoke({ namespace: 'classmates', method: 'save', args: { role: {}, expected: 1 } })).rejects.toThrow('revision conflict');
    await expect(ctx.typertGateway.invoke({ namespace: 'classmates', method: 'load', args: { override: true } })).rejects.toThrow();
    await expect(ctx.typertGateway.invoke({ namespace: 'classmates', method: 'batch', args: { changes: [], expected: 0 } })).resolves.toEqual({ batched: true, changes: [] });
    await expect(ctx.typertGateway.invoke({ namespace: 'classmates', method: 'batch', args: { changes: [], expected: 1 } })).rejects.toThrow('revision conflict');
    await expect(ctx.typertGateway.invoke({ namespace: 'classmates', method: 'batch', args: { changes: [], expected: 0, extra: true } })).rejects.toThrow();
    await expect(ctx.typertGateway.invoke({ namespace: 'classmates', method: 'team', args: { leadId: 'lead-1', extra: true } })).rejects.toThrow();
    await expect(ctx.typertGateway.invoke({ namespace: 'classmates', method: 'team', args: { leadId: 'lead-1' } })).rejects.toThrow();
    await expect(ctx.typertGateway.invoke({
      namespace: 'classmates', method: 'saveModelProfile',
      args: { profile: { id: 'coding-high', revision: 0, name: 'Deep', description: 'careful', enabled: true, model: { provider: 'test', id: 'one' } }, expected: 0 },
    })).resolves.toEqual({ profileSaved: true });
    await expect(ctx.typertGateway.invoke({
      namespace: 'classmates', method: 'batchModelProfiles',
      args: { changes: [], expected: 0 },
    })).resolves.toEqual({ profileBatched: true, changes: [] });
    await expect(ctx.typertGateway.invoke({
      namespace: 'classmates', method: 'batchModelProfiles',
      args: { changes: [], expected: 1 },
    })).rejects.toThrow('revision conflict');
    await expect(ctx.typertGateway.invoke({
      namespace: 'classmates', method: 'batchModelProfiles',
      args: { changes: [], expected: 0, extra: true },
    })).rejects.toThrow();
    await expect(ctx.typertGateway.invoke({
      namespace: 'classmates', method: 'deleteModelProfile',
      args: { id: 'coding-high', revision: 1, expected: 0, extra: true },
    })).rejects.toThrow();
  } finally { await ctx.fiber.dispose(); }
});
