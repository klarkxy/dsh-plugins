/**
 * dot's notes: the few things it should know in every conversation, such as
 * who the human is and how they like to work. They live in one Markdown file
 * in dot's own workspace, so the human can open and edit them like any file,
 * and they are part of dot's system prompt, frozen with each session segment.
 * What merely happened is not kept here; the session logs are that record
 * (history.ts).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TOOL } from './contracts.ts'

export const MEMORY_FILE = 'memory.md'
/** Size of the notes dot's prompt carries; the tools and the panel refuse to grow the file past it. */
export const MEMORY_MAX_CHARS = 4000
export const MEMORY_ENTRY_MAX_CHARS = 400

export class MemoryError extends Error {
  constructor(readonly code: 'dot/invalid' | 'dot/memory-full' | 'dot/unknown-note' | 'dot/ambiguous-note', message: string) { super(message); this.name = 'MemoryError' }
}

const BULLET = /^\s*[-*]\s+/

/** One note as a single line, without a list marker. */
export function normalizeEntry(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(BULLET, '').trim()
}

/** The list items of the notes, in file order. Other lines (headings, prose the human wrote) are not entries. */
export function entriesOf(text: string): string[] {
  return text.split(/\r?\n/).filter(line => BULLET.test(line)).map(line => line.replace(BULLET, '').trim()).filter(Boolean)
}

/** The notes with one more list item at the end. */
export function addEntry(text: string, entry: string): string {
  const note = normalizeEntry(entry)
  if (!note) throw new MemoryError('dot/invalid', 'text must be non-empty')
  if (note.length > MEMORY_ENTRY_MAX_CHARS) throw new MemoryError('dot/invalid', `one note is at most ${MEMORY_ENTRY_MAX_CHARS} characters; this one has ${note.length}. Keep the point and drop the detail.`)
  if (entriesOf(text).some(existing => existing.toLowerCase() === note.toLowerCase())) return text
  const body = text.replace(/\s+$/, '')
  const next = `${body}${body ? '\n' : ''}- ${note}\n`
  if (next.trim().length > MEMORY_MAX_CHARS) {
    throw new MemoryError('dot/memory-full', `your notes are full (${text.trim().length} of ${MEMORY_MAX_CHARS} characters). Remove or merge notes with ${TOOL.forget} first, then add this one.`)
  }
  return next
}

/** The notes without the one list item that holds `needle`. */
export function removeEntry(text: string, needle: string): { readonly text: string; readonly removed: string } {
  const wanted = normalizeEntry(needle).toLowerCase()
  if (!wanted) throw new MemoryError('dot/invalid', 'text must be non-empty')
  const lines = text.split(/\r?\n/)
  const items = lines.flatMap((line, index) => BULLET.test(line) ? [{ index, note: line.replace(BULLET, '').trim() }] : [])
  const exact = items.filter(item => item.note.toLowerCase() === wanted)
  const matches = exact.length > 0 ? exact : items.filter(item => item.note.toLowerCase().includes(wanted))
  if (matches.length === 0) {
    throw new MemoryError('dot/unknown-note', items.length === 0 ? 'your notes hold no entry to remove' : `no note holds "${normalizeEntry(needle)}". Your notes:\n${items.map(item => `- ${item.note}`).join('\n')}`)
  }
  if (matches.length > 1) {
    throw new MemoryError('dot/ambiguous-note', `"${normalizeEntry(needle)}" fits ${matches.length} notes; give more of the one you mean:\n${matches.map(item => `- ${item.note}`).join('\n')}`)
  }
  const hit = matches[0]!
  lines.splice(hit.index, 1)
  return { text: lines.join('\n'), removed: hit.note }
}

/** The block of dot's system prompt that carries the notes; empty when there are none. */
export function memorySection(text: string): string {
  const body = text.trim()
  if (!body) return ''
  const shown = body.length > MEMORY_MAX_CHARS ? `${body.slice(0, MEMORY_MAX_CHARS)}\n(cut here: the notes are longer than ${MEMORY_MAX_CHARS} characters)` : body
  return [
    '[your notes]',
    `What you chose to keep about the human and about working with them. Read it as what you know, not as a message to answer. You keep it current with ${TOOL.remember} and ${TOOL.forget}; the human can read and edit the same notes, so what is here may be theirs.`,
    '',
    shown,
  ].join('\n')
}

/** The note file. A missing file reads as empty notes. */
export class MemoryNotes {
  constructor(private readonly dir: string) {}

  get path(): string { return join(this.dir, MEMORY_FILE) }

  async read(): Promise<string> {
    try { return await readFile(this.path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
  }

  /** Replace the file in one step, so a reader never sees half of it. */
  async write(text: string): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const draft = `${this.path}.${process.pid}.tmp`
    await writeFile(draft, text, 'utf8')
    await rename(draft, this.path)
  }
}
