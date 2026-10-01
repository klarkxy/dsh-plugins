import type { Context } from '@deepseek-ai/cordis'
import { useFeatureRefresh, useNativeSeat, type NativeSurfaceClient } from '@klarkxy/dsh-plugin-kit/client-utils'
import {
  modelMenuChoiceKey, modelMenuEffortOptions, parseModelMenuChoiceKey, parseModelMenuChoices,
  type ModelMenuChoice, type ModelMenuRoute,
} from '@klarkxy/dsh-plugin-kit/model-menu'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button, Checkbox, Input, SegmentedTabs, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import {
  MEMORY_RPC_CHANNEL,
  type DreamPlan, type MemoryRecord, type MemorySettings, type MemoryStatus, type RpcResult,
} from './contracts.ts'
import {
  beginMemoryRequest, createMemoryGeneration, disposeMemoryRequest, loadMemoryStatus, memoryRequestStillCurrent,
  peekMemoryStatus, shouldSkipMemoryRefresh, unwrapMemoryResult,
} from './view-lifetime.ts'

export const name = 'dsh-memory-client'
export const inject = ['slots', 'connection', 'remote', 'remote.session', 'sessions', 'locale', 'uiWorkspace', 'uiSession'] as const
export {
  beginMemoryRequest, createMemoryGeneration, disposeMemoryRequest, loadMemoryStatus, memoryRequestStillCurrent,
  peekMemoryStatus, shouldSkipMemoryRefresh, unwrapMemoryResult,
} from './view-lifetime.ts'

type Client = NativeSurfaceClient & {
  connection: {
    rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> }
    generation?: { subscribe(listener: () => void): () => void }
  }
  remote?: { session?: { modelCatalog?: () => Promise<unknown> } }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; key: string }, render: unknown): () => void
  }
}

export type Locale = 'zh' | 'en'
export type SeatProps = { sessionId: string; locale: Locale; hidden: boolean }

export function parseSeatProps(props: unknown): SeatProps {
  const row = props && typeof props === 'object' ? props as Record<string, unknown> : {}
  const nested = row.owner && typeof row.owner === 'object' ? row.owner as Record<string, unknown> : undefined
  const sessionId = typeof row.sessionId === 'string' && row.sessionId
    ? row.sessionId
    : typeof nested?.sessionId === 'string' ? nested.sessionId : ''
  const locale = row.locale === 'en' || nested?.locale === 'en' ? 'en' : 'zh'
  const hidden = row.hidden === true || nested?.hidden === true
  return { sessionId, locale, hidden }
}

export function memoryPanelKey(sessionId: string, locale: Locale): string {
  return `${sessionId}:${locale}`
}

export function chatSummaryTitle(locale: Locale): string {
  return locale === 'en' ? 'Memory' : '记忆'
}

export function candidateAvailabilityLabel(count: number, locale: Locale): string {
  if (count > 0) return locale === 'en' ? `${count} to review` : `${count} 条候选`
  return locale === 'en' ? 'No candidates' : '暂无候选'
}

export function kindLabel(kind: MemoryRecord['kind'], locale: Locale): string {
  const labels: Record<MemoryRecord['kind'], [string, string]> = {
    preference: ['偏好', 'Preference'], 'project-fact': ['项目事实', 'Project fact'], decision: ['决策', 'Decision'],
    vocabulary: ['用语释义', 'Vocabulary'], activity: ['近期状态', 'Recent activity'], lesson: ['经验', 'Method'],
  }
  return labels[kind][locale === 'en' ? 1 : 0]
}

export function statusLabel(status: MemoryRecord['status'], locale: Locale): string {
  const zh: Record<MemoryRecord['status'], string> = {
    candidate: '候选', active: '已生效', rejected: '已拒绝', superseded: '已替代', revoked: '已撤销', deleted: '已删除',
  }
  const en: Record<MemoryRecord['status'], string> = {
    candidate: 'Candidate', active: 'Active', rejected: 'Rejected', superseded: 'Superseded', revoked: 'Revoked', deleted: 'Deleted',
  }
  return locale === 'en' ? en[status] : zh[status]
}

export function canAccept(record: MemoryRecord): boolean { return record.status === 'candidate' }
export function canReject(record: MemoryRecord): boolean { return record.status === 'candidate' }
export function canRevoke(record: MemoryRecord): boolean { return record.status === 'active' }
/** Deleted records are tombstoned server-side; offering delete again would only fail. */
export function canDelete(record: MemoryRecord): boolean { return record.status !== 'deleted' }

export type MemoryStatusFilter = 'current' | 'all'
/** "current" keeps what still matters to the user: records in use and those awaiting review. */
export function matchesStatusFilter(record: MemoryRecord, filter: MemoryStatusFilter): boolean {
  return filter === 'all' || record.status === 'active' || record.status === 'candidate'
}

type MemoryContext = NonNullable<MemoryRecord['context']>

export function activityStatusLabel(status: NonNullable<MemoryContext['activityStatus']>, locale: Locale): string {
  const labels: Record<NonNullable<MemoryContext['activityStatus']>, [string, string]> = {
    planned: ['计划中', 'Planned'], 'in-progress': ['进行中', 'In progress'], blocked: ['受阻', 'Blocked'],
    paused: ['已暂停', 'Paused'], completed: ['已完成', 'Completed'], cancelled: ['已取消', 'Cancelled'],
    unknown: ['状态未知', 'Status unknown'],
  }
  return labels[status][locale === 'en' ? 1 : 0]
}

/** User-facing context line: localized status, the user's own time words, and when it was noted. */
export function contextSummary(context: MemoryContext, locale: Locale): string {
  const parts: string[] = []
  if (context.activityStatus) parts.push(activityStatusLabel(context.activityStatus, locale))
  const eventTime = context.eventTime?.trim()
  if (eventTime && eventTime !== 'unspecified') parts.push(t(locale, `时间：${eventTime}`, `When: ${eventTime}`))
  parts.push(t(locale, '记录于 ', 'Noted ') + new Date(context.observedAt).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN'))
  return parts.join(' · ')
}

/** Raw identifiers stay available, folded, for troubleshooting. */
export function rawContextDetail(context: MemoryContext): string {
  return [
    `subject=${context.subject}`, `domain=${context.domain}`, `key=${context.key}`,
    context.activityStatus ? `activityStatus=${context.activityStatus}` : '',
    context.eventTime ? `eventTime=${context.eventTime}` : '',
  ].filter(Boolean).join(' · ')
}

export function evidenceFallback(item: MemoryRecord['evidence'][number], locale: Locale): string {
  return item.kind === 'manual'
    ? t(locale, '手动添加', 'Added manually')
    : t(locale, `会话消息 #${item.seq}`, `Chat message #${item.seq}`)
}

function t(locale: Locale, zh: string, en: string): string {
  return locale === 'en' ? en : zh
}

export function MemoryChatShell(props: { locale: Locale; candidateCount: number; children?: ReactNode }) {
  return <details className="dsh-memory-chat" data-testid="memory-chat">
    <summary>
      <span className="dsh-ui-heading">{chatSummaryTitle(props.locale)}</span>
      <span className="dsh-ui-hint">{candidateAvailabilityLabel(props.candidateCount, props.locale)}</span>
    </summary>
    <div className="dsh-memory-chat-body dsh-ui-stack">{props.children}</div>
  </details>
}

function MemorySettingsPanel({ client, sessionId, locale }: { client: Client; sessionId: string; locale: Locale }) {
  const gate = useRef(createMemoryGeneration())
  const sessionRef = useRef(sessionId)
  const workRef = useRef<AbortController | null>(null)
  sessionRef.current = sessionId
  const [status, setStatus] = useState<MemoryStatus>()
  const [draft, setDraft] = useState<MemorySettings>()
  const [choices, setChoices] = useState<ModelMenuChoice[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const busyRef = useRef(false)
  const settingsDirty = useRef(false)
  busyRef.current = busy

  useEffect(() => {
    if (typeof document === 'undefined') return
    let live = true
    void client.remote?.session?.modelCatalog?.()
      ?.then(value => { if (live) setChoices(parseModelMenuChoices(value, draft?.dreamModel)) })
      .catch(() => { if (live) setChoices([]) })
    return () => { live = false }
  }, [client, draft?.dreamModel])

  async function rpc(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    const result = await client.connection.rpc.call(MEMORY_RPC_CHANNEL, endpoint, payload, signal)
    unwrapMemoryResult(result as RpcResult<unknown>)
    return result
  }

  useEffect(() => {
    const request = beginMemoryRequest(gate.current, sessionId, workRef.current)
    workRef.current = request.controller
    setError('')
    setNote('')
    void loadMemoryStatus({
      rpc, sessionId: request.sessionId, token: request.token, gate: gate.current, signal: request.signal,
      viewSessionId: () => sessionRef.current,
    }).then(next => {
      if (!next) return
      setStatus(next)
      setDraft(next.settings)
      settingsDirty.current = false
    }).catch(cause => {
      if (!memoryRequestStillCurrent({
        token: request.token, gate: gate.current, signal: request.signal,
        sessionId: request.sessionId, viewSessionId: sessionRef.current,
      })) return
      setError(cause instanceof Error ? cause.message : t(locale, '无法读取记忆设置。', 'Unable to load memory settings.'))
    })
    return () => disposeMemoryRequest(gate.current, workRef.current ?? request.controller)
  }, [client, sessionId, locale])

  useFeatureRefresh(client, sessionId, () => {
    void peekMemoryStatus({
      rpc, sessionId: sessionRef.current, token: gate.current.current(), gate: gate.current,
      viewSessionId: () => sessionRef.current, busy: () => busyRef.current, editing: () => settingsDirty.current,
    }).then(next => {
      if (next) { setStatus(next); setDraft(next.settings) }
    }).catch(() => {})
  }, false, true)

  /** Runs a write, then reloads. `savedNote: false` is a plain reload that reports nothing. */
  async function action(run: (sessionId: string) => Promise<void>, savedNote = true) {
    const request = beginMemoryRequest(gate.current, sessionId, workRef.current)
    workRef.current = request.controller
    setBusy(true); setNote(''); setError('')
    const still = () => memoryRequestStillCurrent({
      token: request.token, gate: gate.current, signal: request.signal,
      sessionId: request.sessionId, viewSessionId: sessionRef.current,
    })
    try {
      await run(request.sessionId)
      const next = await loadMemoryStatus({
        rpc, sessionId: request.sessionId, token: request.token, gate: gate.current, signal: request.signal,
        viewSessionId: () => sessionRef.current,
      })
      if (!next || !still()) return
      setStatus(next)
      setDraft(next.settings)
      settingsDirty.current = false
      if (savedNote) setNote(t(locale, '已保存。', 'Saved.'))
    } catch (cause) {
      if (!still()) return
      setError(cause instanceof Error ? cause.message : t(locale, '操作失败。', 'Operation failed.'))
      const next = await loadMemoryStatus({
        rpc, sessionId: request.sessionId, token: request.token, gate: gate.current, signal: request.signal,
        viewSessionId: () => sessionRef.current,
      }).catch(() => undefined)
      if (next && still()) {
        setStatus(next)
        setDraft(next.settings)
        settingsDirty.current = false
      }
    } finally {
      if (still()) setBusy(false)
    }
  }

  if (!status || !draft) {
    return <section className="dsh-memory-settings dsh-ui-stack">
      {error
        ? <p role="alert" className="dsh-ui-error">{error}</p>
        : <p role="status" className="dsh-ui-hint">{t(locale, '正在读取设置…', 'Loading settings…')}</p>}
      {error && <div className="dsh-ui-actions">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void action(async () => {}, false)}>{t(locale, '重试', 'Retry')}</Button>
      </div>}
    </section>
  }

  return <section className="dsh-memory-settings dsh-ui-stack" data-testid="memory-settings">
    {error && <p role="alert" className="dsh-ui-error">{error}</p>}
    {note && <p role="status" className="dsh-ui-notice">{note}</p>}
    {status.storageFailed && <p role="alert" className="dsh-ui-banner dsh-ui-banner--danger">{t(locale, '保存失败，已保留原内容。', 'Save failed; previous content was kept.')}</p>}
    {!status.aiAvailable && <p className="dsh-ui-banner">{t(locale, '整理需要模型，可在下方选择或设默认对话模型。', 'Organizing needs a model. Pick one below or set a default chat model.')}</p>}
    <article className="dsh-memory-card dsh-ui-card">
      <header className="dsh-ui-toggle-row">
        <div className="dsh-ui-toggle-text">
          <h3 className="dsh-ui-toggle-label">{t(locale, '在回复中使用记忆', 'Use memory in replies')}</h3>
          <p className="dsh-ui-hint">{t(locale, '关闭后回复不再参考记忆，已存条目保留。', 'When off, replies ignore memory. Saved records stay.')}</p>
        </div>
        <Switch
          checked={draft.injectEnabled}
          label={t(locale, '在回复中使用记忆', 'Use memory in replies')}
          disabled={busy}
          onChange={next => void action(async () => {
            await rpc('settings.update', {
              expectedRevision: draft.revision,
              settings: { ...editable(draft), injectEnabled: next },
            })
          })}
        />
      </header>
    </article>
    <article className="dsh-memory-card dsh-ui-card">
      <header className="dsh-ui-toggle-row">
        <div className="dsh-ui-toggle-text">
          <h3 className="dsh-ui-toggle-label">{t(locale, '自动观察与整理', 'Observe and organize automatically')}</h3>
          <p className="dsh-ui-hint">{t(locale, '从你的消息中记下用语和近期状态；做法在经验学习。', 'Notes vocabulary and recent activity from your messages. Methods go to Experience Learning.')}</p>
        </div>
        <Switch
          checked={draft.dreamIdleEnabled}
          label={t(locale, '自动观察与整理', 'Observe and organize automatically')}
          disabled={busy}
          onChange={next => void action(async () => {
            await rpc('settings.update', {
              expectedRevision: draft.revision,
              settings: { ...editable(draft), dreamIdleEnabled: next },
            })
          })}
        />
      </header>
      <p className="dsh-ui-hint">{t(locale, '会话空闲约 15 分钟后开始整理。', 'Organizing starts after about 15 minutes of inactivity.')}</p>
      <ModelSelect
        locale={locale}
        label={t(locale, '整理模型', 'Organizing model')}
        route={draft.dreamModel}
        choices={choices}
        busy={busy}
        onChange={route => { setDraft({ ...draft, dreamModel: route }); void action(async () => {
          await rpc('settings.update', {
            expectedRevision: draft.revision,
            settings: { ...editable(draft), dreamModel: route },
          })
        }) }}
      />
      <ModelSelect
        locale={locale}
        label={t(locale, '观察模型', 'Observation model')}
        route={draft.observeModel}
        choices={choices}
        busy={busy}
        onChange={route => { setDraft({ ...draft, observeModel: route }); void action(async () => {
          await rpc('settings.update', {
            expectedRevision: draft.revision,
            settings: { ...editable(draft), observeModel: route },
          })
        }) }}
      />
      <p className="dsh-ui-hint">{t(locale, '留空则用当前会话模型，再回落到宿主默认对话模型。', 'Leave empty to use the current session model, then the host default chat model.')}</p>
    </article>
  </section>
}

function editable(settings: MemorySettings): Omit<MemorySettings, 'revision'> {
  const { revision: _revision, ...rest } = settings
  return rest
}

/** One purpose's model select: empty choice keeps the shared role/chat-model default. */
function ModelSelect(props: {
  locale: Locale
  label: string
  route: ModelMenuRoute
  choices: ModelMenuChoice[]
  busy: boolean
  onChange: (route: ModelMenuRoute) => void
}) {
  const optionsId = useId()
  const selected = props.choices.find(
    item => item.provider === props.route.provider && item.model === props.route.model,
  )
  const efforts = modelMenuEffortOptions(selected, props.route.reasoningEffort)
  return <>
    <label className="dsh-ui-field" htmlFor={optionsId}>
      <span className="dsh-ui-label">{props.label}</span>
      <select
        id={optionsId}
        className="dsh-ui-select"
        value={modelMenuChoiceKey(props.route.provider, props.route.model)}
        disabled={props.busy}
        onChange={event => {
          const key = event.target.value
          if (!key) { props.onChange({ provider: '', model: '' }); return }
          const parsed = parseModelMenuChoiceKey(key)
          if (parsed) props.onChange(parsed)
        }}
      >
        <option value="">{t(props.locale, '默认模型', 'Default model')}</option>
        {props.choices.map(choice => (
          <option key={modelMenuChoiceKey(choice.provider, choice.model)} value={modelMenuChoiceKey(choice.provider, choice.model)}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
    {selected && efforts.length > 0 && (
      <label className="dsh-ui-field" htmlFor={`${optionsId}-effort`}>
        <span className="dsh-ui-label">{t(props.locale, '思考强度', 'Reasoning effort')}</span>
        <select
          id={`${optionsId}-effort`}
          className="dsh-ui-select"
          value={props.route.reasoningEffort ?? ''}
          disabled={props.busy}
          onChange={event => props.onChange({ ...props.route, reasoningEffort: event.target.value || undefined })}
        >
          <option value="">{t(props.locale, '默认', 'Default')}</option>
          {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
        </select>
      </label>
    )}
  </>
}

function MemoryChatPanel({ client, sessionId, locale }: { client: Client; sessionId: string; locale: Locale }) {
  const formId = useId()
  const gate = useRef(createMemoryGeneration())
  const sessionRef = useRef(sessionId)
  const workRef = useRef<AbortController | null>(null)
  sessionRef.current = sessionId
  const [status, setStatus] = useState<MemoryStatus>()
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [kind, setKind] = useState<MemoryRecord['kind']>('preference')
  const [global, setGlobal] = useState(false)
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<MemoryStatusFilter>('current')
  const busyRef = useRef(false)
  const editingRef = useRef(false)
  busyRef.current = busy
  editingRef.current = editing

  async function rpc(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    const result = await client.connection.rpc.call(MEMORY_RPC_CHANNEL, endpoint, payload, signal)
    unwrapMemoryResult(result as RpcResult<unknown>)
    return result
  }

  useEffect(() => {
    const request = beginMemoryRequest(gate.current, sessionId, workRef.current)
    workRef.current = request.controller
    setError('')
    setNote('')
    void loadMemoryStatus({
      rpc, sessionId: request.sessionId, token: request.token, gate: gate.current, signal: request.signal,
      viewSessionId: () => sessionRef.current,
    }).then(next => {
      if (!next) return
      setStatus(next)
    }).catch(cause => {
      if (!memoryRequestStillCurrent({
        token: request.token, gate: gate.current, signal: request.signal,
        sessionId: request.sessionId, viewSessionId: sessionRef.current,
      })) return
      setError(cause instanceof Error ? cause.message : t(locale, '无法读取记忆。', 'Unable to load memory.'))
    })
    return () => disposeMemoryRequest(gate.current, workRef.current ?? request.controller)
  }, [client, sessionId, locale])

  useFeatureRefresh(client, sessionId, () => {
    void peekMemoryStatus({
      rpc, sessionId: sessionRef.current, token: gate.current.current(), gate: gate.current,
      viewSessionId: () => sessionRef.current, busy: () => busyRef.current, editing: () => editingRef.current,
    }).then(next => { if (next) setStatus(next) }).catch(() => {})
  }, Boolean(status?.runningDreams?.length), Boolean(sessionId))

  /** Resolves true only once the write itself succeeded, so callers can keep drafts on failure. */
  async function action(run: (sessionId: string) => Promise<void>): Promise<boolean> {
    const request = beginMemoryRequest(gate.current, sessionId, workRef.current)
    workRef.current = request.controller
    setBusy(true); setNote(''); setError('')
    const still = () => memoryRequestStillCurrent({
      token: request.token, gate: gate.current, signal: request.signal,
      sessionId: request.sessionId, viewSessionId: sessionRef.current,
    })
    try {
      await run(request.sessionId)
    } catch (cause) {
      if (!still()) return false
      setError(cause instanceof Error ? cause.message : t(locale, '操作失败。', 'Operation failed.'))
      const next = await loadMemoryStatus({
        rpc, sessionId: request.sessionId, token: request.token, gate: gate.current, signal: request.signal,
        viewSessionId: () => sessionRef.current,
      }).catch(() => undefined)
      if (next && still()) setStatus(next)
      if (still()) setBusy(false)
      return false
    }
    try {
      const next = await loadMemoryStatus({
        rpc, sessionId: request.sessionId, token: request.token, gate: gate.current, signal: request.signal,
        viewSessionId: () => sessionRef.current,
      })
      if (next && still()) setStatus(next)
      return true
    } catch (cause) {
      if (still()) setError(cause instanceof Error ? cause.message : t(locale, '无法刷新记忆。', 'Unable to refresh memory.'))
      return true
    } finally {
      if (still()) setBusy(false)
    }
  }

  const records = (status?.records ?? []).filter(record => {
    if (!matchesStatusFilter(record, statusFilter)) return false
    if (!query.trim()) return true
    return `${record.title}\n${record.content}`.toLowerCase().includes(query.trim().toLowerCase())
  })
  const dreams = (status?.dreams ?? []).slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8)
  const candidateCount = (status?.records ?? []).filter(record => record.status === 'candidate').length

  const body = <>
    <header>
      <p className="dsh-ui-hint">{status?.projectId
        ? t(locale, '当前项目', 'This project')
        : t(locale, '无项目目录；全局写入需勾选。', 'No project path; global write must be explicit.')}</p>
    </header>
    {error && <p role="alert" className="dsh-ui-error">{error}</p>}
    {note && <p role="status" className="dsh-ui-notice">{note}</p>}
    <label className="dsh-ui-field">
      <span className="dsh-ui-label">{t(locale, '搜索', 'Search')}</span>
      <Input className="dsh-ui-control" value={query} onChange={event => setQuery(event.target.value)} disabled={busy}
        aria-label={t(locale, '搜索记忆', 'Search memory')} />
    </label>
    <SegmentedTabs<MemoryStatusFilter>
      label={t(locale, '按状态筛选', 'Filter by status')}
      value={statusFilter}
      onChange={setStatusFilter}
      items={[
        { value: 'current', label: t(locale, '有效与候选', 'Active & candidates'), id: `${formId}-tab-current`, panelId: `${formId}-records` },
        { value: 'all', label: t(locale, '全部', 'All'), id: `${formId}-tab-all`, panelId: `${formId}-records` },
      ]}
    />
    <ul className="dsh-memory-list" id={`${formId}-records`} role="tabpanel">
      {records.length === 0 ? <li className="dsh-ui-empty">{query.trim() ? t(locale, '没有匹配条目，试试其他关键词。', 'No matching records. Try other keywords.') : t(locale, '暂无条目，可在下方添加。', 'No records yet. Add one below.')}</li> : records.map(record => (
        <MemoryRow key={record.id} record={record} locale={locale} busy={busy}
          onEditingChange={setEditing}
          onAccept={() => void action(captured => rpc('records.accept', { sessionId: captured, id: record.id, expectedRevision: record.revision }).then(() => { if (sessionRef.current === captured) setNote(t(locale, '已采纳。', 'Accepted.')) }))}
          onReject={() => void action(captured => rpc('records.reject', { sessionId: captured, id: record.id, expectedRevision: record.revision }).then(() => { if (sessionRef.current === captured) setNote(t(locale, '已拒绝。', 'Rejected.')) }))}
          onRevoke={() => void action(captured => rpc('records.revoke', { sessionId: captured, id: record.id, expectedRevision: record.revision }).then(() => { if (sessionRef.current === captured) setNote(t(locale, '已撤销。', 'Revoked.')) }))}
          onDelete={() => void action(captured => rpc('records.remove', { sessionId: captured, id: record.id, expectedRevision: record.revision }).then(() => { if (sessionRef.current === captured) setNote(t(locale, '已删除。', 'Deleted.')) }))}
          onSave={(nextTitle, nextContent) => action(captured => rpc('records.update', { sessionId: captured, id: record.id, expectedRevision: record.revision, title: nextTitle, content: nextContent }).then(() => { if (sessionRef.current === captured) setNote(t(locale, '已更新。', 'Updated.')) }))}
        />
      ))}
    </ul>
    <form className="dsh-memory-add dsh-ui-card" onSubmit={event => {
      event.preventDefault()
      void action(async captured => {
        await rpc('records.create', {
          sessionId: captured, title, content, kind, global,
          evidence: evidence.trim() ? [{ sessionId: captured, seq: 0, kind: 'manual', excerpt: evidence.trim().slice(0, 400) }] : [],
        })
        if (sessionRef.current !== captured) return
        setTitle(''); setContent(''); setEvidence(''); setNote(t(locale, '已添加。', 'Added.'))
      })
    }}>
      <h4 className="dsh-ui-title">{t(locale, '手动添加', 'Add manually')}</h4>
      <label className="dsh-ui-field" htmlFor={formId + '-title'}>
        <span className="dsh-ui-label">{t(locale, '标题', 'Title')}</span>
        <Input className="dsh-ui-control" id={formId + '-title'} value={title} required maxLength={160} disabled={busy}
          onChange={event => setTitle(event.target.value)} />
      </label>
      <label className="dsh-ui-field" htmlFor={formId + '-body'}>
        <span className="dsh-ui-label">{t(locale, '内容', 'Content')}</span>
        <textarea className="dsh-memory-text" id={formId + '-body'} value={content} required maxLength={4000} disabled={busy} rows={3}
          onChange={event => setContent(event.target.value)} />
      </label>
      <label className="dsh-ui-field">
        <span className="dsh-ui-label">{t(locale, '类型', 'Kind')}</span>
        <select className="dsh-ui-select" value={kind} disabled={busy} onChange={event => setKind(event.target.value as MemoryRecord['kind'])}>
          <option value="preference">{kindLabel('preference', locale)}</option>
          <option value="project-fact">{kindLabel('project-fact', locale)}</option>
          <option value="decision">{kindLabel('decision', locale)}</option>
          <option value="vocabulary">{kindLabel('vocabulary', locale)}</option>
          <option value="activity">{kindLabel('activity', locale)}</option>
        </select>
      </label>
      <label className="dsh-ui-field" htmlFor={formId + '-evidence'}>
        <span className="dsh-ui-label">{t(locale, '依据（可选）', 'Evidence (optional)')}</span>
        <Input className="dsh-ui-control" id={formId + '-evidence'} value={evidence} maxLength={400} disabled={busy}
          onChange={event => setEvidence(event.target.value)} />
      </label>
      <Checkbox checked={global} disabled={busy} onChange={setGlobal}
        label={t(locale, '写入全局（跨项目）', 'Write as global')} />
      <div className="dsh-ui-actions">
        <Button type="submit" variant="primary" disabled={busy}>{t(locale, '添加', 'Add')}</Button>
      </div>
    </form>
    <DreamPanel locale={locale} busy={busy} dreams={dreams} running={Boolean(status?.runningDreams?.length)}
      aiAvailable={status?.aiAvailable === true} action={action} rpc={rpc} />
  </>

  return <MemoryChatShell locale={locale} candidateCount={candidateCount}>{body}</MemoryChatShell>
}

function MemoryRow(props: {
  record: MemoryRecord; locale: Locale; busy: boolean
  onEditingChange?: (editing: boolean) => void
  onAccept(): void; onReject(): void; onRevoke(): void; onDelete(): void
  /** Resolves true when the update was stored; the row leaves edit mode only then. */
  onSave(title: string, content: string): Promise<boolean>
}) {
  const { record, locale } = props
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(record.title)
  const [content, setContent] = useState(record.content)
  const scope = record.scope.kind === 'global' ? t(locale, '全局', 'Global') : t(locale, '项目', 'Project')
  function setRowEditing(next: boolean) {
    setEditing(next)
    props.onEditingChange?.(next)
  }
  if (editing) {
    return <li>
      <label className="dsh-ui-field">
        <span className="dsh-ui-label">{t(locale, '标题', 'Title')}</span>
        <Input className="dsh-ui-control" value={title} disabled={props.busy} onChange={event => setTitle(event.target.value)} />
      </label>
      <label className="dsh-ui-field">
        <span className="dsh-ui-label">{t(locale, '内容', 'Content')}</span>
        <textarea className="dsh-memory-text" value={content} disabled={props.busy} rows={3} maxLength={4000} onChange={event => setContent(event.target.value)} />
      </label>
      <div className="dsh-ui-actions">
        <Button variant="primary" size="sm" disabled={props.busy} onClick={() => void props.onSave(title, content).then(saved => { if (saved) setRowEditing(false) })}>{t(locale, '保存', 'Save')}</Button>
        <Button variant="ghost" size="sm" disabled={props.busy} onClick={() => setRowEditing(false)}>{t(locale, '取消', 'Cancel')}</Button>
      </div>
    </li>
  }
  return <li>
    <strong className="dsh-ui-list-name">{record.title}</strong>
    <p className="dsh-ui-list-desc">{kindLabel(record.kind, locale)} · {statusLabel(record.status, locale)} · {scope}</p>
    {record.context && <p className="dsh-ui-list-desc">{contextSummary(record.context, locale)}</p>}
    {record.kind === 'activity' && <p className="dsh-ui-list-desc">{t(locale, '仅代表上次提到的状态，过期不等于已完成。', 'Shows the last reported state only. Expiry does not mean it is done.')}</p>}
    <p className="dsh-ui-wrap">{record.content}</p>
    {record.evidence.length > 0 && <p className="dsh-ui-list-desc">{t(locale, '依据：', 'Evidence: ')}{record.evidence.map(item => item.excerpt ?? evidenceFallback(item, locale)).join(t(locale, '；', '; '))}</p>}
    {record.context && <details className="dsh-memory-raw">
      <summary className="dsh-ui-hint">{t(locale, '原始信息', 'Raw details')}</summary>
      <p className="dsh-ui-hint dsh-ui-wrap">{rawContextDetail(record.context)}</p>
    </details>}
    <div className="dsh-ui-actions">
      {record.status !== 'deleted' && <Button variant="outline" size="sm" disabled={props.busy} onClick={() => { setTitle(record.title); setContent(record.content); setRowEditing(true) }}>{t(locale, '编辑', 'Edit')}</Button>}
      {canAccept(record) && <Button variant="primary" size="sm" disabled={props.busy} onClick={props.onAccept}>{t(locale, '采纳', 'Accept')}</Button>}
      {canReject(record) && <Button variant="outline" size="sm" disabled={props.busy} onClick={props.onReject}>{t(locale, '拒绝', 'Reject')}</Button>}
      {canRevoke(record) && <Button variant="outline" size="sm" disabled={props.busy} onClick={props.onRevoke}>{t(locale, '撤销', 'Revoke')}</Button>}
      {canDelete(record) && <ConfirmButton disabled={props.busy} label={t(locale, '删除', 'Delete')} confirmLabel={t(locale, '确认删除？', 'Confirm delete?')} onConfirm={props.onDelete} />}
    </div>
  </li>
}

function ConfirmButton(props: { label: string; confirmLabel: string; disabled?: boolean; onConfirm(): void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  function disarm() {
    clearTimeout(timer.current)
    setArmed(false)
  }
  return <>
    <Button variant="outline" size="sm" className="dsh-memory-danger" disabled={props.disabled}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          timer.current = setTimeout(() => setArmed(false), 3000)
          return
        }
        disarm()
        props.onConfirm()
      }}
      onBlur={disarm}>{armed ? props.confirmLabel : props.label}</Button>
    {/* Screen readers do not announce a focused button's label change; this does. */}
    <span role="status" className="dsh-memory-sr">{armed ? props.confirmLabel : ''}</span>
  </>
}

export function dreamStatusLabel(plan: DreamPlan, locale: Locale): string {
  if (plan.status === 'applied') return t(locale, '已应用', 'Applied')
  if (plan.status === 'noop') return t(locale, '无变化', 'No change')
  if (plan.status === 'failed' || plan.status === 'stale') return t(locale, '失败', 'Failed')
  if (plan.status === 'cancelled') return t(locale, '已取消', 'Cancelled')
  return plan.proposals.length ? t(locale, '未应用', 'Not applied') : t(locale, '无变化', 'No change')
}

/** Why "Organize now" is disabled, shown next to it; undefined when the button is usable. */
export function organizeBlockedReason(state: { aiAvailable: boolean; running: boolean }, locale: Locale): string | undefined {
  if (state.running) return undefined
  if (!state.aiAvailable) return t(locale, '需要先在上方选择整理模型或设置默认对话模型。', 'Pick an organizing model above or set a default chat model first.')
  return undefined
}

function DreamPanel(props: {
  running: boolean
  locale: Locale; busy: boolean; dreams: DreamPlan[]; aiAvailable: boolean
  action(run: (sessionId: string) => Promise<void>): Promise<boolean>
  rpc(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}) {
  const locale = props.locale
  const hintId = useId()
  const organizeBlocked = organizeBlockedReason({ aiAvailable: props.aiAvailable, running: props.running }, locale)
  return <article className="dsh-memory-dream dsh-ui-card">
    <h4 className="dsh-ui-title">{t(locale, '整理记忆', 'Organize memory')}</h4>
    <p className="dsh-ui-hint">{t(locale, '每天最多一次；不采纳候选，不延长近期状态有效期。', 'At most once a day. Never accepts candidates or extends recent activity validity.')}</p>
    <div className="dsh-ui-actions">
      <Button variant="outline" size="sm" disabled={props.busy || props.running || !props.aiAvailable}
        aria-describedby={organizeBlocked ? hintId : undefined}
        onClick={() => void props.action(async captured => {
          await props.rpc('dream.run', { sessionId: captured })
        })}>{t(locale, '立即整理', 'Organize now')}</Button>
      <span role="status" className="dsh-ui-hint">{props.running ? t(locale, '整理中…', 'Organizing…') : ''}</span>
    </div>
    {organizeBlocked && <p id={hintId} className="dsh-ui-hint">{organizeBlocked}</p>}
    {props.dreams.length > 0 && <ul className="dsh-memory-dreams">
      {props.dreams.map(plan => (
        <li key={plan.id}>
          <strong className="dsh-ui-compact">{dreamStatusLabel(plan, locale)}</strong>{' '}
          <span className="dsh-ui-hint">{new Date(plan.createdAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</span>
          {plan.proposals.length > 0 && <p className="dsh-ui-hint">{plan.proposals.map(proposal => proposal.title).join('、')}</p>}
          {plan.error && <p className="dsh-ui-error">{plan.error}</p>}
        </li>
      ))}
    </ul>}
  </article>
}

/** Experience Learning is present when it provides its review service; its own plugin page owns the review UI. */
function hasSelfImprovement(host: unknown): boolean {
  if (!host || typeof host !== 'object') return false
  const context = host as { get?: (name: string) => unknown }
  if (typeof context.get !== 'function') return false
  try { return Boolean(context.get('dshSelfImprovementReview')) } catch { return false }
}

export function MemorySettings({ client, host, props }: { client: Client; host?: unknown; props: unknown }) {
  const seat = useNativeSeat(client, props)
  return <div className="dsh-memory-settings-root dsh-ui-panel" data-testid="memory-settings-root">
    <MemorySettingsPanel key={`settings:${memoryPanelKey(seat.sessionId, seat.locale)}`} client={client} sessionId={seat.sessionId} locale={seat.locale} />
    {hasSelfImprovement(host) && <p className="dsh-ui-hint" data-testid="self-improvement-entry">
      {t(seat.locale, '做事方法和技能在“经验学习”插件页审阅。', 'Review methods and skills on the Experience Learning page.')}
    </p>}
    {seat.sessionId && !seat.hidden
      ? <MemoryChatPanel key={`manage:${memoryPanelKey(seat.sessionId, seat.locale)}`} client={client} sessionId={seat.sessionId} locale={seat.locale} />
      : <p className="dsh-ui-hint">{t(seat.locale, '选择会话后可管理其记忆。', 'Select a session to manage its memory.')}</p>}
  </div>
}

const css = `${officialUiCss('dsh-memory-settings-root')}
/* Only the pieces the primitives do not cover keep geometry here: the plugin
 * page's measure, the two native disclosure headers, the record list, and the
 * multi-line field, which has no primitive of its own. */
.dsh-memory-settings-root { max-width: 760px; }
.dsh-memory-chat > summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  min-height: 34px;
  cursor: pointer;
  list-style: revert;
}
.dsh-memory-chat-body { margin-top: 8px; }
.dsh-memory-raw > summary { cursor: pointer; }
.dsh-memory-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
/* Records read as a list of entries, not as selectable rows, so the hairline
 * between them and the shared type tiers are all this rule needs to add. */
.dsh-memory-list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.dsh-memory-list li { display: grid; gap: 6px; padding: 10px 4px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-memory-dreams { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.dsh-memory-dreams li { display: grid; gap: 2px; overflow-wrap: anywhere; }
/* A multi-line field has no primitive; it takes the same hairline, radius and
 * layer the contract's select uses, and shows focus the same way. */
.dsh-memory-text {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  font: inherit;
  color: var(--dsw-alias-label-primary);
  resize: vertical;
}
.dsh-memory-text:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.dsh-memory-text:disabled { color: var(--dsw-alias-label-tertiary); }
/* The destructive confirm keeps the outline button it is and only takes the
 * error palette, so arming it never invents a second button family. */
.dsh-memory-danger { color: var(--dsw-alias-state-error-primary); }
.dsh-memory-danger:hover:not(:disabled) {
  border-color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover-danger);
}
`

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-memory')
    style.textContent = css
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-memory.styles')
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register({
    name: 'plugins.bundle.config', key: '@klarkxy/dsh-memory',
  }, (props: unknown) => <MemorySettings client={client} host={ctx} props={props} />)), 'dsh-memory.settings')
}
