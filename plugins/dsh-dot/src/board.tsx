import { Button, StateDot, Tag, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BoardView, TaskStatus } from './contracts.ts'
import { formatWhen, t, timingLabel, type CopyLocale } from './ui-copy.ts'

export const BOARD_ROOT = 'dsh-dot-board'

const DOT: Record<TaskStatus, StateDotState> = {
  running: 'ongoing', idle: 'done', blocked: 'warning', error: 'error', archived: 'idle',
}

export interface BoardProps {
  readonly locale: CopyLocale
  readonly view: BoardView | undefined
  readonly error?: string
  readonly onOpen: (sessionId: string) => void
  readonly onRetry: () => void
  readonly onRemoveSchedule: (id: string) => void
}

/** Task board: waiting requests on top, then tasks by urgency, then Dorothy's reminders. Pure render over a board snapshot. */
export function Board({ locale, view, error, onOpen, onRetry, onRemoveSchedule }: BoardProps) {
  if (view === undefined) {
    return (
      <div className={BOARD_ROOT}>
        {error === undefined ? null : (
          <div className="dsh-ui-row">
            <span className="dsh-ui-error">{t(locale, 'loadFailed')}: {error}</span>
            <Button variant="ghost" onClick={onRetry}>{t(locale, 'retry')}</Button>
          </div>
        )}
      </div>
    )
  }
  const live = view.tasks.filter(task => task.status !== 'archived')
  const archived = view.tasks.filter(task => task.status === 'archived')
  return (
    <div className={BOARD_ROOT}>
      <div className="dsh-ui-stack">
        {view.pending.length > 0 ? (
          <section className="dsh-ui-stack" aria-label={t(locale, 'waiting')}>
            <span className="dsh-ui-meta">{t(locale, 'waiting')}</span>
            {view.pending.map(item => (
              <button key={item.id} type="button" className="dsh-dot-row" onClick={() => onOpen(item.sessionId)}>
                <StateDot state="warning" />
                <span className="dsh-ui-compact dsh-ui-truncate">{item.subject}</span>
                <span className="dsh-ui-spacer" />
                <Tag tone="outline">{t(locale, item.kind)}</Tag>
              </button>
            ))}
          </section>
        ) : null}
        {live.length === 0 && view.pending.length === 0 && view.schedules.length === 0 ? <p className="dsh-ui-hint">{t(locale, 'empty')}</p> : null}
        {live.map(task => (
          <button key={task.sessionId} type="button" className="dsh-dot-row" onClick={() => onOpen(task.sessionId)}>
            <StateDot state={DOT[task.status]} />
            <span className="dsh-dot-main">
              <span className="dsh-ui-compact dsh-ui-truncate">{task.title}</span>
              {task.lastNote ? <span className="dsh-ui-hint dsh-ui-truncate">{task.lastNote}</span> : null}
            </span>
            <span className="dsh-ui-spacer" />
            {task.unseenTurns > 0 ? <span className="dsh-ui-meta">{task.unseenTurns} {t(locale, 'unread')}</span> : null}
            <Tag tone="outline">{t(locale, task.status)}</Tag>
          </button>
        ))}
        {archived.length > 0 ? <span className="dsh-ui-hint">{t(locale, 'archived')} · {archived.length}</span> : null}
        {view.schedules.length > 0 ? (
          <section className="dsh-ui-stack" aria-label={t(locale, 'reminders')}>
            <span className="dsh-ui-meta">{t(locale, 'reminders')}</span>
            {view.schedules.map(item => (
              <div key={item.id} className="dsh-dot-reminder">
                <span className="dsh-dot-main">
                  <span className="dsh-ui-compact dsh-ui-truncate" title={item.prompt}>{item.title}</span>
                  <span className="dsh-ui-hint dsh-ui-truncate">{timingLabel(locale, item.timing)} · {t(locale, 'reminderNext').replace('{when}', formatWhen(item.nextAt))}</span>
                </span>
                <span className="dsh-ui-spacer" />
                <Button variant="ghost" size="sm" title={t(locale, 'reminderRemoveTip')} onClick={() => onRemoveSchedule(item.id)}>{t(locale, 'reminderRemove')}</Button>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  )
}

// Selectors spell the root out (.dsh-dot-board = BOARD_ROOT) so the repository scope check can read them.
export const boardCss = `
.dsh-dot-board { padding: 12px; overflow-y: auto; height: 100%; }
.dsh-dot-board .dsh-dot-row {
  display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0;
  padding: 8px 10px; border: 0; border-radius: var(--dsw-radius-sm);
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.dsh-dot-board .dsh-dot-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-dot-board .dsh-dot-main { display: flex; flex-direction: column; min-width: 0; }
.dsh-dot-board .dsh-dot-reminder { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 4px 4px 10px; }
.dsh-dot-board .dsh-dot-reminder > button { flex-shrink: 0; white-space: nowrap; }
.dsh-dot-board .dsh-dot-row > .dsh-ui-meta { white-space: nowrap; flex-shrink: 0; }
`
