import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import SettingsForms from '@deepseek-ai/dsh-settings';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import * as Classmates from '../src/index.js';
import { createRuntime, role } from './helpers/harness.js';

it('reconciles an existing Lead after activation and removes tools on unload', async () => {
  const root = mkdtempSync(join(tmpdir(), 'classmates-activation-'));
  const runtime = await createRuntime({ bindingsRoot: join(root, 'bindings'), storageRoot: join(root, 'sessions'), install: false });
  const { ctx, lead } = runtime;
  const config = { roles: [role({ id: 'researcher', revision: 1, name: 'Researcher', description: 'Short', instructions: 'Work', model: { provider: 'mock', id: 'specialist-a' } })] };
  const entry = { id: 'classmates', options: { id: 'classmates', config }, fiber: undefined as Context['fiber'] | undefined };
  try {
    ctx.provide('profileContext', { dir: root, home: root, name: 'test' } as never);
    ctx.provide('loader', { await: async () => {} } as never);
    ctx.provide('configEditor', { configuration: () => entry.fiber ? [{ entry, inherited: config, override: config }] : [] } as never);
    await ctx.plugin(SettingsForms);
    await ctx.plugin(TypertRegistry);
    const handle = ctx.plugin({ ...Classmates, async apply(child: Context) {
      entry.fiber = child.fiber;
      expect(child.fiber.state).toBe(1);
      expect(ctx.settings.describe()).toHaveLength(0);
      await Classmates.apply(child);
      expect(lead.ctx.tools.get('classmates_list', lead)).toBeUndefined();
    } }, config);
    await handle;
    await vi.waitFor(() => expect(lead.ctx.tools.get('classmates_list', lead)).toBeDefined());
    expect(lead.ctx.tools.get('classmates_spawn', lead)).toBeDefined();
    await handle.dispose();
    expect(lead.ctx.tools.get('classmates_list', lead)).toBeUndefined();
    expect(ctx.agents.get(lead.id)).toBe(lead);
  } finally {
    await ctx.fiber.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

it('restores Creator configuration for an empty library and revokes handlers on unload and mode switches', async () => {
  const root = mkdtempSync(join(tmpdir(), 'classmates-creator-lifecycle-'));
  const runtime = await createRuntime({ bindingsRoot: join(root, 'bindings'), storageRoot: join(root, 'sessions'), install: false });
  const { ctx, lead } = runtime;
  const config = { roles: [] };
  const entry = { id: 'classmates', options: { id: 'classmates', config }, fiber: undefined as Context['fiber'] | undefined };
  let mode = 'cordis';
  try {
    ctx.provide('agentPresets', { composedPreset: () => mode } as never);
    ctx.provide('profileContext', { dir: root, home: root, name: 'test' } as never);
    ctx.provide('loader', { await: async () => {} } as never);
    ctx.provide('configEditor', { configuration: () => entry.fiber ? [{ entry, inherited: config, override: config }] : [] } as never);
    await ctx.plugin(SettingsForms);
    await ctx.plugin(TypertRegistry);
    const mount = () => ctx.plugin({ ...Classmates, async apply(child: Context) {
      entry.fiber = child.fiber;
      await Classmates.apply(child);
    } }, config);
    const first = mount();
    await first;
    await vi.waitFor(() => expect(lead.ctx.tools.get('classmates_read', lead)).toBeDefined());
    expect(lead.ctx.tools.get('classmates_models_batch', lead)).toBeDefined();
    expect(lead.ctx.tools.get('classmates_list', lead)).toBeUndefined();
    const captured = lead.ctx.tools.get('classmates_batch', lead)!;
    await first.dispose();
    expect(lead.ctx.tools.get('classmates_read', lead)).toBeUndefined();
    await expect(captured.execute({ changes: [], expected: 0 }, { agent: lead } as never)).rejects.toThrow(/创造模式/);
    const second = mount();
    await second;
    await vi.waitFor(() => expect(lead.ctx.tools.get('classmates_read', lead)).toBeDefined());
    expect(lead.ctx.tools.schemas(lead).filter(tool => tool.name === 'classmates_read')).toHaveLength(1);
    mode = 'standard';
    ctx.emit('agent-preset/selected', lead.id, mode);
    expect(lead.ctx.tools.get('classmates_read', lead)).toBeUndefined();
    mode = 'cordis';
    ctx.emit('agent-preset/selected', lead.id, mode);
    expect(lead.ctx.tools.schemas(lead).filter(tool => tool.name === 'classmates_batch')).toHaveLength(1);
    expect(lead.ctx.tools.schemas(lead).filter(tool => tool.name === 'classmates_models_batch')).toHaveLength(1);
    await second.dispose();
    expect(lead.ctx.tools.get('classmates_batch', lead)).toBeUndefined();
    expect(lead.ctx.tools.get('classmates_models_batch', lead)).toBeUndefined();
    expect(ctx.agents.get(lead.id)).toBe(lead);
  } finally {
    await ctx.fiber.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
