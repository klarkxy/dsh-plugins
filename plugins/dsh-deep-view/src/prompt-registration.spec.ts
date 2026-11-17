import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt, renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { apply, inject } from './index.ts'
import { DEEP_VIEW_PROMPT } from './prompt.ts'

const NAME = 'deep-view:reply-interface'
type AssemblyContext = { agent?: { session?: unknown }; toolSet?: ReadonlySet<string> }
type Contribution = {
  name: string
  order: number
  required?: boolean
  interpolate?: boolean
  text: (context: AssemblyContext) => string
}

function registrationHost(options: {
  existingTool?: boolean
  registerError?: Error
  contextError?: Error
} = {}) {
  const contexts = new Map<string, Contribution>()
  const tools = new Map<string, unknown>()
  const disposers: Array<() => void> = []
  const contextCalls: string[] = []
  if (options.existingTool) tools.set('show_view', { foreign: true })
  const host = {
    agents: { get: () => undefined, list: () => [], roots: () => [] },
    sessionController: { resolveAgent: async () => ({}) },
    sessions: { flush: async () => true },
    logger: { warn() {} },
    tools: {
      get: (name: string) => tools.get(name),
      register(definition: { name?: string }) {
        if (options.registerError) throw options.registerError
        const name = definition.name ?? 'show_view'
        tools.set(name, definition)
        return () => { tools.delete(name) }
      },
    },
    skills: { register: () => () => {} },
    webServer: { register: () => () => {} },
    systemPrompt: {
      context(contribution: Contribution) {
        contextCalls.push(contribution.name)
        if (options.contextError) throw options.contextError
        if (contexts.has(contribution.name)) throw new Error(`duplicate context ${contribution.name}`)
        contexts.set(contribution.name, contribution)
        return () => { contexts.delete(contribution.name) }
      },
    },
    effect(setup: () => (() => void) | void) {
      const dispose = setup()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    provide() {},
    on() { return () => {} },
  }
  return { host, contexts, tools, disposers, contextCalls }
}

const root = { agent: { id: 'root', session: { id: 'root', header: {} } } }
const fork = { agent: { id: 'fork', session: { header: { parentSession: 'previous', isSeeded: true, classification: 'ordinary' } } } }
const child = { agent: { id: 'child', session: { header: { origin: 'subagent', parentSession: 'lead', delegationDepth: 1 } } } }
const rootContext = { ...root, scope: root.agent }

function registered(contexts: Map<string, Contribution>): Contribution {
  const contribution = contexts.get(NAME)
  if (!contribution) throw new Error(`${NAME} was not registered`)
  return contribution
}

function officialHost(includeRuntimeContext = true) {
  const ctx = new Context()
  const systemPrompt = new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext })
  const fixture = registrationHost()
  fixture.host.systemPrompt.context = contribution => systemPrompt.context(contribution as never)
  return { ...fixture, ctx, systemPrompt, dispose: () => { for (const dispose of fixture.disposers) dispose() } }
}

describe('universal Deep View context with the official host service', () => {
  it.each([
    { complete: false, suppressed: false },
    { complete: true, suppressed: false },
    { complete: false, suppressed: true },
    { complete: true, suppressed: true },
  ])('preserves persona and reply context with %j', async ({ complete, suppressed }) => {
    const fixture = officialHost(!suppressed)
    const { host, systemPrompt } = fixture
    systemPrompt.section({ name: 'test:persona', order: 0, complete, text: 'The selected persona stays intact.' })
    systemPrompt.context({ name: 'test:optional', order: 100, text: 'Optional context' })
    try {
      await apply(host as never)
      const assembly = await systemPrompt.assemble(rootContext as never)
      expect(renderPrompt(assembly)).toBe('The selected persona stays intact.')
      expect(assembly.sections.some(section => section.name === NAME)).toBe(false)
      expect(assembly.contexts.filter(entry => entry.name === NAME)).toEqual([
        { name: NAME, text: DEEP_VIEW_PROMPT, interpolate: false },
      ])
      expect(assembly.contexts.some(entry => entry.name === 'test:optional')).toBe(!suppressed)
      expect(renderContextSnapshot(assembly)).toContain(DEEP_VIEW_PROMPT)
      const repeated = await systemPrompt.assemble(rootContext as never)
      expect(renderContextSnapshot(repeated)).toBe(renderContextSnapshot(assembly))
      expect(repeated.contexts.filter(entry => entry.name === NAME)).toHaveLength(1)
    } finally { fixture.dispose() }
    expect(renderContextSnapshot(await systemPrompt.assemble(rootContext as never))).not.toContain(DEEP_VIEW_PROMPT)
    expect(fixture.tools.has('show_view')).toBe(false)
  })

  it('keeps required guidance under independently disposable runtime suppressors', async () => {
    const fixture = officialHost()
    const { host, systemPrompt } = fixture
    systemPrompt.context({ name: 'test:optional', order: 100, text: 'Optional' })
    const first = systemPrompt.suppressRuntimeContext()
    const second = systemPrompt.suppressRuntimeContext()
    try {
      await apply(host as never)
      first()
      const suppressed = await systemPrompt.assemble(rootContext as never)
      expect(renderContextSnapshot(suppressed)).toContain(DEEP_VIEW_PROMPT)
      expect(suppressed.contexts.some(entry => entry.name === 'test:optional')).toBe(false)
      second()
      const restored = await systemPrompt.assemble(rootContext as never)
      expect(restored.contexts.filter(entry => entry.name === NAME)).toHaveLength(1)
      expect(restored.contexts.some(entry => entry.name === 'test:optional')).toBe(true)
    } finally { first(); second(); fixture.dispose() }
  })

  it('restores required context during admission after an assembly transform removes it', async () => {
    const fixture = officialHost(false)
    const { host, systemPrompt, ctx } = fixture
    systemPrompt.section({ name: 'test:complete', order: 0, complete: true, text: 'Complete prompt' })
    const remove = ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const result = await next()
      return { ...result, contexts: [] }
    })
    try {
      await apply(host as never)
      const transformed = await systemPrompt.assemble(rootContext as never)
      expect(transformed.contexts).toEqual([])
      const admitted = systemPrompt.refreshContext(transformed, rootContext as never)
      expect(renderPrompt(admitted)).toBe('Complete prompt')
      expect(renderContextSnapshot(admitted)).toContain(DEEP_VIEW_PROMPT)
      const repeated = systemPrompt.refreshContext(admitted, rootContext as never)
      expect(repeated.contexts.filter(entry => entry.name === NAME)).toHaveLength(1)
      expect(renderContextSnapshot(repeated)).toBe(renderContextSnapshot(admitted))
    } finally { remove(); fixture.dispose() }
  })

  it('keeps inline guidance alongside mode policy sections without exposing tools', async () => {
    const fixture = officialHost()
    const { host, systemPrompt } = fixture
    // These are policy-section fixtures, not end-to-end plan/PTC executors.
    systemPrompt.section({ name: 'plan:policy', order: 500, text: 'Plan before execution.' })
    systemPrompt.section({ name: 'ptc:policy', order: 800, text: 'Execute tools only through run_code.' })
    try {
      await apply(host as never)
      const assembly = await systemPrompt.assemble({ ...rootContext, toolSet: new Set() } as never)
      expect(renderPrompt(assembly)).toContain('Plan before execution.')
      expect(renderPrompt(assembly)).toContain('Execute tools only through run_code.')
      expect(assembly.tools).toEqual([])
      expect(renderContextSnapshot(assembly)).toContain(DEEP_VIEW_PROMPT)
    } finally { fixture.dispose() }
  })

  it('renders guidance for roots and human forks but not internal or unbound requests', async () => {
    const fixture = officialHost()
    try {
      await apply(fixture.host as never)
      for (const context of [root, fork]) {
        const assembly = await fixture.systemPrompt.assemble({ ...context, scope: context.agent } as never)
        expect(renderContextSnapshot(assembly)).toContain(DEEP_VIEW_PROMPT)
      }
      for (const context of [child, {}]) {
        const assembly = await fixture.systemPrompt.assemble(context as never)
        expect(renderContextSnapshot(assembly)).not.toContain(DEEP_VIEW_PROMPT)
      }
    } finally { fixture.dispose() }
  })
})

describe('Deep View context registration lifecycle', () => {
  it('registers one required literal context independent of agent registry and tool filters', async () => {
    expect(inject).toContain('systemPrompt')
    const { host, contexts, contextCalls } = registrationHost()
    await apply(host as never)
    expect(contextCalls).toEqual([NAME])
    expect(registered(contexts)).toMatchObject({ name: NAME, order: 850, required: true, interpolate: false })
    expect(registered(contexts).text(root)).toBe(DEEP_VIEW_PROMPT)
    expect(registered(contexts).text({ ...fork, toolSet: new Set() })).toBe(DEEP_VIEW_PROMPT)
    expect(registered(contexts).text(child)).toBe('')
    expect(registered(contexts).text({})).toBe('')
    expect(registered(contexts).text({ agent: { session: { id: 'bare' } } })).toBe('')
    expect(registered(contexts).text({ agent: { session: { header: 'subagent' } } })).toBe('')
  })

  it('releases context with the tool and supports a clean registration after reload', async () => {
    const { host, contexts, tools, disposers } = registrationHost()
    await apply(host as never)
    expect(contexts.size).toBe(1)
    for (const dispose of disposers) dispose()
    expect(contexts.size).toBe(0)
    expect(tools.size).toBe(0)
    disposers.length = 0
    await apply(host as never)
    expect(contexts.size).toBe(1)
    expect(registered(contexts).text(root)).toBe(DEEP_VIEW_PROMPT)
  })

  it('does not duplicate a live registration or dispose another instance', async () => {
    const { host, contexts, contextCalls, disposers } = registrationHost()
    await apply(host as never)
    const first = disposers.splice(0)
    await apply(host as never)
    expect(contextCalls).toEqual([NAME])
    for (const dispose of disposers) dispose()
    expect(contexts.size).toBe(1)
    for (const dispose of first) dispose()
    expect(contexts.size).toBe(0)
  })

  it('leaves no context when tool registration conflicts or fails', async () => {
    const conflict = registrationHost({ existingTool: true })
    await apply(conflict.host as never)
    expect(conflict.contextCalls).toEqual([])
    expect(conflict.tools.get('show_view')).toMatchObject({ foreign: true })
    const failed = registrationHost({ registerError: new Error('register failed') })
    await expect(apply(failed.host as never)).resolves.toBeUndefined()
    expect(failed.contexts.size).toBe(0)
    expect(failed.contextCalls).toEqual([])
    expect(failed.tools.size).toBe(0)
  })

  it('rolls back tool registration if context registration fails', async () => {
    const { host, contexts, contextCalls, tools } = registrationHost({ contextError: new Error('context failed') })
    await expect(apply(host as never)).resolves.toBeUndefined()
    expect(contextCalls).toEqual([NAME])
    expect(contexts.size).toBe(0)
    expect(tools.has('show_view')).toBe(false)
  })
})
