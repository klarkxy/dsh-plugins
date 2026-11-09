// Widget composition adapted from deep-view/src/react/card.js (Apache-2.0).
// DSH migration: html/PNG export/Bot persistence are excluded. Local controls
// remain live; only a supplied onSubmit callback may deliver an answer.
import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { asText, choiceValue, inputDefault, resolve, viewInputs, viewScope } from './core/index.js'
import type { ViewNode } from './contracts.ts'
import { WidgetChart, type ChartHandle } from './chart.tsx'
import { CheckIcon, CopyIcon, DotsIcon, InfoIcon, LinkIcon, Segmented, TableIcon, english, keyLetter, type ViewT } from './ui.tsx'

// Structural twin of the official MarkdownLabels: the widget layer stays
// runtime-neutral, and any component accepting this shape (the official
// MarkdownText included) is assignable.
export type MarkdownProps = { text: string; streaming?: boolean; labels: ViewLabels; variant?: 'body' | 'compact' }
export type ViewLabels = {
  code: { copyLabel: string; copiedLabel: string; toolbarLabels?: { codeLabel: string; wrapLabel: string; unwrapLabel: string } }
  footnotes: string
}
export type Answer = { id: string; action: string; values: Record<string, unknown> }
export type WidgetCardProps = {
  title?: string
  view: ViewNode
  onSubmit?: (action: string, values: Record<string, unknown>) => void
  onDismiss?: () => void
  busy?: boolean
  settled?: boolean
  answer?: Answer | null
  t?: ViewT
  labels?: ViewLabels
  Markdown?: ComponentType<MarkdownProps>
  localOnly?: boolean
}
type Ctx = {
  values: Record<string, unknown>
  setInput(id: string, value: unknown): void
  lookup(name: string): unknown
  locked: boolean
  answerLocked: boolean
  busy: boolean
  settled: boolean
  answer?: Answer | null
  onSubmit?: (action: string, values: Record<string, unknown>) => void
  registerChart(key: string, handle: ChartHandle): (() => void) | void
  refreshCharts(): void
}
const TONES = ['good', 'warn', 'bad']
const CALLOUT_TONES = ['info', 'good', 'warn', 'bad']
const optionsOf = (node: ViewNode) => (Array.isArray(node.options) ? node.options : []) as { label: string; value?: string | number | boolean; description?: string }[]
const fieldsOf = (node: ViewNode) => (Array.isArray(node.fields) ? node.fields : [])
const cellText = (value: unknown) => value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : asText(value)
const NUMERIC_CELL = /^[-+]?[\d.,]+\s?(%|[a-zA-Z]{1,4})?$/
function hasType(node: ViewNode, types: Set<string>): boolean {
  return types.has(node.type) || (Array.isArray(node.children) && node.children.some(child => hasType(child, types)))
}
const answerValues = (answer: Answer | null | undefined, node: ViewNode) => answer != null && answer.action === node.id ? answer.values : undefined
const withUnit = (value: unknown, unit?: string) => `${asText(value)}${unit ? ` ${unit}` : ''}`
const grouped = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 6 }) : asText(value)
function FallbackMarkdown({ text }: MarkdownProps) { return <span>{text}</span> }

function OptionsInput({ node, ctx, t }: { node: ViewNode; ctx: Ctx; t: ViewT }) {
  const [picked, setPicked] = useState<string[]>([])
  const options = optionsOf(node)
  const multi = node.multi === true
  const choose = (label: string) => {
    if (ctx.answerLocked) return
    if (multi) setPicked(current => current.includes(label) ? current.filter(item => item !== label) : [...current, label])
    else ctx.onSubmit?.(node.id!, { selected: [label] })
  }
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = event.key.toUpperCase().charCodeAt(0) - 65
    if (index >= 0 && index < options.length && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); choose(options[index].label) }
  }
  return <Fragment>
    <div className="dvui-options" role="group" aria-label={t('Options')} onKeyDown={onKey}>{options.map((option, index) => {
      const selected = multi && picked.includes(option.label)
      return <button key={option.label} type="button" className="dvui-option" disabled={ctx.answerLocked} aria-pressed={multi ? selected : undefined} aria-keyshortcuts={keyLetter(index).toLowerCase()} onClick={() => choose(option.label)}>
        <span className="dvui-key" aria-hidden="true">{keyLetter(index)}</span>
        <span className="dvui-option-body"><span className="dvui-option-label">{option.label}</span>{option.description ? <span className="dvui-option-desc">{option.description}</span> : null}</span>
        {selected ? <span className="dvui-check"><CheckIcon /></span> : null}
      </button>
    })}</div>
    {multi ? <div className="dvui-actions"><button type="button" className="dvui-submit" disabled={ctx.answerLocked || picked.length === 0} onClick={() => ctx.onSubmit?.(node.id!, { selected: picked })}>{t('Submit')}</button></div> : null}
  </Fragment>
}
function SettledOptions({ node, answer, t }: { node: ViewNode; answer?: Answer | null; t: ViewT }) {
  const selected = answerValues(answer, node)?.selected
  const chosen = Array.isArray(selected) ? selected : []
  return <div className="dvui-options" role="group" aria-label={t('Your answer')}>{optionsOf(node).map(option => <div key={option.label} className="dvui-option"><span className="dvui-option-body"><span className="dvui-option-label">{option.label}</span>{option.description ? <span className="dvui-option-desc">{option.description}</span> : null}</span>{chosen.includes(option.label) ? <span className="dvui-check" role="img" aria-label={t('Selected')}><CheckIcon /></span> : null}</div>)}</div>
}
function ConfirmInput({ node, ctx, t }: { node: ViewNode; ctx: Ctx; t: ViewT }) {
  return <div className="dvui-actions"><button type="button" className="dvui-button" disabled={ctx.answerLocked} onClick={() => ctx.onSubmit?.(node.id!, { confirmed: false })}>{node.cancelLabel ?? t('Cancel')}</button><button type="button" className="dvui-submit" disabled={ctx.answerLocked} onClick={() => ctx.onSubmit?.(node.id!, { confirmed: true })}>{node.confirmLabel ?? t('Confirm')}</button></div>
}
function SettledConfirm({ node, answer, t }: { node: ViewNode; answer?: Answer | null; t: ViewT }) {
  const confirmed = answerValues(answer, node)?.confirmed
  if (typeof confirmed !== 'boolean') return <ConfirmInput node={node} ctx={{ answerLocked: true } as Ctx} t={t} />
  return <span className="dvui-badge">{confirmed ? node.confirmLabel ?? t('Confirm') : node.cancelLabel ?? t('Cancel')}</span>
}
function FormInput({ node, ctx, t }: { node: ViewNode; ctx: Ctx; t: ViewT }) {
  const fields = fieldsOf(node)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const submit = () => { if (!ctx.answerLocked) ctx.onSubmit?.(node.id!, { fields: Object.fromEntries(fields.map(field => [field.id, draft[field.id] ?? ''])) }) }
  return <form className="dvui-form" onSubmit={event => { event.preventDefault(); submit() }}>{fields.map(field => <label key={field.id} className="dvui-field"><span className="dvui-field-label">{field.label}</span><input className="dvui-input" type="text" value={draft[field.id] ?? ''} autoComplete="off" spellCheck={false} readOnly={ctx.answerLocked} aria-label={field.label} placeholder={field.placeholder} onChange={event => setDraft(current => ({ ...current, [field.id]: event.target.value }))} /></label>)}<div className="dvui-actions"><button type="submit" className="dvui-submit" disabled={ctx.answerLocked}>{node.submitLabel ?? t('Submit')}</button></div></form>
}
function SettledForm({ node, answer }: { node: ViewNode; answer?: Answer | null }) {
  const fields = answerValues(answer, node)?.fields
  const values = fields !== null && typeof fields === 'object' ? fields as Record<string, unknown> : {}
  return <div className="dvui-form">{fieldsOf(node).map(field => <label key={field.id} className="dvui-field"><span className="dvui-field-label">{field.label}</span><input className="dvui-input" value={String(values[field.id] ?? '')} disabled readOnly aria-label={field.label} /></label>)}</div>
}
function WidgetTable({ node, lookup }: { node: ViewNode; lookup: (name: string) => unknown }) {
  const columns = Array.isArray(node.columns) ? node.columns : []
  const rows = (Array.isArray(node.rows) ? node.rows : []).map(row => (Array.isArray(row) ? row : []).map(cell => resolve(cell, lookup, '')))
  const numeric = columns.map((_, index) => {
    const cells = rows.map(row => row[index]).filter(cell => cell !== undefined && cell !== '')
    return cells.length > 0 && cells.every(cell => typeof cell === 'number' || (typeof cell === 'string' && NUMERIC_CELL.test(cell.trim())))
  })
  return <div className="dvui-table"><table><thead><tr>{columns.map((column, index) => <th key={column.key ?? index} scope="col" className={numeric[index] ? 'dvui-num' : undefined}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{columns.map((column, index) => <td key={column.key ?? index} className={numeric[index] ? 'dvui-num' : undefined}>{cellText(row[index])}</td>)}</tr>)}</tbody></table></div>
}
function WidgetProgress({ node, lookup, t }: { node: ViewNode; lookup: (name: string) => unknown; t: ViewT }) {
  let percent: number
  if (node.percent !== undefined) percent = Number(resolve(node.percent, lookup, 0))
  else {
    const max = Number(resolve(node.max, lookup, 0))
    percent = max > 0 ? (Number(resolve(node.value, lookup, 0)) / max) * 100 : 0
  }
  percent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0))
  const tone = resolve(node.tone, lookup)
  const right = node.valueLabel !== undefined ? asText(resolve(node.valueLabel, lookup, '')) : `${Math.round(percent)}%`
  return <div className="dvui-progress" data-tone={TONES.includes(String(tone)) ? String(tone) : undefined}><span className="dvui-progress-label"><span>{node.label}</span><span>{right}</span></span><div className="dvui-progress-track" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label={node.label ?? t('Progress')} aria-valuetext={right}><div className="dvui-progress-fill" style={{ width: `${percent}%` }} /></div></div>
}
function WidgetMetric({ node, lookup }: { node: ViewNode; lookup: (name: string) => unknown }) {
  const tone = resolve(node.tone, lookup)
  const caption = node.caption === undefined ? '' : asText(resolve(node.caption, lookup, ''))
  return <div className="dvui-metric" data-tone={TONES.includes(String(tone)) ? String(tone) : undefined}><span className="dvui-metric-label">{node.label}</span><span className="dvui-metric-value">{asText(resolve(node.value, lookup, '—'))}</span>{caption !== '' ? <span className="dvui-caption">{caption}</span> : null}</div>
}
function WidgetCallout({ node, lookup, Markdown, labels }: { node: ViewNode; lookup: (name: string) => unknown; Markdown: ComponentType<MarkdownProps>; labels: ViewLabels }) {
  const tone = resolve(node.tone, lookup)
  return <div className="dvui-callout" data-tone={CALLOUT_TONES.includes(String(tone)) ? String(tone) : 'info'}><span className="dvui-callout-icon" aria-hidden="true"><InfoIcon /></span><div><Markdown text={asText(resolve(node.text, lookup, ''))} labels={labels} variant="compact" /></div></div>
}
function WidgetSources({ node, t }: { node: ViewNode; t: ViewT }) {
  return <div className="dvui-sources" role="list" aria-label={t('Sources')}>{(node.items ?? []).map((item, index) => <a key={`${item.url}-${index}`} role="listitem" className="dvui-source" href={item.url} target="_blank" rel="noopener noreferrer" title={item.url}><LinkIcon />{item.label}</a>)}</div>
}
function InputHead({ id, label, value }: { id: string; label?: string; value?: string }) {
  return <div className="dvui-input-head"><label htmlFor={id} className="dvui-input-label">{label}</label>{value !== undefined ? <output htmlFor={id} className="dvui-input-value">{value}</output> : null}</div>
}
const numericBound = (bound: unknown) => typeof bound === 'number' && Number.isFinite(bound) ? bound : typeof bound === 'string' && bound.trim() !== '' && Number.isFinite(Number(bound)) ? Number(bound) : undefined
function SliderInput({ node, ctx }: { node: ViewNode; ctx: Ctx }) {
  const id = useId()
  const value = Number(ctx.values[node.id!])
  // Validation guarantees numeric min/max; resolve any stray non-numeric bound defensively.
  const min = numericBound(resolve(node.min, ctx.lookup, undefined))
  const max = numericBound(resolve(node.max, ctx.lookup, undefined))
  const percent = min !== undefined && max !== undefined && max > min ? ((value - min) / (max - min)) * 100 : 0
  return <div className="dvui-input-row"><InputHead id={id} label={node.label} value={withUnit(grouped(value), node.unit)} /><input id={id} type="range" className="dvui-range" min={min} max={max} step={node.step ?? 'any'} value={value} disabled={ctx.locked} style={{ '--_dvui-fill': `${percent}%` } as React.CSSProperties} onChange={event => ctx.setInput(node.id!, Number(event.target.value))} /></div>
}
function NumberInput({ node, ctx }: { node: ViewNode; ctx: Ctx }) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const value = ctx.values[node.id!]
  const min = numericBound(resolve(node.min, ctx.lookup, undefined))
  const max = numericBound(resolve(node.max, ctx.lookup, undefined))
  return <div className="dvui-input-row"><InputHead id={id} label={node.label} /><span className="dvui-number"><input id={id} className="dvui-input" type="number" inputMode="decimal" value={draft ?? asText(value)} min={min} max={max} step={node.step ?? 'any'} disabled={ctx.locked} onChange={event => {
    const raw = event.target.value
    setDraft(raw)
    const next = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(next) || (min !== undefined && next < min) || (max !== undefined && next > max)) return
    ctx.setInput(node.id!, next)
  }} onBlur={() => setDraft(null)} />{node.unit ? <span className="dvui-unit">{node.unit}</span> : null}</span></div>
}
function ChoiceInput({ node, ctx }: { node: ViewNode; ctx: Ctx }) {
  const labelId = useId()
  const options = optionsOf(node)
  const current = ctx.values[node.id!]
  const side = options.length <= 4 && options.every(option => [...option.label].length <= 14)
  return <div className="dvui-input-row"><span className="dvui-input-label" id={labelId}>{node.label}</span>{side
    ? <Segmented label={node.label ?? ''} value={options.findIndex(option => choiceValue(option) === current)} className="dvui-choice-seg">{options.map(option => <button key={option.label} type="button" aria-pressed={choiceValue(option) === current} disabled={ctx.locked} onClick={() => ctx.setInput(node.id!, choiceValue(option))}>{option.label}</button>)}</Segmented>
    : <div className="dvui-radios" role="radiogroup" aria-labelledby={labelId}>{options.map(option => <button key={option.label} type="button" role="radio" className="dvui-radio" aria-checked={choiceValue(option) === current} disabled={ctx.locked} onClick={() => ctx.setInput(node.id!, choiceValue(option))}><span className="dvui-radio-dot" aria-hidden="true" />{option.label}</button>)}</div>}</div>
}
function ToggleInput({ node, ctx }: { node: ViewNode; ctx: Ctx }) {
  const on = ctx.values[node.id!] === true
  return <div className="dvui-toggle"><span className="dvui-input-label">{node.label}</span><button type="button" role="switch" className="dvui-switch" aria-checked={on} aria-label={node.label} disabled={ctx.locked} onClick={() => ctx.setInput(node.id!, !on)}><span className="dvui-switch-knob" aria-hidden="true" /></button></div>
}
function WidgetNode({ node, ctx, Markdown, labels, t }: { node: ViewNode; ctx: Ctx; Markdown: ComponentType<MarkdownProps>; labels: ViewLabels; t: ViewT }) {
  const { lookup } = ctx
  switch (node.type) {
    case 'stack': case 'row': return <div className={node.type === 'row' ? 'dvui-row' : 'dvui-stack'}>{(node.children ?? []).map((child, index) => <WidgetNode key={child.id ?? `${child.type}-${index}`} node={child} ctx={ctx} Markdown={Markdown} labels={labels} t={t} />)}</div>
    case 'text': {
      const text = <Markdown text={asText(resolve(node.text, lookup, ''))} labels={labels} variant="compact" />
      return node.tone === 'muted' ? <div className="dvui-muted">{text}</div> : text
    }
    case 'metric': return <WidgetMetric node={node} lookup={lookup} />
    case 'table': return <WidgetTable node={node} lookup={lookup} />
    case 'chart': return <WidgetChart node={node} lookup={lookup} registerChart={ctx.registerChart} refreshCharts={ctx.refreshCharts} t={t} />
    case 'progress': return <WidgetProgress node={node} lookup={lookup} t={t} />
    case 'callout': return <WidgetCallout node={node} lookup={lookup} Markdown={Markdown} labels={labels} />
    case 'sources': return <WidgetSources node={node} t={t} />
    case 'slider': return <SliderInput node={node} ctx={ctx} />
    case 'number': return <NumberInput node={node} ctx={ctx} />
    case 'choice': return <ChoiceInput node={node} ctx={ctx} />
    case 'toggle': return <ToggleInput node={node} ctx={ctx} />
    case 'submit': return ctx.settled ? null : <div className="dvui-actions"><button type="button" className="dvui-submit" disabled={ctx.answerLocked} onClick={() => ctx.onSubmit?.(node.id!, {})}>{node.label || t('Send')}</button></div>
    case 'options': return ctx.settled ? <SettledOptions node={node} answer={ctx.answer} t={t} /> : <OptionsInput node={node} ctx={ctx} t={t} />
    case 'confirm': return ctx.settled ? <SettledConfirm node={node} answer={ctx.answer} t={t} /> : <ConfirmInput node={node} ctx={ctx} t={t} />
    case 'form': return ctx.settled ? <SettledForm node={node} answer={ctx.answer} /> : <FormInput node={node} ctx={ctx} t={t} />
    default: return null
  }
}
export function WidgetView({ view, onSubmit, settled = false, answer = null, busy = false, registerChart, refreshCharts, t = english, labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }, Markdown = FallbackMarkdown }: Omit<WidgetCardProps, 'title'> & { registerChart: Ctx['registerChart']; refreshCharts: () => void }) {
  const inputs = viewInputs(view) as ViewNode[]
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(inputs.map(node => [node.id, inputDefault(node)])))
  const sent = answer?.values?.inputs
  const current = settled && sent !== null && typeof sent === 'object' ? { ...values, ...sent } : values
  const submit = (action: string, extra: Record<string, unknown>) => onSubmit?.(action, inputs.length > 0 ? { ...extra, inputs: current } : extra)
  const ctx: Ctx = {
    onSubmit: submit, settled, answer, busy, lookup: viewScope(view, current), values: current, locked: settled || busy, answerLocked: settled || busy || onSubmit === undefined,
    setInput: (id, value) => setValues(before => ({ ...before, [id]: value })), registerChart, refreshCharts,
  }
  return <WidgetNode node={view} ctx={ctx} Markdown={Markdown} labels={labels} t={t} />
}
function useChartHandles() {
  const [, bump] = useState(0)
  const charts = useRef(new Map<string, ChartHandle>())
  const refreshCharts = useCallback(() => bump(value => value + 1), [])
  const registerChart = useCallback((key: string, handle: ChartHandle) => {
    charts.current.set(key, handle)
    refreshCharts()
    return () => { charts.current.delete(key); refreshCharts() }
  }, [refreshCharts])
  return { charts: [...charts.current.values()], registerChart, refreshCharts }
}
function ViewMenu({ charts, t }: { charts: ChartHandle[]; t: ViewT }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return undefined
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key) }
  }, [open])
  return <div ref={root} className="dvui-tools" data-open={open ? '' : undefined}><button type="button" className="dvui-more" aria-label={t('Chart options')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}><DotsIcon /></button>{open ? <div className="dvui-menu" role="menu">{charts.map((chart, index) => <Fragment key={`${chart.label}-${index}`}>{charts.length > 1 ? <div className="dvui-menu-label">{chart.label ?? t('Chart {n}', { n: index + 1 })}</div> : null}<button type="button" role="menuitem" onClick={() => { setOpen(false); chart.toggleTable() }}><TableIcon />{chart.asTable ? t('View as chart') : t('View as table')}</button><button type="button" role="menuitem" onClick={() => { setOpen(false); chart.copy() }}><CopyIcon />{t('Copy data')}</button></Fragment>)}</div> : null}</div>
}
export function WidgetCard({ title = '', view, onSubmit, onDismiss, busy = false, settled = false, answer = null, t = english, labels, Markdown, localOnly = false }: WidgetCardProps) {
  const titleId = useId()
  const { charts, registerChart, refreshCharts } = useChartHandles()
  const framed = hasType(view, new Set(['slider', 'number', 'choice', 'toggle', 'options', 'confirm', 'form', 'submit']))
  return <div className={`dvui-view ${framed ? 'dvui-framed' : 'dvui-bare'}${settled ? ' dvui-settled' : ''}`} role="group" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : t('View')} aria-busy={busy || undefined}>
    {title || onDismiss || charts.length > 0 ? <div className="dvui-head"><p className="dvui-title" id={titleId}>{title}</p>{charts.length > 0 ? <ViewMenu charts={charts} t={t} /> : null}{onDismiss ? <button type="button" className="dvui-dismiss" aria-label={t('Dismiss view')} onClick={onDismiss} disabled={busy}>×</button> : null}</div> : null}
    <div className="dvui-body"><WidgetView view={view} onSubmit={onSubmit} settled={settled} answer={answer} busy={busy} registerChart={registerChart} refreshCharts={refreshCharts} t={t} labels={labels} Markdown={Markdown} /></div>
    {localOnly && hasType(view, new Set(['options', 'confirm', 'form', 'submit'])) ? <p className="dvui-local-note" role="note">{t('Local preview only; this card does not send an answer.')}</p> : null}
  </div>
}
