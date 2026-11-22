import { describe, expect, it } from 'vitest'
import { compileDeepUi, parseDeepUi } from './parser.ts'
import { VIEW_BYTE_LIMIT } from './core/index.js'

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
  it('recognizes common casing and spelling variants of the fence language', () => {
    for (const language of ['DeepUI', 'deepview', 'deep-view', 'deep view', 'deep_ui', 'deepui 演示标题', 'deep view 演示标题']) {
      const parts = parseDeepUi(`\`\`\`${language}\n${card}\n\`\`\``)
      expect(parts.map(part => part.kind)).toEqual(['view'])
    }
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
  it('compiles a bare ViewNode body and lifts an inline title', () => {
    const compiled = compileDeepUi(JSON.stringify({ type: 'metric', title: 'Inline', label: 'Revenue', value: 42 }))
    expect(compiled.state).toBe('complete')
    expect(compiled.state === 'complete' && compiled.shown.title).toBe('Inline')
  })
  it('recovers trailing commas, comments and literal newlines inside strings only once final', () => {
    const lenient = `{
      // model comment
      "type": "callout",
      "text": "Line 1
Line 2",
    }`
    expect(compileDeepUi(lenient, true).state).toBe('complete')
    expect(compileDeepUi(lenient).state).toBe('partial')
  })
  it('repairs a missing key quote in a final body but never while streaming', () => {
    const body = '{"title":"T","type":"flow","id":"g","nodes":[{"id":"a","label":"A","x":0,y":10},{"id":"b","label":"B"}],"edges":[{"id":"e1","source":"a","target":"b"}]}'
    const compiled = compileDeepUi(body, true)
    expect(compiled.state).toBe('complete')
    const nodes = compiled.state === 'complete' ? (compiled.shown.view as { nodes: { id: string; y?: number }[] }).nodes : []
    expect(nodes.find(node => node.id === 'a')?.y).toBe(10)
    expect(compileDeepUi(body).state).toBe('partial')
  })
  it('repairs single quotes, unquoted keys and Python constants in a final body', () => {
    expect(compileDeepUi("{type:'callout', text:'hi', tone:'warn'}", true).state).toBe('complete')
    expect(compileDeepUi("{type:'toggle', id:'t', label:'L', value:False}", true).state).toBe('complete')
    expect(compileDeepUi("{type:'callout', text:'hi'}").state).toBe('partial')
  })
  it('refuses to repair a final body far above the view byte limit', () => {
    const compiled = compileDeepUi('{' + ' '.repeat(4 * VIEW_BYTE_LIMIT + 1), true)
    expect(compiled.state).toBe('invalid')
    expect(compiled.state === 'invalid' && compiled.error).toBe('JSON: the body is too large to repair')
  })
  it('reports incomplete JSON as partial and rejected views as invalid', () => {
    expect(compileDeepUi('{"title":"R').state).toBe('partial')
    expect(compileDeepUi('{broken').state).toBe('partial')
    const unrepairable = compileDeepUi('not json at all {', true)
    expect(unrepairable.state).toBe('invalid')
    expect(unrepairable.state === 'invalid' && unrepairable.error.startsWith('JSON:')).toBe(true)
    const invalid = compileDeepUi(JSON.stringify({ view: { type: 'unknown' } }))
    expect(invalid.state).toBe('invalid')
    expect(invalid.state === 'invalid' && typeof invalid.error).toBe('string')
    expect(compileDeepUi(JSON.stringify({ type: 'html', html: '<script>1</script>' })).state).toBe('invalid')
  })
  it('keeps an unrepairable closed fence as Markdown', () => {
    const parts = parseDeepUi('```deepui\nnot json at all {\n```')
    expect(parts.every(part => part.kind === 'markdown')).toBe(true)
  })
  it('recovers a closed fence with a missing key quote into a view part', () => {
    const body = '{"title":"T","type":"flow","id":"g","nodes":[{"id":"a","label":"A","x":0,y":10},{"id":"b","label":"B"}],"edges":[{"id":"e1","source":"a","target":"b"}]}'
    const parts = parseDeepUi(`Before\n\`\`\`deepui\n${body}\n\`\`\`\nAfter`)
    expect(parts.map(part => part.kind)).toEqual(['markdown', 'view', 'markdown'])
  })
})
