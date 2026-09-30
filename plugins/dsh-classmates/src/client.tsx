import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ClassmateDefinition, ClassmatesClient, ClassmatesState, ModelProfile, ModelRoute, TeamDetails } from './contracts.js';
import { classmatesRemote } from './rpc.js';
import { ClassmatesPage } from './ui/ClassmatesPage.js';
import { HandoffOverlayRoot } from './ui/HandoffOverlay.js';
import { createHandoffGate, runStartTask, type HandoffHost } from './ui/handoff.js';
import type { LocaleSource } from './ui/hooks.js';
import { createPageTranslator } from './ui/page-locales.js';
import { ClassmatesTeamAction } from './ui/TeamAction.js';
import { CLASSMATES_TEAM_NS, classmatesTeamEn, classmatesTeamZh } from './ui/team-locales.js';

type Result<T> = { ok: true; value: T } | { ok: false; error: { message: string } };
interface SessionSnapshotLike {
  openState?: 'cold' | 'loading' | 'open' | 'error';
  openError?: { message?: string } | null;
  subagent?: { address: { parentSessionId?: string } } | null;
}
interface SessionSummaryLike {
  id: string;
  cwd?: string;
  parentId?: string;
  updatedAt: number;
  retainedBy: Record<string, number | undefined>;
}
interface WorkspaceViewLike {
  workspaceId: string;
  sessionIds: readonly string[];
}
interface ClientContext {
  remote: {
    $mount(contribution: typeof classmatesRemote): Promise<() => Promise<void>>;
    classmates: {
      load(): Promise<Result<ClassmatesState>>;
      save(role: ClassmateDefinition, expected: number): Promise<Result<ClassmatesState>>;
      deleteRole(id: string, revision: number, expected: number): Promise<Result<ClassmatesState>>;
      saveModelProfile?(profile: ModelProfile, expected: number): Promise<Result<ClassmatesState>>;
      deleteModelProfile?(id: string, revision: number, expected: number): Promise<Result<ClassmatesState>>;
      setModelProtection?(model: ModelRoute, required: boolean, expected: number): Promise<Result<ClassmatesState>>;
      team(leadId: string): Promise<Result<TeamDetails>>;
    };
    agentPresets: {
      select(sessionId: string, preset: string): Promise<Result<string>>;
    };
  };
  slots: {
    inject(name: string, callback: () => () => void): () => void;
    register(
      options: {
        name: string;
        key?: string;
        id?: string;
        label?: string;
        order?: number;
        priority?: number;
        locale?: string;
        inject?: () => Record<string, unknown>;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      component: React.ComponentType<any>,
    ): () => void;
  };
  locale: LocaleSource & {
    register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void;
  };
  sessions: {
    create(opts?: { workspaceId?: string; cwd?: string }): Promise<string>;
    binding(id: string): {
      ctx: unknown;
      session: {
        getSnapshot(): SessionSnapshotLike;
        subscribe(listener: () => void): () => void;
      };
    } | undefined;
    retainInfo(id: string): {
      getSnapshot(): { retainedBy: Record<string, number | undefined> };
      subscribe(listener: () => void): () => void;
    };
    list: {
      getSnapshot(): { byId: Record<string, SessionSummaryLike | undefined> };
      subscribe(listener: () => void): () => void;
    };
  };
  workspaces: {
    list: { getSnapshot(): { items: readonly WorkspaceViewLike[] } };
  };
  conversation?: HandoffHost['conversation'];
  uiWorkspace: {
    openSession(target: unknown): void;
    startSession(workspaceId?: string): void;
  };
  effect(callback: () => (() => void | Promise<void>)): unknown;
  inject(dependencies: string[], callback: (ctx: ClientContext) => void): unknown;
}

async function unwrap<T>(result: Promise<Result<T>>): Promise<T> {
  const response = await result;
  if (!response.ok) throw new Error(response.error.message);
  return response.value;
}

function toHandoffHost(ctx: ClientContext): HandoffHost {
  return ctx;
}

function mountHandoffOverlay(gate: ReturnType<typeof createHandoffGate>, locale: LocaleSource): () => void {
  const node = document.createElement('div');
  node.dataset.classmatesHandoffHost = 'true';
  document.body.appendChild(node);
  const root: Root = createRoot(node);
  root.render(<HandoffOverlayRoot gate={gate} locale={locale} />);
  return () => {
    root.unmount();
    node.remove();
  };
}

export const name = 'classmates-ui';
export const inject = ['slots', 'remote', 'locale', 'sessions', 'uiWorkspace', 'conversation'];

async function install(ctx: ClientContext): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(classmatesRemote);
  ctx.effect(() => disposeRemote);
  ctx.effect(() => ctx.locale.register(CLASSMATES_TEAM_NS, { zh: classmatesTeamZh, en: classmatesTeamEn }));

  const gate = createHandoffGate();
  ctx.effect(() => {
    const unmount = mountHandoffOverlay(gate, ctx.locale);
    return () => {
      gate.cancel();
      unmount();
    };
  });

  // The implementation arrives only once the host provides presets,
  // workspaces and conversation; the page subscribes so "Start task" appears
  // and disappears with it instead of always rendering and then throwing.
  let startTaskImpl: (() => Promise<void>) | undefined;
  const startTaskListeners = new Set<() => void>();
  const setStartTaskImpl = (next: (() => Promise<void>) | undefined) => {
    startTaskImpl = next;
    for (const listener of startTaskListeners) listener();
  };
  const startTaskAvailability = {
    getSnapshot: () => startTaskImpl !== undefined,
    subscribe(listener: () => void) {
      startTaskListeners.add(listener);
      return () => { startTaskListeners.delete(listener); };
    },
  };
  ctx.inject(['remote.agentPresets', 'remote.classmates', 'workspaces', 'conversation'], scope => {
    const host = toHandoffHost(scope);
    setStartTaskImpl(() => gate.run('task', (signal, commit) => runStartTask(host, signal, commit)));
    scope.effect(() => () => {
      setStartTaskImpl(undefined);
      gate.cancel();
    });
  });

  ctx.inject(['remote.classmates'], child => {
    const fetchTeam = (leadId: string) => unwrap(child.remote.classmates.team(leadId));
    const client: ClassmatesClient = {
      load: () => unwrap(child.remote.classmates.load()),
      save: (role, expected) => unwrap(child.remote.classmates.save(role, expected)),
      remove: (id, revision, expected) => unwrap(child.remote.classmates.deleteRole(id, revision, expected)),
      ...(child.remote.classmates.saveModelProfile && child.remote.classmates.deleteModelProfile ? {
        saveModelProfile: (profile: ModelProfile, expected: number) =>
          unwrap(child.remote.classmates.saveModelProfile!(profile, expected)),
        removeModelProfile: (id: string, revision: number, expected: number) =>
          unwrap(child.remote.classmates.deleteModelProfile!(id, revision, expected)),
      } : {}),
      ...(child.remote.classmates.setModelProtection ? {
        setModelProtection: (model: ModelRoute, required: boolean, expected: number) =>
          unwrap(child.remote.classmates.setModelProtection!(model, required, expected)),
      } : {}),
      team: fetchTeam,
      startTask: () => {
        if (!startTaskImpl) {
          throw new Error(createPageTranslator(ctx.locale.getSnapshot().active)('startTask.unavailable'));
        }
        return startTaskImpl();
      },
      startTaskAvailability,
    };

    const openTeammate = (sessionId: string, childSessionId: string) => {
      const parentSessionId = ctx.sessions.binding(sessionId)?.session.getSnapshot().subagent?.address.parentSessionId
        ?? sessionId;
      if ((ctx.sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) === 0) return;
      if (childSessionId === parentSessionId) {
        ctx.uiWorkspace.openSession(parentSessionId);
        return;
      }
      ctx.uiWorkspace.openSession({ parentSessionId, childSessionId, mode: 'continuable' });
    };

    child.effect(() => child.slots.inject('plugins.bundle.config', () => child.slots.register(
      { name: 'plugins.bundle.config', key: '@klarkxy/dsh-classmates' },
      () => <ClassmatesPage client={client} locale={ctx.locale} />,
    )));

    child.effect(() => child.slots.inject('conversation.session.header.actions', () => child.slots.register(
      {
        name: 'conversation.session.header.actions',
        id: 'agent-team',
        order: -20,
        priority: -10,
        locale: CLASSMATES_TEAM_NS,
        inject: () => ({ openTeammate, fetchTeam }),
      },
      ClassmatesTeamAction,
    )));
  });
}

export async function apply(ctx: ClientContext): Promise<void> {
  try { await install(ctx); } catch (error) { console.error('Classmates startup failed', error); throw error; }
}
