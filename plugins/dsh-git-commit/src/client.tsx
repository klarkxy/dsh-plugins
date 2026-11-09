import type { Context } from '@deepseek-ai/cordis'
import {
  MODEL_CATALOG_INJECT, readModelCatalog, modelMenuEffortLabel, modelMenuEffortOptions, parseModelMenuChoices,
} from '@klarkxy/dsh-model-route'
import { ModelCatalogStatus, ModelMenu, modelMenuCss, useModelCatalog } from '@klarkxy/dsh-model-route/ui'
import { renderModelPicker, useModelMenuAnchor, type RenderFactorySlot } from '@klarkxy/dsh-plugin-kit/model-picker'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  Button, IconChevronDownOutlineRegular, IconRefreshOutlineRegular, Switch, Tooltip, useAnchoredPosition, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { createModelSettingsSubscriber, mountModelSettingsChanges } from '@klarkxy/dsh-plugin-kit/model-settings-client'
import { registerAuxiliaryModelSettings } from '@klarkxy/dsh-plugin-kit/auxiliary-model-client'
import {
  GIT_COMMIT_CLIENT_SERVICE, PLUGIN_NAME, RPC_CHANNEL, type CommitModelRoute, type CommitRunResult,
  type GitCommitSettings, type GitCommitStatus, type PartialCommitResult, type RpcResult,
} from './contracts.ts'

export const name = 'dsh-git-commit-client'
export const inject = ['slots', 'connection', ...MODEL_CATALOG_INJECT, 'locale'] as const

const NS = 'dsh-git-commit.action'

const zh = {
  action: '提交',
  title: '提交到 Git',
  commitAction: '分次提交全部工作区修改',
  files: '个文件',
  model: '模型',
  filesCount: '（{n} 个文件）',
  confirmPrompt: '将把 {n} 个文件的全部修改分次提交到当前分支。',
  confirm: '确认提交',
  cancel: '取消',
  commitBlocked: '正在保存模型设置或上次保存未生效，恢复后才可提交',
  loading: '正在读取仓库状态…',
  running: '正在整理修改并分次提交…',
  done: '已创建提交',
  partial: '本次提交未全部完成；以下提交已保留',
  stopped: '本次操作未确认完成',
  uncertain: '以下提交组的结果不确定。请检查 Git 日志和状态，确认后再操作。',
  hashUnavailable: '提交已创建，哈希未读取',
  remaining: '尚未提交：{n} 组',
  cancelled: '提交操作已取消',
  fallback: '模型不可用，已合并为单个提交',
  noWorkspace: '工作区没有修改',
  unavailable: '不可用',
  reasonNoRepo: '当前目录不在 Git 仓库中',
  reasonNoGit: '未找到 git 命令',
  reasonNoCwd: '会话没有工作目录',
  reasonNoSession: '会话不在线',
  sessionRunning: '会话正在运行，提交已暂停',
  refresh: '刷新',
  failed: '操作失败',
  disabled: '插件已停用',
  busy: '已有提交操作正在进行',
  stale: '设置已更新，请刷新后重试',
  workspaceChanged: '工作区或分支已变更，请刷新后重试提交',
  settingsUnavailable: '无法读取提交设置，请重新加载插件后重试',
  invalidRequest: '提交请求无效，请刷新后重试',
  planUnavailable: '模型没有给出可用的提交方案，已取消本次提交，工作区没有被改动。换一个模型重试，或开启下方「模型不可用时仍然提交」。',
  close: '关闭',
}

const en: Record<keyof typeof zh, string> = {
  action: 'Commit',
  title: 'Commit to Git',
  commitAction: 'Commit all workspace changes',
  files: 'files',
  model: 'Model',
  filesCount: ' ({n} files)',
  confirmPrompt: 'All changes in {n} files will be committed to the current branch in one or more commits.',
  confirm: 'Commit now',
  cancel: 'Cancel',
  commitBlocked: 'A settings write is pending or unrecovered; commits unlock once it settles',
  loading: 'Reading repository status…',
  running: 'Organizing changes into commits…',
  done: 'Commits created',
  partial: 'This run stopped before completion; these commits were kept',
  stopped: 'This run did not finish with a confirmed result',
  uncertain: 'The outcome of these groups is uncertain. Check Git log and status before taking further action.',
  hashUnavailable: 'Commit created; hash unavailable',
  remaining: 'Groups not committed: {n}',
  cancelled: 'Commit run cancelled',
  fallback: 'Model unavailable; used a single commit',
  noWorkspace: 'No workspace changes',
  unavailable: 'Unavailable',
  reasonNoRepo: 'Current directory is not inside a Git repository',
  reasonNoGit: 'git executable not found',
  reasonNoCwd: 'Session has no working directory',
  reasonNoSession: 'Session is not live',
  sessionRunning: 'Session is running; commits paused',
  refresh: 'Refresh',
  failed: 'Operation failed',
  disabled: 'Plugin disabled',
  busy: 'A commit run is already in progress',
  stale: 'Settings changed; refresh and retry',
  workspaceChanged: 'The workspace or branch changed; refresh and retry the commit',
  settingsUnavailable: 'Could not read commit settings; reload the plugin and retry',
  invalidRequest: 'Invalid commit request; refresh and retry',
  planUnavailable: 'The model returned no usable commit plan, so the run was cancelled and your workspace is untouched. Try another model, or enable “Commit even without a model plan” below.',
  close: 'Close',
}

type Key = keyof typeof zh
type Translate = (key: Key) => string

interface ConnectionLike {
  generation?: { subscribe(listener: () => void): () => void }
  rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
}

interface SessionSnapshotLike {
  running?: boolean
}

interface UseSessionLike {
  <T>(selector: (snapshot: SessionSnapshotLike) => T): T
}

/** A failed RPC keeps its code so the panel can explain a rejection in its own words. */
class RpcError extends Error {
  readonly code: string
  readonly partial?: PartialCommitResult
  constructor(code: string, message: string, partial?: PartialCommitResult) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.partial = partial
  }
}

export interface GitCommitActionProps {
  sessionId: string
  useSession: UseSessionLike
  call: (endpoint: string, payload: unknown) => Promise<unknown>
  t: Translate
  /** Injected by the slot registration; absent in tests that render the button alone. */
  client?: Client
  subscribeSettings?: (change: () => void, error?: (message: string) => void) => () => void
  /** Framework-composed factory renderer; absent in tests that render the button alone. */
  renderFactorySlot?: RenderFactorySlot
}

async function rpc<T>(
  call: GitCommitActionProps['call'], endpoint: string, payload: unknown = {}, fallback = '',
): Promise<T> {
  const result = await call(endpoint, payload) as RpcResult<T> | undefined
  if (!result || result.ok !== true) {
    const failed = result && 'error' in result ? result.error : undefined
    throw new RpcError(failed?.code ?? 'unknown', failed?.message ? failed.message : fallback,
      failed && 'partial' in failed ? failed.partial : undefined)
  }
  return result.value
}

function reasonText(t: Translate, status: GitCommitStatus): string {
  switch (status.reason) {
    case 'not-a-repo': return t('reasonNoRepo')
    case 'no-git': return t('reasonNoGit')
    case 'no-cwd': return t('reasonNoCwd')
    case 'no-session': return t('reasonNoSession')
    default: return t('unavailable')
  }
}

/** A refusal the plugin can name gets its own sentence; the rest stay verbatim. */
function errorText(t: Translate, error: { code: string; message: string }): string {
  const keys: Record<string, Key> = {
    'plan-unavailable': 'planUnavailable', 'no-session': 'reasonNoSession', 'no-cwd': 'reasonNoCwd',
    'no-git': 'reasonNoGit', 'not-a-repo': 'reasonNoRepo', 'no-changes': 'noWorkspace',
    'session-running': 'sessionRunning', 'session-changed': 'workspaceChanged', 'workspace-changed': 'workspaceChanged',
    busy: 'busy', stale: 'stale', disposed: 'disabled', cancelled: 'cancelled',
    'settings-unavailable': 'settingsUnavailable', 'bad-request': 'invalidRequest', 'not-found': 'invalidRequest',
  }
  const key = keys[error.code]
  return key ? t(key) : error.message || t('failed')
}

function panelError(reason: unknown): { code: string; message: string } {
  return reason instanceof RpcError
    ? { code: reason.code, message: reason.message }
    : { code: 'unknown', message: reason instanceof Error ? reason.message : String(reason) }
}

function GitBranchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4.5" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4.5" cy="12.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.5" cy="6.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.5 5.1v5.8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M11.5 8.1c0 2-1.6 2.9-3.4 3" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

export function GitCommitAction({ sessionId, useSession, call, t, client, subscribeSettings, renderFactorySlot }: GitCommitActionProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<GitCommitStatus>()
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CommitRunResult | PartialCommitResult | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  // A write that is still in flight must not let a commit run against the
  // previous default; a write that failed while the panel was open stays
  // suspect until a reread confirms what is actually stored. The panel
  // reports writes as count deltas so an abandoned popover only releases
  // the lock when the write itself settles.
  const pendingWrites = useRef(0)
  const writeFailed = useRef(false)
  const settingsDirty = useRef(false)
  const [settingsPending, setSettingsPending] = useState(false)
  // Commit is refused until the stored row has been shown to the user at
  // least once in this action's lifetime, so a default cannot be bypassed
  // while the picker is still loading or failed to load.
  const [settingsSeen, setSettingsSeen] = useState(false)
  const syncLock = useCallback(() => {
    const locked = pendingWrites.current > 0 || writeFailed.current
    settingsDirty.current = locked
    setSettingsPending(locked)
  }, [])
  const markWrite = useCallback((active: boolean) => {
    pendingWrites.current = Math.max(0, pendingWrites.current + (active ? 1 : -1))
    syncLock()
  }, [syncLock])
  const markWriteFailed = useCallback(() => { writeFailed.current = true; syncLock() }, [syncLock])
  const markSeen = useCallback(() => {
    writeFailed.current = false
    setSettingsSeen(true)
    syncLock()
  }, [syncLock])
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const generationRef = useRef(0)
  const position = useAnchoredPosition({ open, anchorRef: triggerRef, panelRef, gap: 5, margin: 16 })
  const sessionRunning = useSession(snapshot => snapshot.running === true)

  // The settings panel's model menu portals to document.body too, so the
  // dismiss hook would count a pick click as "outside" and close the whole
  // popover before onPick fires. The hook's portal parameter only ever calls
  // portal.current.contains(node) — the ref's element type is irrelevant — so
  // this proxy widens "inside" to any open menu portal carrying our list
  // class while still satisfying RefObject<HTMLElement>.
  const panelPortalRef = useMemo((): { current: HTMLElement | null } => ({
    get current() {
      const panel = panelRef.current
      if (!panel) return null
      return {
        contains: (node: Node | null): boolean =>
          panel.contains(node)
          || [...document.querySelectorAll('.gcm-menu-portal')].some(menu => menu.contains(node)),
      } as unknown as HTMLElement
    },
  }), [])

  const changeOpen = useCallback((next: boolean) => {
    // Closing mid-write is refused: a dead panel cannot apply the settled row,
    // so the popover would reopen showing the pre-write pick while commits use
    // the new default. Refusing keeps the visible row and the stored row in
    // lockstep; a settled failure closes normally.
    if (!next && pendingWrites.current > 0) return
    setOpen(next)
    setConfirming(false)
    if (next) {
      setResult(null)
      setError(null)
      // The settings block remounts and rereads the stored row; commits stay
      // locked until that read applies (onReady), even if a previous open
      // already proved the row once.
      setSettingsSeen(false)
    }
    // pendingWrites is a ref: the callback always reads the latest value.
  }, [])

  // Move focus into the dialog once it is positioned, so keyboard users land inside it.
  const positioned = Boolean(position)
  useEffect(() => {
    if (open && positioned) panelRef.current?.focus()
  }, [open, positioned])

  useDismissOnOutsidePointer(rootRef, open, changeOpen, panelPortalRef)

  useEffect(() => {
    generationRef.current += 1
    setOpen(false)
    setStatus(undefined)
    setResult(null)
    setError(null)
    setRunning(false)
    pendingWrites.current = 0
    writeFailed.current = false
    settingsDirty.current = false
    setSettingsPending(false)
    setSettingsSeen(false)
  }, [sessionId])

  const loadStatus = useCallback(async () => {
    const generation = generationRef.current
    setLoading(true)
    setError(null)
    try {
      const next = await rpc<GitCommitStatus>(call, 'status', { sessionId })
      if (generationRef.current !== generation) return
      setStatus(next)
    } catch (reason) {
      if (generationRef.current !== generation) return
      setStatus(undefined)
      setError(panelError(reason))
    } finally {
      if (generationRef.current === generation) setLoading(false)
    }
  }, [call, sessionId])

  useEffect(() => {
    if (!open) return
    void loadStatus()
  }, [open, loadStatus])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      changeOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [open, changeOpen])

  const runCommit = useCallback(async () => {
    const generation = generationRef.current
    // A half-saved default is never the model this commit should use, and a
    // commit never runs before the stored row has been displayed once.
    if (settingsDirty.current || (client && !settingsSeen)) { setConfirming(false); return }
    setConfirming(false)
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      const value = await rpc<CommitRunResult>(call, 'commit', { sessionId })
      if (generationRef.current !== generation) return
      setResult(value)
    } catch (reason) {
      if (generationRef.current !== generation) return
      if (reason instanceof RpcError && reason.partial) setResult(reason.partial)
      setError(panelError(reason))
    } finally {
      if (generationRef.current === generation) {
        // Even a rejected run may have durable commits or changed the index.
        const next = await rpc<GitCommitStatus>(call, 'status', { sessionId }).catch(() => undefined)
        if (generationRef.current === generation) {
          setStatus(next)
          setRunning(false)
        }
      }
    }
  }, [call, sessionId, client, settingsSeen])

  const available = status?.available === true
  const workspaceCount = status?.workspace.files ?? 0
  const canCommit = available && !running && !sessionRunning && workspaceCount > 0
    && !settingsPending && (!client || settingsSeen)

  return (
    <div ref={rootRef} className="gcm-root">
      <Tooltip label={t('title')} side="bottom" gap={4}>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="sm"
          icon={<GitBranchIcon />}
          aria-label={t('title')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => changeOpen(!open)}
        >
          {t('action')}
        </Button>
      </Tooltip>
      {open && createPortal(
        <div
          ref={panelRef}
          className="gcm-root dsh-ui-surface gcm-panel"
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="dialog"
          tabIndex={-1}
          aria-label={t('title')}
        >
          <div className="dsh-ui-surface-body">
            <div className="dsh-ui-surface-head">
              <span className="dsh-ui-surface-title">{t('title')}</span>
              {status?.branch ? <span className="dsh-ui-hint dsh-ui-truncate">{status.branch}</span> : null}
              <span className="dsh-ui-spacer" />
              <Tooltip label={t('refresh')} side="bottom" gap={4}>
                <Button variant="ghost" size="sm" aria-label={t('refresh')} icon={<IconRefreshOutlineRegular size={14} />}
                  disabled={loading || running} onClick={() => void loadStatus()} />
              </Tooltip>
            </div>
            {loading && !status && <p className="dsh-ui-hint" role="status">{t('loading')}</p>}
            {error !== null && <p className="dsh-ui-error" role="alert">{errorText(t, error)}</p>}
            {/* Picking a model or the fallback only writes the saved row; the
             * commit itself still requires the explicit confirm below. The
             * panel lives inside the dialog, so closing the popover unmounts
             * it and a write-back receipt from a closed panel cannot bleed
             * into the next open. The controls lock while a commit run is in
             * flight so it cannot switch models mid-plan, and the commit
             * button locks while a write is pending or its failure is
             * unrecovered. */}
            {client ? (
              <GitCommitSettingsPanel
                client={client}
                subscribeSettings={subscribeSettings}
                disabled={running}
                renderFactorySlot={renderFactorySlot}
                onSaving={markWrite}
                onWriteFailed={markWriteFailed}
                onReady={markSeen}
                onSaved={() => void loadStatus()}
              />
            ) : null}
            {status && !available && <p className="dsh-ui-meta" role="status">{reasonText(t, status)}</p>}
            {available && (
              <>
                {/* The resolved model is intentionally not repeated here: the
                 * picker above already shows the saved pick (or "default"),
                 * and a second read-only row could contradict it while a
                 * save is in flight. */}
                {confirming && canCommit ? (
                  <div className="dsh-ui-stack" role="group" aria-label={t('commitAction')}>
                    <p className="dsh-ui-hint dsh-ui-wrap">{t('confirmPrompt').replace('{n}', String(workspaceCount))}</p>
                    <div className="dsh-ui-actions">
                      <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>{t('cancel')}</Button>
                      <Button variant="primary" size="md" onClick={() => void runCommit()}>{t('confirm')}</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="primary" size="md"
                    disabled={!canCommit}
                    onClick={() => setConfirming(true)}>
                    {t('commitAction')}{t('filesCount').replace('{n}', String(workspaceCount))}
                  </Button>
                )}
                {workspaceCount === 0 && <p className="dsh-ui-hint">{t('noWorkspace')}</p>}
                {sessionRunning && <p className="dsh-ui-hint">{t('sessionRunning')}</p>}
                {settingsPending && <p className="dsh-ui-hint" role="status">{t('commitBlocked')}</p>}
              </>
            )}
            {running && <p className="dsh-ui-hint" role="status">{t('running')}</p>}
            {result && (
              <div className="dsh-ui-stack">
                <p className="dsh-ui-hint dsh-ui-wrap">{t('failure' in result ? result.commits.length ? 'partial' : 'stopped' : 'done')} · {result.branch}</p>
                <ul className="gcm-commits">
                  {result.commits.map((commit, index) => (
                    <li key={`${index}:${commit.hash}`}>
                      <code>{commit.hash || t('hashUnavailable')}</code> {commit.message}
                      <div className="dsh-ui-hint">{commit.files.join(', ')}</div>
                    </li>
                  ))}
                </ul>
                {result.fallback && <p className="dsh-ui-hint">{t('fallback')}</p>}
                {'uncertain' in result && result.uncertain?.length ? <>
                  <p className="dsh-ui-hint" role="status">{t('uncertain')}</p>
                  <ul className="gcm-commits">
                    {result.uncertain.map((group, index) => <li key={index}>{group.message}
                      <div className="dsh-ui-hint">{group.files.join(', ')}</div>
                    </li>)}
                  </ul>
                </> : null}
                {'remaining' in result && <>
                  <p className="dsh-ui-hint">{t('remaining').replace('{n}', String(result.remaining.length))}</p>
                  <ul className="gcm-commits">
                    {result.remaining.map((group, index) => <li key={index}>{group.message}
                      <div className="dsh-ui-hint">{group.files.join(', ')}</div>
                    </li>)}
                  </ul>
                </>}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

export const clientCss = `${officialUiCss('gcm-root')}${modelMenuCss}
/* Only the floating panel's geometry is this plugin's own: the material, the
 * rounded edge and the scrollbar tokens all come from the shared contract.
 *
 * The root class is spelled out because the panel is portaled and *is* the
 * root: the dsh-ui-surface recipe therefore reaches it as a compound
 * .gcm-root.dsh-ui-surface selector and declares position:relative at the
 * weight a bare .gcm-panel rule also carries. Left unqualified that recipe
 * wins, and the anchored left/top degrade into offsets from the panel's static
 * spot at the end of body — the popover then renders under the page instead
 * of at the trigger. Naming both classes puts this rule at the same weight,
 * later in the sheet, so it wins. */
.gcm-root.gcm-panel { position: fixed; width: min(360px, calc(100vw - 32px)); max-height: min(560px, calc(100vh - 32px)); overflow: auto; }
.gcm-root .gcm-commits { margin: 0; padding-inline-start: 18px; display: grid; gap: 2px; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.gcm-root .gcm-commits code { font-size: 12px; background: var(--dsw-alias-bg-layer-2); padding: 0 4px; border-radius: var(--dsw-radius-sm); }
.gcm-root .gcm-settings-status { display: flex; flex-direction: column; gap: 4px; }
`

declare module '@deepseek-ai/cordis' {
  interface Context { dshGitCommitClient: { active: boolean } }
}

type Client = Context & {
  connection: ConnectionLike
  remote?: { session?: { modelCatalog?: () => Promise<unknown> } }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; id: string; order: number; locale: string; inject: () => unknown } | { name: string; id: string; order: number; label: () => string }, render: unknown): () => void
  }
  locale: {
    register(ns: string, locales: { zh: Record<string, string>; en: Record<string, string> }): () => void
    getSnapshot?(): { active: string }
    subscribe?(listener: () => void): () => void
  }
}

/** Host UI language, following live switches with the host's English fallback. */
function useHostLocale(client: Client): string {
  const subscribe = useCallback(
    (listener: () => void) => client.locale.subscribe?.(listener) ?? (() => {}),
    [client],
  )
  const snapshot = useCallback(() => client.locale.getSnapshot?.().active ?? 'en', [client])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

const settingsZh = {
  model: '提交规划模型',
  modelDefault: '默认辅助模型',
  modelHint: '留空使用全局默认辅助模型；未设置时跟随当前会话模型，再回落到宿主默认对话模型。',
  fallback: '模型不可用时仍然提交',
  fallbackHint: '默认关闭：模型规划失败会取消本次提交，工作区不变。开启后全部改动会合并成一个提交，由插件代写提交信息。',
  loading: '正在读取设置…',
  saved: '已保存。',
  stale: '设置已更新，请刷新后重试。',
  failed: '无法读取提交设置。',
  saveFailed: '设置未能保存，已显示的选择未生效。请重试。',
  retry: '重试',
  refresh: '刷新设置',
  syncUnavailable: '自动刷新不可用，请手动刷新设置。',
}

const settingsEn: Record<keyof typeof settingsZh, string> = {
  model: 'Commit planning model',
  modelDefault: 'Default auxiliary model',
  modelHint: 'Leave empty to use the global default auxiliary model; when none is set, the current conversation model, then the host default chat model.',
  fallback: 'Commit even without a model plan',
  fallbackHint: 'Off by default: a failed plan cancels the run and leaves the workspace untouched. When on, every change lands in one commit with a plugin-written message.',
  loading: 'Loading settings…',
  saved: 'Saved.',
  stale: 'Settings changed; refresh and retry.',
  failed: 'Could not load commit settings.',
  saveFailed: 'The change could not be saved, so the shown selection did not take effect. Try again.',
  retry: 'Retry',
  refresh: 'Refresh settings',
  syncUnavailable: 'Automatic refresh unavailable; refresh settings manually.',
}

function settingsCopy(locale: string): Record<keyof typeof settingsZh, string> {
  return String(locale).startsWith('zh') ? settingsZh : settingsEn
}

/** Model/fallback block embedded in the commit popover; picks persist as the
 * plugin's saved defaults and sync through the model-settings change channel. */
export function GitCommitSettingsPanel(props: {
  client: Client
  locale?: string
  subscribeSettings?: (change: () => void, error?: (message: string) => void) => () => void
  /** Locks the controls while a commit run is in flight. */
  disabled?: boolean
  /** Framework-composed factory renderer; absent under direct test renders. */
  renderFactorySlot?: RenderFactorySlot
  /** Write lifecycle: true at dispatch, false when the write settles (even if
   * the panel unmounted by then). The parent counts these, never a read. */
  onSaving?: (active: boolean) => void
  /** A live panel saw a write rejection: the shown pick was never stored, so
   * the parent locks until the stored row is reread and reapplied. */
  onWriteFailed?: () => void
  /** Fired when a stored row is applied to the UI: enables commits and clears
   * an unrecovered-write lock because the shown row is again authoritative. */
  onReady?: () => void
  onSaved?: (settings: GitCommitSettings) => void
}) {
  const hostLocale = useHostLocale(props.client)
  const text = settingsCopy(props.locale ?? hostLocale)
  const language = String(props.locale ?? hostLocale).toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const [settings, setSettings] = useState<GitCommitSettings | undefined>(undefined)
  const loadCatalog = useCallback(() => readModelCatalog(props.client), [props.client])
  const subscribeCatalog = useCallback((change: () => void) => props.client.connection.generation?.subscribe(change), [props.client])
  const catalogState = useModelCatalog(loadCatalog, { subscribe: subscribeCatalog })
  const { refresh: refreshCatalog } = catalogState
  const choices = parseModelMenuChoices(catalogState.catalog, settings?.model)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<'' | 'failed' | 'stale' | 'saveFailed'>('')
  const [note, setNote] = useState(false)
  const [busy, setBusy] = useState(false)
  const [syncError, setSyncError] = useState('')
  const operation = useRef({ epoch: 0, active: false, reading: false, writing: false, pending: false })
  const refreshRef = useRef<() => void>(() => {})

  const call = useCallback(
    (endpoint: string, payload: unknown = {}) => props.client.connection.rpc.call(RPC_CHANNEL, endpoint, payload),
    [props.client],
  )

  const refresh = () => {
    const state = operation.current
    if (!state.active) return
    if (state.reading || state.writing) { state.pending = true; return }
    state.pending = false; state.reading = true; setBusy(true)
    const epoch = state.epoch
    void rpc<GitCommitSettings>(call, 'settings', {}, text.failed).then(next => {
      if (state.active && state.epoch === epoch && !state.pending) {
        setSettings(next); setError('')
        // The stored row is now on screen: the parent may allow commits. A
        // read never touches the write lock — only a write's own settle does.
        props.onReady?.()
      }
    }).catch(() => {
      if (state.active && state.epoch === epoch && !state.pending) setError('failed')
    }).finally(() => {
      if (!state.active || state.epoch !== epoch) return
      state.reading = false; setBusy(false)
      if (state.pending) refreshRef.current()
    })
  }
  refreshRef.current = refresh
  useEffect(() => {
    const state = operation.current
    state.epoch++; state.active = true; state.reading = false; state.writing = false; state.pending = false
    setBusy(false); setSettings(undefined); setError(''); setNote(false)
    refreshRef.current()
    // An in-flight write keeps the parent's lock across this unmount; only the
    // write's own settle may release it (see save().finally), so nothing is
    // emitted here.
    return () => { state.active = false; state.epoch++ }
  }, [call])
  useEffect(() => {
    setSyncError('')
    let live = true
    const stop = props.subscribeSettings?.(() => { if (live) { setSyncError(''); refreshCatalog(); refreshRef.current() } }, message => { if (live) setSyncError(message) })
    return () => { live = false; stop?.() }
  }, [props.subscribeSettings, props.client, refreshCatalog])

  // One patch shape for both rows: the service replaces the whole row, so an
  // update to the toggle must carry the model it is not changing.
  const controlsLocked = props.disabled === true

  const save = useCallback((patch: { model?: CommitModelRoute; allowFallback?: boolean }) => {
    const state = operation.current
    if (!settings || !state.active || state.writing || state.reading || props.disabled) return
    state.writing = true
    const epoch = state.epoch
    setBusy(true); setNote(false); setError('')
    // Synchronous: the parent's commit click handler reads this flag before the
    // next render, so a click landing mid-write is still refused.
    props.onSaving?.(true)
    void rpc<GitCommitSettings>(call, 'settings.update', {
      settings: {
        model: patch.model ?? settings.model,
        allowFallback: patch.allowFallback ?? settings.allowFallback,
      },
      expectedRevision: settings.revision,
    }, text.stale).then(next => {
      if (state.active && state.epoch === epoch) {
        setSettings(next); setNote(true); props.onReady?.(); props.onSaved?.(next)
      }
    }).catch(reason => {
      if (state.active && state.epoch === epoch) {
        // A stale write is a lost race; anything else means the new choice was
        // never persisted, so the UI must not look "saved". The parent locks
        // until a reread (onReady) proves what is actually stored.
        props.onWriteFailed?.()
        setError(reason instanceof RpcError && reason.code === 'stale' ? 'stale' : 'saveFailed')
      }
    }).finally(() => {
      // The write's settle — success or failure — always releases the parent
      // lock it opened, including when the popover already closed this panel:
      // by then the stored row is final and a reopened panel can safely
      // commit. A live panel that saw the failure marks it visibly instead
      // (saveFailed above), so the lock still cannot be lost silently.
      props.onSaving?.(false)
      if (!state.active || state.epoch !== epoch) return
      state.writing = false; setBusy(false)
      if (state.pending) refreshRef.current()
    })
  }, [call, settings, text.stale, props.disabled])

  const locked = busy || controlsLocked
  const current = settings?.model ?? { provider: '', model: '' }
  const follow = !current.provider || !current.model
  const selected = follow ? undefined : choices.find(item => item.provider === current.provider && item.model === current.model)
  const efforts = follow ? [] : modelMenuEffortOptions(selected, current.reasoningEffort)
  const currentLabel = follow ? text.modelDefault : selected?.label ?? `${current.provider} / ${current.model}`
  const selectedEffort = efforts.find(item => item.id === (current.reasoningEffort || ''))
  const effortName = selectedEffort ? modelMenuEffortLabel(selectedEffort, language) : undefined
  const anchor = useModelMenuAnchor(`${text.model}: ${settings ? currentLabel : ''}`, undefined,
    () => setMenuOpen(false))

  if (!settings) {
    return (
      <section className="gcm-root gcm-settings dsh-ui-stack">
        {error
          ? <p role="alert" className="dsh-ui-error">{text[error]}</p>
          : <p role="status" className="dsh-ui-hint">{text.loading}</p>}
        {syncError && <p role="status" className="dsh-ui-hint">{text.syncUnavailable}</p>}
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => refreshRef.current()}>{text.retry}</Button>
      </section>
    )
  }

  return (
    <section className="gcm-root gcm-settings dsh-ui-stack" data-testid="git-commit-settings">
      <div className="dsh-ui-field">
        <span className="dsh-ui-label">{text.model}</span>
        <ModelCatalogStatus state={catalogState} locale={language} />
        {renderModelPicker(props.renderFactorySlot, {
          locale: language,
          disabled: locked,
          busy: locked,
          onOpenChange: next => setMenuOpen(next && !locked),
          listClassName: 'gcm-root gcm-menu-portal',
          choices,
          selected: follow ? undefined : { provider: current.provider, model: current.model },
          onPick: picked => save({ model: { provider: picked.provider, model: picked.model } }),
          leading: [{ id: 'default', label: text.modelDefault, selected: follow }],
          onPickLeading: () => save({ model: { provider: '', model: '' } }),
          efforts,
          selectedEffort: current.reasoningEffort || '',
          onPickEffort: effort => save({ model: follow
            ? { provider: '', model: '' }
            : { provider: current.provider, model: current.model, ...(effort ? { reasoningEffort: effort } : {}) } }),
          triggerLabel: currentLabel,
          triggerEffortLabel: !follow && efforts.length ? (effortName ?? text.modelDefault) : undefined,
          modelLabel: text.model,
          modelValue: currentLabel,
          defaultEffortLabel: text.modelDefault,
        }, {
          anchor,
          fallback: <ModelMenu
            locale={language}
            open={menuOpen && !locked}
            onOpenChange={next => setMenuOpen(next && !locked)}
            listClassName="gcm-root gcm-menu-portal"
            anchor={<button type="button" className="dsh-model-menu-trigger" disabled={locked} aria-label={`${text.model}: ${currentLabel}`}>
              <span className="dsh-model-menu-triggerLabel">{currentLabel}</span>
              {!follow && efforts.length ? <span className="dsh-model-menu-triggerEffort">{effortName ?? text.modelDefault}</span> : null}
              <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${menuOpen && !locked ? ' dsh-model-menu-chevronOpen' : ''}`} />
            </button>}
            choices={choices}
            selected={follow ? undefined : { provider: current.provider, model: current.model }}
            onPick={picked => save({ model: { provider: picked.provider, model: picked.model } })}
            leading={[{ id: 'default', label: text.modelDefault, selected: follow }]}
            onPickLeading={() => save({ model: { provider: '', model: '' } })}
            efforts={efforts}
            selectedEffort={current.reasoningEffort || ''}
            onPickEffort={effort => save({ model: follow
              ? { provider: '', model: '' }
              : { provider: current.provider, model: current.model, ...(effort ? { reasoningEffort: effort } : {}) } })}
            modelLabel={text.model}
            modelValue={currentLabel}
            defaultEffortLabel={text.modelDefault}
          />,
        })}
      </div>
      <p className="dsh-ui-meta">{text.modelHint}</p>
      <div className="gcm-settings-status">
        {syncError && <p role="status" className="dsh-ui-hint">{text.syncUnavailable}</p>}
        {error && <p role="alert" className="dsh-ui-error">{text[error]}</p>}
        {note && <p role="status" className="dsh-ui-notice">{text.saved}</p>}
        {error || syncError ? (
          <Button variant="ghost" size="sm" disabled={locked} onClick={() => refreshRef.current()}>{text.refresh}</Button>
        ) : null}
      </div>
      <article className="gcm-root dsh-ui-card">
        <header className="dsh-ui-toggle-row">
          <div className="dsh-ui-toggle-text">
            <h3 className="dsh-ui-toggle-label">{text.fallback}</h3>
            <p className="dsh-ui-hint">{text.fallbackHint}</p>
          </div>
          <Switch
            checked={settings.allowFallback}
            label={text.fallback}
            disabled={locked}
            onChange={next => save({ allowFallback: next })}
          />
        </header>
      </article>
    </section>
  )
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  mountModelSettingsChanges(ctx, PLUGIN_NAME)
  const settingsSubscriber = createModelSettingsSubscriber(ctx, PLUGIN_NAME)
  const subscribeSettings = (change: () => void, error?: (message: string) => void) => settingsSubscriber.subscribe(change, error)
  ctx.provide(GIT_COMMIT_CLIENT_SERVICE, { active: true })
  // The shared "default auxiliary model" card is root-owned infrastructure:
  // this plugin retains one share while enabled and the card unloads with
  // the last participant, never depending on another plugin.
  ctx.effect(() => registerAuxiliaryModelSettings(ctx), 'git-commit.auxiliary-model')
  ctx.effect(() => client.locale.register(NS, { zh: { ...zh }, en: { ...en } }), 'git-commit.locale')
  // One stylesheet serves the header popover, whose settings block lives in the
  // same portaled surface.
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', name)
    style.textContent = clientCss
    document.head.appendChild(style)
    return () => style.remove()
  }, 'git-commit.styles')
  // The model/fallback defaults live inside the commit popover itself: the
  // header action injects the live client and settings subscriber, and there is
  // no standalone settings.section anymore. Model-hub aggregation on the host
  // side still lists the same stored row.
  ctx.effect(() => client.slots.inject('conversation.session.header.actions', () => client.slots.register(
    {
      name: 'conversation.session.header.actions',
      id: 'git-commit',
      order: 10,
      locale: NS,
      inject: () => ({
        call: (endpoint: string, payload: unknown) => client.connection.rpc.call(RPC_CHANNEL, endpoint, payload),
        client,
        subscribeSettings,
      }),
    },
    GitCommitAction,
  )), 'git-commit.slot')
}
