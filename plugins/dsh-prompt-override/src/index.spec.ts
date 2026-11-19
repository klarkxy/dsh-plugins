import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AssembledSection, PromptPresentation } from '@deepseek-ai/dsh-system-prompt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, resolveSettings } from './index.ts'
import { parseOverrides, readOverrides } from './overrides.ts'
import { rewriteSections, type RewriteSettings } from './rewrite.ts'
import { CORE_CONTRACT, CORE_SECTION, TOOL_REWRITES } from './texts.ts'

const defaults: RewriteSettings = { core: true, tools: true, devContext: 'auto', sections: {} }

function presentation(sections: AssembledSection[]): PromptPresentation {
  return { sections, contexts: [{ name: 'working-directory:current', text: 'cwd' }], variables: { model: 'm' } }
}

function nativeSections(persona = 'You are a coding agent powered by the {{model}} model.'): AssembledSection[] {
  return [
    { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
    { name: 'deployment:persona-prefix', text: persona },
    { name: 'tool:pwsh', text: 'native pwsh' },
    { name: 'tool:read', text: 'native read' },
    { name: 'tool:write', text: 'native write' },
    { name: 'tool:edit', text: '' },
    { name: 'tool:grep', text: 'native grep' },
    { name: 'deep-view:x', text: 'plugin text' },
    { name: 'harness:source', text: 'checkout notes' },
    { name: 'app:web-surface', text: 'web gui notes' },
    { name: 'deployment:persona-suffix', text: '' },
  ]
}

const names = (p: PromptPresentation): string[] => p.sections.map(s => s.name)
const text = (p: PromptPresentation, name: string): string | undefined => p.sections.find(s => s.name === name)?.text

describe('rewriteSections', () => {
  it('inserts the contract right after the persona and leaves contexts and variables alone', () => {
    const input = presentation(nativeSections())
    const out = rewriteSections(input, defaults)
    expect(names(out).slice(0, 3)).toEqual(['harness:identity', 'deployment:persona-prefix', CORE_SECTION])
    expect(text(out, CORE_SECTION)).toBe(CORE_CONTRACT)
    expect(out.sections.find(s => s.name === CORE_SECTION)?.interpolate).toBe(false)
    expect(out.contexts).toBe(input.contexts)
    expect(out.variables).toBe(input.variables)
    expect(input.sections).toHaveLength(11)
  })

  it('rewrites visible tool sections and keeps hidden ones empty', () => {
    const out = rewriteSections(presentation(nativeSections()), defaults)
    expect(text(out, 'tool:read')).toBe(TOOL_REWRITES['tool:read']!(() => true))
    expect(text(out, 'tool:pwsh')).toContain('[exit code: 1]')
    expect(text(out, 'tool:edit')).toBe('')
    // edit is hidden, so write must not recommend it; read is visible, so grep may.
    expect(text(out, 'tool:write')).not.toContain('edit')
    expect(text(out, 'tool:grep')).toContain('Use read on a matched file')
    expect(text(out, 'deep-view:x')).toBe('plugin text')
  })

  it('drops the development notes unless the persona works on DSH itself', () => {
    expect(names(rewriteSections(presentation(nativeSections()), defaults))).not.toContain('harness:source')
    const cordis = nativeSections('You are a coding agent.\nYou help the user customize DeepSeek Harness itself.')
    const kept = rewriteSections(presentation(cordis), defaults)
    expect(names(kept)).toContain('harness:source')
    expect(names(kept)).toContain('app:web-surface')
    expect(names(rewriteSections(presentation(nativeSections()), { ...defaults, devContext: 'keep' }))).toContain('harness:source')
    expect(names(rewriteSections(presentation(cordis), { ...defaults, devContext: 'drop' }))).not.toContain('harness:source')
  })

  it('honours the switches', () => {
    const out = rewriteSections(presentation(nativeSections()), { ...defaults, core: false, tools: false, devContext: 'keep' })
    expect(out.sections).toEqual(nativeSections())
  })

  it('applies user section overrides last without un-hiding sections', () => {
    const out = rewriteSections(presentation(nativeSections()), {
      ...defaults,
      coreText: 'my contract',
      sections: { 'tool:read': 'mine', 'tool:edit': 'should stay hidden', 'deep-view:x': null, 'missing': 'x' },
    })
    expect(text(out, CORE_SECTION)).toBe('my contract')
    expect(text(out, 'tool:read')).toBe('mine')
    expect(text(out, 'tool:edit')).toBe('')
    expect(names(out)).not.toContain('deep-view:x')
    expect(names(out)).not.toContain('missing')
  })

  it('places the contract first when there is no identity or persona, and never twice', () => {
    const out = rewriteSections(presentation([{ name: 'tool:read', text: 'r' }]), defaults)
    expect(names(out)).toEqual([CORE_SECTION, 'tool:read'])
    expect(names(rewriteSections(out, defaults)).filter(n => n === CORE_SECTION)).toHaveLength(1)
  })
})

describe('overrides', () => {
  let dir: string | undefined
  afterEach(() => { if (dir !== undefined) rmSync(dir, { recursive: true, force: true }); dir = undefined })

  it('keeps valid fields and reports invalid ones', () => {
    const { overrides, ignored } = parseOverrides({
      core: false, tools: 'yes', devContext: 'drop', coreText: 3, sections: { a: 'x', b: null, c: 1 },
    })
    expect(overrides).toEqual({ core: false, devContext: 'drop', sections: { a: 'x', b: null } })
    expect(ignored).toEqual(['tools', 'coreText', 'sections.c'])
    expect(parseOverrides([]).ignored).toEqual(['<root>'])
  })

  it('treats a missing file as empty and reports broken JSON', () => {
    dir = mkdtempSync(join(tmpdir(), 'prompt-override-'))
    expect(readOverrides(join(dir, 'none.json'))).toEqual({ overrides: {}, ignored: [] })
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ nope')
    expect(readOverrides(bad).error).toBeTypeOf('string')
    const good = join(dir, 'good.json')
    writeFileSync(good, '\uFEFF{"tools": false}')
    expect(readOverrides(good).overrides).toEqual({ tools: false })
  })

  it('lets the overrides file win over profile config', () => {
    expect(resolveSettings({ core: false, devContext: 'keep' }, { core: true })).toEqual({
      core: true, tools: true, devContext: 'keep', sections: {},
    })
  })
})

describe('apply', () => {
  it('registers one assemble listener that falls back to the native prompt on failure', async () => {
    const listeners: Array<(a: PromptPresentation, c: unknown, next: () => Promise<PromptPresentation>) => Promise<PromptPresentation>> = []
    const ctx = {
      effect: (fn: () => unknown) => { fn() },
      on: (event: string, fn: typeof listeners[number]) => { expect(event).toBe('system-prompt/assemble'); listeners.push(fn); return () => {} },
    }
    vi.stubEnv('DSH_HOME', mkdtempSync(join(tmpdir(), 'prompt-override-home-')))
    apply(ctx as never, {})
    vi.unstubAllEnvs()
    expect(listeners).toHaveLength(1)
    const ok = await listeners[0]!(presentation([]), {}, async () => presentation(nativeSections()))
    expect(names(ok)).toContain(CORE_SECTION)
    const broken = { sections: null } as unknown as PromptPresentation
    expect(await listeners[0]!(broken, {}, async () => broken)).toBe(broken)
  })
})
