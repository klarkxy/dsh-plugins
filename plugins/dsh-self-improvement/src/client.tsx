import type { Context } from '@deepseek-ai/cordis'
import { Button, Checkbox, PathLabel, SegmentedTabs, Tag, type TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import { useFeatureRefresh, useNativeSeat, type NativeSurfaceClient } from '@klarkxy/dsh-plugin-kit/client-utils'
import {
  modelMenuChoiceKey, modelMenuEffortOptions, normalizeModelMenuRoute, parseModelMenuChoiceKey, parseModelMenuChoices,
  type ModelMenuChoice, type ModelMenuRoute,
} from '@klarkxy/dsh-plugin-kit/model-menu'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { useEffect, useId, useRef, useState } from 'react'
import {
  MEMORY_UNAVAILABLE_MESSAGE, MEMORY_UNAVAILABLE_MESSAGE_EN,
  SELF_IMPROVEMENT_PLUGIN, SELF_IMPROVEMENT_REVIEW_SERVICE, SELF_IMPROVEMENT_RPC_CHANNEL,
  defaultSettings, type MemoryRecord, type ReviewSnapshot, type RpcResult, type SelfImprovementSettings,
  type SkillRecord,
} from './contracts.ts'
import {
  beginReviewRequest, createReviewGeneration, disposeReviewRequest, exportSkillIfCurrent,
  loadReviewSnapshot, peekReviewSnapshot, reviewRequestStillCurrent,
} from './review-lifetime.ts'
import { unwrap } from './rpc-result.ts'
import { exportRevocationCopy, skillExportStateLabel } from './skills.ts'

export const name = 'dsh-self-improvement-client'
export const inject = ['slots', 'connection', 'remote', 'remote.session', 'sessions', 'locale', 'uiWorkspace', 'uiSession'] as const
export { unwrap }
export {
  beginReviewRequest, createReviewGeneration, disposeReviewRequest, exportSkillIfCurrent,
  loadReviewSnapshot, peekReviewSnapshot, reviewRequestStillCurrent, shouldSkipReviewRefresh,
} from './review-lifetime.ts'

type Client = NativeSurfaceClient & {
  connection: {
    rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> }
    generation?: { subscribe(listener: () => void): () => void }
  }
  remote?: { session?: { modelCatalog?: () => Promise<unknown> } }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; id: string; label: string; order: number } | { name: string; key: string }, render: unknown): () => void
  }
}

export type SeatProps = { sessionId: string; locale: 'zh' | 'en'; hidden: boolean }

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

export function memoryUnavailableCopy(locale: 'zh' | 'en'): string {
  return locale === 'en' ? MEMORY_UNAVAILABLE_MESSAGE_EN : MEMORY_UNAVAILABLE_MESSAGE
}

function statusLabel(status: MemoryRecord['status'], locale: 'zh' | 'en'): string {
  const zh = { candidate: '候选', active: '已生效', rejected: '已拒绝', superseded: '已替代', revoked: '已撤销', deleted: '已删除' }
  const en = { candidate: 'Candidate', active: 'Active', rejected: 'Rejected', superseded: 'Superseded', revoked: 'Revoked', deleted: 'Deleted' }
  return (locale === 'en' ? en : zh)[status]
}

export function skillStatusLabel(status: SkillRecord['status'], locale: 'zh' | 'en'): string {
  const zh = { preview: '草稿', accepted: '已接受', rejected: '已拒绝', revoked: '已撤销' }
  const en = { preview: 'Draft', accepted: 'Accepted', rejected: 'Rejected', revoked: 'Revoked' }
  return (locale === 'en' ? en : zh)[status]
}

/** Readable evidence line: where it came from and a short session id instead of the full raw id. */
export function evidenceLabel(ref: MemoryRecord['evidence'][number], locale: 'zh' | 'en'): string {
  const kinds = {
    user: ['你的消息', 'Your message'], tool: ['工具结果', 'Tool result'], turn: ['对话回合', 'Chat turn'], manual: ['手动添加', 'Added manually'],
  } as const
  const kind = kinds[ref.kind]?.[locale === 'en' ? 1 : 0] ?? ref.kind
  if (ref.kind === 'manual') return kind
  const session = ref.sessionId.length > 8 ? ref.sessionId.slice(0, 8) : ref.sessionId
  return locale === 'en' ? `${kind} #${ref.seq} · session ${session}` : `${kind} #${ref.seq} · 会话 ${session}`
}

/** A record's lifecycle reads as a state, so it wears the tag of that state. */
function statusTone(status: MemoryRecord['status'] | SkillRecord['status']): TagTone {
  switch (status) {
    case 'active':
    case 'accepted': return 'success'
    case 'candidate':
    case 'preview': return 'info'
    case 'rejected': return 'warning'
    case 'revoked': return 'danger'
    default: return 'quiet'
  }
}

const emptySnapshot = (): ReviewSnapshot => ({
  memoryAvailable: false, memoryMessage: MEMORY_UNAVAILABLE_MESSAGE,
  generation: 0, storageFailed: false, lessons: [], skills: [],
})

function LessonEvidence({ record, locale }: { record: MemoryRecord; locale: 'zh' | 'en' }) {
  return record.evidence.length === 0
    ? <p className="dsh-ui-hint">{locale === 'en' ? 'No evidence recorded.' : '没有记录依据。'}</p>
    : <ul className="si-evidence" aria-label={locale === 'en' ? 'Evidence' : '依据'}>
      {record.evidence.map(ref => (
        <li key={`${ref.sessionId}:${ref.seq}:${ref.kind}`} title={`${ref.kind} · ${ref.sessionId}#${ref.seq}`}>
          {evidenceLabel(ref, locale)}{ref.excerpt ? ` — ${ref.excerpt}` : ''}
        </li>
      ))}
    </ul>
}

function ConfirmButton(props: { label: string; confirmLabel: string; disabled?: boolean; onConfirm(): void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  function disarm() {
    clearTimeout(timer.current)
    setArmed(false)
  }
  return <Button variant="outline" size="sm" className="si-danger" disabled={props.disabled} data-armed={armed || undefined}
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
}

function LessonList(props: {
  lessons: MemoryRecord[]
  locale: 'zh' | 'en'
  busy: boolean
  projectId?: string
  onAccept(record: MemoryRecord): void
  onPromote(record: MemoryRecord): void
  onReject(record: MemoryRecord): void
  onRevoke(record: MemoryRecord): void
}) {
  const { lessons, locale, busy, projectId, onAccept, onPromote, onReject, onRevoke } = props
  if (lessons.length === 0) {
    return <p className="dsh-ui-empty">{locale === 'en' ? 'No methods yet.' : '还没有经验。'}</p>
  }
  return <ol className="si-list">
    {lessons.map(record => {
      const candidate = record.status === 'candidate'
      const active = record.status === 'active'
      const foreignProject = record.scope.kind === 'project' && Boolean(projectId) && record.scope.projectId !== projectId
      const scope = record.scope.kind === 'global'
        ? (locale === 'en' ? 'Global' : '全局')
        : <PathLabel path={record.scope.projectId} className="dsh-ui-truncate" />
      return <li key={record.id} className="si-card dsh-ui-card dsh-ui-card--flat" data-status={record.status}>
        <header className="dsh-ui-row-wrap">
          <h3 className="dsh-ui-title">{record.title}</h3>
          <span className="dsh-ui-row">
            <Tag tone={statusTone(record.status)}>{statusLabel(record.status, locale)}</Tag>
            <span className="dsh-ui-meta dsh-ui-row">· {scope}</span>
          </span>
        </header>
        <p className="dsh-ui-compact dsh-ui-wrap">{record.content}</p>
        <LessonEvidence record={record} locale={locale} />
        <div className="dsh-ui-actions">
          {candidate && !foreignProject ? <Button variant="outline" size="sm" disabled={busy} onClick={() => onAccept(record)}>
            {locale === 'en' ? 'Accept in this scope' : '按当前范围采纳'}
          </Button> : null}
          {active && record.scope.kind === 'project' && !foreignProject ? <Button variant="outline" size="sm" disabled={busy} onClick={() => onPromote(record)}>
            {locale === 'en' ? 'Promote to global' : '提升为全局'}
          </Button> : null}
          {candidate ? <ConfirmButton disabled={busy}
            label={locale === 'en' ? 'Reject' : '拒绝'}
            confirmLabel={locale === 'en' ? 'Confirm reject?' : '确认拒绝？'}
            onConfirm={() => onReject(record)} /> : null}
          {active ? <ConfirmButton disabled={busy}
            label={locale === 'en' ? 'Revoke' : '撤销'}
            confirmLabel={locale === 'en' ? 'Confirm revoke?' : '确认撤销？'}
            onConfirm={() => onRevoke(record)} /> : null}
          {foreignProject
            ? <p className="dsh-ui-hint">{locale === 'en' ? 'From another project; it can’t be changed here.' : '来自其他项目的经验，此处不能操作。'}</p>
            : null}
        </div>
      </li>
    })}
  </ol>
}

function SkillList(props: {
  skills: SkillRecord[]
  locale: 'zh' | 'en'
  busy: boolean
  onAccept(record: SkillRecord): void
  onReject(record: SkillRecord): void
  onRevoke(record: SkillRecord): void
  onExport(record: SkillRecord): void
  onUnexport(record: SkillRecord): void
}) {
  const { skills, locale, busy } = props
  if (skills.length === 0) {
    return <p className="dsh-ui-empty">{locale === 'en' ? 'No skill drafts.' : '没有技能草稿。'}</p>
  }
  return <ol className="si-list">
    {skills.map(record => (
      <li key={record.id} className="si-card dsh-ui-card dsh-ui-card--flat" data-skill-status={record.status} data-export={record.exportState}>
        <header className="dsh-ui-row-wrap">
          <h3 className="dsh-ui-title">{record.title}</h3>
          <span className="dsh-ui-row">
            <Tag tone={statusTone(record.status)}>{skillStatusLabel(record.status, locale)}</Tag>
            <span className="dsh-ui-meta">· {skillExportStateLabel(record, locale)}</span>
          </span>
        </header>
        <pre className="dsh-ui-code si-preview">{record.markdown}</pre>
        <div className="dsh-ui-actions">
          {record.status === 'preview' ? <Button variant="outline" size="sm" disabled={busy} onClick={() => props.onAccept(record)}>
            {locale === 'en' ? 'Accept draft' : '接受草稿'}
          </Button> : null}
          {record.status === 'preview' ? <ConfirmButton disabled={busy}
            label={locale === 'en' ? 'Reject draft' : '拒绝草稿'}
            confirmLabel={locale === 'en' ? 'Confirm reject?' : '确认拒绝？'}
            onConfirm={() => props.onReject(record)} /> : null}
          {record.status === 'accepted' || record.status === 'preview' ? <Button variant="outline" size="sm" disabled={busy} onClick={() => props.onExport(record)}>
            {locale === 'en' ? 'Download Markdown' : '下载 Markdown'}
          </Button> : null}
          {record.exportState === 'recorded' ? <ConfirmButton disabled={busy}
            label={locale === 'en' ? 'Revoke download record' : '撤销下载记录'}
            confirmLabel={locale === 'en' ? 'Confirm revoke?' : '确认撤销？'}
            onConfirm={() => props.onUnexport(record)} /> : null}
          {record.status === 'accepted' ? <ConfirmButton disabled={busy}
            label={locale === 'en' ? 'Revoke skill' : '撤销技能'}
            confirmLabel={locale === 'en' ? 'Confirm revoke?' : '确认撤销？'}
            onConfirm={() => props.onRevoke(record)} /> : null}
        </div>
      </li>
    ))}
  </ol>
}

export function ReviewPanel({ client, sessionId, locale }: {
  client: Client
  sessionId: string
  locale: 'zh' | 'en'
}) {
  const tabsId = useId()
  const gate = useRef(createReviewGeneration())
  const sessionRef = useRef(sessionId)
  const workRef = useRef<AbortController | null>(null)
  sessionRef.current = sessionId
  const [tab, setTab] = useState<'lessons' | 'skills'>('lessons')
  const [snapshot, setSnapshot] = useState<ReviewSnapshot>()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const busyRef = useRef(false)
  busyRef.current = busy

  function rpc(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    return client.connection.rpc.call(SELF_IMPROVEMENT_RPC_CHANNEL, endpoint, payload, signal)
  }
  async function call<T>(endpoint: string, payload: unknown = {}): Promise<T> {
    return unwrap(await rpc(endpoint, payload) as RpcResult<T>)
  }

  useEffect(() => {
    const request = beginReviewRequest(gate.current, sessionId, workRef.current)
    workRef.current = request.controller
    setError('')
    setNote('')
    void loadReviewSnapshot({
      rpc,
      sessionId: request.sessionId,
      token: request.token,
      gate: gate.current,
      signal: request.signal,
      viewSessionId: () => sessionRef.current,
    }).then(next => {
      if (next === undefined) return
      setSnapshot(next)
    }).catch(cause => {
      if (!reviewRequestStillCurrent({
        token: request.token,
        gate: gate.current,
        signal: request.signal,
        sessionId: request.sessionId,
        viewSessionId: sessionRef.current,
      })) return
      setError(cause instanceof Error ? cause.message : (locale === 'en' ? 'Unable to read Experience Learning state.' : '无法读取经验学习状态。'))
    })
    return () => disposeReviewRequest(gate.current, workRef.current ?? request.controller)
  }, [client, sessionId, locale])

  useFeatureRefresh(client, sessionId, () => {
    void peekReviewSnapshot({
      rpc, sessionId: sessionRef.current, token: gate.current.current(), gate: gate.current,
      viewSessionId: () => sessionRef.current, busy: () => busyRef.current, editing: () => false,
    }).then(next => { if (next) setSnapshot(next) }).catch(() => {})
  }, snapshot?.extracting === true, true)

  async function action(run: (ctx: { sessionId: string; token: number; signal: AbortSignal }) => Promise<void>) {
    const request = beginReviewRequest(gate.current, sessionId, workRef.current)
    workRef.current = request.controller
    setBusy(true); setNote(''); setError('')
    const still = () => reviewRequestStillCurrent({
      token: request.token,
      gate: gate.current,
      signal: request.signal,
      sessionId: request.sessionId,
      viewSessionId: sessionRef.current,
    })
    try {
      await run({ sessionId: request.sessionId, token: request.token, signal: request.signal })
    } catch (cause) {
      if (!still()) return
      setError(cause instanceof Error ? cause.message : (locale === 'en' ? 'Action failed.' : '操作失败。'))
      const next = await loadReviewSnapshot({
        rpc,
        sessionId: request.sessionId,
        token: request.token,
        gate: gate.current,
        signal: request.signal,
        viewSessionId: () => sessionRef.current,
      }).catch(() => undefined)
      if (next && still()) setSnapshot(next)
    } finally {
      if (still()) setBusy(false)
    }
  }

  const data = snapshot ?? emptySnapshot()
  const visibleLessons = data.lessons

  const body = <>
    {error ? <p role="alert" className="dsh-ui-error dsh-ui-wrap">{error}</p> : null}
    {note ? <p role="status" className="dsh-ui-notice">{note}</p> : null}
    {data.storageFailed ? <p role="alert" className="dsh-ui-banner dsh-ui-banner--danger">{locale === 'en' ? 'Save failed; previous state was kept.' : '保存失败，已保留上一次成功的状态。'}</p> : null}
    {data.memoryAvailable ? null : <p role="alert" className="dsh-ui-banner dsh-ui-banner--danger">{memoryUnavailableCopy(locale)}</p>}
    <SegmentedTabs<'lessons' | 'skills'>
      value={tab}
      onChange={setTab}
      label={locale === 'en' ? 'Experience Learning' : '经验学习'}
      items={[
        {
          value: 'lessons',
          label: locale === 'en' ? 'Methods' : '经验',
          id: `${tabsId}-lessons-tab`,
          panelId: `${tabsId}-lessons-panel`,
        },
        {
          value: 'skills',
          label: locale === 'en' ? 'Skills' : '技能草稿',
          id: `${tabsId}-skills-tab`,
          panelId: `${tabsId}-skills-panel`,
        },
      ]}
    />
    <div role="tabpanel" id={`${tabsId}-lessons-panel`}
      aria-labelledby={`${tabsId}-lessons-tab`} hidden={tab !== 'lessons'} tabIndex={0}>
      <p className="dsh-ui-help">{locale === 'en'
        ? 'Methods you ask for directly take effect right away. Methods learned from outcomes stay as candidates until you accept them. Vocabulary and recent activity are kept by Long-term Memory.'
        : '你明确要求的做法会直接生效；从结果中观察到的做法先作为候选，采纳后才会使用。用语和近期状态由长期记忆管理。'}</p>
      {sessionId ? <div className="dsh-ui-actions"><Button variant="primary" size="md" disabled={busy || !data.memoryAvailable} onClick={() => void action(async ctx => {
        if (!reviewRequestStillCurrent({
          token: ctx.token, gate: gate.current, signal: ctx.signal, sessionId: ctx.sessionId, viewSessionId: sessionRef.current,
        })) return
        await call('extract', { sessionId: ctx.sessionId })
        const next = await loadReviewSnapshot({
          rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
        })
        if (!next) return
        setSnapshot(next)
        setNote(locale === 'en' ? 'Extracted from this session when evidence was sufficient.' : '已按明确依据尝试摘录。')
      })}>{locale === 'en' ? 'Extract from this session' : '从本会话摘录'}</Button></div> : null}
      <LessonList
        lessons={visibleLessons}
        locale={locale}
        busy={busy || !data.memoryAvailable}
        projectId={data.projectId}
        onAccept={record => void action(async ctx => {
          await call('accept', { id: record.id, expectedRevision: record.revision, scope: 'project', sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
        onPromote={record => void action(async ctx => {
          await call('accept', { id: record.id, expectedRevision: record.revision, scope: 'global', sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
        onReject={record => void action(async ctx => {
          await call('reject', { id: record.id, expectedRevision: record.revision, sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
        onRevoke={record => void action(async ctx => {
          await call('revoke', { id: record.id, expectedRevision: record.revision, sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
      />
    </div>
    <div role="tabpanel" id={`${tabsId}-skills-panel`} aria-labelledby={`${tabsId}-skills-tab`} hidden={tab !== 'skills'} tabIndex={0}>
      {skillManagement()}
    </div>
  </>

  function skillManagement() {
    return <>
      <fieldset className="si-lessons" disabled={busy || !data.memoryAvailable}>
        <legend className="dsh-ui-label">{locale === 'en' ? 'Build a skill draft from active methods' : '从已生效的经验生成技能草稿'}</legend>
        {data.lessons.filter(record => record.status === 'active').map(record => (
          <Checkbox key={record.id} className="si-lesson-option"
            checked={selected.includes(record.id)}
            disabled={busy || !data.memoryAvailable}
            label={record.title}
            onChange={next => setSelected(current => next ? [...current, record.id] : current.filter(id => id !== record.id))} />
        ))}
        {data.lessons.some(record => record.status === 'active') ? null
          : <p className="dsh-ui-hint">{locale === 'en' ? 'No active methods yet.' : '还没有已生效的经验。'}</p>}
      </fieldset>
      <div className="dsh-ui-actions">
        <Button variant="primary" size="md" disabled={busy || selected.length === 0 || !data.memoryAvailable} onClick={() => void action(async ctx => {
          await call('skill.preview', { lessonIds: selected, sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (!next) return
          setSnapshot(next)
          setTab('skills')
        })}>{locale === 'en' ? 'Preview skill Markdown' : '预览技能 Markdown'}</Button>
      </div>
      <SkillList
        skills={data.skills}
        locale={locale}
        busy={busy}
        onAccept={record => void action(async ctx => {
          await call('skill.accept', { id: record.id, expectedRevision: record.revision, sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
        onReject={record => void action(async ctx => {
          await call('skill.reject', { id: record.id, expectedRevision: record.revision, sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
        onRevoke={record => void action(async ctx => {
          await call('skill.revoke', { id: record.id, expectedRevision: record.revision, sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
        onExport={record => void action(async ctx => {
          const result = await exportSkillIfCurrent({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal,
            viewSessionId: () => sessionRef.current, record,
          })
          if (result !== 'recorded') return
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (!next) return
          setSnapshot(next)
          setNote(locale === 'en' ? 'Browser download started. Destination is chosen in the save dialog.' : '已开始浏览器下载，保存位置由系统对话框决定。')
        })}
        onUnexport={record => void action(async ctx => {
          await call('skill.unexport', { id: record.id, expectedRevision: record.revision, sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (!next) return
          setSnapshot(next)
          setNote(exportRevocationCopy(locale))
        })}
      />
    </>
  }

  return <section className="si-settings dsh-ui-panel" data-testid="self-improvement-settings" data-session={sessionId || undefined}>
    {sessionId ? body : <p className="dsh-ui-empty">{locale === 'en'
      ? 'Open a session to review methods for its project.'
      : '打开一个会话后，可审阅该项目的经验。'}</p>}
  </section>
}

/* The contract owns the type tiers, the card, the field, the button row, the
 * banner and the focus ring. What is left is this panel's own geometry: the
 * reading width, the stacked record cards, the evidence indent, the lesson
 * picker's option list and the scroll box around a skill's Markdown. */
const styles = `${officialUiCss('si-root')}
.si-root { max-width: 760px; }
.si-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.si-evidence {
  margin: 0;
  padding-inline-start: 18px;
  display: grid;
  gap: 2px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere;
}
.si-preview { margin: 0; max-height: 240px; overflow: auto; }
.si-lessons {
  margin: 0;
  border: 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding: 12px 0 0;
  display: grid;
  gap: 6px;
  min-width: 0;
}
.si-lessons > legend { padding: 0 8px 0 0; }
.si-lesson-option { padding: 2px 0; }
/* A destructive row only shows its colour once the pointer is on it or the
 * two-step confirmation is armed; the resting appearance stays the outlined
 * one every other action uses. */
.si-danger:hover:not(:disabled),
.si-danger[data-armed] {
  color: var(--dsw-alias-state-error-primary);
  border-color: var(--dsw-alias-state-error-primary);
}
.si-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
`

export function reviewPanelKey(sessionId: string, locale: 'zh' | 'en'): string {
  return `${sessionId}:${locale}`
}

/** Plugin-page model menu for the one extraction purpose this plugin registers. */
export function SelfImprovementModelMenu({ client, locale }: { client: Client; locale: 'zh' | 'en' }) {
  const optionsId = useId()
  const [settings, setSettings] = useState<SelfImprovementSettings>()
  const [choices, setChoices] = useState<ModelMenuChoice[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const route: ModelMenuRoute = settings?.model ?? defaultSettings().model
  const selected = choices.find(item => item.provider === route.provider && item.model === route.model)
  const efforts = modelMenuEffortOptions(selected, route.reasoningEffort)

  // Load once per client/locale. Saving must not refetch: the catalog is parsed
  // against the saved route read here, and later saves only update `settings`.
  useEffect(() => {
    let live = true
    void (async () => {
      let saved: ModelMenuRoute = defaultSettings().model
      try {
        const next = unwrap(await client.connection.rpc.call(SELF_IMPROVEMENT_RPC_CHANNEL, 'settings', {}) as RpcResult<SelfImprovementSettings>)
        if (!live) return
        setSettings(next)
        saved = next.model
      } catch (cause) {
        if (live) setError(cause instanceof Error && cause.message ? cause.message : (locale === 'en' ? 'Unable to load settings.' : '无法读取设置。'))
      }
      try {
        const value = await client.remote?.session?.modelCatalog?.()
        if (live) setChoices(parseModelMenuChoices(value, saved))
      } catch {
        if (live) setChoices([])
      }
    })()
    return () => { live = false }
  }, [client, locale])

  async function save(next: ModelMenuRoute): Promise<void> {
    if (!settings) return
    setBusy(true); setError(''); setNote('')
    try {
      const value = await client.connection.rpc.call(SELF_IMPROVEMENT_RPC_CHANNEL, 'settings.update', {
        expectedRevision: settings.revision, model: normalizeModelMenuRoute(next),
      })
      setSettings(unwrap(value as RpcResult<SelfImprovementSettings>))
      setNote(locale === 'en' ? 'Saved.' : '已保存。')
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : (locale === 'en' ? 'Unable to save settings.' : '无法保存设置。'))
    } finally {
      setBusy(false)
    }
  }

  return <section className="si-model dsh-ui-stack" data-testid="self-improvement-model">
    {error && <p role="alert" className="dsh-ui-error">{error}</p>}
    {note && <p role="status" className="dsh-ui-notice">{note}</p>}
    <label className="dsh-ui-field" htmlFor={optionsId}>
      <span className="dsh-ui-label">{locale === 'en' ? 'Extraction model' : '摘录模型'}</span>
      <select
        id={optionsId}
        className="dsh-ui-select"
        value={modelMenuChoiceKey(route.provider, route.model)}
        disabled={busy || !settings}
        onChange={event => {
          const key = event.target.value
          if (!key) { void save({ provider: '', model: '' }); return }
          const parsed = parseModelMenuChoiceKey(key)
          if (parsed) void save(parsed)
        }}
      >
        <option value="">{locale === 'en' ? 'Default model' : '默认模型'}</option>
        {choices.map(choice => (
          <option key={modelMenuChoiceKey(choice.provider, choice.model)} value={modelMenuChoiceKey(choice.provider, choice.model)}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
    {selected && efforts.length > 0 && (
      <label className="dsh-ui-field" htmlFor={`${optionsId}-effort`}>
        <span className="dsh-ui-label">{locale === 'en' ? 'Reasoning effort' : '思考强度'}</span>
        <select
          id={`${optionsId}-effort`}
          className="dsh-ui-select"
          value={route.reasoningEffort ?? ''}
          disabled={busy}
          onChange={event => void save({ ...route, reasoningEffort: event.target.value || undefined })}
        >
          <option value="">{locale === 'en' ? 'Default' : '默认'}</option>
          {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
        </select>
      </label>
    )}
    <p className="dsh-ui-hint">{locale === 'en'
      ? 'Leave empty to use the current session model, then the host default chat model.'
      : '留空则使用当前会话模型，再回落到宿主默认对话模型。'}</p>
  </section>
}

/** Plugin page seat: the model menu works without a session. */
export function SelfImprovementSettingsSeat({ client }: { client: Client }) {
  const seat = useNativeSeat(client, {})
  return <section className="si-settings si-root dsh-ui-panel" data-testid="self-improvement-settings">
    <SelfImprovementModelMenu client={client} locale={seat.locale} />
    <SelfImprovementSettings client={client} props={{ sessionId: seat.sessionId, locale: seat.locale }} />
  </section>
}

export function SelfImprovementSettings({ client, props }: { client: Client; props: unknown }) {
  const seat = useNativeSeat(client, props)
  return <ReviewPanel key={reviewPanelKey(seat.sessionId, seat.locale)} client={client} sessionId={seat.sessionId} locale={seat.locale} />
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshSelfImprovementReview: { render(props: unknown): unknown }
  }
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.provide(SELF_IMPROVEMENT_REVIEW_SERVICE, {
    render: (props: unknown) => <SelfImprovementSettings client={client} props={props} />,
  })
  ctx.effect(() => client.slots.inject('plugins.bundle.config', () => client.slots.register(
    { name: 'plugins.bundle.config', key: SELF_IMPROVEMENT_PLUGIN },
    () => <SelfImprovementSettingsSeat client={client} />,
  )), 'self-improvement.settings')
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-self-improvement')
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'self-improvement.styles')
}
