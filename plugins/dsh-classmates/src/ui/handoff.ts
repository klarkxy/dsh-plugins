import type { ClassmatesState } from '../contracts.js';
import { buildTaskDraft, enabledValidRoles } from './roles.js';

export const STANDARD_PRESET_ID = 'standard';

type Result<T> = { ok: true; value: T } | { ok: false; error: { message: string } };

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

export interface SessionInputLike {
  setDraft(text: string): void;
  focus?(): void;
}

export interface SessionOpenSnapshot {
  openState?: 'cold' | 'loading' | 'open' | 'error';
  openError?: { message?: string } | null;
}

export interface SessionBindingLike {
  ctx: unknown;
  session?: {
    getSnapshot(): SessionOpenSnapshot;
    subscribe(listener: () => void): () => void;
  };
}

export interface HandoffHost {
  remote: {
    classmates: {
      load(): Promise<Result<ClassmatesState>>;
    };
    agentPresets: {
      select(sessionId: string, preset: string): Promise<Result<string>>;
    };
  };
  sessions: {
    create(opts?: { workspaceId?: string; cwd?: string }): Promise<string>;
    binding(id: string): SessionBindingLike | undefined;
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
  uiWorkspace: {
    openSession(target: unknown): void;
    startSession(workspaceId?: string): void;
  };
  conversation?: {
    input: {
      for(actx: unknown): SessionInputLike;
    };
  };
}

export class HandoffBusyError extends Error {
  override readonly name = 'HandoffBusyError';
  constructor() {
    super('正在切换会话，请稍候。');
  }
}

export class HandoffTimeoutError extends Error {
  override readonly name = 'HandoffTimeoutError';
  constructor() {
    super('会话切换超时。请在会话列表中确认目标会话是否已打开，再重试。');
  }
}

/** Bound wait so a stuck overlay cannot last forever. */
export const HANDOFF_READY_TIMEOUT_MS = 20_000;

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function isHandoffBusy(error: unknown): boolean {
  return error instanceof HandoffBusyError || (error instanceof Error && error.name === 'HandoffBusyError');
}

function abortError(): Error {
  const error = new Error('已取消');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

async function unwrap<T>(result: Promise<Result<T>>): Promise<T> {
  const response = await result;
  if (!response.ok) throw new Error(response.error.message);
  return response.value;
}

/** Session shown in the main view, else the most recently updated one. */
export function anchorSession(host: HandoffHost): SessionSummaryLike | undefined {
  const byId = host.sessions.list.getSnapshot().byId;
  const rows = Object.values(byId).filter((row): row is SessionSummaryLike => row !== undefined);
  const main = rows.find(row => (row.retainedBy.mainView ?? 0) > 0);
  if (main) return main;
  return rows.sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

/**
 * Create a fresh Session in the active workspace — never reusing a
 * pre-existing blank that may hold the user's unsent draft, and never a
 * workspace-less blank that cannot send.
 */
export async function createWorkspaceSession(host: HandoffHost): Promise<string> {
  const anchor = anchorSession(host);
  const candidates = [anchor?.id, anchor?.parentId].filter((id): id is string => id !== undefined);
  const workspaces = host.workspaces.list.getSnapshot().items;
  const workspace = workspaces.find(row => candidates.some(id => row.sessionIds.includes(id)));
  if (workspace) return host.sessions.create({ workspaceId: workspace.workspaceId });
  if (anchor?.cwd) return host.sessions.create({ cwd: anchor.cwd });
  host.uiWorkspace.startSession();
  throw new Error('未找到可用工作区：请先在左侧选择或创建一个工作区，然后重试。');
}

export function waitUntil(
  ready: () => boolean,
  subscribe: (check: () => void) => () => void,
  signal: AbortSignal,
  timeoutMs?: number,
): Promise<void> {
  throwIfAborted(signal);
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let dispose = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (next: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      dispose();
      next();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const check = () => {
      if (signal.aborted) {
        onAbort();
        return;
      }
      if (ready()) finish(() => resolve());
    };
    dispose = subscribe(check);
    signal.addEventListener('abort', onAbort);
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => finish(() => reject(new HandoffTimeoutError())), timeoutMs);
    }
    check();
  });
}

function mainViewPhase(host: HandoffHost, sessionId: string): 'pending' | 'open' | 'error' {
  const retained = (host.sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) > 0;
  const binding = host.sessions.binding(sessionId);
  if (!retained || binding === undefined) return 'pending';
  const openState = binding.session?.getSnapshot().openState;
  if (openState === 'open') return 'open';
  if (openState === 'error') return 'error';
  return 'pending';
}

function subscribeMainView(host: HandoffHost, sessionId: string, check: () => void): () => void {
  let dropSession = () => {};
  const watchSession = () => {
    dropSession();
    const session = host.sessions.binding(sessionId)?.session;
    dropSession = session === undefined ? () => {} : session.subscribe(check);
  };
  const onChange = () => {
    watchSession();
    check();
  };
  const dropList = host.sessions.list.subscribe(onChange);
  const dropInfo = host.sessions.retainInfo(sessionId).subscribe(onChange);
  watchSession();
  return () => {
    dropList();
    dropInfo();
    dropSession();
  };
}

function openFailureMessage(host: HandoffHost, sessionId: string): string {
  const message = host.sessions.binding(sessionId)?.session?.getSnapshot().openError?.message?.trim();
  return message ? `目标会话打开失败：${message}` : '目标会话打开失败。';
}

/**
 * Official main-view retention, live binding, and session openState.
 * `openSession` is not cancellable; callers that already submitted navigation
 * should not abort this wait as if the switch were undone.
 */
export async function waitForMainView(
  host: HandoffHost,
  sessionId: string,
  signal: AbortSignal,
  timeoutMs = HANDOFF_READY_TIMEOUT_MS,
): Promise<void> {
  await waitUntil(
    () => mainViewPhase(host, sessionId) !== 'pending',
    check => subscribeMainView(host, sessionId, check),
    signal,
    timeoutMs,
  );
  if (mainViewPhase(host, sessionId) === 'error') {
    throw new Error(openFailureMessage(host, sessionId));
  }
}

function sessionInputOf(host: HandoffHost, sessionId: string): SessionInputLike {
  const input = host.conversation?.input;
  if (!input) {
    throw new Error('会话输入不可用，无法写入任务草稿。请在新会话输入框自行填写任务后再发送。');
  }
  const binding = host.sessions.binding(sessionId);
  if (!binding) {
    throw new Error('目标会话尚未就绪，无法写入任务草稿。请确认已进入新会话后再填写任务。');
  }
  return input.for(binding.ctx);
}

export function setSessionDraft(host: HandoffHost, sessionId: string, text: string): void {
  const sessionInput = sessionInputOf(host, sessionId);
  sessionInput.setDraft(text);
  sessionInput.focus?.();
}

async function openFreshSession(
  host: HandoffHost,
  preset: string,
  signal: AbortSignal,
  commit?: () => void,
): Promise<string> {
  throwIfAborted(signal);
  const sessionId = await createWorkspaceSession(host);
  throwIfAborted(signal);
  const selected = await host.remote.agentPresets.select(sessionId, preset);
  if (!selected.ok) throw new Error(selected.error.message);
  throwIfAborted(signal);
  commit?.();
  host.uiWorkspace.openSession(sessionId);
  await waitForMainView(host, sessionId, signal);
  return sessionId;
}

export async function runStartTask(
  host: HandoffHost,
  signal: AbortSignal,
  commit?: () => void,
): Promise<void> {
  throwIfAborted(signal);
  const state = await unwrap(host.remote.classmates.load());
  throwIfAborted(signal);
  const roles = enabledValidRoles(state.roles, state.models, state.modelProfiles ?? []);
  if (roles.length === 0) {
    throw new Error('请先在角色列表启用至少一个可用角色。模型可以跟随当前聊天。');
  }
  const sessionId = await openFreshSession(host, STANDARD_PRESET_ID, signal, commit);
  setSessionDraft(host, sessionId, buildTaskDraft(roles, state.models, state.modelProfiles ?? []));
}

export type HandoffPhase = 'idle' | 'task';

export interface HandoffSnapshot {
  phase: HandoffPhase;
  busy: boolean;
  /** False after `openSession` is submitted — the host cannot undo that navigation. */
  cancellable: boolean;
}

export function createHandoffGate() {
  let current: AbortController | undefined;
  let phase: HandoffPhase = 'idle';
  let cancellable = true;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    get snapshot(): HandoffSnapshot {
      return { phase, busy: current !== undefined, cancellable: current !== undefined && cancellable };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel() {
      if (!cancellable) return;
      current?.abort();
    },
    async run(
      next: HandoffPhase,
      work: (signal: AbortSignal, commit: () => void) => Promise<void>,
    ): Promise<void> {
      if (current) throw new HandoffBusyError();
      const controller = new AbortController();
      current = controller;
      phase = next;
      cancellable = true;
      notify();
      try {
        await work(controller.signal, () => {
          if (current !== controller || !cancellable) return;
          cancellable = false;
          notify();
        });
      } finally {
        if (current === controller) {
          current = undefined;
          phase = 'idle';
          cancellable = true;
          notify();
        }
      }
    },
  };
}

export type HandoffGate = ReturnType<typeof createHandoffGate>;
