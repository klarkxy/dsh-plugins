import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUserMessage, ReasoningEffortId, type LlmAdapter } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { PROVIDER } from '../src/contracts.js';
import { BindingStore } from '../src/bindings.js';
import { installNative } from '../src/native.js';
import {
  PROFILE_ID,
  SIGNAL,
  createRuntime,
  firstRequest,
  requestText,
  role,
  spawnClassmate,
  text,
  type Runtime,
} from './helpers/harness.js';

const contexts: Runtime[] = [];
const roots: string[] = [];

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

async function boot(options: Parameters<typeof createRuntime>[0] = {
  bindingsRoot: tmp('dsh-classmates-bindings-'),
}): Promise<Runtime> {
  const runtime = await createRuntime({
    bindingsRoot: options.bindingsRoot,
    ...options.storageRoot === undefined ? {} : { storageRoot: options.storageRoot },
    ...options.resumeLead === undefined ? {} : { resumeLead: options.resumeLead },
    ...options.install === undefined ? {} : { install: options.install },
  });
  contexts.push(runtime);
  if (!roots.includes(runtime.storageRoot)) roots.push(runtime.storageRoot);
  if (!roots.includes(runtime.bindingsRoot)) roots.push(runtime.bindingsRoot);
  return runtime;
}

afterEach(async () => {
  for (const runtime of contexts.splice(0).reverse()) {
    await runtime.ctx.fiber.dispose();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function researcher(instructions: string) {
  return role({
    id: 'researcher',
    revision: 1,
    name: 'Researcher',
    description: 'research',
    instructions,
    model: { provider: 'mock', id: 'specialist-a' },
  });
}

function writer(instructions: string) {
  return role({
    id: 'writer',
    revision: 1,
    name: 'Writer',
    description: 'write',
    instructions,
    model: { provider: 'mock', id: 'specialist-b', reasoningEffort: 'low' },
  });
}

function bindingFile(storeRoot: string): string {
  const files = readdirSync(storeRoot).filter(name => name.endsWith('.json'));
  if (files.length !== 1) throw new Error(`expected one binding file, found ${files.join(',')}`);
  const name = files[0];
  if (name === undefined) throw new Error('expected one binding file');
  return join(storeRoot, name);
}

async function waitRequest(runtime: Runtime, model: string): Promise<void> {
  await vi.waitFor(() => {
    expect(runtime.adapter.requests.some(request => request.model === model)).toBe(true);
  }, { timeout: 15_000 });
}

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

describe('BindingStore', () => {
  it('atomically persists, rejects inconsistent overwrite, and claims one child id', async () => {
    const store = new BindingStore(tmp('dsh-classmates-store-'), PROFILE_ID);
    const definition = researcher('Keep {{not_a_variable}} literal');
    const first = await store.prepare('lead-1', 'alpha', definition, 'find sources');
    expect(first.schemaVersion).toBe(1);
    expect(first.childId).toBeUndefined();
    expect(first.role.instructions).toBe('Keep {{not_a_variable}} literal');
    definition.instructions = 'mutated template';
    expect(first.role.instructions).toBe('Keep {{not_a_variable}} literal');

    const again = await store.prepare('lead-1', 'alpha', researcher('Keep {{not_a_variable}} literal'), 'find sources');
    expect(again.checksum).toBe(first.checksum);

    await expect(store.prepare('lead-1', 'alpha', researcher('other'), 'find sources'))
      .rejects.toThrow(/conflict/);
    await expect(store.prepare('lead-1', 'alpha', researcher('Keep {{not_a_variable}} literal'), 'other task'))
      .rejects.toThrow(/conflict/);

    const claimed = await store.claim('lead-1', 'alpha', SessionId('child-a'));
    expect(claimed.childId).toBe('child-a');
    await expect(store.claim('lead-1', 'alpha', SessionId('child-b'))).rejects.toThrow(/already claimed/);
    expect((await store.claim('lead-1', 'alpha', SessionId('child-a'))).childId).toBe('child-a');
    expect((await store.read('lead-1', 'missing'))).toBeUndefined();
  });

  it('throws on corrupt or checksum-mismatched files', async () => {
    const corruptRoot = tmp('dsh-classmates-corrupt-');
    const corruptStore = new BindingStore(corruptRoot, PROFILE_ID);
    await corruptStore.prepare('lead-1', 'alpha', researcher('ok'), 'task');
    writeFileSync(bindingFile(corruptRoot), '{not-json');
    await expect(corruptStore.read('lead-1', 'alpha')).rejects.toThrow(/corrupt binding/);

    const mismatchRoot = tmp('dsh-classmates-checksum-');
    const mismatchStore = new BindingStore(mismatchRoot, PROFILE_ID);
    await mismatchStore.prepare('lead-2', 'beta', researcher('ok'), 'task');
    const parsed = JSON.parse(readFileSync(bindingFile(mismatchRoot), 'utf8')) as {
      role: { instructions: string };
    };
    parsed.role.instructions = 'tampered';
    writeFileSync(bindingFile(mismatchRoot), JSON.stringify(parsed));
    await expect(mismatchStore.read('lead-2', 'beta')).rejects.toThrow(/checksum/);
  });
});

describe('official runtime P0', () => {
  it.each(['unload', 'creation'] as const)('cancels a signal-aware model lookup on %s without a claim or new hooks', async cancellation => {
    const runtime = await boot({ bindingsRoot: tmp('classmates-model-cancel-'), install: false });
    const { ctx, lead, store, adapter } = runtime;
    await store.prepare(lead.id, 'alpha', researcher('cancel'), 'task');
    const dispose = installNative(ctx, store);
    const creation = new AbortController();
    const reached = barrier();
    let lookupSignal: AbortSignal | undefined;
    const delayed = vi.spyOn(adapter as LlmAdapter, 'resolveModel').mockImplementation((_provider, _model, signal) => {
      lookupSignal = signal;
      reached.release();
      if (signal === undefined) return Promise.reject(new Error('model lookup received no signal'));
      return new Promise<never>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => { reject(signal.reason); }, { once: true });
      });
    });
    const claim = vi.spyOn(store, 'claim');
    const rejected = expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'alpha', description: 'alpha classmate', prompt: text('task'),
      context: 'fresh', provider: PROVIDER, signal: creation.signal,
    })).rejects.toThrow(cancellation === 'unload' ? /native installation was disposed/ : /creation cancelled/);
    await reached.promise;
    const registration = vi.spyOn(ctx.events, 'register');
    try {
      expect(lookupSignal).toBeDefined();
      expect(lookupSignal?.aborted).toBe(false);
      if (cancellation === 'unload') await dispose();
      else creation.abort(new Error('creation cancelled'));
      await rejected;
      expect(lookupSignal?.aborted).toBe(true);
      expect(claim).not.toHaveBeenCalled();
      expect(registration).not.toHaveBeenCalled();
      expect((await store.read(lead.id, 'alpha'))?.childId).toBeUndefined();
      expect(adapter.requests).toEqual([]);
    } finally {
      creation.abort();
      await dispose();
      registration.mockRestore();
      delayed.mockRestore();
      claim.mockRestore();
    }
  });

  it.each(['read', 'model'] as const)('rejects a pending %s after native unload without claiming or installing hooks', async stage => {
    const runtime = await boot({ bindingsRoot: tmp('classmates-unload-'), install: false });
    const { ctx, lead, store } = runtime;
    await store.prepare(lead.id, 'alpha', researcher('unload'), 'task');
    const dispose = installNative(ctx, store);
    const gate = barrier();
    const reached = barrier();
    const read = store.read.bind(store);
    const resolveModel = ctx.llm.resolveModelInfo.bind(ctx.llm);
    const delayed = stage === 'read'
      ? vi.spyOn(store, 'read').mockImplementation(async (...args) => {
        reached.release();
        await gate.promise;
        return read(...args);
      })
      : vi.spyOn(ctx.llm, 'resolveModelInfo').mockImplementation(async (...args) => {
        reached.release();
        await gate.promise;
        return resolveModel(...args);
      });
    const claim = vi.spyOn(store, 'claim');
    const rejected = expect(spawnClassmate(ctx, lead, 'alpha', 'task')).rejects.toThrow(/disposed/);
    await reached.promise;
    const registration = vi.spyOn(ctx.events, 'register');
    try {
      let disposed = false;
      const disposal = dispose().then(() => { disposed = true; });
      await Promise.resolve();
      expect(disposed).toBe(false);
      gate.release();
      await rejected;
      await disposal;
      await dispose();
      expect(claim).not.toHaveBeenCalled();
      expect(registration).not.toHaveBeenCalled();
      expect((await read(lead.id, 'alpha'))?.childId).toBeUndefined();
      expect(runtime.adapter.requests).toEqual([]);
    } finally {
      gate.release();
      registration.mockRestore();
      delayed.mockRestore();
      claim.mockRestore();
      await dispose();
    }
  });

  it('drains an admitted claim on unload without installing hooks or running the child', async () => {
    const runtime = await boot({ bindingsRoot: tmp('classmates-claim-unload-'), install: false });
    const { ctx, lead, store } = runtime;
    await store.prepare(lead.id, 'alpha', researcher('unload'), 'task');
    const dispose = installNative(ctx, store);
    const gate = barrier();
    const reached = barrier();
    const originalClaim = store.claim.bind(store);
    const claim = vi.spyOn(store, 'claim').mockImplementation(async (...args) => {
      reached.release();
      await gate.promise;
      return originalClaim(...args);
    });
    const rejected = expect(spawnClassmate(ctx, lead, 'alpha', 'task')).rejects.toThrow(/disposed/);
    await reached.promise;
    const registration = vi.spyOn(ctx.events, 'register');
    try {
      let disposed = false;
      const disposal = dispose().then(() => { disposed = true; });
      await Promise.resolve();
      expect(disposed).toBe(false);
      gate.release();
      await rejected;
      await disposal;
      expect(claim).toHaveBeenCalledTimes(1);
      expect((await store.read(lead.id, 'alpha'))?.childId).toBe(claim.mock.calls[0]?.[2]);
      expect(registration).not.toHaveBeenCalled();
      expect(runtime.adapter.requests).toEqual([]);
    } finally {
      gate.release();
      registration.mockRestore();
      claim.mockRestore();
      await dispose();
    }
  });

  it('rechecks Team identity after delayed model lookup before claiming', async () => {
    const runtime = await boot();
    const { ctx, lead, store } = runtime;
    await store.prepare(lead.id, 'alpha', researcher('identity'), 'task');
    const gate = barrier();
    const reached = barrier();
    const resolveModel = ctx.llm.resolveModelInfo.bind(ctx.llm);
    const delayed = vi.spyOn(ctx.llm, 'resolveModelInfo').mockImplementation(async (...args) => {
      reached.release();
      await gate.promise;
      return resolveModel(...args);
    });
    const claim = vi.spyOn(store, 'claim');
    const rejected = expect(spawnClassmate(ctx, lead, 'alpha', 'task')).rejects.toThrow(/not a Team teammate/);
    await reached.promise;
    const membership = vi.spyOn(ctx.agentTeams, 'tryMembership').mockReturnValue(undefined);
    try {
      gate.release();
      await rejected;
      expect(claim).not.toHaveBeenCalled();
      expect((await store.read(lead.id, 'alpha'))?.childId).toBeUndefined();
      expect(runtime.adapter.requests).toEqual([]);
    } finally {
      gate.release();
      membership.mockRestore();
      delayed.mockRestore();
      claim.mockRestore();
    }
  });

  it('captures two concurrent first final requests, clears inherited effort, and keeps the lead unchanged', async () => {
    const runtime = await boot();
    const { ctx, lead, adapter, store } = runtime;
    const alphaRole = researcher('Alpha must keep {{not_a_variable}} literal.');
    const betaRole = writer('Beta writer body.');
    await store.prepare(lead.id, 'alpha', alphaRole, 'alpha task');
    await store.prepare(lead.id, 'beta', betaRole, 'beta task');

    const [alpha, beta] = await Promise.all([
      spawnClassmate(ctx, lead, 'alpha', 'alpha task'),
      spawnClassmate(ctx, lead, 'beta', 'beta task'),
    ]);
    expect(alpha.member.name).toBe('alpha');
    expect(beta.member.name).toBe('beta');
    await waitRequest(runtime, 'specialist-a');
    await waitRequest(runtime, 'specialist-b');

    const alphaReq = firstRequest(adapter, 'specialist-a');
    const betaReq = firstRequest(adapter, 'specialist-b');
    expect(alphaReq.provider).toBe('mock');
    expect(betaReq.provider).toBe('mock');
    expect(alphaReq.reasoningEffort).toBeUndefined();
    expect(betaReq.reasoningEffort).toBe('low');
    expect(requestText(alphaReq)).toContain('Alpha must keep {{not_a_variable}} literal.');
    expect(requestText(alphaReq)).not.toContain('Beta writer body.');
    expect(requestText(betaReq)).toContain('Beta writer body.');
    expect(requestText(betaReq)).not.toContain('Alpha must keep {{not_a_variable}} literal.');

    lead.followup(createUserMessage({
      content: text('lead ping'),
      source: { kind: 'user' },
    }));
    await vi.waitFor(() => {
      expect(adapter.requests.some(request => (
        request.model === 'mock' && requestText(request).includes('lead ping')
      ))).toBe(true);
    }, { timeout: 15_000 });
    await lead.whenIdle();
    const leadReq = adapter.requests.find(request => (
      request.model === 'mock' && requestText(request).includes('lead ping')
    ));
    if (leadReq === undefined) throw new Error('missing lead ping request');
    expect(leadReq.provider).toBe('mock');
    expect(leadReq.reasoningEffort).toBe(ReasoningEffortId('high'));
    expect(requestText(leadReq)).not.toContain('Alpha must keep {{not_a_variable}} literal.');
    expect(lead.options.provider).toBe('mock');
    expect(lead.options.model).toBe('mock');
    expect(lead.options.reasoningEffort).toBe(ReasoningEffortId('high'));
  });

  it('does not rewrite an ordinary spawn teammate', async () => {
    const runtime = await boot();
    const { ctx, lead, adapter } = runtime;
    const started = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'ordinary',
      description: 'ordinary teammate',
      prompt: text('ordinary task'),
      context: 'fresh',
      provider: 'spawn',
      signal: SIGNAL,
    });
    await vi.waitFor(() => {
      expect(adapter.requests.some(request => request.model === 'mock')).toBe(true);
    }, { timeout: 15_000 });
    expect(started.member.name).toBe('ordinary');
    const ordinary = adapter.requests.find(request => request.model === 'mock');
    if (ordinary === undefined) throw new Error('missing ordinary spawn request');
    expect(ordinary.provider).toBe('mock');
    expect(ordinary.reasoningEffort).toBe(ReasoningEffortId('high'));
    expect(requestText(ordinary)).not.toContain('classmates:instructions');
  });

  it('freezes retry snapshots so later template edits cannot change the instance', async () => {
    const runtime = await boot();
    const { ctx, lead, store, adapter } = runtime;
    const snapshot = researcher('frozen {{keep}} instructions');
    await store.prepare(lead.id, 'alpha', snapshot, 'frozen task');
    await store.prepare(lead.id, 'alpha', researcher('frozen {{keep}} instructions'), 'frozen task');
    snapshot.instructions = 'edited template after prepare';
    snapshot.revision = 2;
    snapshot.model = { provider: 'mock', id: 'specialist-b', reasoningEffort: 'low' };
    await expect(store.prepare(lead.id, 'alpha', snapshot, 'frozen task')).rejects.toThrow(/conflict/);

    let retried = false;
    ctx.on('agent/request-error', async (_payload, next) => {
      if (retried) return next();
      retried = true;
      return { kind: 'retry' };
    });
    adapter.failRemaining = 1;

    const started = await spawnClassmate(ctx, lead, 'alpha', 'frozen task');
    expect(started.member.name).toBe('alpha');
    await vi.waitFor(() => {
      expect(adapter.requests.filter(request => request.model === 'specialist-a')).toHaveLength(2);
    }, { timeout: 15_000 });
    expect(retried).toBe(true);
    const captured = adapter.requests.filter(request => request.model === 'specialist-a');
    for (const request of captured) {
      expect(request.provider).toBe('mock');
      expect(request.reasoningEffort).toBeUndefined();
      expect(requestText(request)).toContain('frozen {{keep}} instructions');
      expect(requestText(request)).not.toContain('edited template after prepare');
    }
  });

  it('restores a frozen snapshot on a new Context from JSONL (not same-Context child dispose)', async () => {
    const bindingsRoot = tmp('dsh-classmates-cold-bind-');
    const first = await boot({ bindingsRoot });
    await first.store.prepare(
      first.lead.id,
      'alpha',
      researcher('cold snapshot {{keep}}'),
      'cold task',
    );
    const started = await spawnClassmate(first.ctx, first.lead, 'alpha', 'cold task');
    expect(started.member.name).toBe('alpha');
    await waitRequest(first, 'specialist-a');
    expect(requestText(firstRequest(first.adapter, 'specialist-a'))).toContain('cold snapshot {{keep}}');
    const childId = started.member.id;
    first.ctx.agentTeams.interrupt(first.lead, 'alpha');
    await vi.waitFor(() => {
      expect(first.ctx.agents.get(childId)).toBeUndefined();
    }, { timeout: 10_000 });
    const storageRoot = first.storageRoot;
    await first.ctx.fiber.dispose();
    contexts.splice(contexts.indexOf(first), 1);

    const second = await boot({ bindingsRoot, storageRoot, resumeLead: true });
    const ping = await second.ctx.agentTeams.sendMessage(second.lead, {
      target: 'alpha',
      content: text('resume ping'),
      signal: SIGNAL,
    });
    expect(['accepted', 'queued']).toContain(ping.status);
    await vi.waitFor(() => {
      expect(second.adapter.requests.some(request => (
        request.model === 'specialist-a' && requestText(request).includes('resume ping')
      ))).toBe(true);
    }, { timeout: 15_000 });
    const resumed = second.adapter.requests.find(request => (
      request.model === 'specialist-a' && requestText(request).includes('resume ping')
    ));
    if (resumed === undefined) throw new Error('missing cold resume request');
    expect(resumed.provider).toBe('mock');
    expect(resumed.reasoningEffort).toBeUndefined();
    expect(requestText(resumed)).toContain('cold snapshot {{keep}}');
    expect(requestText(resumed)).not.toContain('edited after spawn');
  }, 30_000);

  it('fail-closes on missing, corrupt, and catalog-invalid bindings with no parent-model fallback', async () => {
    const missing = await boot();
    await expect(spawnClassmate(missing.ctx, missing.lead, 'ghost', 'no binding'))
      .rejects.toThrow(/missing binding/);
    expect(missing.adapter.requests.filter(request => request.model === 'mock')).toEqual([]);

    const corrupt = await boot();
    await corrupt.store.prepare(corrupt.lead.id, 'broken', researcher('ok'), 'task');
    writeFileSync(bindingFile(corrupt.bindingsRoot), '{broken');
    await expect(spawnClassmate(corrupt.ctx, corrupt.lead, 'broken', 'task'))
      .rejects.toThrow(/corrupt binding|missing binding/);
    expect(corrupt.adapter.requests).toEqual([]);

    const unknown = await boot();
    await unknown.store.prepare(unknown.lead.id, 'lost', role({
      id: 'researcher',
      revision: 1,
      name: 'Researcher',
      description: 'research',
      instructions: 'x',
      model: { provider: 'mock', id: 'not-in-catalog' },
    }), 'task');
    await expect(spawnClassmate(unknown.ctx, unknown.lead, 'lost', 'task'))
      .rejects.toThrow(/unknown model|not valid/);
    expect(unknown.adapter.requests).toEqual([]);

    const effort = await boot();
    await effort.store.prepare(effort.lead.id, 'effort', role({
      id: 'researcher',
      revision: 1,
      name: 'Researcher',
      description: 'research',
      instructions: 'x',
      model: { provider: 'mock', id: 'specialist-a', reasoningEffort: 'medium' },
    }), 'task');
    await expect(spawnClassmate(effort.ctx, effort.lead, 'effort', 'task'))
      .rejects.toThrow(/reasoning effort/);
    expect(effort.adapter.requests).toEqual([]);
  });

  it('rejects one-shot start and completes official message and task round-trips', async () => {
    const runtime = await boot();
    const { ctx, lead, store } = runtime;
    await expect(ctx.subagents.start(PROVIDER, {
      prompt: text('one-shot'),
      parent: lead,
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });

    await store.prepare(lead.id, 'alpha', researcher('task member'), 'task');
    runtime.adapter.hold = true;
    const started = await spawnClassmate(ctx, lead, 'alpha', 'task');
    await waitRequest(runtime, 'specialist-a');
    const child = ctx.agents.get(started.member.id);
    if (child === undefined) throw new Error('expected live classmate after first request');

    const created = await ctx.agentTeams.createTask(lead, {
      subject: 'shared-work',
      description: 'official board item',
    });
    expect(created.subject).toBe('shared-work');
    const claimed = await ctx.agentTeams.updateTask(child, {
      taskId: created.id,
      expectedRevision: created.revision,
      action: 'claim',
    });
    expect(claimed.status).toBe('in_progress');
    expect(ctx.agentTeams.getTask(lead, created.id).ownerName).toBe('alpha');

    const message = await ctx.agentTeams.sendMessage(lead, {
      target: 'alpha',
      content: text('direct ping'),
      signal: SIGNAL,
    });
    expect(['accepted', 'queued']).toContain(message.status);
    runtime.adapter.release();
    await vi.waitFor(() => {
      expect(runtime.adapter.requests.some(request => (
        request.model === 'specialist-a' && requestText(request).includes('direct ping')
      ))).toBe(true);
    }, { timeout: 15_000 });
    expect(ctx.agentTeams.listMembers(lead).map(member => member.name)).toEqual(
      expect.arrayContaining(['lead', 'alpha']),
    );
  });

  it('refuses unsafe hot install onto an already-loaded classmates-spawn agent', async () => {
    const runtime = await boot();
    await runtime.store.prepare(runtime.lead.id, 'alpha', researcher('hot'), 'task');
    runtime.adapter.hold = true;
    const started = await spawnClassmate(runtime.ctx, runtime.lead, 'alpha', 'task');
    await waitRequest(runtime, 'specialist-a');
    expect(runtime.ctx.agents.get(started.member.id)).toBeDefined();
    expect(() => installNative(runtime.ctx, runtime.store)).toThrow(/hot install/);
    runtime.adapter.release();
  });
});
