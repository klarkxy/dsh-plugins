import type { SessionEvent } from '@deepseek-ai/dsh-session'

type Content = SessionEvent<'user/message'>['data']['content']

/**
 * The editor exposes joined text, while the host stores an ordered block list.
 * Apply the smallest single text replacement to that list. Unchanged text on
 * either side of an attachment stays on its own side; attachments never move.
 * Code points avoid splitting an emoji at a block boundary during replacement.
 */
export function editedPromptBlocks(content: Content, text: string | undefined): Content {
  const before = content.flatMap(block => block.type === 'text' ? Array.from(block.text) : [])
  if (text === undefined || before.join('') === text) return content
  const after = Array.from(text)
  let prefix = 0
  while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < Math.min(before.length, after.length) - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
  const end = before.length - suffix
  const replacement = after.slice(prefix, after.length - suffix).join('')
  let offset = 0
  let inserted = false
  const blocks = content.map(block => {
    if (block.type !== 'text') return block
    const chars = Array.from(block.text)
    const start = offset
    offset += chars.length
    const left = chars.slice(0, Math.max(0, prefix - start)).join('')
    const right = chars.slice(Math.max(0, end - start)).join('')
    const insertHere = !inserted && offset >= prefix
    if (insertHere) inserted = true
    return { type: 'text' as const, text: left + (insertHere ? replacement : '') + right }
  })
  if (!inserted && text !== '') blocks.push({ type: 'text', text })
  return blocks
}
