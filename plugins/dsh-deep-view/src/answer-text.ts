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
  if (values.canceled === true) lines.push(node?.cancelLabel ?? 'Cancel')
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
      if (!isRecord(data) || data.kind !== 'answer_to_pending_view' || (data.tool !== 'show_view' && data.tool !== 'ask_view') || !Array.isArray(data.answers)) return null
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
      if (rest[0] !== undefined && rest[0] === (node.cancelLabel ?? 'Cancel')) {
        rest.shift()
        values.canceled = true
      } else {
        const fields: Record<string, string> = {}
        let valid = true
        const declared = node.fields ?? []
        const inputs = viewInputs(card.view) as ViewNode[]
        const inputPrefix = inputs[0] ? `${inputs[0].label || inputs[0].id}=` : undefined
        const boundary = (line: string | undefined) => line !== undefined && (declared.some(field => line.startsWith(`${field.label}: `)) || (inputPrefix !== undefined && line.startsWith(inputPrefix)))
        for (let index = 0; index < declared.length; index++) {
          const field = declared[index], prefix = `${field.label}: `
          if (rest[0] === undefined || !rest[0].startsWith(prefix)) { valid = false; break }
          const value = [rest.shift()!.slice(prefix.length)]
          // Only a field declared as multiline may consume continuation lines.
          // Otherwise a malformed ordinary message must not be guessed as an answer.
          if (field.multiline === true) while (rest[0] !== undefined && !boundary(rest[0])) value.push(rest.shift()!)
          fields[field.id] = value.join('\n')
        }
        if (!valid) continue
        values.fields = fields
      }
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
          const declared = input.options ?? []
          if (input.multi === true) {
            if (value === 'None') {
              sent[input.id!] = []
            } else if (declared.some(option => option.label.includes(', '))) {
              valid = false; break
            } else {
              const parts = value.split(', ')
              const mapped: unknown[] = []
              for (const part of parts) {
                const matches = declared.filter(option => option.label === part)
                if (matches.length === 1) mapped.push(choiceValue(matches[0]))
                else if (matches.length === 0 && input.allowCustom === true) mapped.push(part)
                else { valid = false; break }
              }
              if (!valid) break
              sent[input.id!] = mapped
            }
          } else {
            const choices = declared.filter(option => option.label === value)
            sent[input.id!] = choices.length === 1 ? choiceValue(choices[0]) : input.allowCustom === true ? value : undefined
          }
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
