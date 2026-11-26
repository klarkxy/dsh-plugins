// Widget composition adapted from deep-view/src/react/card.js (Apache-2.0).
// DSH migration: html/PNG export/Bot persistence are excluded. Local controls
// remain live; only a supplied onSubmit callback may deliver an answer.
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { asText, choiceValue, hasInputs, inputDefault, inputsSummary, mathDefaults, resolve, viewInputs, viewScope } from './core/index.js'
import { isSourceItem, isStepItem, type ViewNode } from './contracts.ts'
import { WidgetChart, type ChartHandle } from './chart.tsx'
import { CheckIcon, CopyIcon, DotsIcon, InfoIcon, LinkIcon, Segmented, TableIcon, english, keyLetter, type ViewT } from './ui.tsx'
import { RichNode } from './rich-lazy.tsx'

// Structural twin of the official MarkdownLabels: the widget layer stays
// runtime-neutral, and any component accepting this shape (the official
// MarkdownText included) is assignable.
export type MarkdownProps = { text: string; streaming?: boolean; labels: ViewLabels; variant?: 'body' | 'compact' }
export type ViewLabels = {
  code: { copyLabel: string; copiedLabel: string; toolbarLabels?: { codeLabel: string; wrapLabel: string; unwrapLabel: string } }
  footnotes: string
}
export type Answer = { id: string; action: string; values: Record<string, unknown>; revision?: number }
export type WidgetCardProps = {
  title?: string
  view: ViewNode
  onSubmit?: (action: string, values: Record<string, unknown>) => void
  /** Write the answer as composer draft instead of answering directly. Never sends. */
  onFillDraft?: (action: string, values: Record<string, unknown>) => void
  onDismiss?: () => void
  busy?: boolean
  settled?: boolean
  answer?: Answer | null
  t?: ViewT
  labels?: ViewLabels
  Markdown?: ComponentType<MarkdownProps>
  localOnly?: boolean
  /** Ephemeral local state shared across the dock and settled reply surfaces. */
  values?: Record<string, unknown>
  onValuesChange?: (values: Record<string, unknown>) => void
  /** Optional explanation for an interactive preview answered in another surface. */
  localNote?: string
  /** The card can no longer be answered here (expired or superseded). Controls render read-only with no action row; `localNote` explains why. */
  closed?: boolean
  /** Host draws the card shell; the view drops its own margin, padding and frame. */
  embedded?: boolean
  /** Browser hosts inject their native button without coupling the shared widget to DSH. */
  ButtonComponent?: ButtonHost
}
type Ctx = {
  values: Record<string, unknown>
  setInput(id: string, value: unknown): void
  lookup(name: string): unknown
  locked: boolean
  answerLocked: boolean
  fillLocked: boolean
  editable: boolean
  busy: boolean
  settled: boolean
  closed: boolean
  answer?: Answer | null
  onSubmit?: (action: string, values: Record<string, unknown>) => void
  onFillDraft?: (action: string, values: Record<string, unknown>) => void
  ButtonComponent?: ButtonHost
  registerChart(key: string, handle: ChartHandle): (() => void) | void
  refreshCharts(): void
}
// Direct-answer controls (Submit/Confirm/Cancel) stay rendered disabled when a
// card answers nowhere, but a fill-only card hides them: a permanently disabled
// button that looks usable is a fake action, while Fill composer does the work.
const directAnswer = (ctx: Ctx) => ctx.onSubmit !== undefined || ctx.onFillDraft === undefined
const TONES = ['good', 'warn', 'bad', 'accent']
const CALLOUT_TONES = ['info', 'good', 'warn', 'bad']
const optionsOf = (node: ViewNode) => (Array.isArray(node.options) ? node.options : []) as { label: string; value?: string | number | boolean; description?: string }[]
const fieldsOf = (node: ViewNode) => (Array.isArray(node.fields) ? node.fields : [])
const sourcesOf = (node: ViewNode) => (Array.isArray(node.items) ? node.items : []).filter(isSourceItem)
const stepsOf = (node: ViewNode) => (Array.isArray(node.items) ? node.items : []).filter(isStepItem)
const cellText = (value: unknown) => value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : asText(value)
const NUMERIC_CELL = /^[-+]?[\d.,]+\s?(%|[a-zA-Z]{1,4})?$/
const RICH_MARKDOWN_CELL = /[*`\[_~]/
function hasType(node: ViewNode, types: Set<string>): boolean {
  return types.has(node.type) || (Array.isArray(node.children) && node.children.some(child => hasType(child, types)))
}
const answerValues = (answer: Answer | null | undefined, node: ViewNode) => answer != null && answer.action === node.id ? answer.values : undefined
const withUnit = (value: unknown, unit?: string) => `${asText(value)}${unit ? ` ${unit}` : ''}`
const grouped = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 6 }) : asText(value)
export type ButtonHost = ComponentType<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'; size?: 'sm' | 'md' }>
function ActionButton({ primary = false, className = '', children, host: Host, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; host?: ButtonHost }) {
  const classes = `${primary ? 'dvui-submit' : 'dvui-button'} ${className}`
  return Host ? <Host variant={primary ? 'primary' : 'ghost'} size="sm" className={classes} {...props}>{children}</Host>
    : <button type={props.type ?? 'button'} className={classes} {...props}>{children}</button>
}
function FallbackMarkdown({ text }: MarkdownProps) { return <span>{text}</span> }

function findControl(view: ViewNode, id: string): ViewNode | undefined {
  if (['options', 'confirm', 'form', 'submit'].includes(view.type) && view.id === id) return view
  for (const child of view.children ?? []) {
    const found = findControl(child, id)
    if (found) return found
  }
  return undefined
}

export function settledCardSummary(title: string, view: ViewNode, answer: Answer, t: ViewT): string {
  const node = findControl(view, answer.action)
  const values = answer.values
  let controlPart = ''
  if (Array.isArray(values.selected)) {
    controlPart = values.selected.map(String).join(', ')
  } else if (typeof values.confirmed === 'boolean') {
    controlPart = values.confirmed ? (node?.confirmLabel ?? t('Confirm')) : (node?.cancelLabel ?? t('Cancel'))
  } else if (values.canceled === true) {
    controlPart = node?.cancelLabel ?? t('Cancel')
  } else if (values.fields !== null && typeof values.fields === 'object' && !Array.isArray(values.fields)) {
    const fieldMap = values.fields as Record<string, unknown>
    const pairs = fieldsOf(node ?? { type: 'form' }).map(field => {
      const val = String(fieldMap[field.id] ?? '').replace(/\s+/g, ' ').trim()
      return val !== '' ? `${field.label}: ${val}` : ''
    }).filter(Boolean).join(' · ')
    const submitLabel = node?.submitLabel ?? t('Submit')
    controlPart = pairs !== '' ? `${submitLabel} · ${pairs}` : submitLabel
  } else if (node?.type === 'submit') {
    controlPart = node.label || t('Send')
  }
  const inputPart = values.inputs !== null && typeof values.inputs === 'object' && !Array.isArray(values.inputs)
    ? inputsSummary(view, values.inputs)
    : ''
  return [title.trim(), controlPart, inputPart].filter(Boolean).join(' · ') || t('Your answer')
}

function OptionsInput({ node, ctx, t }: { node: ViewNode; ctx: Ctx; t: ViewT }) {
  const [picked, setPicked] = useState<string[]>([])
  const [customText, setCustomText] = useState('')
  const [customSelected, setCustomSelected] = useState(false)
  const options = optionsOf(node)
  const multi = node.multi === true
  const allowCustom = node.allowCustom === true
  // A card that can fill a draft or accept custom text needs a pick first, so
  // one-tap submit becomes select-then-act; plain cards keep instant single-tap.
  const staged = multi || ctx.onFillDraft !== undefined || allowCustom
  const choose = (label: string) => {
    if (!ctx.editable) return
    if (multi) setPicked(current => current.includes(label) ? current.filter(item => item !== label) : [...current, label])
    else if (staged) { setPicked([label]); setCustomSelected(false) }
    else ctx.onSubmit?.(node.id!, { selected: [label] })
  }
  const customTrimmed = customText.trim()
  const activeCustom = allowCustom && customSelected && customTrimmed !== '' ? [customTrimmed] : []
  const effectivePicked = multi
    ? [...picked, ...activeCustom.filter(item => !picked.includes(item))]
    : (activeCustom.length > 0 ? activeCustom : picked)
  const values = () => ({ selected: effectivePicked })
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    const index = event.key.toUpperCase().charCodeAt(0) - 65
    if (index >= 0 && index < options.length && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); choose(options[index].label) }
  }
  const customPlaceholder = node.customPlaceholder ?? t('Type your own…')
  return <Fragment>
    <div className="dvui-options" role="group" aria-label={t('Options')} onKeyDown={onKey}>
      {options.map((option, index) => {
        const selected = staged && (multi ? picked.includes(option.label) : !customSelected && picked.includes(option.label))
        return <button key={option.label} type="button" className="dvui-option" disabled={!ctx.editable} aria-pressed={staged ? selected : undefined} aria-keyshortcuts={keyLetter(index).toLowerCase()} onClick={() => choose(option.label)}>
          <span className="dvui-key" aria-hidden="true">{keyLetter(index)}</span>
          <span className="dvui-option-body"><span className="dvui-option-label">{option.label}</span>{option.description ? <span className="dvui-option-desc">{option.description}</span> : null}</span>
          {selected ? <span className="dvui-check"><CheckIcon /></span> : null}
        </button>
      })}
      {allowCustom ? <div className="dvui-option dvui-option-custom" data-selected={activeCustom.length > 0 ? '' : undefined}>
        <span className="dvui-key" aria-hidden="true">{keyLetter(options.length)}</span>
        <input
          type="text"
          className="dvui-input dvui-custom-input"
          value={customText}
          readOnly={!ctx.editable}
          placeholder={customPlaceholder}
          aria-label={customPlaceholder}
          onFocus={() => { if (ctx.editable && customText.trim() !== '') { setCustomSelected(true); if (!multi) setPicked([]) } }}
          onChange={event => {
            const raw = event.target.value
            setCustomText(raw)
            const hasText = raw.trim() !== ''
            setCustomSelected(hasText)
            if (!multi && hasText) setPicked([])
          }}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || !ctx.editable || effectivePicked.length === 0) return
            event.preventDefault()
            const act = ctx.onSubmit ?? ctx.onFillDraft
            act?.(node.id!, values())
          }}
        />
        {activeCustom.length > 0 ? <span className="dvui-check"><CheckIcon /></span> : null}
      </div> : null}
    </div>
    {staged ? <div className="dvui-actions">
      {ctx.onFillDraft ? <ActionButton host={ctx.ButtonComponent} primary={!directAnswer(ctx)} disabled={ctx.fillLocked || effectivePicked.length === 0} onClick={() => ctx.onFillDraft?.(node.id!, values())}>{t('Fill composer')}</ActionButton> : null}
      {directAnswer(ctx) ? <ActionButton host={ctx.ButtonComponent} primary disabled={ctx.answerLocked || effectivePicked.length === 0} onClick={() => ctx.onSubmit?.(node.id!, values())}>{t('Submit')}</ActionButton> : null}
    </div> : null}
  </Fragment>
}
function SettledOptions({ node, answer, t }: { node: ViewNode; answer?: Answer | null; t: ViewT }) {
  const selected = answerValues(answer, node)?.selected
  const chosen = Array.isArray(selected) ? selected.map(String) : []
  const declared = optionsOf(node)
  const declaredLabels = new Set(declared.map(option => option.label))
  const customChosen = chosen.filter(label => !declaredLabels.has(label))
  return <div className="dvui-options" role="group" aria-label={t('Your answer')}>
    {declared.map(option => <div key={option.label} className="dvui-option" aria-pressed={chosen.includes(option.label) || undefined}><span className="dvui-option-body"><span className="dvui-option-label">{option.label}</span>{option.description ? <span className="dvui-option-desc">{option.description}</span> : null}</span>{chosen.includes(option.label) ? <span className="dvui-check" role="img" aria-label={t('Selected')}><CheckIcon /></span> : null}</div>)}
    {customChosen.map(label => <div key={`custom-${label}`} className="dvui-option" aria-pressed><span className="dvui-option-body"><span className="dvui-option-label">{label}</span></span><span className="dvui-check" role="img" aria-label={t('Selected')}><CheckIcon /></span></div>)}
  </div>
}
function ConfirmInput({ node, ctx, t }: { node: ViewNode; ctx: Ctx; t: ViewT }) {
  return <div className="dvui-actions">
    {ctx.onFillDraft ? <ActionButton host={ctx.ButtonComponent} primary={!directAnswer(ctx)} disabled={ctx.fillLocked} onClick={() => ctx.onFillDraft?.(node.id!, { confirmed: true })}>{t('Fill composer')}</ActionButton> : null}
    {directAnswer(ctx) ? <ActionButton host={ctx.ButtonComponent} disabled={ctx.answerLocked} onClick={() => ctx.onSubmit?.(node.id!, { confirmed: false })}>{node.cancelLabel ?? t('Cancel')}</ActionButton> : null}
    {directAnswer(ctx) ? <ActionButton host={ctx.ButtonComponent} primary disabled={ctx.answerLocked} onClick={() => ctx.onSubmit?.(node.id!, { confirmed: true })}>{node.confirmLabel ?? t('Confirm')}</ActionButton> : null}
  </div>
}
function SettledConfirm({ node, answer, t, closed }: { node: ViewNode; answer?: Answer | null; t: ViewT; closed: boolean }) {
  const confirmed = answerValues(answer, node)?.confirmed
  if (typeof confirmed !== 'boolean') return closed ? null : <ConfirmInput node={node} ctx={{ answerLocked: true } as Ctx} t={t} />
  return <span className="dvui-badge">{confirmed ? node.confirmLabel ?? t('Confirm') : node.cancelLabel ?? t('Cancel')}</span>
}
function FormInput({ node, ctx, t }: { node: ViewNode; ctx: Ctx; t: ViewT }) {
  const fields = fieldsOf(node)
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(field => [field.id, field.value ?? ''])))
  const values = () => ({ fields: Object.fromEntries(fields.map(field => [field.id, field.readOnly === true ? (field.value ?? '') : (draft[field.id] ?? '')])) })
  // The primary action prefers a direct answer; a fill-only card (no onSubmit)
  // falls back to writing the draft.
  const act = ctx.onSubmit !== undefined ? ctx.onSubmit : ctx.onFillDraft
  const submit = () => { if (ctx.editable) act?.(node.id!, values()) }
  const cancel = () => { if (ctx.editable) ctx.onSubmit?.(node.id!, { canceled: true }) }
  return <form className="dvui-form" onSubmit={event => { event.preventDefault(); submit() }}>
    {fields.map(field => {
      const readOnly = field.readOnly === true
      const val = readOnly ? (field.value ?? '') : (draft[field.id] ?? '')
      const shared = {
        className: 'dvui-input', value: val, autoComplete: 'off', spellCheck: false,
        readOnly: !ctx.editable || readOnly, 'aria-label': field.label, placeholder: field.placeholder,
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { if (!readOnly) setDraft(current => ({ ...current, [field.id]: event.target.value })) },
      }
      return <label key={field.id} className="dvui-field"><span className="dvui-field-label">{field.label}</span>
        {field.multiline === true
          ? <textarea {...shared} rows={Math.min(10, Math.max(3, (val.match(/\n/g)?.length ?? 0) + 1))} onKeyDown={event => {
            if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey) || event.nativeEvent.isComposing) return
            event.preventDefault(); submit()
          }} />
          : <input {...shared} type="text" onKeyDown={event => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault(); submit()
          }} />}
      </label>
    })}
    <div className="dvui-actions">
      {node.cancelLabel && directAnswer(ctx) ? <ActionButton host={ctx.ButtonComponent} disabled={ctx.answerLocked} onClick={cancel}>{node.cancelLabel}</ActionButton> : null}
      {ctx.onFillDraft && ctx.onSubmit ? <ActionButton host={ctx.ButtonComponent} disabled={ctx.fillLocked} onClick={() => ctx.onFillDraft?.(node.id!, values())}>{t('Fill composer')}</ActionButton> : null}
      {ctx.onSubmit ? <ActionButton host={ctx.ButtonComponent} primary type="submit" disabled={ctx.answerLocked}>{node.submitLabel ?? t('Submit')}</ActionButton>
        : ctx.onFillDraft ? <ActionButton host={ctx.ButtonComponent} primary type="submit" disabled={ctx.fillLocked}>{t('Fill composer')}</ActionButton> : null}
    </div>
  </form>
}
// A settled form keeps a receipt line and read-only field values (when expanded) without editable inputs.
function SettledForm({ node, answer, t }: { node: ViewNode; answer?: Answer | null; t: ViewT }) {
  const sent = answerValues(answer, node)
  if (sent === undefined) return <div className="dvui-form">{fieldsOf(node).map(field => <div className="dvui-field" key={field.id}>
    <span className="dvui-field-label">{field.label}</span><span className="dvui-option-desc">{field.value || field.placeholder || ''}</span>
  </div>)}</div>
  const label = sent.canceled === true ? (node.cancelLabel ?? t('Cancel')) : (node.submitLabel ?? t('Submit'))
  const fieldMap = sent.canceled !== true && sent.fields !== null && typeof sent.fields === 'object' ? sent.fields as Record<string, unknown> : undefined
  const recorded = fieldMap ? fieldsOf(node).filter(field => String(fieldMap[field.id] ?? '') !== '') : []
  return <div className="dvui-form">
    {recorded.map(field => <div className="dvui-field" key={field.id}><span className="dvui-field-label">{field.label}</span><span className="dvui-option-desc">{String(fieldMap![field.id] ?? '')}</span></div>)}
    <div className="dvui-actions"><span className="dvui-badge">{label}</span></div>
  </div>
}
function WidgetTable({ node, lookup, Markdown, labels }: { node: ViewNode; lookup: (name: string) => unknown; Markdown: ComponentType<MarkdownProps>; labels: ViewLabels }) {
  const columns = Array.isArray(node.columns) ? node.columns : []
  const rows = (Array.isArray(node.rows) ? node.rows : []).map(row => (Array.isArray(row) ? row : []).map(cell => resolve(cell, lookup, '')))
  const numeric = columns.map((_, index) => {
    const cells = rows.map(row => row[index]).filter(cell => cell !== undefined && cell !== '')
    return cells.length > 0 && cells.every(cell => typeof cell === 'number' || (typeof cell === 'string' && NUMERIC_CELL.test(cell.trim())))
  })
  const caption = node.caption === undefined ? '' : asText(resolve(node.caption, lookup, ''))
  const renderCell = (raw: unknown) => {
    const text = cellText(raw)
    if (text !== '' && RICH_MARKDOWN_CELL.test(text)) return <Markdown text={text} labels={labels} variant="compact" />
    return text
  }
  return <div className="dvui-table-wrap">
    <div className="dvui-table"><table><thead><tr>{columns.map((column, index) => <th key={column.key ?? index} scope="col" className={numeric[index] ? 'dvui-num' : undefined}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{columns.map((column, index) => <td key={column.key ?? index} className={numeric[index] ? 'dvui-num' : undefined}>{renderCell(row[index])}</td>)}</tr>)}</tbody></table></div>
    {caption !== '' ? <div className="dvui-caption">{caption}</div> : null}
  </div>
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
  const resolved = resolve(node.value, lookup, '—')
  const unit = node.unit === undefined ? '' : asText(resolve(node.unit, lookup, ''))
  const display = `${typeof resolved === 'number' && Number.isFinite(resolved) ? grouped(resolved) : asText(resolved)}${unit ? ` ${unit}` : ''}`
  return <div className="dvui-metric" data-tone={TONES.includes(String(tone)) ? String(tone) : undefined}><span className="dvui-metric-label">{node.label}</span><span className="dvui-metric-value">{display}</span>{caption !== '' ? <span className="dvui-caption">{caption}</span> : null}</div>
}
function WidgetCallout({ node, lookup, Markdown, labels }: { node: ViewNode; lookup: (name: string) => unknown; Markdown: ComponentType<MarkdownProps>; labels: ViewLabels }) {
  const tone = resolve(node.tone, lookup)
  return <div className="dvui-callout" data-tone={CALLOUT_TONES.includes(String(tone)) ? String(tone) : 'info'}><span className="dvui-callout-icon" aria-hidden="true"><InfoIcon /></span><div><Markdown text={asText(resolve(node.text, lookup, ''))} labels={labels} variant="compact" /></div></div>
}
function WidgetSources({ node, t }: { node: ViewNode; t: ViewT }) {
  return <div className="dvui-sources" role="list" aria-label={t('Sources')}>{sourcesOf(node).map((item, index) => <a key={`${item.url}-${index}`} role="listitem" className="dvui-source" href={item.url} target="_blank" rel="noopener noreferrer" title={item.url}><LinkIcon />{item.label}</a>)}</div>
}
// A vertical rail of stage dots. Styles live inline because the view stylesheet
// is a separate contract; only status colours come from host tokens.
const STEP_DOT: Record<string, React.CSSProperties> = {
  done: { background: 'var(--dsw-alias-state-success-primary)' },
  active: { background: 'var(--dsw-alias-state-business-primary)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent)' },
  blocked: { background: 'var(--dsw-alias-state-error-primary)' },
  pending: { boxShadow: 'inset 0 0 0 1.5px var(--dsw-alias-border-l3)' },
}
const STEP_LABEL: Record<string, React.CSSProperties> = {
  active: { color: 'var(--dsw-alias-label-primary)', fontWeight: 600 },
  blocked: { color: 'var(--dsw-alias-state-error-primary)' },
  pending: { color: 'var(--dsw-alias-label-secondary)' },
  done: { color: 'var(--dsw-alias-label-primary)' },
}
function WidgetSteps({ node, lookup, t }: { node: ViewNode; lookup: (name: string) => unknown; t: ViewT }) {
  const items = stepsOf(node)
  return <ol className="dvui-steps" role="list" aria-label={t('Steps')} aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: 0, padding: 0, listStyle: 'none' }}>{items.map((item, index) => {
    const status = resolve(item.status, lookup, 'pending')
    const state = typeof status === 'string' && status in STEP_DOT ? status : 'pending'
    const detail = item.detail === undefined ? '' : asText(resolve(item.detail, lookup, ''))
    const last = index === items.length - 1
    return <li key={`${item.label}-${index}`} className="dvui-step" data-status={state} aria-current={state === 'active' ? 'step' : undefined}
      style={{ display: 'flex', gap: 10, minWidth: 0 }}>
      <span aria-hidden="true" style={{ flex: 'none', width: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ flex: 'none', width: 9, height: 9, marginTop: 6, borderRadius: '50%', ...STEP_DOT[state] }} />
        {last ? null : <span style={{ flex: '1 1 auto', width: 1.5, minHeight: 8, margin: '2px 0 -2px', background: 'var(--dsw-alias-border-l2)' }} />}
      </span>
      <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, paddingBottom: last ? 0 : 10 }}>
        <span style={{ fontSize: 13, lineHeight: '20px', fontWeight: 500, overflowWrap: 'anywhere', ...STEP_LABEL[state] }}>{item.label}</span>
        {detail !== '' ? <span className="dvui-option-desc">{detail}</span> : null}
      </span>
    </li>
  })}</ol>
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
function ChoiceInput({ node, ctx, t }: { node: ViewNode; ctx: Ctx; t: ViewT }) {
  const labelId = useId()
  const options = optionsOf(node)
  const declaredValues = useMemo(() => new Set(options.map(choiceValue)), [options])
  const current = ctx.values[node.id!]
  const multi = node.multi === true
  const allowCustom = node.allowCustom === true
  const customPlaceholder = node.customPlaceholder ?? t('Other…')
  const initialCustom = multi
    ? (Array.isArray(current) ? current.find(item => !declaredValues.has(item as never)) : undefined)
    : (current !== undefined && !declaredValues.has(current as never) ? current : undefined)
  const [customDraft, setCustomDraft] = useState<string>(() => typeof initialCustom === 'string' ? initialCustom : '')

  if (multi) {
    const list = Array.isArray(current) ? current : []
    const committedCustom = list.find(item => !declaredValues.has(item as never))
    const customChecked = committedCustom !== undefined
    const toggleDeclared = (val: unknown) => {
      const next = list.includes(val) ? list.filter(item => item !== val) : [...list, val]
      ctx.setInput(node.id!, next)
    }
    const updateCustom = (raw: string) => {
      setCustomDraft(raw)
      const base = list.filter(item => declaredValues.has(item as never))
      const trimmed = raw.trim()
      if (trimmed === '') ctx.setInput(node.id!, base)
      else if (declaredValues.has(trimmed)) ctx.setInput(node.id!, base.includes(trimmed) ? base : [...base, trimmed])
      else ctx.setInput(node.id!, [...base, trimmed])
    }
    return <div className="dvui-input-row">
      <span className="dvui-input-label" id={labelId}>{node.label}</span>
      <div className="dvui-checks" role="group" aria-labelledby={labelId}>
        {options.map(option => {
          const val = choiceValue(option)
          const checked = list.includes(val)
          return <button key={option.label} type="button" role="checkbox" className="dvui-check-option" aria-checked={checked} disabled={ctx.locked} onClick={() => toggleDeclared(val)}>
            <span className="dvui-check-box" aria-hidden="true">{checked ? <CheckIcon /> : null}</span>
            <span>{option.label}</span>
          </button>
        })}
        {allowCustom ? <div className="dvui-custom-row">
          <button
            type="button"
            role="checkbox"
            className="dvui-check-option"
            aria-checked={customChecked}
            aria-label={customPlaceholder}
            disabled={ctx.locked}
            onClick={() => {
              const base = list.filter(item => declaredValues.has(item as never))
              if (customChecked) ctx.setInput(node.id!, base)
              else if (customDraft.trim() !== '') ctx.setInput(node.id!, [...base, customDraft.trim()])
            }}
          >
            <span className="dvui-check-box" aria-hidden="true">{customChecked ? <CheckIcon /> : null}</span>
          </button>
          <input
            type="text"
            className="dvui-input dvui-custom-input"
            value={customDraft}
            disabled={ctx.locked}
            placeholder={customPlaceholder}
            aria-label={customPlaceholder}
            onChange={event => updateCustom(event.target.value)}
          />
        </div> : null}
      </div>
    </div>
  }

  if (allowCustom) {
    const isCustom = current !== undefined && !declaredValues.has(current as never)
    return <div className="dvui-input-row">
      <span className="dvui-input-label" id={labelId}>{node.label}</span>
      <div className="dvui-radios" role="radiogroup" aria-labelledby={labelId}>
        {options.map(option => <button key={option.label} type="button" role="radio" className="dvui-radio" aria-checked={choiceValue(option) === current} disabled={ctx.locked} onClick={() => ctx.setInput(node.id!, choiceValue(option))}><span className="dvui-radio-dot" aria-hidden="true" />{option.label}</button>)}
        <div className="dvui-custom-row">
          <button
            type="button"
            role="radio"
            className="dvui-radio"
            aria-checked={isCustom}
            aria-label={customPlaceholder}
            disabled={ctx.locked}
            onClick={() => { if (customDraft.trim() !== '') ctx.setInput(node.id!, customDraft.trim()) }}
          >
            <span className="dvui-radio-dot" aria-hidden="true" />
          </button>
          <input
            type="text"
            className="dvui-input dvui-custom-input"
            value={customDraft}
            disabled={ctx.locked}
            placeholder={customPlaceholder}
            aria-label={customPlaceholder}
            onFocus={() => { if (!ctx.locked && customDraft.trim() !== '') ctx.setInput(node.id!, customDraft.trim()) }}
            onChange={event => {
              const raw = event.target.value
              setCustomDraft(raw)
              if (raw.trim() !== '') ctx.setInput(node.id!, raw.trim())
            }}
          />
        </div>
      </div>
    </div>
  }

  const side = options.length <= 5 && options.every(option => [...option.label].length <= 16)
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
    case 'table': return <WidgetTable node={node} lookup={lookup} Markdown={Markdown} labels={labels} />
    case 'chart': return <WidgetChart node={node} lookup={lookup} registerChart={ctx.registerChart} refreshCharts={ctx.refreshCharts} t={t} />
    case 'progress': return <WidgetProgress node={node} lookup={lookup} t={t} />
    case 'callout': return <WidgetCallout node={node} lookup={lookup} Markdown={Markdown} labels={labels} />
    case 'sources': return <WidgetSources node={node} t={t} />
    case 'steps': return <WidgetSteps node={node} lookup={lookup} t={t} />
    case 'slider': return <SliderInput node={node} ctx={ctx} />
    case 'number': return <NumberInput node={node} ctx={ctx} />
    case 'choice': return <ChoiceInput node={node} ctx={ctx} t={t} />
    case 'toggle': return <ToggleInput node={node} ctx={ctx} />
    case 'submit': return ctx.settled || ctx.closed ? null : <div className="dvui-actions">
      {ctx.onFillDraft ? <ActionButton host={ctx.ButtonComponent} primary={!directAnswer(ctx)} disabled={ctx.fillLocked} onClick={() => ctx.onFillDraft?.(node.id!, {})}>{directAnswer(ctx) ? t('Fill composer') : node.label || t('Fill composer')}</ActionButton> : null}
      {directAnswer(ctx) ? <ActionButton host={ctx.ButtonComponent} primary disabled={ctx.answerLocked} onClick={() => ctx.onSubmit?.(node.id!, {})}>{node.label || t('Send')}</ActionButton> : null}
    </div>
    case 'options': return ctx.settled || !ctx.onSubmit && !ctx.onFillDraft ? <SettledOptions node={node} answer={ctx.answer} t={t} /> : <OptionsInput node={node} ctx={ctx} t={t} />
    case 'confirm': return ctx.settled || !ctx.onSubmit && !ctx.onFillDraft ? <SettledConfirm node={node} answer={ctx.answer} t={t} closed={ctx.closed} /> : <ConfirmInput node={node} ctx={ctx} t={t} />
    case 'form': return ctx.settled || !ctx.onSubmit && !ctx.onFillDraft ? <SettledForm node={node} answer={ctx.answer} t={t} /> : <FormInput node={node} ctx={ctx} t={t} />
    case 'math': case 'flow': case 'explore': case 'map': return <RichNode node={node} lookup={lookup} setInput={ctx.setInput} editable={ctx.editable} t={t} />
    default: return null
  }
}
export function WidgetView({ view, onSubmit, onFillDraft, settled = false, closed = false, answer = null, busy = false, ButtonComponent, registerChart, refreshCharts, t = english, labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }, Markdown = FallbackMarkdown, values: controlled, onValuesChange }: Omit<WidgetCardProps, 'title'> & { registerChart: Ctx['registerChart']; refreshCharts: () => void }) {
  const inputs = useMemo(() => viewInputs(view) as ViewNode[], [view])
  const [localValues, setLocalValues] = useState<Record<string, unknown>>(() => Object.fromEntries(inputs.map(node => [node.id, inputDefault(node)])))
  const supplied = controlled ?? localValues
  const values = useMemo(() => Object.fromEntries(inputs.map(node => [node.id,
    supplied && Object.hasOwn(supplied, node.id!) ? supplied[node.id!] : inputDefault(node)])), [inputs, supplied])
  const valueRef = useRef(values)
  valueRef.current = values
  const changeRef = useRef(onValuesChange)
  changeRef.current = onValuesChange
  const setInput = useCallback((id: string, value: unknown) => {
    const next = { ...valueRef.current }
    // Coordinates are formula bindings, not extra answer fields. Persist only
    // the math node's declared nested point map.
    const math = inputs.find(node => node.type === 'math' && node.mathPoints?.some(point => `${point.id}X` === id || `${point.id}Y` === id))
    const point = math?.mathPoints?.find(item => `${item.id}X` === id || `${item.id}Y` === id)
    if (math?.id && point) {
      const previous = next[math.id] !== null && typeof next[math.id] === 'object' && !Array.isArray(next[math.id])
        ? next[math.id] as Record<string, unknown> : mathDefaults(math)
      const pair: unknown[] = Array.isArray(previous[point.id]) ? [...previous[point.id] as unknown[]] : [point.x, point.y]
      pair[`${point.id}X` === id ? 0 : 1] = value
      next[math.id] = { ...previous, [point.id]: pair }
    } else next[id] = value
    valueRef.current = next
    setLocalValues(next)
    changeRef.current?.(next)
  }, [inputs])
  const sent = answer?.values?.inputs
  const current = (settled || closed) && sent !== null && typeof sent === 'object' ? { ...values, ...sent } : values
  const withInputs = (extra: Record<string, unknown>) => inputs.length > 0 ? { ...extra, inputs: current } : extra
  // Closed owns the rule in one place: the view answers nowhere, whatever the caller passed.
  const direct = closed ? undefined : onSubmit
  const draft = closed ? undefined : onFillDraft
  const submit = direct === undefined ? undefined : (action: string, extra: Record<string, unknown>) => direct(action, withInputs(extra))
  const fill = draft === undefined ? undefined : (action: string, extra: Record<string, unknown>) => draft(action, withInputs(extra))
  const editable = !settled && !closed && !busy && (submit !== undefined || fill !== undefined || hasInputs(view))
  const ctx: Ctx = {
    onSubmit: submit, onFillDraft: fill, settled, closed, answer, busy, editable, lookup: viewScope(view, current), values: current, ButtonComponent,
    locked: settled || closed || busy, answerLocked: settled || busy || submit === undefined, fillLocked: settled || busy || fill === undefined,
    setInput, registerChart, refreshCharts,
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
export function WidgetCard({ title = '', view, onSubmit, onFillDraft, onDismiss, busy = false, settled = false, closed = false, embedded = false, answer = null, t = english, labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }, Markdown = FallbackMarkdown, localOnly = false, localNote, ButtonComponent, values, onValuesChange }: WidgetCardProps) {
  const titleId = useId()
  const { charts, registerChart, refreshCharts } = useChartHandles()
  const collapsible = settled && !closed && answer !== null
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { setExpanded(false) }, [answer?.id, answer?.revision])
  const framed = hasType(view, new Set(['slider', 'number', 'choice', 'toggle', 'options', 'confirm', 'form', 'submit', 'math']))
  // Single standalone callouts or source strips already draw their own shell, so
  // they omit a redundant outer card box when untitled.
  const selfFramed = !title && !onDismiss && (view.type === 'callout' || view.type === 'sources')
  const showHead = Boolean(title || onDismiss || charts.length > 0)
  const toolsOnlyHead = !title && !onDismiss && charts.length > 0
  return <div className={`dvui-view ${framed ? 'dvui-framed' : 'dvui-bare'}${selfFramed ? ' dvui-bare-inline' : ''}${settled ? ' dvui-settled' : ''}${closed ? ' dvui-closed' : ''}${embedded ? ' dvui-embedded' : ''}${collapsible && !expanded ? ' dvui-collapsed' : ''}`} role="group" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : t('View')} aria-busy={busy || undefined}>
    {collapsible && answer ? <button type="button" className="dvui-settled-bar" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <span className="dvui-settled-check" aria-hidden="true"><CheckIcon /></span>
      <span className="dvui-settled-text">{settledCardSummary(title, view, answer, t)}</span>
      <span className="dvui-settled-toggle">{expanded ? t('Collapse') : t('Expand')}</span>
    </button> : null}
    {showHead ? <div className={`dvui-head${toolsOnlyHead ? ' dvui-head-tools-only' : ''}`}>{title ? <p className="dvui-title" id={titleId}>{title}</p> : null}{charts.length > 0 ? <ViewMenu charts={charts} t={t} /> : null}{onDismiss ? <button type="button" className="dvui-dismiss" aria-label={t('Dismiss view')} onClick={onDismiss} disabled={busy}>×</button> : null}</div> : null}
    <div className="dvui-body"><WidgetView view={view} onSubmit={onSubmit} onFillDraft={onFillDraft} settled={settled} closed={closed} answer={answer} busy={busy} ButtonComponent={ButtonComponent} registerChart={registerChart} refreshCharts={refreshCharts} t={t} labels={labels} Markdown={Markdown} values={values} onValuesChange={onValuesChange} /></div>
    {(localOnly || closed) && hasType(view, new Set(['options', 'confirm', 'form', 'submit'])) ? <p className="dvui-local-note" role="note">{localNote ?? t('Local preview only; this card does not send an answer.')}</p> : null}
  </div>
}
