import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MEMORY_ENTRY_MAX_CHARS, MEMORY_FILE, MEMORY_MAX_CHARS, MemoryNotes, addEntry, entriesOf, memorySection, normalizeEntry, removeEntry } from './memory.ts'

describe('notes text', () => {
  it('reads list items as entries and leaves other lines alone', () => {
    const text = '# About the human\n\n- calls me Dot\n* prefers short answers\nfree prose\n-not an item\n'
    expect(entriesOf(text)).toEqual(['calls me Dot', 'prefers short answers'])
    expect(normalizeEntry('  -  likes\n  tea ')).toBe('likes tea')
  })

  it('adds an entry at the end, once', () => {
    const first = addEntry('', 'likes tea')
    expect(first).toBe('- likes tea\n')
    const second = addEntry('# Notes\n\n- likes tea\n\n\n', '- works in Shanghai time')
    expect(second).toBe('# Notes\n\n- likes tea\n- works in Shanghai time\n')
    // The same note again changes nothing, whatever its letter case.
    expect(addEntry(second, 'LIKES TEA')).toBe(second)
  })

  it('refuses an empty note, an overlong one, and one that does not fit any more', () => {
    expect(() => addEntry('', '   ')).toThrow(/non-empty/)
    expect(() => addEntry('', 'x'.repeat(MEMORY_ENTRY_MAX_CHARS + 1))).toThrowError(expect.objectContaining({ code: 'dot/invalid' }))
    const full = `- ${'x'.repeat(MEMORY_MAX_CHARS - 20)}\n`
    expect(() => addEntry(full, 'one more thing to keep')).toThrowError(expect.objectContaining({ code: 'dot/memory-full' }))
  })

  it('removes the one entry a phrase singles out and keeps the rest of the file', () => {
    const text = '# Notes\n- likes green tea\n- likes short answers\nprose stays\n'
    expect(removeEntry(text, 'green')).toEqual({ text: '# Notes\n- likes short answers\nprose stays\n', removed: 'likes green tea' })
    // The whole entry wins over entries that merely contain it.
    expect(removeEntry('- tea\n- green tea\n', 'tea')).toEqual({ text: '- green tea\n', removed: 'tea' })
    expect(() => removeEntry(text, 'likes')).toThrowError(expect.objectContaining({ code: 'dot/ambiguous-note' }))
    expect(() => removeEntry(text, 'coffee')).toThrowError(expect.objectContaining({ code: 'dot/unknown-note' }))
    expect(() => removeEntry('prose only', 'prose')).toThrow(/no entry to remove/)
  })

  it('builds the prompt block only when there are notes, and caps what it carries', () => {
    expect(memorySection('  \n')).toBe('')
    const block = memorySection('- likes tea\n')
    expect(block.startsWith('[your notes]\n')).toBe(true)
    expect(block.endsWith('\n\n- likes tea')).toBe(true)
    const long = memorySection(`- ${'x'.repeat(MEMORY_MAX_CHARS + 500)}`)
    expect(long).toContain(`(cut here: the notes are longer than ${MEMORY_MAX_CHARS} characters)`)
    expect(long.length).toBeLessThan(MEMORY_MAX_CHARS + 600)
  })
})

describe('MemoryNotes', () => {
  it('reads a missing file as empty and replaces the file whole', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-dot-notes-'))
    try {
      const notes = new MemoryNotes(join(dir, 'home'))
      expect(notes.path).toBe(join(dir, 'home', MEMORY_FILE))
      expect(await notes.read()).toBe('')
      await notes.write('- likes tea\n')
      await notes.write('- likes coffee\n')
      expect(await readFile(notes.path, 'utf8')).toBe('- likes coffee\n')
      expect(await notes.read()).toBe('- likes coffee\n')
      // No draft file is left behind.
      expect(await readdir(join(dir, 'home'))).toEqual([MEMORY_FILE])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
