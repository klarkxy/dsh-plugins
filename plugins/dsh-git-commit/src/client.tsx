import type { Context } from '@deepseek-ai/cordis'
import {
  modelMenuChoiceKey, modelMenuEffortOptions, parseModelMenuChoiceKey, parseModelMenuChoices,
  type ModelMenuChoice,
} from '@klarkxy/dsh-plugin-kit/model-menu'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  Button, IconRefreshOutlineRegular, Switch, Tag, Tooltip, useAnchoredPosition, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import {
  GIT_COMMIT_CLIENT_SERVICE, PLUGIN_NAME, RPC_CHANNEL, type CommitModelRoute, type CommitRunResult,
  type GitCommitSettings, type GitCommitStatus, type RpcResult,
} from './contracts.ts'

export const name = 'dsh-git-commit-client'
export const inject = ['slots', 'connection', 'remote', 'remote.session', 'locale'] as const

const NS = 'dsh-git-commit.action'

const zh = {
  action: '提交',
  title: '提交到 Git',
  commitAction: '分次提交全部工作区修改',
  files: '个文件',
  model: '模型',
  modelDefault: '默认模型',
  modelCustom: '插件设置',
  filesCount: '（{n} 个文件）',
  confirmPrompt: '将把 {n} 个文件的全部修改分次提交到当前分支。',
  confirm: '确认提交',
  cancel: '取消',
  loading: '正在读取仓库状态…',
  running: '正在整理修改并分次提交…',
  done: '已创建提交',
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
  planUnavailable: '模型没有给出可用的提交方案，已取消本次提交，工作区没有被改动。换一个模型重试，或在插件设置里开启兜底提交。',
  close: '关闭',
}

const en: Record<keyof typeof zh, string> = {
  action: 'Commit',
  title: 'Commit to Git',
  commitAction: 'Commit all workspace changes',
  files: 'files',
  model: 'Model',
  modelDefault: 'default model',
  modelCustom: 'Plugin settings',
  filesCount: ' ({n} files)',
  confirmPrompt: 'All changes in {n} files will be committed to the current branch in one or more commits.',
  confirm: 'Commit now',
  cancel: 'Cancel',
  loading: 'Reading repository status…',
  running: 'Organizing changes into commits…',
  done: 'Commits created',
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
  planUnavailable: 'The model returned no usable commit plan, so the run was cancelled and your workspace is untouched. Try another model, or turn on the fallback in plugin settings.',
  close: 'Close',
}

type Key = keyof typeof zh
type Translate = (key: Key) => string

interface ConnectionLike {
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
  constructor(code: string, message: string) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

export interface GitCommitActionProps {
  sessionId: string
  useSession: UseSessionLike
  call: (endpoint: string, payload: unknown) => Promise<unknown>
  t: Translate
}

async function rpc<T>(
  call: GitCommitActionProps['call'], endpoint: string, payload: unknown = {}, fallback = 'Operation failed',
): Promise<T> {
  const result = await call(endpoint, payload) as RpcResult<T> | undefined
  if (!result || result.ok !== true) {
    const failed = result && 'error' in result ? result.error : undefined
    throw new RpcError(failed?.code ?? 'unknown', failed?.message ? failed.message : fallback)
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
  return error.code === 'plan-unavailable' ? t('planUnavailable') : error.message
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

export function GitCommitAction({ sessionId, useSession, call, t }: GitCommitActionProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<GitCommitStatus>()
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CommitRunResult | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const generationRef = useRef(0)
  const position = useAnchoredPosition({ open, anchorRef: triggerRef, panelRef, gap: 5, margin: 16 })
  const sessionRunning = useSession(snapshot => snapshot.running === true)

  const changeOpen = useCallback((next: boolean) => {
    setOpen(next)
    setConfirming(false)
    if (next) {
      setResult(null)
      setError(null)
    }
  }, [])

  // Move focus into the dialog once it is positioned, so keyboard users land inside it.
  const positioned = Boolean(position)
  useEffect(() => {
    if (open && positioned) panelRef.current?.focus()
  }, [open, positioned])

  useDismissOnOutsidePointer(rootRef, open, changeOpen, panelRef)

  useEffect(() => {
    generationRef.current += 1
    setOpen(false)
    setStatus(undefined)
    setResult(null)
    setError(null)
    setRunning(false)
  }, [sessionId])

  const loadStatus = useCallback(async () => {
    const generation = generationRef.current
    setLoading(true)
    setError(null)
    try {
      const next = await rpc<GitCommitStatus>(call, 'status', { sessionId }, t('failed'))
      if (generationRef.current !== generation) return
      setStatus(next)
    } catch (reason) {
      if (generationRef.current !== generation) return
      setStatus(undefined)
      setError(panelError(reason))
    } finally {
      if (generationRef.current === generation) setLoading(false)
    }
  }, [call, sessionId, t])

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
    setConfirming(false)
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      const value = await rpc<CommitRunResult>(call, 'commit', { sessionId }, t('failed'))
      if (generationRef.current !== generation) return
      setResult(value)
      const next = await rpc<GitCommitStatus>(call, 'status', { sessionId }).catch(() => undefined)
      if (generationRef.current !== generation) return
      if (next) setStatus(next)
    } catch (reason) {
      if (generationRef.current !== generation) return
      setError(panelError(reason))
    } finally {
      if (generationRef.current === generation) setRunning(false)
    }
  }, [call, sessionId, t])

  const available = status?.available === true
  const workspaceCount = status?.workspace.files ?? 0
  const canCommit = available && !running && !sessionRunning && workspaceCount > 0

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
            {status && !available && <p className="dsh-ui-meta" role="status">{reasonText(t, status)}</p>}
            {available && (
              <>
                {status?.model ? (
                  <p className="gcm-model">
                    <span className="dsh-ui-hint">{t('model')}</span>
                    <span className="dsh-ui-truncate">{status.model.provider}/{status.model.model}</span>
                    <Tag tone={status.model.source === 'page' ? 'info' : 'neutral'}>
                      {status.model.source === 'page' ? t('modelCustom') : t('modelDefault')}
                    </Tag>
                  </p>
                ) : null}
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
              </>
            )}
            {running && <p className="dsh-ui-hint" role="status">{t('running')}</p>}
            {result && (
              <div className="dsh-ui-stack">
                <p className="dsh-ui-hint dsh-ui-wrap">{t('done')} · {result.branch}</p>
                <ul className="gcm-commits">
                  {result.commits.map(commit => (
                    <li key={commit.hash || commit.message}>
                      <code>{commit.hash}</code> {commit.message}
                    </li>
                  ))}
                </ul>
                {result.fallback && <p className="dsh-ui-hint">{t('fallback')}</p>}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

export const clientCss = `${officialUiCss('gcm-root')}
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
.gcm-model { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); }
.gcm-commits { margin: 0; padding-inline-start: 18px; display: grid; gap: 2px; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.gcm-commits code { font-size: 12px; background: var(--dsw-alias-bg-layer-2); padding: 0 4px; border-radius: var(--dsw-radius-sm); }
.gcm-settings { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.gcm-settings-status { display: flex; flex-direction: column; gap: 4px; }
`

declare module '@deepseek-ai/cordis' {
  interface Context { dshGitCommitClient: { active: boolean } }
}

type Client = Context & {
  connection: ConnectionLike
  remote?: { session?: { modelCatalog?: () => Promise<unknown> } }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; id: string; order: number; locale: string; inject: () => unknown } | { name: string; key: string }, render: unknown): () => void
  }
  locale: {
    register(ns: string, locales: { zh: Record<string, string>; en: Record<string, string> }): () => void
    getSnapshot?(): { active: string }
    subscribe?(listener: () => void): () => void
  }
}

/** Host UI language, following live switches; falls back to zh when the service lacks a snapshot. */
function useHostLocale(client: Client): string {
  const subscribe = useCallback(
    (listener: () => void) => client.locale.subscribe?.(listener) ?? (() => {}),
    [client],
  )
  const snapshot = useCallback(() => client.locale.getSnapshot?.().active ?? 'zh', [client])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

const settingsZh = {
  pageTitle: 'Git 提交',
  model: '提交规划模型',
  modelDefault: '默认模型',
  modelEffort: '思考强度',
  modelHint: '留空则使用当前会话模型，再回落到宿主默认对话模型。',
  fallback: '模型不可用时仍然提交',
  fallbackHint: '默认关闭：模型规划失败会取消本次提交，工作区不变。开启后全部改动会合并成一个提交，由插件代写提交信息。',
  loading: '正在读取设置…',
  saved: '已保存。',
  stale: '设置已更新，请刷新后重试。',
  failed: '无法读取提交设置。',
  retry: '重试',
}

const settingsEn: Record<keyof typeof settingsZh, string> = {
  pageTitle: 'Git Commit',
  model: 'Commit planning model',
  modelDefault: 'Default model',
  modelEffort: 'Reasoning effort',
  modelHint: 'Leave empty to use the current session model, then the host default chat model.',
  fallback: 'Commit even without a model plan',
  fallbackHint: 'Off by default: a failed plan cancels the run and leaves the workspace untouched. When on, every change lands in one commit with a plugin-written message.',
  loading: 'Loading settings…',
  saved: 'Saved.',
  stale: 'Settings changed; refresh and retry.',
  failed: 'Could not load commit settings.',
  retry: 'Retry',
}

function settingsCopy(locale: string): Record<keyof typeof settingsZh, string> {
  return String(locale).startsWith('zh') ? settingsZh : settingsEn
}

/** Plugin-page settings row: pick the model this plugin's planning call uses. */
export function GitCommitSettingsPanel(props: { client: Client; locale?: string }) {
  const hostLocale = useHostLocale(props.client)
  const text = settingsCopy(props.locale ?? hostLocale)
  const [settings, setSettings] = useState<GitCommitSettings | undefined>(undefined)
  const [choices, setChoices] = useState<ModelMenuChoice[]>([])
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const call = useCallback(
    (endpoint: string, payload: unknown = {}) => props.client.connection.rpc.call(RPC_CHANNEL, endpoint, payload),
    [props.client],
  )

  // Settings load once per client; the catalog effect below is keyed on route
  // strings, so saving a new settings object never re-triggers either fetch.
  useEffect(() => {
    let live = true
    void rpc<GitCommitSettings>(call, 'settings', {}, text.failed).then(next => {
      if (live) { setSettings(next); setError('') }
    }).catch(() => { if (live) setError(text.failed) })
    return () => { live = false }
  }, [call, text.failed])

  const boundProvider = settings?.model.provider ?? ''
  const boundModel = settings?.model.model ?? ''
  useEffect(() => {
    let live = true
    const bound = boundProvider && boundModel ? { provider: boundProvider, model: boundModel } : undefined
    void props.client.remote?.session?.modelCatalog?.()
      ?.then(value => { if (live) setChoices(parseModelMenuChoices(value, bound)) })
      .catch(() => { if (live) setChoices([]) })
    return () => { live = false }
  }, [props.client, boundProvider, boundModel])

  // One patch shape for both rows: the service replaces the whole row, so an
  // update to the toggle must carry the model it is not changing.
  const save = useCallback((patch: { model?: CommitModelRoute; allowFallback?: boolean }) => {
    if (!settings) return
    setBusy(true); setNote(''); setError('')
    void rpc<GitCommitSettings>(call, 'settings.update', {
      settings: {
        model: patch.model ?? settings.model,
        allowFallback: patch.allowFallback ?? settings.allowFallback,
      },
      expectedRevision: settings.revision,
    }, text.stale).then(next => {
      setSettings(next); setNote(text.saved); setBusy(false)
    }).catch(() => {
      setError(text.stale); setBusy(false)
    })
  }, [call, settings, text.saved, text.stale])

  if (!settings) {
    return (
      <section className="gcm-root gcm-settings">
        {error
          ? <p role="alert" className="dsh-ui-error">{error}</p>
          : <p role="status" className="dsh-ui-hint">{text.loading}</p>}
      </section>
    )
  }

  const current = settings.model
  const selected = choices.find(item => item.provider === current.provider && item.model === current.model)
  const efforts = modelMenuEffortOptions(selected, current.reasoningEffort)

  return (
    <section className="gcm-root gcm-settings" data-testid="git-commit-settings">
      <div className="gcm-settings-status">
        {error && <p role="alert" className="dsh-ui-error">{error}</p>}
        {note && <p role="status" className="dsh-ui-notice">{note}</p>}
      </div>
      <label className="dsh-ui-field">
        <span className="dsh-ui-label">{text.model}</span>
        <select
          className="dsh-ui-select"
          value={modelMenuChoiceKey(current.provider, current.model)}
          disabled={busy}
          onChange={event => {
            const key = event.target.value
            if (!key) { save({ model: { provider: '', model: '' } }); return }
            const parsed = parseModelMenuChoiceKey(key)
            if (parsed) save({ model: parsed })
          }}
        >
          <option value="">{text.modelDefault}</option>
          {choices.map(choice => (
            <option key={modelMenuChoiceKey(choice.provider, choice.model)} value={modelMenuChoiceKey(choice.provider, choice.model)}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      {selected && efforts.length > 0 && (
        <label className="dsh-ui-field">
          <span className="dsh-ui-label">{text.modelEffort}</span>
          <select
            className="dsh-ui-select"
            value={current.reasoningEffort ?? ''}
            disabled={busy}
            onChange={event => save({ model: { ...current, reasoningEffort: event.target.value || undefined } })}
          >
            <option value="">{text.modelDefault}</option>
            {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
          </select>
        </label>
      )}
      <p className="dsh-ui-meta">{text.modelHint}</p>
      <article className="gcm-root dsh-ui-card">
        <header className="dsh-ui-toggle-row">
          <div className="dsh-ui-toggle-text">
            <h3 className="dsh-ui-toggle-label">{text.fallback}</h3>
            <p className="dsh-ui-hint">{text.fallbackHint}</p>
          </div>
          <Switch
            checked={settings.allowFallback}
            label={text.fallback}
            disabled={busy}
            onChange={next => save({ allowFallback: next })}
          />
        </header>
      </article>
    </section>
  )
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.provide(GIT_COMMIT_CLIENT_SERVICE, { active: true })
  ctx.effect(() => client.locale.register(NS, { zh: { ...zh }, en: { ...en } }), 'git-commit.locale')
  // One stylesheet for both the header popover and the plugin-page settings,
  // so the settings page is styled even when no session header is mounted.
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', name)
    style.textContent = clientCss
    document.head.appendChild(style)
    return () => style.remove()
  }, 'git-commit.styles')
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register(
    { name: 'plugins.bundle.config', key: PLUGIN_NAME },
    () => <GitCommitSettingsPanel client={client} />,
  )), 'git-commit.settings')
  ctx.effect(() => client.slots.inject('conversation.session.header.actions', () => client.slots.register(
    {
      name: 'conversation.session.header.actions',
      id: 'git-commit',
      order: 10,
      locale: NS,
      inject: () => ({
        call: (endpoint: string, payload: unknown) => client.connection.rpc.call(RPC_CHANNEL, endpoint, payload),
      }),
    },
    GitCommitAction,
  )), 'git-commit.slot')
}
