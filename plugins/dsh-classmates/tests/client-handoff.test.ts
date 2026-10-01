import { describe, expect, it } from 'vitest';
import type { ClassmateDefinition, ClassmatesState, ModelChoice } from '../src/contracts.js';
import {
  createHandoffGate,
  HandoffBusyError,
  HandoffTimeoutError,
  isAbortError,
  runStartTask,
  STANDARD_PRESET_ID,
  waitForMainView,
  type HandoffHost,
  type SessionInputLike,
  type SessionOpenSnapshot,
} from '../src/ui/handoff.js';
import {
  buildTaskDraft,
  catalogConnectivityUnknown,
  enabledValidRoles,
  formatModelOption,
  formatRoleModelSummary,
  roleHealth,
} from '../src/ui/roles.js';

interface Harness extends HandoffHost {
  created: string[];
  selected: Array<{ sessionId: string; preset: string }>;
  opened: unknown[];
  drafts: Array<{ sessionId: string; text: string }>;
  startSessionCalls: number;
  notifyMainView(sessionId: string, open?: SessionOpenSnapshot): void;
  setOpenState(sessionId: string, open: SessionOpenSnapshot): void;
}

function role(patch: Partial<ClassmateDefinition> & Pick<ClassmateDefinition, 'id' | 'name'>): ClassmateDefinition {
  return {
    schemaVersion: 1,
    revision: 1,
    description: '负责检索',
    instructions: 'SECRET_INSTRUCTIONS do not copy',
    enabled: true,
    model: { provider: 'mock', id: 'specialist-a' },
    reasoningEffort: 'high',
    ...patch,
  };
}

function models(): ModelChoice[] {
  return [{
    provider: 'mock',
    providerName: '演示供应商',
    availability: 'unverified',
    id: 'specialist-a',
    name: 'Specialist A',
    efforts: [{ id: 'high', name: 'High' }],
  }];
}

function state(roles: ClassmateDefinition[]): ClassmatesState {
  return { roles, models: models(), settingsRevision: 1, writable: true };
}

async function flushUntil(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error('timed out waiting for handoff progress');
}

function createHost(options?: {
  workspace?: boolean;
  load?: () => Promise<ClassmatesState>;
}): Harness {
  const listListeners = new Set<() => void>();
  const retainListeners = new Map<string, Set<() => void>>();
  const sessionListeners = new Map<string, Set<() => void>>();
  const created: string[] = [];
  const selected: Array<{ sessionId: string; preset: string }> = [];
  const opened: unknown[] = [];
  const drafts: Array<{ sessionId: string; text: string }> = [];
  const byId: Record<string, {
    id: string;
    cwd?: string;
    parentId?: string;
    updatedAt: number;
    retainedBy: Record<string, number | undefined>;
  } | undefined> = {
    existing: {
      id: 'existing',
      cwd: '/tmp/project',
      updatedAt: 2,
      retainedBy: { mainView: 1 },
    },
    blankDraft: {
      id: 'blankDraft',
      cwd: '/tmp/project',
      updatedAt: 9,
      retainedBy: {},
    },
  };
  const bindings = new Map<string, { ctx: { sessionId: string } }>();
  const retained = new Map<string, Record<string, number | undefined>>([
    ['existing', { mainView: 1 }],
  ]);
  const openById = new Map<string, SessionOpenSnapshot>();
  let startSessionCalls = 0;

  const notify = (sessionId: string) => {
    for (const listener of listListeners) listener();
    for (const listener of retainListeners.get(sessionId) ?? []) listener();
    for (const listener of sessionListeners.get(sessionId) ?? []) listener();
  };

  const sessionFace = (sessionId: string) => ({
    getSnapshot: () => openById.get(sessionId) ?? { openState: 'cold' as const, openError: null },
    subscribe: (listener: () => void) => {
      const set = sessionListeners.get(sessionId) ?? new Set<() => void>();
      set.add(listener);
      sessionListeners.set(sessionId, set);
      return () => {
        set.delete(listener);
      };
    },
  });

  const host: Harness = {
    created,
    selected,
    opened,
    drafts,
    get startSessionCalls() {
      return startSessionCalls;
    },
    notifyMainView(sessionId: string, open: SessionOpenSnapshot = { openState: 'open', openError: null }) {
      retained.set(sessionId, { mainView: 1 });
      bindings.set(sessionId, { ctx: { sessionId } });
      openById.set(sessionId, { openState: open.openState ?? 'open', openError: open.openError ?? null });
      const row = byId[sessionId];
      if (row) row.retainedBy = { mainView: 1 };
      notify(sessionId);
    },
    setOpenState(sessionId: string, open: SessionOpenSnapshot) {
      openById.set(sessionId, open);
      for (const listener of sessionListeners.get(sessionId) ?? []) listener();
    },
    remote: {
      classmates: {
        load: async () => ({
          ok: true,
          value: options?.load ? await options.load() : state([role({ id: 'researcher', name: '研究员' })]),
        }),
      },
      agentPresets: {
        select: async (sessionId: string, preset: string) => {
          selected.push({ sessionId, preset });
          return { ok: true, value: preset };
        },
      },
    },
    sessions: {
      create: async () => {
        const id = `fresh-${created.length + 1}`;
        created.push(id);
        byId[id] = { id, cwd: '/tmp/project', updatedAt: Date.now(), retainedBy: {} };
        return id;
      },
      binding: (id: string) => {
        const row = bindings.get(id);
        if (!row) return undefined;
        return { ctx: row.ctx, session: sessionFace(id) };
      },
      retainInfo: (id: string) => ({
        getSnapshot: () => ({ retainedBy: retained.get(id) ?? {} }),
        subscribe: (listener: () => void) => {
          const set = retainListeners.get(id) ?? new Set<() => void>();
          set.add(listener);
          retainListeners.set(id, set);
          return () => {
            set.delete(listener);
          };
        },
      }),
      list: {
        getSnapshot: () => ({ byId }),
        subscribe: (listener: () => void) => {
          listListeners.add(listener);
          return () => {
            listListeners.delete(listener);
          };
        },
      },
    },
    workspaces: {
      list: {
        getSnapshot: () => ({
          items: options?.workspace === false
            ? []
            : [{ workspaceId: 'ws-1', sessionIds: ['existing', 'blankDraft'] }],
        }),
      },
    },
    uiWorkspace: {
      openSession: (target: unknown) => {
        opened.push(target);
      },
      startSession: () => {
        startSessionCalls += 1;
      },
    },
    conversation: {
      input: {
        for: (actx: unknown) => ({
          setDraft: (text: string) => {
            drafts.push({ sessionId: String((actx as { sessionId?: string }).sessionId ?? ''), text });
          },
          focus: () => {},
        }),
      },
    },
  };
  return host;
}

describe('task draft', () => {
  it('allows model and effort inheritance independently', () => {
    const catalog = models();
    const inheritBoth = role({ id: 'inherit-both', name: '继承全部', model: null, reasoningEffort: undefined });
    expect(roleHealth(inheritBoth, [])).toBe('enabled');
    expect(formatRoleModelSummary(inheritBoth, catalog)).toBe('模型：跟随当前聊天 · 思考强度：跟随当前聊天');

    const inheritModel = role({ id: 'inherit-model', name: '继承模型', model: null });
    expect(roleHealth(inheritModel, catalog)).toBe('enabled');
    expect(formatRoleModelSummary(inheritModel, catalog)).toBe('模型：跟随当前聊天 · 思考强度：High');
    expect(roleHealth(inheritModel, [])).toBe('invalid');

    const inheritEffort = role({ id: 'inherit-effort', name: '继承强度', reasoningEffort: undefined });
    expect(roleHealth(inheritEffort, catalog)).toBe('enabled');
    expect(formatRoleModelSummary(inheritEffort, catalog)).toBe('模型：演示供应商 · Specialist A · 思考强度：跟随当前聊天');
  });

  it('reads legacy nested effort and rejects unsupported explicit bindings', () => {
    const legacy = role({ id: 'legacy', name: '旧角色', reasoningEffort: undefined, model: { provider: 'mock', id: 'specialist-a', reasoningEffort: 'high' } });
    expect(roleHealth(legacy, models())).toBe('enabled');
    expect(formatRoleModelSummary(legacy, models())).toContain('思考强度：High');
    expect(roleHealth(role({ id: 'invalid', name: '无效', reasoningEffort: 'low' }), models())).toBe('invalid');
    expect(roleHealth(role({ id: 'disabled-inherit', name: '停用', enabled: false, model: null }), models())).toBe('disabled');
  });

  it('summarizes enabled valid roles in ordinary language without internal fields', () => {
    const roles = enabledValidRoles([
      role({ id: 'researcher', name: '研究员' }),
      role({ id: 'writer', name: '写作者', enabled: false, description: '成稿' }),
      role({ id: 'broken', name: '坏的', model: { provider: 'missing', id: 'nope' } }),
    ], models());
    expect(roles.map(item => item.name)).toEqual(['研究员']);
    const draft = buildTaskDraft(roles, models());
    expect(draft).toContain('研究员');
    expect(draft).toContain('负责检索');
    expect(draft).toContain('演示供应商');
    expect(draft).toContain('Specialist A');
    expect(draft).toMatch(/描述要派发的任务/);
    expect(draft).toContain('连接尚未验证');
    expect(draft).not.toContain('SECRET_INSTRUCTIONS');
    expect(draft).not.toContain('researcher');
    expect(draft).not.toContain('classmates_spawn');
    expect(draft).not.toContain('team_task');
    expect(draft).not.toContain('schemaVersion');
    expect(draft).not.toMatch(/https?:\/\//);
    expect(draft).not.toContain('api_key');
  });

  it('shows public provider names and treats catalog rows as unverified', () => {
    const [model] = models();
    expect(formatModelOption(model)).toBe('演示供应商 · Specialist A');
    expect(formatModelOption(model)).not.toContain('http');
    expect(catalogConnectivityUnknown(model)).toBe(true);
    expect(catalogConnectivityUnknown({ ...model, availability: undefined })).toBe(true);
  });
});

describe('session handoff', () => {
  it('opens a new standard session after the official main view is ready and seeds an editable draft', async () => {
    const host = createHost();
    const pending = runStartTask(host, new AbortController().signal);
    await flushUntil(() => host.opened.length === 1);
    expect(host.created).toHaveLength(1);
    expect(host.selected).toEqual([{ sessionId: host.created[0], preset: STANDARD_PRESET_ID }]);
    expect(host.opened).toEqual([host.created[0]]);
    expect(host.drafts).toHaveLength(0);
    host.notifyMainView(host.created[0]);
    await pending;
    expect(host.drafts).toEqual([{ sessionId: host.created[0], text: expect.stringContaining('研究员') }]);
    expect(host.created).not.toContain('blankDraft');
    expect(host.opened).not.toContain('blankDraft');
    expect(host.opened).not.toContain('existing');
  });

  it('does not create a session when no enabled valid role exists', async () => {
    const host = createHost({
      load: async () => state([role({ id: 'writer', name: '写作者', enabled: false })]),
    });
    await expect(runStartTask(host, new AbortController().signal)).rejects.toThrow(/启用/);
    expect(host.created).toHaveLength(0);
    expect(host.opened).toHaveLength(0);
    expect(host.selected).toHaveLength(0);
  });

  it('asks the host to pick a workspace instead of opening a workspace-less blank', async () => {
    const host = createHost({ workspace: false });
    const existing = host.sessions.list.getSnapshot().byId.existing;
    if (existing) {
      delete existing.cwd;
    }
    await expect(runStartTask(host, new AbortController().signal)).rejects.toThrow(/工作区/);
    expect(host.startSessionCalls).toBe(1);
    expect(host.created).toHaveLength(0);
  });

  it('aborts before navigation when cancelled while waiting for the main view', async () => {
    const host = createHost();
    const controller = new AbortController();
    const pending = waitForMainView(host, 'fresh-1', controller.signal);
    controller.abort();
    await expect(pending).rejects.toSatisfy(isAbortError);
  });

  it('rejects overlapping handoffs; cancel after openSession does not pretend the switch was undone', async () => {
    const gate = createHandoffGate();
    const host = createHost();
    const first = gate.run('task', (signal, commit) => runStartTask(host, signal, commit));
    await flushUntil(() => host.opened.length === 1);
    await expect(gate.run('task', (signal, commit) => runStartTask(host, signal, commit))).rejects.toBeInstanceOf(HandoffBusyError);
    expect(gate.snapshot.cancellable).toBe(false);
    gate.cancel();
    expect(gate.snapshot.busy).toBe(true);
    host.notifyMainView(host.created[0]);
    await first;
    expect(host.drafts).toEqual([{ sessionId: host.created[0], text: expect.stringContaining('研究员') }]);
  });

  it('still cancels before openSession while preset select is pending', async () => {
    const host = createHost();
    let finishSelect: (result: { ok: true; value: string }) => void = () => {};
    host.remote.agentPresets.select = () => new Promise(resolve => {
      finishSelect = resolve;
    });
    const gate = createHandoffGate();
    const first = gate.run('task', (signal, commit) => runStartTask(host, signal, commit));
    await flushUntil(() => host.created.length === 1);
    expect(host.opened).toHaveLength(0);
    expect(gate.snapshot.cancellable).toBe(true);
    gate.cancel();
    finishSelect({ ok: true, value: STANDARD_PRESET_ID });
    await expect(first).rejects.toSatisfy(isAbortError);
    expect(host.opened).toHaveLength(0);
    expect(host.drafts).toHaveLength(0);
  });
});

describe('main-view readiness', () => {
  it('does not treat a live binding as ready while openState is still loading', async () => {
    const host = createHost();
    let settled = false;
    const pending = waitForMainView(host, 'fresh-1', new AbortController().signal, 400).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    host.notifyMainView('fresh-1', { openState: 'loading' });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    host.setOpenState('fresh-1', { openState: 'open' });
    await pending;
    expect(settled).toBe(true);
  });

  it('rejects when the target session reports openState error', async () => {
    const host = createHost();
    host.notifyMainView('fresh-1', { openState: 'error', openError: { message: 'history refused' } });
    await expect(waitForMainView(host, 'fresh-1', new AbortController().signal, 200))
      .rejects.toThrow(/history refused/);
  });

  it('times out instead of covering forever when the target never becomes ready', async () => {
    const host = createHost();
    host.notifyMainView('fresh-1', { openState: 'loading' });
    await expect(waitForMainView(host, 'fresh-1', new AbortController().signal, 30))
      .rejects.toBeInstanceOf(HandoffTimeoutError);
  });

  it('still settles if openState becomes ready after a late host update', async () => {
    const host = createHost();
    const pending = waitForMainView(host, 'fresh-1', new AbortController().signal, 400);
    host.notifyMainView('fresh-1', { openState: 'cold' });
    await Promise.resolve();
    host.setOpenState('fresh-1', { openState: 'open' });
    await pending;
  });
});

describe('handoff draft delivery', () => {
  it('returns setDraft failure to the caller instead of reporting success', async () => {
    const host = createHost();
    host.conversation!.input.for = () => ({
      setDraft() {
        throw new Error('草稿写入被拒绝');
      },
    });
    const pending = runStartTask(host, new AbortController().signal);
    await flushUntil(() => host.opened.length === 1);
    host.notifyMainView(host.created[0]);
    await expect(pending).rejects.toThrow(/草稿写入被拒绝/);
  });

  it('writes drafts only through official input.for(binding.ctx) and ignores a decoy shell', async () => {
    const host = createHost();
    const seen: unknown[] = [];
    const official = host.conversation!.input.for;
    host.conversation!.input.for = (actx: unknown) => {
      seen.push(actx);
      return official(actx);
    };
    (host.conversation!.input as { shell?: (id: string) => SessionInputLike }).shell = () => ({
      setDraft() {
        throw new Error('shell must not be used');
      },
    });
    const pending = runStartTask(host, new AbortController().signal);
    await flushUntil(() => host.opened.length === 1);
    host.notifyMainView(host.created[0]);
    await pending;
    expect(seen).toEqual([{ sessionId: host.created[0] }]);
    expect(host.drafts).toHaveLength(1);
  });

  it('does not fall back to input.shell when input.for fails', async () => {
    const host = createHost();
    host.conversation!.input.for = () => {
      throw new Error('for unavailable');
    };
    (host.conversation!.input as { shell?: (id: string) => SessionInputLike }).shell = () => ({
      setDraft(text: string) {
        host.drafts.push({ sessionId: 'via-shell', text });
      },
    });
    const pending = runStartTask(host, new AbortController().signal);
    await flushUntil(() => host.opened.length === 1);
    host.notifyMainView(host.created[0]);
    await expect(pending).rejects.toThrow(/for unavailable/);
    expect(host.drafts).toHaveLength(0);
  });
});
