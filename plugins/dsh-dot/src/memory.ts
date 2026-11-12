/**
 * dot's two prompt blocks that the human and dot keep current:
 *
 * - agreements: the human's own standing requirements, written verbatim when
 *   they ask dot to remember something. They win over cognition on a clash.
 * - cognition: dot's own understanding of the human and of how to work with
 *   them, rewritten whole by dot or by the reflection pass.
 *
 * Both live in DotStore, not on disk, so a task opened in dot's workspace can
 * never edit them or inject into dot's prompt. This file holds the text rules
 * plus a one-time reader for the old memory.md / cognition.md files, which are
 * read once for migration and never authoritative afterwards.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AGREEMENTS_MAX_CHARS, AGREEMENT_ENTRY_MAX_CHARS, COGNITION_MAX_CHARS, TOOL } from './contracts.ts'

export { AGREEMENTS_MAX_CHARS, AGREEMENT_ENTRY_MAX_CHARS, COGNITION_MAX_CHARS }

/** Legacy note files, read once during migration. */
export const MEMORY_FILE = 'memory.md'
export const COGNITION_FILE = 'cognition.md'
export class KnowledgeError extends Error {
  constructor(readonly code: 'dot/invalid' | 'dot/agreements-full' | 'dot/unknown-agreement' | 'dot/ambiguous-agreement', message: string) { super(message); this.name = 'KnowledgeError' }
}
const BULLET = /^\s*[-*]\s+/

/** One agreement as a single line, without a list marker. */
export function normalizeEntry(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(BULLET, '').trim()
}

/** The list items of the agreements, in text order. Other lines (headings, prose) are not entries. */
export function entriesOf(text: string): string[] {
  return text.split(/\r?\n/).filter(line => BULLET.test(line)).map(line => line.replace(BULLET, '').trim()).filter(Boolean)
}

/**
 * Turn the old free-form "policy" into agreement list items so the agreements
 * tools (which work on list items) can find and remove them: one item per
 * non-empty line, keeping any existing bullet and the human's exact words.
 */
export function policyAsAgreements(policy: string): string {
  return policy
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => BULLET.test(line) ? line : `- ${line}`)
    .join('\n')
}

/** The agreements with one more list item at the end. */
export function addEntry(text: string, entry: string, maxChars = AGREEMENTS_MAX_CHARS, entryMaxChars = AGREEMENT_ENTRY_MAX_CHARS): string {
  const note = normalizeEntry(entry)
  if (!note) throw new KnowledgeError('dot/invalid', 'text must be non-empty')
  if (note.length > entryMaxChars) throw new KnowledgeError('dot/invalid', `one agreement is at most ${entryMaxChars} characters; this one has ${note.length}. Keep the point and drop the detail.`)
  if (entriesOf(text).some(existing => existing.toLowerCase() === note.toLowerCase())) return text
  const body = text.replace(/\s+$/, '')
  const next = `${body}${body ? '\n' : ''}- ${note}\n`
  if (next.trim().length > maxChars) {
    throw new KnowledgeError('dot/agreements-full', `your agreements are full (${text.trim().length} of ${maxChars} characters). Remove or merge one with ${TOOL.agreement} (action=remove) first, then add this one.`)
  }
  return next
}

/** The agreements without the one list item that holds `needle`. */
export function removeEntry(text: string, needle: string): { readonly text: string; readonly removed: string } {
  const wanted = normalizeEntry(needle).toLowerCase()
  if (!wanted) throw new KnowledgeError('dot/invalid', 'text must be non-empty')
  const lines = text.split(/\r?\n/)
  const items = lines.flatMap((line, index) => BULLET.test(line) ? [{ index, note: line.replace(BULLET, '').trim() }] : [])
  const exact = items.filter(item => item.note.toLowerCase() === wanted)
  const matches = exact.length > 0 ? exact : items.filter(item => item.note.toLowerCase().includes(wanted))
  if (matches.length === 0) {
    throw new KnowledgeError('dot/unknown-agreement', items.length === 0 ? 'there is no agreement to remove' : `no agreement holds "${normalizeEntry(needle)}". They are:\n${items.map(item => `- ${item.note}`).join('\n')}`)
  }
  if (matches.length > 1) {
    throw new KnowledgeError('dot/ambiguous-agreement', `"${normalizeEntry(needle)}" fits ${matches.length} agreements; give more of the one you mean:\n${matches.map(item => `- ${item.note}`).join('\n')}`)
  }
  const hit = matches[0]!
  lines.splice(hit.index, 1)
  return { text: lines.join('\n'), removed: hit.note }
}

/** The texts the human typed, stored the one canonical way. */
export function normalizeAgreements(text: string): string {
  const body = text.replace(/\r\n/g, '\n')
  return body.trim() ? `${body.replace(/\s+$/, '')}\n` : ''
}

export function normalizeCognition(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\s+$/, '')
}

/**
 * The [agreements] block of dot's system prompt; empty when there are none.
 * The text is carried whole, even past AGREEMENTS_MAX_CHARS: the limit guards new
 * writes, while a legacy policy import may legitimately exceed it and no user rule
 * at the tail may be cut out of the prompt.
 */
export function agreementsSection(text: string): string {
  const body = text.trim()
  if (!body) return ''
  return [
    '[agreements]',
    `The human's own standing requirements, in their words. They take precedence over your cognition: when the two conflict, follow the agreements. The human can read and edit them directly; you add one with ${TOOL.agreement} (action=add) only when they explicitly ask you to remember something, and remove one only when they say to drop it.`,
    '',
    body,
  ].join('\n')
}

/**
 * The [cognition] block of dot's system prompt; empty while dot has written none.
 * Like the agreements, it is carried whole; the size limit only guards new writes.
 */
export function cognitionSection(text: string): string {
  const body = text.trim()
  if (!body) return ''
  return [
    '[cognition]',
    `Your own understanding of the human and of how best to work with them — what you have noticed, felt and come to expect. Read it as what you know, not as a message to answer; keep it current by rewriting the whole text with ${TOOL.cognition}. The human can read it and roll it back. Whenever it conflicts with the agreements above, the agreements win.`,
    '',
    body,
  ].join('\n')
}

/** The legacy note files. A missing file reads as empty; only migration uses these. */
export class MemoryNotes {
  constructor(private readonly dir: string) {}

  get path(): string { return join(this.dir, MEMORY_FILE) }
  get cognitionPath(): string { return join(this.dir, COGNITION_FILE) }

  read(): Promise<string> { return this.readFile(this.path) }
  readCognition(): Promise<string> { return this.readFile(this.cognitionPath) }

  private async readFile(path: string): Promise<string> {
    try { return await readFile(path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
  }
}
