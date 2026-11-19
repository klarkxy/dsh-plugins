import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import type { AssembledSection, PromptPresentation } from '@deepseek-ai/dsh-system-prompt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, resolveSettings } from './index.ts'
import { expandHomePath, parseOverrides, readOverrides, resolveDshHome } from './overrides.ts'
import { isDshSelfAssembly, rewriteSections, type RewriteSettings } from './rewrite.ts'
import { CORE_CONTRACT, CORE_SECTION, TOOL_APPENDS, TOOL_REWRITES } from './texts.ts'

const defaults: RewriteSettings = { core: true, tools: true, devContext: 'auto', sections: {} }

function presentation(sections: AssembledSection[]): PromptPresentation {
  return { sections, contexts: [{ name: 'working-directory:current', text: 'cwd' }], variables: { model: 'm' } }
}

/** The persona the official cordis preset ships — still a template here; interpolation happens after the waterfall. */
const CORDIS_PERSONA = 'You are a coding agent powered by the {{model}} model.\nYou help the user customize DeepSeek Harness itself.'
const PLAIN_PERSONA = 'You are a coding agent powered by the {{model}} model.'

function nativeSections(persona = PLAIN_PERSONA): AssembledSection[] {
  return [
    { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
    { name: 'deployment:persona-prefix', text: persona },
    { name: 'tool:pwsh', text: 'native pwsh guidance with [exit code: N] notes' },
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

/** An agent whose composed preset the registry can resolve. */
function agentWithPreset(presetId: string | undefined): object {
  return {
    ctx: { get: () => ({ composedPreset: () => presetId }) },
    session: { header: presetId === undefined ? {} : { agentPreset: presetId } },
  }
}

const names = (p: PromptPresentation): string[] => p.sections.map(s => s.name)
const text = (p: PromptPresentation, name: string): string | undefined => p.sections.find(s => s.name === name)?.text

describe('isDshSelfAssembly', () => {
  it('trusts the composed preset id first: cordis keeps the dev sections even without the persona sentence', () => {
    expect(isDshSelfAssembly(undefined, agentWithPreset('cordis'))).toBe(true)
    // A preset that is not DSH-self: drop applies regardless of the persona text.
    expect(isDshSelfAssembly(CORDIS_PERSONA, agentWithPreset('writing'))).toBe(false)
  })

  it('falls back to the persona marker when no preset signal exists', () => {
    expect(isDshSelfAssembly(CORDIS_PERSONA, undefined)).toBe(true)
    expect(isDshSelfAssembly(PLAIN_PERSONA, undefined)).toBe(false)
  })

  it('keeps the dev sections when the persona is absent (fail-safe)', () => {
    expect(isDshSelfAssembly(undefined, undefined)).toBe(true)
  })
})

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

  it('drops the development notes for a plain-preset agent and keeps them for cordis', () => {
    const plain = rewriteSections(presentation(nativeSections()), defaults, agentWithPreset('writing'))
    expect(names(plain)).not.toContain('harness:source')
    expect(names(plain)).not.toContain('app:web-surface')

    const cordis = rewriteSections(presentation(nativeSections(CORDIS_PERSONA)), defaults, agentWithPreset('cordis'))
    expect(names(cordis)).toContain('harness:source')
    expect(names(cordis)).toContain('app:web-surface')

    // No agent signal at all: persona marker is the fallback, and a missing
    // persona fails safe to keep.
    expect(names(rewriteSections(presentation(nativeSections()), defaults, undefined))).not.toContain('harness:source')
    const noPersona = nativeSections()
    noPersona[1] = { name: 'deployment:persona-prefix', text: '' }
    expect(names(rewriteSections(presentation(noPersona), defaults, undefined))).toContain('harness:source')

    expect(names(rewriteSections(presentation(nativeSections()), { ...defaults, devContext: 'keep' }))).toContain('harness:source')
    expect(names(rewriteSections(presentation(nativeSections(CORDIS_PERSONA)), { ...defaults, devContext: 'drop' }))).not.toContain('harness:source')
  })

  it('rewrites visible tool sections and keeps hidden ones empty', () => {
    const out = rewriteSections(presentation(nativeSections()), defaults)
    expect(text(out, 'tool:read')).toBe(TOOL_REWRITES['tool:read']!(() => true))
    expect(text(out, 'tool:edit')).toBe('')
    // edit is hidden, so write must not recommend it; read is visible, so grep may.
    expect(text(out, 'tool:write')).not.toContain('edit')
    expect(text(out, 'tool:grep')).toContain('Use read on a matched file')
    expect(text(out, 'deep-view:x')).toBe('plugin text')
  })

  it('appends shell discipline to native bash/pwsh text instead of replacing it', () => {
    const out = rewriteSections(presentation(nativeSections()), defaults)
    const pwsh = text(out, 'tool:pwsh')!
    // The host's own exit-marker contract survives verbatim…
    expect(pwsh).toContain('native pwsh guidance with [exit code: N] notes')
    // …and our discipline is appended after it.
    expect(pwsh.endsWith(TOOL_APPENDS['tool:pwsh']!)).toBe(true)
    expect(pwsh.indexOf('native')).toBeLessThan(pwsh.indexOf('Use the shell for builds'))
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

  it('lets an explicit section override rescue a section the auto drop would remove', () => {
    const out = rewriteSections(presentation(nativeSections()), {
      ...defaults,
      sections: { 'harness:source': 'keep these notes' },
    })
    expect(text(out, 'harness:source')).toBe('keep these notes')
    expect(names(out)).not.toContain('app:web-surface')
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

  it('treats a missing file as empty and throws on a broken one', () => {
    dir = mkdtempSync(join(tmpdir(), 'prompt-override-'))
    expect(readOverrides(join(dir, 'none.json'))).toEqual({ overrides: {}, ignored: [] })
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ nope')
    expect(() => readOverrides(bad)).toThrow()
    const rooty = join(dir, 'root.json')
    writeFileSync(rooty, '[]')
    expect(() => readOverrides(rooty)).toThrow(/must contain a JSON object/)
    const good = join(dir, 'good.json')
    writeFileSync(good, '\uFEFF{"tools": false}')
    expect(readOverrides(good).overrides).toEqual({ tools: false })
  })

  it('expands ~ and resolves DSH_HOME the way the host does', () => {
    expect(expandHomePath('~').length).toBeGreaterThan(0)
    expect(resolveDshHome({ DSH_HOME: '~/dsh-homes/main' })).toContain('dsh-homes')
    expect(resolveDshHome({ DSH_HOME: 'relative/dir' })).toContain(sep)
    expect(resolveDshHome({ DSH_HOME: '  ' })).toContain('.dsh')
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
    const agent = agentWithPreset('cordis')
    const ok = await listeners[0]!(presentation([]), { agent }, async () => presentation(nativeSections(CORDIS_PERSONA)))
    expect(names(ok)).toContain(CORE_SECTION)
    // The listener reads the assembly's agent: a cordis child without the
    // persona sentence still keeps its dev sections.
    const child = await listeners[0]!(presentation([]), { agent }, async () => presentation(nativeSections()))
    expect(names(child)).toContain('harness:source')
    const broken = { sections: null } as unknown as PromptPresentation
    expect(await listeners[0]!(broken, {}, async () => broken)).toBe(broken)
  })
})
