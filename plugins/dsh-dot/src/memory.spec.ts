import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AGREEMENT_ENTRY_MAX_CHARS, AGREEMENTS_MAX_CHARS, COGNITION_FILE, COGNITION_MAX_CHARS, MEMORY_FILE, MemoryNotes,
  addEntry, agreementsSection, cognitionSection, entriesOf, normalizeAgreements, normalizeCognition, normalizeEntry, policyAsAgreements, removeEntry,
} from './memory.ts'

describe('agreements text', () => {
  it('reads list items as entries and leaves other lines alone', () => {
    const text = '# About the human\n\n- calls me Dot\n* prefers short answers\nfree prose\n-not an item\n'
    expect(entriesOf(text)).toEqual(['calls me Dot', 'prefers short answers'])
    expect(normalizeEntry('  -  likes\n  tea ')).toBe('likes tea')
  })

  it('adds an entry at the end, once', () => {
    const first = addEntry('', 'likes tea')
    expect(first).toBe('- likes tea\n')
    const second = addEntry('# Rules\n\n- likes tea\n\n\n', '- works in Shanghai time')
    expect(second).toBe('# Rules\n\n- likes tea\n- works in Shanghai time\n')
    // The same requirement again changes nothing, whatever its letter case.
    expect(addEntry(second, 'LIKES TEA')).toBe(second)
  })

  it('refuses an empty entry, an overlong one, and one that does not fit any more', () => {
    expect(() => addEntry('', '   ')).toThrow(/non-empty/)
    expect(() => addEntry('', 'x'.repeat(AGREEMENT_ENTRY_MAX_CHARS + 1))).toThrowError(expect.objectContaining({ code: 'dot/invalid' }))
    const full = `- ${'x'.repeat(AGREEMENTS_MAX_CHARS - 20)}\n`
    expect(() => addEntry(full, 'one more thing to keep')).toThrowError(expect.objectContaining({ code: 'dot/agreements-full' }))
  })

  it('removes the one entry a phrase singles out and keeps the rest of the text', () => {
    const text = '# Rules\n- likes green tea\n- likes short answers\nprose stays\n'
    expect(removeEntry(text, 'green')).toEqual({ text: '# Rules\n- likes short answers\nprose stays\n', removed: 'likes green tea' })
    // The whole entry wins over entries that merely contain it.
    expect(removeEntry('- tea\n- green tea\n', 'tea')).toEqual({ text: '- green tea\n', removed: 'tea' })
    expect(() => removeEntry(text, 'likes')).toThrowError(expect.objectContaining({ code: 'dot/ambiguous-agreement' }))
    expect(() => removeEntry(text, 'coffee')).toThrowError(expect.objectContaining({ code: 'dot/unknown-agreement' }))
    expect(() => removeEntry('prose only', 'prose')).toThrow(/no agreement to remove/)
  })

  it('builds the [agreements] block only when there are some, and caps what it carries', () => {
    expect(agreementsSection('  \n')).toBe('')
    const block = agreementsSection('- likes tea\n')
    expect(block.startsWith('[agreements]\n')).toBe(true)
    expect(block).toContain('take precedence over your cognition')
    expect(block.endsWith('\n\n- likes tea')).toBe(true)
    const longBody = `- ${'x'.repeat(AGREEMENTS_MAX_CHARS + 500)}\n- the tail rule must survive`
    const long = agreementsSection(longBody)
    expect(long).not.toContain('(cut here')
    expect(long).toContain('the tail rule must survive')
  })

  it('normalizes text the one canonical way', () => {
    expect(normalizeAgreements('  - a\r\n- b\r\n\r\n')).toBe('  - a\n- b\n')
    expect(normalizeAgreements('   ')).toBe('')
    expect(normalizeCognition('  line one\r\nline two\r\n')).toBe('  line one\nline two')
  })

  it('turns free-form policy lines into removable agreement items, keeping existing bullets', () => {
    expect(policyAsAgreements('推送前问我\n\n- 已有项\n* 星号项')).toBe('- 推送前问我\n- 已有项\n* 星号项')
    expect(entriesOf(policyAsAgreements('推送前问我'))).toEqual(['推送前问我'])
  })
})

describe('cognition text', () => {
  it('builds the [cognition] block only when there is some, and caps what it carries', () => {
    expect(cognitionSection('  ')).toBe('')
    const block = cognitionSection('I notice you dislike long preambles.')
    expect(block.startsWith('[cognition]\n')).toBe(true)
    expect(block).toContain('the agreements win')
    expect(block.endsWith('\n\nI notice you dislike long preambles.')).toBe(true)
    const long = cognitionSection(`x`.repeat(COGNITION_MAX_CHARS + 500) + ' tail')
    expect(long).not.toContain('(cut here')
    expect(long).toContain('tail')
  })
})

describe('MemoryNotes (legacy reader)', () => {
  it('reads missing files as empty and reads only, never writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-dot-legacy-'))
    try {
      const notes = new MemoryNotes(join(dir, 'home'))
      expect(notes.path).toBe(join(dir, 'home', MEMORY_FILE))
      expect(notes.cognitionPath).toBe(join(dir, 'home', COGNITION_FILE))
      expect(await notes.read()).toBe('')
      expect(await notes.readCognition()).toBe('')
      await mkdir(join(dir, 'home'), { recursive: true })
      await writeFile(join(dir, 'home', MEMORY_FILE), '- old rule\n', 'utf8')
      await writeFile(join(dir, 'home', COGNITION_FILE), 'old feeling', 'utf8')
      expect(await notes.read()).toBe('- old rule\n')
      expect(await notes.readCognition()).toBe('old feeling')
      expect('write' in notes).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
