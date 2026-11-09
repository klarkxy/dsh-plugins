import { choiceValue, inputsSummary, validateViewAnswer, viewInputs } from './core/index.js'
import { isRecord, type ViewAnswer, type ViewNode } from './contracts.ts'

type Card = { id: string; title: string; view: ViewNode }
function controls(view: ViewNode): ViewNode[] {
  return ['options', 'confirm', 'form', 'submit'].includes(view.type)
    ? [view] : (view.children ?? []).flatMap(controls)
}

export function answerText(card: Pick<Card, 'title' | 'view'>, action: string, values: Record<string, unknown>): string {
  const node = controls(card.view).find(node => node.id === action)
  const lines = [card.title || 'Deep View']
  if (Array.isArray(values.selected)) lines.push(values.selected.map(String).join(', '))
  if (typeof values.confirmed === 'boolean') lines.push(values.confirmed
    ? node?.confirmLabel ?? 'Confirm' : node?.cancelLabel ?? 'Cancel')
  if (isRecord(values.fields)) {
    for (const field of node?.fields ?? []) lines.push(`${field.label}: ${String(values.fields[field.id] ?? '')}`)
  }
  const inputs = inputsSummary(card.view, values.inputs)
  if (inputs) lines.push(inputs)
  if (node?.type === 'submit') lines.push(node.label ?? 'Submit')
  return lines.join('\n')
}

/** Legacy messages have no metadata. Restore only unambiguous, fully validated
 * answers that reproduce the exact text written by this plugin. Never guess
 * from ordinary prose, and never modify the stored message. */
export function legacyAnswer(card: Card, text: string): ViewAnswer | null {
  if (text.startsWith('{')) {
    try {
      const data: unknown = JSON.parse(text)
      if (!isRecord(data) || data.kind !== 'answer_to_pending_view' || data.tool !== 'show_view' || !Array.isArray(data.answers)) return null
      const answer = data.answers.find(value => isRecord(value) && value.id === card.id)
      if (!isRecord(answer) || typeof answer.action !== 'string') return null
      const values = validateViewAnswer(card.view, answer.action, answer.values)
      return values.error === undefined ? { id: card.id, action: answer.action, values } : null
    } catch { return null }
  }
  const lines = text.split('\n')
  if (lines.shift() !== (card.title || 'Deep View')) return null
  const candidates: ViewAnswer[] = []
  for (const node of controls(card.view)) {
    const rest = [...lines]
    const values: Record<string, unknown> = {}
    if (node.type === 'options') {
      const line = rest.shift()
      if (line === undefined) continue
      const labels = node.options?.map(option => option.label) ?? []
      if (node.multi && labels.some(label => label.includes(', '))) continue
      values.selected = node.multi ? line.split(', ') : [line]
    } else if (node.type === 'confirm') {
      const line = rest.shift(), yes = node.confirmLabel ?? 'Confirm', no = node.cancelLabel ?? 'Cancel'
      if (yes === no || line !== yes && line !== no) continue
      values.confirmed = line === yes
    } else if (node.type === 'form') {
      const fields: Record<string, string> = {}
      let valid = true
      for (const field of node.fields ?? []) {
        const line = rest.shift(), prefix = `${field.label}: `
        if (line === undefined || !line.startsWith(prefix)) { valid = false; break }
        fields[field.id] = line.slice(prefix.length)
      }
      if (!valid) continue
      values.fields = fields
    }
    const inputs = viewInputs(card.view) as ViewNode[]
    if (inputs.length) {
      const pairs = rest.shift()?.split('; ')
      if (!pairs || pairs.length !== inputs.length) continue
      const sent: Record<string, unknown> = {}
      let valid = true
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i], prefix = `${input.label || input.id}=`
        if (!pairs[i].startsWith(prefix)) { valid = false; break }
        const value = pairs[i].slice(prefix.length)
        if (input.type === 'toggle') sent[input.id!] = value === 'on' ? true : value === 'off' ? false : undefined
        else if (input.type === 'choice') {
          const choices = input.options?.filter(option => option.label === value) ?? []
          sent[input.id!] = choices.length === 1 ? choiceValue(choices[0]) : undefined
        } else {
          const unit = input.unit ? ` ${input.unit}` : ''
          sent[input.id!] = !unit || value.endsWith(unit) ? Number(unit ? value.slice(0, -unit.length) : value) : undefined
        }
      }
      if (!valid) continue
      values.inputs = sent
    }
    if (node.type === 'submit' && rest.shift() !== (node.label ?? 'Submit')) continue
    if (rest.length || !node.id) continue
    const checked = validateViewAnswer(card.view, node.id, values)
    if (checked.error === undefined && answerText(card, node.id, checked) === text) {
      candidates.push({ id: card.id, action: node.id, values: checked })
    }
  }
  return candidates.length === 1 ? candidates[0] : null
}
