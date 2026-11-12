/**
 * The durable trace of a dot-scope show_view card.
 *
 * Dot's cards are shown once, by the single reply that ends the turn, and the
 * presentation payload lives only on that tool result. Later segments, the
 * handoff and the history search do not need the widget: they need everything
 * the card actually said. cardText() walks the whole view and renders every
 * node as readable text — text, metric, every table row, every chart series,
 * option descriptions, form labels and placeholders, source URLs and input
 * values — so a card stays fully searchable after the conversation moved on.
 * Formulas are resolved against the view's own inputs with deep-view's core
 * helpers, and nothing is clipped: the byte limit already lives in
 * checkShownView. A failed or malformed card contributes nothing.
 *
 * ViewPresentation is the metadata shape dsh-deep-view already persists for a
 * shown view; reusing it keeps the two plugins' result meta interchangeable.
 */
import { asText, checkShownView, choiceValue, inputDefault, resolve, viewScope } from '../../dsh-deep-view/src/core/index.js'
import { isRecord, VIEW_OWNER, type ViewNode, type ViewPresentation } from '../../dsh-deep-view/src/contracts.ts'

/** What output.presentationMeta stamps on a dot show_view result and the log keeps. */
export interface DotCardMeta extends ViewPresentation {
  /** The persistent card number the human sees as #N; interactive cards only. */
  readonly dotCard?: { readonly number?: number }
}

/** The canonical result of dot().presentCard, which tools.ts returns as the tool result. */
export interface DotCardResult {
  readonly status: 'shown' | 'pending'
  readonly summary: string
  readonly presentation: DotCardMeta
}

type Rec = Record<string, unknown>
const str = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
/** One readable field: whitespace flattened, never clipped. */
const flat = (value: unknown): string => str(value).replace(/\s+/g, ' ').trim()

/** A node's current value, resolved through the view's inputs and let names. */
const valueText = (value: unknown, lookup: (name: string) => unknown): string => flat(asText(resolve(value, lookup, '')))

/** The text of one input's current value. */
function inputText(node: Rec, value: unknown): string {
  if (node.type === 'toggle') return value === true ? 'on' : 'off'
  if (node.type === 'choice') {
    const options = Array.isArray(node.options) ? node.options : []
    const picked = options.find(option => isRecord(option) && choiceValue(option as { label?: string; value?: string | number | boolean }) === value)
    if (isRecord(picked) && typeof picked.label === 'string') return flat(picked.label)
    return flat(asText(value))
  }
  const unit = typeof node.unit === 'string' && node.unit ? ` ${node.unit}` : ''
  return `${flat(asText(value))}${unit}`
}

/** Every piece of one component, in a stable readable sentence. */
function componentText(node: Rec, lookup: (name: string) => unknown): string | undefined {
  switch (node.type) {
    case 'text':
      return `text: ${valueText(node.text, lookup)}`
    case 'metric': {
      const caption = node.caption === undefined ? '' : ` (${valueText(node.caption, lookup)})`
      return `metric: ${flat(node.label)}=${valueText(node.value, lookup)}${caption}`
    }
    case 'table': {
      const columns = Array.isArray(node.columns) ? node.columns : []
      const header = columns
        .map(column => isRecord(column) ? flat(column.label ?? column.key) : '')
        .filter(Boolean)
        .join('/')
      const rows = Array.isArray(node.rows) ? node.rows : []
      const body = rows
        .map(cells => Array.isArray(cells) ? cells.map(cell => valueText(cell, lookup)).join('/') : '')
        .filter(Boolean)
        .join('; ')
      return `table: ${header}${body ? `; rows: ${body}` : ''}`
    }
    case 'chart': {
      const categories = Array.isArray(node.categories) ? node.categories : []
      const unit = typeof node.unit === 'string' && node.unit ? ` ${node.unit}` : ''
      const series = (Array.isArray(node.series) ? node.series : []).filter(isRecord)
      const named = series.length > 1
      const body = series.map(entry => {
        const name = named && typeof entry.name === 'string' ? `${flat(entry.name)}: ` : ''
        const values = Array.isArray(entry.values) ? entry.values : []
        const points = categories.map((category, index) => `${flat(category)}=${valueText(values[index], lookup)}${unit}`)
        return `${name}${points.join(', ')}`
      }).join('; ')
      return `chart: ${body}`
    }
    case 'progress': {
      const max = Number(resolve(node.max, lookup, 0))
      const percent = node.percent !== undefined
        ? Number(resolve(node.percent, lookup, 0))
        : max > 0 ? (Number(resolve(node.value, lookup, 0)) / max) * 100 : 0
      const label = node.label === undefined ? '' : `${valueText(node.label, lookup)} `
      const valueLabel = node.valueLabel === undefined ? '' : ` ${valueText(node.valueLabel, lookup)}`
      return `progress: ${label}${Math.round(percent)}%${valueLabel}`
    }
    case 'callout':
      return `callout: ${valueText(node.text, lookup)}`
    case 'sources': {
      const items = Array.isArray(node.items) ? node.items : []
      const body = items
        .map(item => isRecord(item) ? `${flat(item.label)}=${flat(item.url)}` : '')
        .filter(Boolean)
        .join(', ')
      return `sources: ${body}`
    }
    case 'slider':
    case 'number':
    case 'choice':
    case 'toggle':
      return `${String(node.type)}: ${flat(node.label)}=${inputText(node, inputDefault(node as ViewNode))}`
    case 'options': {
      const options = Array.isArray(node.options) ? node.options : []
      const body = options
        .map(option => {
          if (!isRecord(option)) return ''
          const label = flat(option.label)
          return typeof option.description === 'string' && option.description ? `${label} (${flat(option.description)})` : label
        })
        .filter(Boolean)
        .join('/')
      return `options: ${body}`
    }
    case 'confirm':
      return 'confirm'
    case 'form': {
      const fields = Array.isArray(node.fields) ? node.fields : []
      const body = fields
        .map(field => {
          if (!isRecord(field)) return ''
          const label = flat(field.label ?? field.id)
          return typeof field.placeholder === 'string' && field.placeholder ? `${label} (${flat(field.placeholder)})` : label
        })
        .filter(Boolean)
        .join('/')
      return `form: ${body}`
    }
    case 'submit':
      return `submit: ${flat(node.label ?? 'Send')}`
    default:
      return undefined
  }
}

/** Walk the whole view: containers add nothing of their own, their children do. */
function collect(node: unknown, lookup: (name: string) => unknown, parts: string[]): void {
  if (!isRecord(node)) return
  const line = componentText(node, lookup)
  if (line !== undefined && line.trim() !== '') parts.push(line)
  if ((node.type === 'stack' || node.type === 'row') && Array.isArray(node.children)) {
    for (const child of node.children) collect(child, lookup, parts)
  }
}

/**
 * The persistent meta carried by a canonical show_view result, or undefined
 * when the call did not produce a card. tools.ts exposes this through
 * output.presentationMeta so the host stores it on the tool result.
 */
export function cardPresentation(result: unknown): DotCardMeta | undefined {
  if (!isRecord(result)) return undefined
  if (result.status !== 'shown' && result.status !== 'pending') return undefined
  const presentation = result.presentation
  if (!isRecord(presentation) || presentation.owner !== VIEW_OWNER) return undefined
  return presentation as unknown as DotCardMeta
}

/**
 * The readable text of one card, or undefined when the meta is not a valid
 * show_view card. It re-checks the view with the same validator deep-view uses,
 * so a card that failed never counts as something dot said.
 */
export function cardText(meta: unknown): string | undefined {
  if (!isRecord(meta) || meta.owner !== VIEW_OWNER) return undefined
  if (meta.status !== undefined && meta.status !== 'shown' && meta.status !== 'pending') return undefined
  const checked = checkShownView(meta.title, meta.view)
  if ('error' in checked) return undefined
  const title = checked.title || 'Card'
  const number = isRecord(meta.dotCard) && typeof meta.dotCard.number === 'number' && Number.isFinite(meta.dotCard.number)
    ? meta.dotCard.number
    : undefined
  const head = number === undefined ? title : `[#${number}] ${title}`
  const parts: string[] = []
  collect(checked.view, viewScope(checked.view as ViewNode), parts)
  const summary = parts.join('; ')
  return summary ? `${head} — ${summary}` : head
}

// Answers to a dot card are validated by the same code as deep-view's own
// replies; the root service uses this to settle a card's submission.
export { validateViewAnswer } from '../../dsh-deep-view/src/core/index.js'
