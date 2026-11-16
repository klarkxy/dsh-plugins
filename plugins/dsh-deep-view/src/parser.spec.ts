import { describe, expect, it } from 'vitest'
import { compileDeepUi, parseDeepUi } from './parser.ts'

const card = JSON.stringify({ title: 'Report', view: { type: 'metric', label: 'Revenue', value: 42 } })
describe('deepui fenced parser', () => {
  it('renders valid blocks and preserves ordinary Markdown around them', () => {
    const parts = parseDeepUi(`Before\n\`\`\`deepui\n${card}\n\`\`\`\nAfter`)
    expect(parts.map(part => part.kind)).toEqual(['markdown', 'view', 'markdown'])
    expect(parts[1].shown?.title).toBe('Report')
    expect(parts[2].text).toBe('After')
  })
  it('keeps an unclosed stream fence as Markdown', () => {
    const parts = parseDeepUi('Before\n```deepui\n{"view":')
    expect(parts.every(part => part.kind === 'markdown')).toBe(true)
    expect(parts.map(part => part.text).join('')).toBe('Before\n```deepui\n{"view":')
    expect(parts.at(-1)?.text).toContain('```deepui')
  })
  it('does not enter ordinary nested fences', () => {
    const source = `Before\n\`\`\`md\n\`\`\`deepui\n${card}\n\`\`\`\n\`\`\`\nAfter`
    const parts = parseDeepUi(source)
    expect(parts.every(part => part.kind === 'markdown')).toBe(true)
    expect(parts.map(part => part.text).join('')).toBe(source)
  })
  it('falls back for malformed JSON and invalid views including html', () => {
    for (const body of ['{broken', JSON.stringify({ type: 'html', html: '<script>1</script>', summary: 'bad' }), JSON.stringify({ view: { type: 'unknown' } })]) {
      const parts = parseDeepUi(`\`\`\`deep-view\n${body}\n\`\`\``)
      expect(parts).toHaveLength(1)
      expect(parts[0].kind).toBe('markdown')
    }
  })
  it('keeps source-offset keys stable as the tail grows', () => {
    const first = parseDeepUi(`Intro\n\`\`\`deepui\n${card}\n\`\`\`\nTail`)
    const second = parseDeepUi(`Intro\n\`\`\`deepui\n${card}\n\`\`\`\nTail grows`)
    expect(second.map(part => part.key)).toEqual(first.map(part => part.key))
  })
})

describe('compileDeepUi', () => {
  it('compiles a {title, view} body', () => {
    const compiled = compileDeepUi(card)
    expect(compiled.state).toBe('complete')
    expect(compiled.state === 'complete' && compiled.shown.title).toBe('Report')
  })
  it('compiles a bare ViewNode body', () => {
    const compiled = compileDeepUi(JSON.stringify({ type: 'metric', label: 'Revenue', value: 42 }))
    expect(compiled.state).toBe('complete')
  })
  it('reports incomplete JSON as partial and rejected views as invalid', () => {
    expect(compileDeepUi('{"title":"R','"view":{"type":"metric"}}').state).toBe('partial')
    expect(compileDeepUi('{broken').state).toBe('partial')
    const invalid = compileDeepUi(JSON.stringify({ view: { type: 'unknown' } }))
    expect(invalid.state).toBe('invalid')
    expect(invalid.state === 'invalid' && typeof invalid.error).toBe('string')
    expect(compileDeepUi(JSON.stringify({ type: 'html', html: '<script>1</script>' })).state).toBe('invalid')
  })
})
