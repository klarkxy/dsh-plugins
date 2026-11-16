// Inline deepui/deep-view fence renderer for the 'conversation.chat.markdown.fence'
// hoc layer. Streaming keeps a quiet placeholder, a complete body mounts the
// live WidgetCard even mid-stream, and a final invalid body keeps the raw code
// reachable. Answers only fill the composer; nothing submits for the user.
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Button, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { validateViewAnswer } from './core/index.js'
import type { ShownView } from './contracts.ts'
import { compileDeepUi } from './parser.ts'
import { answerText } from './answer-text.ts'
import { fillComposerDraft, type ComposerActions, type InputSnapshot } from './draft.ts'
import { WidgetCard, type MarkdownProps, type ViewLabels } from './widget.tsx'
import type { ViewT } from './ui.tsx'

/** Standard props a session-scoped markdown fence layer receives, plus owner content. */
export type DeepViewFenceProps = {
  /** The fence body text, complete or still streaming. */
  code: string
  /** True while the model is still writing this fence. */
  streaming: boolean
  /** Owner-rendered raw code block; kept for the final invalid fallback. */
  children?: ReactNode
  /** UI-key translator mapped by the registration layer (deep-view locale). */
  t(key: string, params?: Record<string, unknown>): string
  inputActions?: ComposerActions
  useInput?<T>(selector: (snapshot: InputSnapshot) => T, equal?: (left: T, right: T) => boolean): T
}

type FillStatus = { state: 'filled' } | { state: 'fillFailed' } | { state: 'failed'; text: string }
type DraftChoice = { action: string; values: Record<string, unknown> }

// Mirrors client.tsx viewT: maps the widget layer's English keys onto the
// plugin locale ids the registration's `t` speaks.
const VIEW_KEYS: Record<string, string> = {
  Copy: 'copy', Copied: 'copied', Footnotes: 'footnotes', Chart: 'chart', 'Chart options': 'chartOptions',
  'View as chart': 'viewAsChart', 'View as table': 'viewAsTable', 'Copy data': 'copyData', 'Chart {n}': 'chartNumber',
  Value: 'value', Series: 'series', View: 'view', Sources: 'sources', Progress: 'progress', 'Your answer': 'yourAnswer',
  'Local preview only; this card does not send an answer.': 'local',
  Options: 'options', Submit: 'submit', Cancel: 'cancel', Confirm: 'confirm', Send: 'send', Selected: 'selected',
  'Fill composer': 'fillDraft', Steps: 'steps',
  'Node graph': 'nodeGraph', 'Select a node': 'selectNode', 'Nothing to explore': 'nothingToExplore',
  '{n} selected: {values}': 'selectedValues', 'Drag to select a range; double-click to clear': 'exploreIntervalHint',
  'Click points to select; double-click to clear': 'explorePointHint', 'The chart could not be drawn.': 'exploreFailed',
  'Data: {n} rows': 'dataRows', 'Showing {shown} of {n} rows': 'dataTruncated', Map: 'map', 'Map marker': 'mapMarker',
  'Zoom in': 'zoomIn', 'Zoom out': 'zoomOut', 'Reset bearing to north': 'resetBearing',
  'Map is unavailable in this environment.': 'mapUnavailable', 'Map failed to load.': 'mapFailed',
  'You can still pick a location below.': 'mapFallback', Locations: 'locations',
}
export const fenceViewT = (t: DeepViewFenceProps['t']): ViewT => (key, params) => {
  const mapped = VIEW_KEYS[key] ?? key
  return t(mapped, params) === mapped
    ? key.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))
    : t(mapped, params)
}

function FenceMarkdown(props: Parameters<typeof MarkdownText>[0]) {
  return <MarkdownText {...props} />
}

/** Title peek for the quiet streaming placeholder; undefined unless the string is already complete. */
export function streamTitle(code: string): string | undefined {
  const match = /"title"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(code)
  if (!match) return undefined
  try {
    const title: unknown = JSON.parse(`"${match[1]}"`)
    return typeof title === 'string' ? title : undefined
  } catch {
    return undefined
  }
}

export function DeepViewFence(props: DeepViewFenceProps) {
  const compiled = useMemo(() => compileDeepUi(props.code), [props.code])
  const shown: ShownView | undefined = compiled.state === 'complete' ? compiled.shown : undefined
  const t = props.t
  const viewT = useMemo(() => fenceViewT(t), [t])
  const labels = useMemo<ViewLabels>(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('footnotes'),
  }), [t])
  const input = props.useInput?.(value => value) ?? { draft: '', phase: 'plain' as const }
  const [status, setStatus] = useState<FillStatus | null>(null)
  const [draftChoice, setDraftChoice] = useState<DraftChoice | null>(null)
  const canFill = props.inputActions !== undefined
  const fill = useCallback((choice: DraftChoice, replace = false) => {
    if (!shown) return
    const checked = validateViewAnswer(shown.view, choice.action, choice.values)
    if (checked.error !== undefined) {
      setStatus({ state: 'failed', text: String(checked.error) })
      setDraftChoice(null)
      return
    }
    const text = answerText(shown, choice.action, checked)
    const accepted = fillComposerDraft(input, props.inputActions, text, replace)
    setStatus(accepted ? { state: 'filled' } : { state: 'fillFailed' })
    setDraftChoice(null)
  }, [shown, input, props.inputActions])
  const onFillDraft = useCallback((action: string, values: Record<string, unknown>) => {
    if (input.draft.trim() !== '') setDraftChoice({ action, values })
    else fill({ action, values })
  }, [input.draft, fill])

  // Final invalid bodies fall back: never blank, and the raw code stays viewable.
  if (compiled.state !== 'complete' && !props.streaming) {
    return <div className="dvui-fence dvui-fence-failed" role="group" aria-label={t('invalid')}>
      <p className="dvui-tool-error" role="status">{t('invalid')}</p>
      {props.children ? <details className="dvui-fence-source"><summary>{t('code')}</summary><div className="dvui-fence-code">{props.children}</div></details> : null}
    </div>
  }
  // Still streaming: complete JSON mounts the card immediately; anything else
  // waits behind one static placeholder, so a mid-stream parse miss never flickers.
  if (!shown) {
    const title = streamTitle(props.code)
    return <div className="dvui-fence dvui-fence-pending" role="status" aria-label={title ?? t('preparing')}>
      {title ? <p className="dvui-fence-title">{title}</p> : null}
      <span className="dvui-fence-hint">{t('preparing')}</span>
    </div>
  }
  return <div className="dvui-fence dvui-fence-card">
    <WidgetCard title={shown.title} view={shown.view} ButtonComponent={Button}
      onFillDraft={canFill ? onFillDraft : undefined}
      localOnly={!canFill}
      t={viewT} labels={labels} Markdown={FenceMarkdown} />
    {status ? <p className={status.state === 'filled' ? 'dvui-status' : 'dvui-tool-error'} role={status.state === 'filled' ? 'status' : 'alert'}>
      {status.state === 'filled' ? t('filled') : status.state === 'fillFailed' ? t('fillFailed') : status.text}
    </p> : null}
    {draftChoice ? <div className="dvui-draft-choice" role="group" aria-label={t('draftConflict')}>
      <p>{t('draftConflict')}</p><div className="dvui-actions">
        <Button variant="primary" onClick={() => void fill(draftChoice, true)}>{t('replaceDraft')}</Button>
        <Button onClick={() => void fill(draftChoice)}>{t('appendDraft')}</Button>
        <Button onClick={() => setDraftChoice(null)}>{t('cancel')}</Button>
      </div>
    </div> : null}
  </div>
}
