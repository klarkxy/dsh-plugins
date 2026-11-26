import { checkShownView, validateViewAnswer } from './core/index.js'
import { isRecord, VIEW_OWNER, type ViewAnswer, type ViewNode } from './contracts.ts'
import type { ReplySnapshot, ToolViewBlock } from './runtime.ts'
import { legacyAnswer } from './answer-text.ts'

/** Read visible, durable user/steering messages and synchronous ask_view tool results. */
export function replyAnswers(snapshot: ReplySnapshot): ReadonlyMap<string, ViewAnswer> {
  const answers = new Map<string, ViewAnswer>()
  type Card = { id: string; title: string; view: ViewNode; revision: number }
  // Cards with the same viewId are immutable revisions of one view. Only the
  // newest snapshot can still be answered, so merge to the latest revision
  // instead of letting two revisions compete over one composer message.
  let cards = new Map<string, Card>()
  const collect = (block: ToolViewBlock) => {
    const meta = block.meta
    if (block.kind === 'tool-result' && !block.isError && isRecord(meta) && meta.owner === VIEW_OWNER && meta.awaitReply === true && typeof meta.viewId === 'string') {
      const shown = checkShownView(meta.title, meta.view)
      if (!('error' in shown)) {
        const revision = typeof meta.revision === 'number' && Number.isSafeInteger(meta.revision) && meta.revision > 0 ? meta.revision : 1
        // Synchronous ask_view resolves inside the tool call itself and persists its validated answer on meta.answer.
        if (isRecord(meta.answer) && typeof meta.answer.id === 'string' && meta.answer.id === meta.viewId
          && typeof meta.answer.action === 'string' && isRecord(meta.answer.values)) {
          if (!answers.has(meta.viewId)) {
            answers.set(meta.viewId, { id: meta.viewId, action: meta.answer.action, values: meta.answer.values, revision })
          }
        } else if (revision >= (cards.get(meta.viewId)?.revision ?? 0)) {
          cards.set(meta.viewId, { id: meta.viewId, title: shown.title, view: shown.view, revision })
        }
      }
    }
    for (const child of block.subCalls ?? []) collect(child)
  }
  for (const key of snapshot.order) {
    const node = snapshot.nodes.get(key)
    if (node?.kind === 'tool-call' && node.data?.root) collect(node.data.root)
    if (node?.kind !== 'user' && node?.kind !== 'steering') continue
    const source = node.data?.source
    if (!isRecord(source) || source.kind !== 'user') continue
    // Only the very next human message can answer an old card, and it must
    // match exactly one card. Ambiguous/edited legacy text remains a preview.
    if (source.deepView === undefined) {
      const text = node.data?.content?.filter(isRecord).filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
      const candidates = [...cards.values()].map(card => ({ card, answer: legacyAnswer(card, text) }))
        .filter((candidate): candidate is { card: Card; answer: ViewAnswer } => candidate.answer !== null)
      if (candidates.length === 1 && !answers.has(candidates[0].answer.id)) {
        const [{ card, answer }] = candidates
        answers.set(card.id, { ...answer, revision: card.revision })
      }
    }
    cards = new Map()
    if (!isRecord(source.deepView)) continue
    const meta = source.deepView
    if (meta.owner !== VIEW_OWNER || meta.version !== 1 || !isRecord(meta.answer)) continue
    const answer = meta.answer
    if (typeof answer.id !== 'string' || typeof answer.action !== 'string' || !isRecord(answer.values)) continue
    // The first accepted reply settles a card; later inputs cannot change it.
    if (!answers.has(answer.id)) answers.set(answer.id, answer as ViewAnswer)
  }
  return answers
}

export function checkedAnswer(answer: ViewAnswer | undefined, id: string | undefined, view: ViewNode, revision?: number): ViewAnswer | null {
  if (!answer || !id || answer.id !== id || revision !== undefined && (answer.revision ?? 1) !== revision) return null
  const values = validateViewAnswer(view, answer.action, answer.values)
  return values.error === undefined ? { id, action: answer.action, values, ...(answer.revision !== undefined ? { revision: answer.revision } : {}) } : null
}

export function sameAnswers(left: ReadonlyMap<string, ViewAnswer>, right: ReadonlyMap<string, ViewAnswer>): boolean {
  return left.size === right.size && [...left].every(([id, answer]) => {
    const next = right.get(id)
    return next === answer || next?.action === answer.action && (next.revision ?? 1) === (answer.revision ?? 1)
      && JSON.stringify(next.values) === JSON.stringify(answer.values)
  })
}
