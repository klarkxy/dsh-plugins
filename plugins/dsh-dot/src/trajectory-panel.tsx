/**
 * dot's trajectory: her session as DSH's trajectory view reads one, turn by
 * turn and step by step, with each step's model, time to first token, duration
 * and tokens, and every input, reasoning, reply, tool call and compaction in
 * log order. It refreshes when dot's chat moves and while a turn runs.
 */
import { Button, Checkbox, IconSearchOutlineRegular, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ReflectionRun, TrajectoryView, TrajRecord, TrajStep, TrajTurn } from './contracts.ts'
import { turnTotals } from './trajectory.ts'
import { formatDuration, formatTokens, formatWhen, t, toolLabel, type CopyLocale, type TextKey } from './ui-copy.ts'

const RUNNING_POLL_MS = 3_000

export interface TrajectoryApi {
  trajectory(signal: AbortSignal): Promise<TrajectoryView>
  /** Archived background reflection passes, oldest first (at most 30). */
  reflectionRuns(signal: AbortSignal): Promise<readonly ReflectionRun[]>
  /** Trajectory of one archived reflection session. */
  reflectionTrajectory(sessionId: string, signal: AbortSignal): Promise<TrajectoryView>
}

function useTrajectory(api: TrajectoryApi, rev: number | undefined, running: boolean): { view?: TrajectoryView; error?: string } {
  const [state, setState] = useState<{ view?: TrajectoryView; error?: string }>({})
  useEffect(() => {
    const lifetime = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      api.trajectory(lifetime.signal).then(
        view => { if (!lifetime.signal.aborted) setState({ view }) },
        failure => { if (!lifetime.signal.aborted) setState(prev => ({ ...prev, error: failure instanceof Error ? failure.message : String(failure) })) },
      ).finally(() => { if (!lifetime.signal.aborted && running) timer = setTimeout(run, RUNNING_POLL_MS) })
    }
    run()
    return () => { lifetime.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [api, rev, running])
  return state
}

const clock = (locale: CopyLocale, at: number) => new Date(at).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

const INPUT_LABEL: Record<Extract<TrajRecord, { kind: 'input' }>['source'], TextKey> = {
  user: 'trUser', answer: 'trAnswer', relay: 'trRelay', context: 'trContext', notice: 'trNotice',
}

function recordLabel(record: TrajRecord): TextKey {
  switch (record.kind) {
    case 'input': return INPUT_LABEL[record.source]
    case 'reasoning': return 'trReasoning'
    case 'text': return 'trReply'
    case 'call': return 'trCall'
    case 'compaction': return 'trCompaction'
  }
}

function recordText(locale: CopyLocale, record: TrajRecord): string {
  switch (record.kind) {
    case 'call': {
      const label = toolLabel(locale, record.name)
      return label !== record.name ? `${label} · ${record.name}` : record.name
    }
    default: return record.text
  }
}

/** Lower-case haystack of a record for the search box. */
function haystack(locale: CopyLocale, record: TrajRecord): string {
  return (record.kind === 'call' ? `${toolLabel(locale, record.name)}\n${record.name}\n${record.args}\n${record.result ?? ''}` : record.text).toLowerCase()
}

function prettyJson(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

function Record({ locale, record, open, onToggle }: { locale: CopyLocale; record: TrajRecord; open: boolean; onToggle: () => void }) {
  const status = record.kind === 'call' ? record.status : undefined
  const preview = recordText(locale, record).replace(/\s+/g, ' ')
  const took = record.kind === 'call' && record.endedAt !== undefined ? formatDuration(record.endedAt - record.at) : undefined
  return (
    <li className="dsh-dot-tr-record" data-kind={record.kind} data-status={status}>
      <button type="button" className="dsh-dot-tr-recordhead lc-br-elem-row" aria-expanded={open} onClick={onToggle}>
        <span className="dsh-dot-tr-tag lc-br-tag">{t(locale, recordLabel(record))}</span>
        <span className="dsh-dot-tr-preview lc-br-preview">{preview}</span>
        {status === 'running' ? <span className="dsh-dot-tr-meta">{t(locale, 'trRunning')}</span> : null}
        {status === 'error' ? <span className="dsh-dot-tr-meta dsh-dot-tr-bad">{t(locale, 'trFailed')}</span> : null}
        {took ? <span className="dsh-dot-tr-meta">{took}</span> : null}
        {record.kind === 'compaction' && record.shadowed !== undefined ? <span className="dsh-dot-tr-meta">−{formatTokens(record.shadowed)}</span> : null}
        <span className="dsh-dot-tr-time lc-br-time">{clock(locale, record.at)}</span>
      </button>
      {open ? (
        <div className="dsh-dot-tr-body">
          {record.kind === 'call' ? (
            <>
              <span className="dsh-dot-tr-sub">{t(locale, 'trArgs')}</span>
              <pre className="dsh-dot-tr-pre">{prettyJson(record.args)}{record.argsClipped ? '\n…' : ''}</pre>
              {record.result !== undefined ? (
                <>
                  <span className="dsh-dot-tr-sub">{t(locale, 'trResult')}</span>
                  <pre className="dsh-dot-tr-pre">{record.result || t(locale, 'trEmpty')}{record.resultClipped ? '\n…' : ''}</pre>
                </>
              ) : null}
            </>
          ) : <pre className="dsh-dot-tr-pre">{record.text}{record.clipped ? '\n…' : ''}</pre>}
          {(record.kind === 'call' ? record.argsClipped || record.resultClipped : record.clipped) ? <span className="dsh-dot-tr-sub">{t(locale, 'trClipped')}</span> : null}
        </div>
      ) : null}
    </li>
  )
}

function StepBlock({ locale, step, records, openRecords, toggleRecord }: { locale: CopyLocale; step: TrajStep; records: readonly TrajRecord[]; openRecords: ReadonlySet<string>; toggleRecord: (key: string) => void }) {
  const facts: string[] = []
  if (step.model) facts.push(step.model)
  if (step.firstTokenAt !== undefined) facts.push(`${t(locale, 'trTtft')} ${formatDuration(step.firstTokenAt - step.startedAt)}`)
  if (step.endedAt !== undefined) facts.push(formatDuration(step.endedAt - step.startedAt))
  if (step.usage) facts.push(`↑${formatTokens(step.usage.input + step.usage.cacheRead)}${step.usage.cacheRead ? ` (${t(locale, 'trCached')} ${formatTokens(step.usage.cacheRead)})` : ''} ↓${formatTokens(step.usage.output)}`)
  return (
    <div className="dsh-dot-tr-step">
      <div className="dsh-dot-tr-stephead">
        <span className="dsh-dot-tr-steplabel">{t(locale, 'trStep').replace('{n}', String(step.step))}</span>
        <span className="dsh-dot-tr-facts">{facts.join(' · ')}</span>
        {step.endedAt === undefined ? <span className="dsh-dot-tr-meta">{t(locale, 'trRunning')}</span> : null}
      </div>
      {step.failed ? <div className="dsh-dot-tr-error">{step.failed}</div> : null}
      <ul className="dsh-dot-tr-records">
        {records.map(record => {
          const key = String(record.seq) + ':' + (record.kind === 'call' ? record.callId : record.kind)
          return <Record key={key} locale={locale} record={record} open={openRecords.has(key)} onToggle={() => toggleRecord(key)} />
        })}
      </ul>
    </div>
  )
}

function turnEndReason(locale: CopyLocale, end: string | undefined): string {
  if (!end) return ''
  if (end === 'cancelled' || end === 'interrupted' || end === 'aborted') return t(locale, 'trEndCancelled')
  if (end === 'error' || end === 'failed') return t(locale, 'trEndError')
  return end
}

function TurnBlock({ locale, turn, open, onToggle, filter, openRecords, toggleRecord }: { locale: CopyLocale; turn: TrajTurn; open: boolean; onToggle: () => void; filter: (records: readonly TrajRecord[]) => readonly TrajRecord[]; openRecords: ReadonlySet<string>; toggleRecord: (key: string) => void }) {
  const totals = turnTotals(turn)
  const facts: string[] = [t(locale, 'trSteps').replace('{n}', String(totals.steps))]
  if (totals.calls) facts.push(t(locale, 'trCalls').replace('{n}', String(totals.calls)))
  if (turn.endedAt !== undefined) facts.push(formatDuration(turn.endedAt - turn.startedAt))
  if (totals.usage) facts.push(`↑${formatTokens(totals.usage.input + totals.usage.cacheRead)} ↓${formatTokens(totals.usage.output)}`)
  const lead = filter(turn.records)
  const steps = turn.steps.map(step => ({ step, records: filter(step.records) }))
  const state = turn.end === undefined ? 'running' : turn.end === 'completed' ? 'done' : 'error'
  return (
    <section className="dsh-dot-tr-turn" data-state={state}>
      <button type="button" className="dsh-dot-tr-turnhead" aria-expanded={open} onClick={onToggle}>
        <span className="dsh-dot-tr-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="dsh-dot-tr-turnlabel">{t(locale, 'trTurn').replace('{n}', String(turn.turn))}</span>
        <span className="dsh-dot-tr-time">{clock(locale, turn.startedAt)}</span>
        <span className="dsh-dot-tr-facts">{facts.join(' · ')}</span>
        <span className="dsh-dot-tr-end">{state === 'running' ? t(locale, 'trRunning') : state === 'error' ? t(locale, 'trEnded').replace('{reason}', turnEndReason(locale, turn.end)) : ''}</span>
      </button>
      {open ? (
        <div className="dsh-dot-tr-turnbody">
          {turn.error ? <div className="dsh-dot-tr-error">{turn.error}</div> : null}
          {lead.length ? <ul className="dsh-dot-tr-records">{lead.map(record => {
            const key = String(record.seq) + ':' + record.kind
            return <Record key={key} locale={locale} record={record} open={openRecords.has(key)} onToggle={() => toggleRecord(key)} />
          })}</ul> : null}
          {steps.map(({ step, records }) => <StepBlock key={step.step} locale={locale} step={step} records={records} openRecords={openRecords} toggleRecord={toggleRecord} />)}
        </div>
      ) : null}
    </section>
  )
}

/** Compact list of archived reflection passes; picking one shows its trajectory. */
function ReflectionRuns({ locale, runs, error, selected, onPick }: {
  locale: CopyLocale
  runs?: readonly ReflectionRun[]
  error?: string
  selected?: string
  onPick: (sessionId: string) => void
}) {
  return (
    <div className="dsh-dot-tr-reflections" aria-label={t(locale, 'trReflection')}>
      {error ? <div className="dsh-ui-error">{t(locale, 'trFailedLoad')}{error}</div> : null}
      {runs === undefined && !error ? <div className="dsh-ui-empty">{t(locale, 'trLoading')}</div> : null}
      {runs?.length === 0 ? <div className="dsh-ui-empty">{t(locale, 'trReflectionEmpty')}</div> : null}
      {[...(runs ?? [])].reverse().map(run => (
        <button key={run.sessionId} type="button" className="dsh-dot-tr-run" aria-pressed={selected === run.sessionId} onClick={() => onPick(run.sessionId)}>
          <span className="dsh-dot-tr-time">{formatWhen(run.startedAt)}</span>
          <span className={run.endedAt !== undefined && !run.ok ? 'dsh-dot-tr-meta dsh-dot-tr-bad' : 'dsh-dot-tr-meta'}>
            {run.endedAt === undefined ? t(locale, 'trRunning') : run.ok ? t(locale, 'trReflectionUpdated') : t(locale, 'trFailed')}
          </span>
        </button>
      ))}
    </div>
  )
}

export function TrajectoryPanel({ locale, api, rev, running }: { locale: CopyLocale; api: TrajectoryApi; rev?: number; running: boolean }): ReactNode {
  const { view, error } = useTrajectory(api, rev, running)
  const [query, setQuery] = useState('')
  const [openTurns, setOpenTurns] = useState<ReadonlySet<number> | undefined>()
  const [openRecords, setOpenRecords] = useState<ReadonlySet<string>>(new Set())
  const [showContext, setShowContext] = useState(false)
  const [reflectionOpen, setReflectionOpen] = useState(false)
  const [runs, setRuns] = useState<readonly ReflectionRun[]>()
  const [runsError, setRunsError] = useState<string>()
  const [selected, setSelected] = useState<string>()
  const [archived, setArchived] = useState<TrajectoryView>()
  const [archivedError, setArchivedError] = useState<string>()
  useEffect(() => {
    if (!reflectionOpen) return
    const life = new AbortController()
    api.reflectionRuns(life.signal).then(
      next => { if (!life.signal.aborted) { setRuns(next); setRunsError(undefined) } },
      failure => { if (!life.signal.aborted) setRunsError(failure instanceof Error ? failure.message : String(failure)) },
    )
    return () => life.abort()
  }, [api, reflectionOpen])
  useEffect(() => {
    if (!selected) return
    const life = new AbortController()
    setArchived(undefined)
    setArchivedError(undefined)
    api.reflectionTrajectory(selected, life.signal).then(
      next => { if (!life.signal.aborted) setArchived(next) },
      failure => { if (!life.signal.aborted) setArchivedError(failure instanceof Error ? failure.message : String(failure)) },
    )
    return () => life.abort()
  }, [api, selected])
  // An archived reflection pass uses the same turn view as the live segment.
  const source = selected ? archived : view
  const needle = query.trim().toLowerCase()
  const filter = useCallback((records: readonly TrajRecord[]) => records.filter(record =>
    (showContext || !(record.kind === 'input' && record.source === 'context')) && (!needle || haystack(locale, record).includes(needle))), [locale, needle, showContext])
  const turns = useMemo(() => {
    const all = source?.turns ?? []
    if (!needle) return all
    return all.filter(turn => filter(turn.records).length > 0 || turn.steps.some(step => filter(step.records).length > 0))
  }, [source, needle, filter])
  // The newest turn starts open; a search opens every match.
  const lastTurn = source?.turns.at(-1)?.turn
  const isOpen = (turn: number) => needle ? true : openTurns ? openTurns.has(turn) : turn === lastTurn
  const toggleTurn = (turn: number) => setOpenTurns(prev => {
    const next = new Set(prev ?? (lastTurn !== undefined ? [lastTurn] : []))
    if (next.has(turn)) next.delete(turn); else next.add(turn)
    return next
  })
  const toggleRecord = useCallback((key: string) => setOpenRecords(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  }), [])
  const pick = (sessionId: string) => {
    setSelected(sessionId)
    setOpenTurns(undefined)
    setOpenRecords(new Set())
  }
  const back = () => {
    setSelected(undefined)
    setArchived(undefined)
    setArchivedError(undefined)
    setOpenTurns(undefined)
    setOpenRecords(new Set())
  }
  const toggleReflection = () => {
    if (reflectionOpen) back()
    setReflectionOpen(!reflectionOpen)
  }

  if (!view && !selected) {
    return error
      ? <div className="dsh-dot-tr"><div className="dsh-ui-error" role="alert">{t(locale, 'trFailedLoad')}{error}</div></div>
      : <div className="dsh-dot-tr"><div className="dsh-ui-loading">{t(locale, 'trLoading')}</div></div>
  }
  return (
    <div className="dsh-dot-tr">
      <div className="dsh-dot-tr-toolbar">
        <Input
          className="dsh-dot-tr-search"
          icon={<IconSearchOutlineRegular size={13} />}
          type="search"
          aria-label={t(locale, 'trSearch')}
          placeholder={t(locale, 'trSearch')}
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <Checkbox
          className="dsh-dot-tr-check"
          checked={showContext}
          label={t(locale, 'trShowContext')}
          onChange={setShowContext}
        />
        <span className="dsh-dot-spacer" />
        <Button variant="ghost" size="sm" className="dsh-dot-tr-reflection-toggle" aria-pressed={reflectionOpen} onClick={toggleReflection}>{t(locale, 'trReflection')}</Button>
        <Button variant="ghost" size="sm" onClick={() => setOpenTurns(new Set((source?.turns ?? []).map(turn => turn.turn)))}>{t(locale, 'trExpandAll')}</Button>
        <Button variant="ghost" size="sm" onClick={() => { setOpenTurns(new Set()); setOpenRecords(new Set()) }}>{t(locale, 'trCollapseAll')}</Button>
      </div>
      <div className="dsh-dot-tr-list">
        {reflectionOpen
          ? <ReflectionRuns locale={locale} {...runs ? { runs } : {}} {...runsError ? { error: runsError } : {}} {...selected ? { selected } : {}} onPick={pick} />
          : null}
        {selected ? <div className="dsh-dot-tr-archived-head"><Button variant="ghost" size="sm" onClick={back}>{t(locale, 'trReflectionBack')}</Button></div> : null}
        {selected && archivedError ? <div className="dsh-ui-error" role="alert">{t(locale, 'trFailedLoad')}{archivedError}</div> : null}
        {selected && !archived && !archivedError ? <div className="dsh-ui-loading">{t(locale, 'trLoading')}</div> : null}
        {!selected || archived
          ? <>
            {(source?.earlier ?? 0) > 0 ? <div className="dsh-dot-tr-earlier">{t(locale, 'trEarlier').replace('{n}', String(source?.earlier ?? 0))}</div> : null}
            {turns.length === 0 ? <div className="dsh-ui-empty">{needle ? t(locale, 'trNoMatch') : t(locale, 'trEmptyLog')}</div> : null}
            {turns.map(turn => <TurnBlock key={turn.turn} locale={locale} turn={turn} open={isOpen(turn.turn)} onToggle={() => toggleTurn(turn.turn)} filter={filter} openRecords={openRecords} toggleRecord={toggleRecord} />)}
          </>
          : null}
      </div>
    </div>
  )
}

// Selectors spell the root out (.dsh-dot-chat = CHAT_ROOT) so the repository scope check can read them.
export const trajectoryCss = `
.dsh-dot-chat .dsh-dot-tr { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.dsh-dot-chat .dsh-dot-tr > .dsh-ui-loading,
.dsh-dot-chat .dsh-dot-tr > .dsh-ui-empty,
.dsh-dot-chat .dsh-dot-tr > .dsh-ui-error { margin: 20px 24px; }
.dsh-dot-chat .dsh-dot-tr-toolbar {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 10px 20px;
  background: var(--dsw-alias-bg-base); border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  font-size: 12px; color: var(--dsw-alias-label-secondary);
}
.dsh-dot-chat .dsh-dot-tr-search { width: 220px; max-width: 50%; height: 28px; }
.dsh-dot-chat .dsh-dot-tr-check { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; white-space: nowrap; cursor: pointer; }
.dsh-dot-chat .dsh-dot-tr-toolbar > button { flex-shrink: 0; white-space: nowrap; }
.dsh-dot-chat .dsh-dot-tr-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 20px 28px; display: flex; flex-direction: column; }
.dsh-dot-chat .dsh-dot-tr-list > .dsh-ui-empty { margin-top: 16px; }
.dsh-dot-chat .dsh-dot-tr-earlier { font-size: 12px; color: var(--dsw-alias-label-tertiary); padding: 4px 8px; }
.dsh-dot-chat .dsh-dot-tr-turn { border: 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); background: transparent; }
.dsh-dot-chat .dsh-dot-tr-turn[data-state='error'] .dsh-dot-tr-turnlabel { color: var(--dsw-alias-label-error); }
.dsh-dot-chat .dsh-dot-tr-turnhead {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 4px;
  border: 0; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer;
}
.dsh-dot-chat .dsh-dot-tr-turnhead:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-dot-chat .dsh-dot-tr-chevron { width: 12px; color: var(--dsw-alias-label-tertiary); }
.dsh-dot-chat .dsh-dot-tr-turnlabel { font-weight: 600; }
.dsh-dot-chat .dsh-dot-tr-facts { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.dsh-dot-chat .dsh-dot-tr-end { font-size: 12px; color: var(--dsw-alias-state-business-primary); }
.dsh-dot-chat .dsh-dot-tr-turn[data-state='error'] .dsh-dot-tr-end { color: var(--dsw-alias-label-error); }
.dsh-dot-chat .dsh-dot-tr-turnbody { padding: 0 0 12px 20px; display: flex; flex-direction: column; gap: 4px; }
.dsh-dot-chat .dsh-dot-tr-step { border-left: 1px solid var(--dsw-alias-border-l2); padding-left: 12px; display: flex; flex-direction: column; gap: 2px; }
.dsh-dot-chat .dsh-dot-tr-stephead { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 18px; }
.dsh-dot-chat .dsh-dot-tr-steplabel { font-weight: 500; color: var(--dsw-alias-label-secondary); flex: none; }
.dsh-dot-chat .dsh-dot-tr-records { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.dsh-dot-chat .dsh-dot-tr-recordhead {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 6px;
  border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; line-height: 18px; text-align: left; cursor: pointer;
  transition: background-color var(--ds-transition-duration, 0.2s) var(--ds-ease-in-out, ease-in-out);
}
.dsh-dot-chat .dsh-dot-tr-recordhead:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-dot-chat .dsh-dot-tr-time { flex: none; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dsh-dot-chat .dsh-dot-tr-tag {
  flex: none; min-width: 52px; max-width: 220px; padding: 0 6px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 4px; text-align: center;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-dot-chat .dsh-dot-tr-record[data-kind='call'] .dsh-dot-tr-tag { color: var(--dsw-alias-state-business-primary); }
.dsh-dot-chat .dsh-dot-tr-record[data-kind='text'] .dsh-dot-tr-tag { color: var(--dsw-alias-label-primary); }
.dsh-dot-chat .dsh-dot-tr-record[data-kind='compaction'] .dsh-dot-tr-tag { color: var(--dsw-alias-state-warn-primary); }
.dsh-dot-chat .dsh-dot-tr-preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-dot-chat .dsh-dot-tr-record[data-kind='reasoning'] .dsh-dot-tr-preview,
.dsh-dot-chat .dsh-dot-tr-record[data-kind='input'] .dsh-dot-tr-preview { color: var(--dsw-alias-label-secondary); }
.dsh-dot-chat .dsh-dot-tr-meta { flex: none; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dsh-dot-chat .dsh-dot-tr-bad { color: var(--dsw-alias-label-error); }
.dsh-dot-chat .dsh-dot-tr-body { margin: 2px 0 6px 6px; display: flex; flex-direction: column; gap: 4px; }
.dsh-dot-chat .dsh-dot-tr-sub { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsh-dot-chat .dsh-dot-tr-pre {
  margin: 0; padding: 8px 10px; max-height: 360px; overflow: auto; border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary);
  font: 12px/18px var(--ds-font-family-code); white-space: pre-wrap; overflow-wrap: anywhere;
}
.dsh-dot-chat .dsh-dot-tr-error { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-error); overflow-wrap: anywhere; }
.dsh-dot-chat .dsh-dot-tr-reflections { display: flex; flex-direction: column; gap: 2px; padding: 2px 0 10px; margin-bottom: 8px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-dot-chat .dsh-dot-tr-reflections > .dsh-ui-empty { margin: 4px 0; }
.dsh-dot-chat .dsh-dot-tr-run { display: flex; align-items: center; gap: 10px; width: 100%; padding: 4px 6px; border: 0; border-radius: var(--dsw-radius-sm); background: none; color: inherit; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.dsh-dot-chat .dsh-dot-tr-run:hover,
.dsh-dot-chat .dsh-dot-tr-run[aria-pressed='true'] { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-dot-chat .dsh-dot-tr-archived-head { padding: 2px 0 8px; }
`
