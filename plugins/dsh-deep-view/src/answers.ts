import { checkShownView, validateViewAnswer } from './core/index.js'
import { isRecord, VIEW_OWNER, type ViewAnswer, type ViewNode } from './contracts.ts'
import type { ReplySnapshot, ToolViewBlock } from './runtime.ts'
import { legacyAnswer } from './answer-text.ts'

/** Read visible, durable user/steering messages only, including inherited history. */
export function replyAnswers(snapshot: ReplySnapshot): ReadonlyMap<string, ViewAnswer> {
  const answers = new Map<string, ViewAnswer>()
  let cards: { id: string; title: string; view: ViewNode }[] = []
  const collect = (block: ToolViewBlock) => {
    const meta = block.meta
    if (block.kind === 'tool-result' && !block.isError && isRecord(meta) && meta.owner === VIEW_OWNER && meta.awaitReply === true && typeof meta.viewId === 'string') {
      const shown = checkShownView(meta.title, meta.view)
      if (!('error' in shown)) cards.push({ id: meta.viewId, title: shown.title, view: shown.view })
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
      const candidates = cards.map(card => legacyAnswer(card, text)).filter((answer): answer is ViewAnswer => answer !== null)
      if (candidates.length === 1 && !answers.has(candidates[0].id)) answers.set(candidates[0].id, candidates[0])
    }
    cards = []
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

export function checkedAnswer(answer: ViewAnswer | undefined, id: string | undefined, view: ViewNode): ViewAnswer | null {
  if (!answer || !id || answer.id !== id) return null
  const values = validateViewAnswer(view, answer.action, answer.values)
  return values.error === undefined ? { id, action: answer.action, values } : null
}

export function sameAnswers(left: ReadonlyMap<string, ViewAnswer>, right: ReadonlyMap<string, ViewAnswer>): boolean {
  return left.size === right.size && [...left].every(([id, answer]) => {
    const next = right.get(id)
    return next === answer || next?.action === answer.action && JSON.stringify(next.values) === JSON.stringify(answer.values)
  })
}
