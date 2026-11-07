import { describe, expect, it } from 'vitest'
import { AuxiliaryContextTooLargeError, buildAuxiliaryUserText, packAuxiliaryContext } from './auxiliary-context.ts'

describe('packAuxiliaryContext', () => {
  it('joins segments in order and skips blanks', () => {
    expect(packAuxiliaryContext(['a', 'b'], 100)).toBe('a\nb')
    expect(packAuxiliaryContext(['a', '', 'b'], 100)).toBe('a\nb')
    expect(packAuxiliaryContext([], 100)).toBe('')
  })

  it('fails loudly over budget instead of truncating', () => {
    expect(() => packAuxiliaryContext(['x'.repeat(64)], 10)).toThrow(AuxiliaryContextTooLargeError)
    expect(() => packAuxiliaryContext(['é'.repeat(10)], 19)).toThrow(AuxiliaryContextTooLargeError) // 20 bytes
    expect(packAuxiliaryContext(['é'.repeat(10)], 20)).toBe('é'.repeat(10))
    const error = new AuxiliaryContextTooLargeError(42, 10)
    expect(error.bytes).toBe(42)
    expect(error.maxBytes).toBe(10)
  })

  it('rejects a non-positive budget', () => {
    expect(() => packAuxiliaryContext(['a'], 0)).toThrow('Invalid auxiliary context budget')
  })
})

describe('buildAuxiliaryUserText', () => {
  it('is byte-identical to the plain text without context', () => {
    const text = '现有请求 body'
    expect(buildAuxiliaryUserText({ text })).toBe(text)
    expect(buildAuxiliaryUserText({ feature: 'f', context: [], text })).toBe(text)
    expect(buildAuxiliaryUserText({ context: '', text })).toBe(text)
  })

  it('puts stable material before the live request', () => {
    const out = buildAuxiliaryUserText({ context: 'facts', text: 'now' })
    expect(out).toBe('<auxiliary-context>\nfacts\n</auxiliary-context>\n<request>\nnow\n</request>')
    expect(out.indexOf('facts')).toBeLessThan(out.indexOf('now'))
  })

  it('stamps the feature attribute with sanitized characters', () => {
    const out = buildAuxiliaryUserText({ feature: 'review v2!"<', context: 'c', text: 't' })
    expect(out).toContain('<auxiliary-context feature="review_v2___">')
  })

  it('supports pre-ordered segments', () => {
    const out = buildAuxiliaryUserText({ context: ['s1', 's2'], text: 't' })
    expect(out).toContain('s1\ns2')
  })
})
