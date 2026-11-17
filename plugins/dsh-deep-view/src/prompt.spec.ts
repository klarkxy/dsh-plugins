import { describe, expect, it } from 'vitest'
import { compileDeepUi, parseDeepUi } from './parser.ts'
import { resolve, viewScope } from './core/index.js'
import { DEEP_VIEW_PROMPT } from './prompt.ts'
import { DEEP_VIEW_SKILL } from './skill.ts'

const examples = (text: string) => [...text.matchAll(/```deepui\n([\s\S]*?)\n```/g)].map(match => match[1]!)

describe('model-facing Deep View protocols', () => {
  it.each([
    ['direct prompt', DEEP_VIEW_PROMPT],
    ['reference skill', DEEP_VIEW_SKILL],
  ])('compiles every example in the %s through the real reply parser', (_name, text) => {
    const bodies = examples(text)
    expect(bodies.length).toBeGreaterThanOrEqual(3)
    for (const body of bodies) {
      const compiled = compileDeepUi(body)
      expect(compiled, body).toMatchObject({ state: 'complete' })
      const reply = `Explanation\n\n\`\`\`deepui\n${body}\n\`\`\`\n\nSource and caveat`
      const parts = parseDeepUi(reply)
      expect(parts.map(part => part.kind)).toEqual(['markdown', 'view', 'markdown'])
      expect(parts[0]!.text).toContain('Explanation')
      expect(parts[2]!.text).toContain('Source and caveat')
    }
  })

  it('provides comparison and architecture examples without loading a skill', () => {
    const views = examples(DEEP_VIEW_PROMPT).map(body => compileDeepUi(body))
    const types = views.flatMap(result => result.state === 'complete' ? [result.shown.view.type] : [])
    expect(types).toContain('table')
    expect(types).toContain('flow')
  })

  it('recalculates the directly supplied estimate with changed local inputs', () => {
    const compiled = examples(DEEP_VIEW_PROMPT).map(body => compileDeepUi(body))
      .find(result => result.state === 'complete' && result.shown.view.type === 'stack')
    expect(compiled?.state).toBe('complete')
    if (compiled?.state !== 'complete') throw new Error('Missing valid local estimate example')
    const view = compiled.shown.view
    const metric = view.children?.find(node => node.type === 'metric')
    expect(metric).toBeDefined()
    expect(resolve(metric!.value, viewScope(view))).toBe(20)
    expect(resolve(metric!.value, viewScope(view, { quantity: 3 }))).toBe(30)
    // Local input changes must not turn a display into a direct-answer request.
    expect(compiled.shown.interactive).toBe(false)
  })
})
