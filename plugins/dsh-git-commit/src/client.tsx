import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip, useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  GIT_COMMIT_CLIENT_SERVICE, RPC_CHANNEL, type CommitRunResult, type GitCommitStatus, type RpcResult,
} from './contracts.ts'

export const name = 'dsh-git-commit-client'
export const inject = ['slots', 'connection', 'locale'] as const

const NS = 'dsh-git-commit.action'

const zh = {
  action: '提交',
  title: '提交到 Git',
  commitAction: '分次提交全部工作区修改',
  files: '个文件',
  model: '模型',
  modelDefault: '默认模型',
  modelCustom: 'AI 服务配置',
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
  close: '关闭',
}

const en: Record<keyof typeof zh, string> = {
  action: 'Commit',
  title: 'Commit to Git',
  commitAction: 'Commit all workspace changes',
  files: 'files',
  model: 'Model',
  modelDefault: 'default model',
  modelCustom: 'AI services route',
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

export interface GitCommitActionProps {
  sessionId: string
  useSession: UseSessionLike
  call: (endpoint: string, payload: unknown) => Promise<unknown>
  t: Translate
}

async function rpc<T>(call: GitCommitActionProps['call'], endpoint: string, payload: unknown): Promise<T> {
  const result = await call(endpoint, payload) as RpcResult<T> | undefined
  if (!result || result.ok !== true) {
    throw new Error(result && 'error' in result ? result.error.message : 'request failed')
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
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const generationRef = useRef(0)
  const position = useAnchoredPosition({ open, anchorRef: triggerRef, panelRef, gap: 5, margin: 16 })
  const sessionRunning = useSession(snapshot => snapshot.running === true)

  const changeOpen = useCallback((next: boolean) => {
    setOpen(next)
    if (next) {
      setResult(null)
      setError(null)
    }
  }, [])

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
      const next = await rpc<GitCommitStatus>(call, 'status', { sessionId })
      if (generationRef.current !== generation) return
      setStatus(next)
    } catch (reason) {
      if (generationRef.current !== generation) return
      setStatus(undefined)
      setError(reason instanceof Error ? reason.message : String(reason))
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
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      const value = await rpc<CommitRunResult>(call, 'commit', { sessionId })
      if (generationRef.current !== generation) return
      setResult(value)
      const next = await rpc<GitCommitStatus>(call, 'status', { sessionId }).catch(() => undefined)
      if (generationRef.current !== generation) return
      if (next) setStatus(next)
    } catch (reason) {
      if (generationRef.current !== generation) return
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (generationRef.current === generation) setRunning(false)
    }
  }, [call, sessionId])

  const available = status?.available === true
  const workspaceCount = status?.workspace.files ?? 0
  const canCommit = available && !running && !sessionRunning && workspaceCount > 0
  const modelLabel = status?.model
    ? `${status.model.provider}/${status.model.model} · ${status.model.source === 'purpose' || status.model.source === 'override' ? t('modelCustom') : t('modelDefault')}`
    : undefined

  return (
    <div ref={rootRef} className="gcm-root">
      <style>{css}</style>
      <Tooltip label={t('title')} side="bottom" gap={4}>
        <button
          type="button"
          ref={triggerRef}
          className="gcm-trigger"
          aria-label={t('title')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => changeOpen(!open)}
        >
          <GitBranchIcon />
          <span className="gcm-triggerLabel">{t('action')}</span>
        </button>
      </Tooltip>
      {open && createPortal(
        <div
          ref={panelRef}
          className="gcm-panel"
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="dialog"
          tabIndex={-1}
          aria-label={t('title')}
        >
          <div className="gcm-body">
            <div className="gcm-header">
              <span className="gcm-title">{t('title')}</span>
              {status?.branch ? <span className="gcm-branch">{status.branch}</span> : null}
              <button type="button" className="gcm-iconButton" aria-label={t('refresh')}
                disabled={loading || running} onClick={() => void loadStatus()}>⟳</button>
            </div>
            {error !== null && <p className="gcm-error" role="alert">{error}</p>}
            {status && !available && <p className="gcm-notice" role="status">{reasonText(t, status)}</p>}
            {available && (
              <>
                {modelLabel ? <p className="gcm-meta">{t('model')}: {modelLabel}</p> : null}
                <button type="button" className="gcm-action gcm-primary"
                  disabled={!canCommit}
                  onClick={() => void runCommit()}>
                  {t('commitAction')}（{workspaceCount} {t('files')}）
                </button>
                {workspaceCount === 0 && <p className="gcm-notice">{t('noWorkspace')}</p>}
                {sessionRunning && <p className="gcm-notice">{t('sessionRunning')}</p>}
              </>
            )}
            {running && <p className="gcm-notice" role="status">{t('running')}</p>}
            {result && (
              <div className="gcm-result">
                <p className="gcm-meta">{t('done')} · {result.branch}</p>
                <ul className="gcm-commits">
                  {result.commits.map(commit => (
                    <li key={commit.hash || commit.message}>
                      <code>{commit.hash}</code> {commit.message}
                    </li>
                  ))}
                </ul>
                {result.fallback && <p className="gcm-notice">{t('fallback')}</p>}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

const css = `
.gcm-root{position:relative;display:inline-flex}
.gcm-trigger{min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:none;border:0;border-radius:6px;align-items:center;gap:5px;padding:3px 7px;font-size:12px;display:inline-flex}
.gcm-trigger:hover,.gcm-trigger:focus-visible{color:var(--dsw-alias-label-primary)}
.gcm-triggerLabel{white-space:nowrap}
.gcm-panel{--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);z-index:100;box-sizing:border-box;width:min(360px,100vw - 32px);max-height:min(560px,100vh - 32px);box-shadow:var(--dsw-elevation-prominent);border:0;border-radius:12px;display:flex;flex-direction:column;position:fixed;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;font-family:var(--default-font-family,system-ui,sans-serif)}
.gcm-panel::before{content:"";z-index:-1;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);border-radius:12px;position:absolute;inset:0}
.gcm-body{display:grid;gap:8px;padding:12px 14px 14px;overflow-y:auto}
.gcm-header{display:flex;align-items:center;gap:8px}
.gcm-title{font-weight:600}
.gcm-branch{color:var(--dsw-alias-label-caption);overflow-wrap:anywhere;font-size:12px}
.gcm-iconButton{margin-left:auto;border:0;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;padding:2px 6px;border-radius:6px}
.gcm-iconButton:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.gcm-iconButton:disabled{opacity:.45;cursor:not-allowed}
.gcm-action{--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);display:block;width:100%;text-align:left;padding:7px 10px;border:0;box-shadow:var(--dsw-elevation-stroke);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.gcm-action:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.gcm-action:disabled{opacity:.45;cursor:not-allowed}
.gcm-primary{--dsw-elevation-stroke-color:var(--dsw-alias-brand-primary)}
.gcm-meta{margin:0;font-size:12px;color:var(--dsw-alias-label-caption);overflow-wrap:anywhere}
.gcm-notice{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.gcm-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary)}
.gcm-result{display:grid;gap:4px}
.gcm-commits{margin:0;padding-left:18px;display:grid;gap:2px;font-size:12px;overflow-wrap:anywhere}
.gcm-commits code{font-size:12px;background:var(--dsw-alias-bg-layer-2);padding:0 4px;border-radius:4px}
`

declare module '@deepseek-ai/cordis' {
  interface Context { dshGitCommitClient: { active: boolean } }
}

type Client = Context & {
  connection: ConnectionLike
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; id: string; order: number; locale: string; inject: () => unknown }, render: unknown): () => void
  }
  locale: { register(ns: string, locales: { zh: Record<string, string>; en: Record<string, string> }): () => void }
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.provide(GIT_COMMIT_CLIENT_SERVICE, { active: true })
  ctx.effect(() => client.locale.register(NS, { zh: { ...zh }, en: { ...en } }), 'git-commit.locale')
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
