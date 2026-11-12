import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { apply } from './tools.ts'
import { DEFAULT_SETTINGS, TOOL, type DotSettings } from './contracts.ts'
import { DEFAULT_PERSONA } from './persona.ts'
import { settingsSnapshotBlock, SelfSettings } from './self-settings.ts'
import { DotStore } from './store.ts'

/** Load the preset row against a recording host: every definition must compile. */
function load(settings: { current: DotSettings; segment?: { sessionId: string; persona: string; opening?: string; memory?: string }; notes?: string } = { current: DEFAULT_SETTINGS }) {
  const registered: Array<Record<string, unknown>> = []
  const sections: Array<{ name: string; order: number; text: (context?: { agent?: { session?: { id?: string } } }) => string }> = []
  // Build a real SelfSettings backed by a real DotStore so the locks guard works.
  const store = new DotStore(undefined)
  const service = {
    store,
    memoryView: async () => ({ text: settings.notes ?? '', path: '/memory.md', maxChars: 4000, canUndo: false }),
    setMemory: async (text: string) => ({ text, path: '/memory.md', maxChars: 4000, canUndo: false }),
    settingsChanged: async () => {},
    serialSettings: async <T>(work: () => Promise<T>) => work(),
  }
  const realSelf = new SelfSettings(service as never)
  const ctx = {
    tools: { register(definition: Record<string, unknown>) { registered.push(definition); return () => {} } },
    systemPrompt: { section(section: (typeof sections)[number]) { sections.push(section); return () => {} } },
    dot: {
      store: { get settings() { return settings.current }, get segment() { return settings.segment } },
      currentNotesBlock: () => settings.notes ?? '',
      selfSettings: realSelf,
    },
    effect(fn: () => unknown) { fn() },
  }
  apply(ctx as never)
  return Object.assign(registered, { sections })
}

describe('dot tools', () => {
  it('compiles every tool definition through defineTool', () => {
    const names = load().map(tool => tool.name)
    expect([...names].sort()).toEqual([...Object.values(TOOL)].sort())
  })

  it('marks only the reading tools read-only', () => {
    const readOnly = load().filter(tool => tool.hostEffect === 'read-only').map(tool => tool.name).sort()
    // dot_schedule is NOT read-only: add and remove mutate state.
    // dot_settings is NOT read-only: propose mutates state.
    // dot_workspace is NOT read-only: create mutates state.
    expect(readOnly).toEqual([TOOL.listModels, TOOL.overview, TOOL.read, TOOL.readHistory, TOOL.searchHistory].sort())
  })

  it('registers dot_workspace (not the two old split tools)', () => {
    const names = load().map(tool => tool.name)
    expect(names).toContain(TOOL.workspace)
    expect(names).not.toContain('dot_list_workspaces')
    expect(names).not.toContain('dot_create_workspace')
  })

  it('registers dot_schedule (not the three old split tools)', () => {
    const names = load().map(tool => tool.name)
    expect(names).toContain(TOOL.schedule)
    expect(names).not.toContain('dot_schedule_add')
    expect(names).not.toContain('dot_schedule_list')
    expect(names).not.toContain('dot_schedule_remove')
  })

  it('registers dot_settings (not the two old split tools)', () => {
    const names = load().map(tool => tool.name)
    expect(names).toContain(TOOL.settings)
    expect(names).not.toContain('dot_read_settings')
    expect(names).not.toContain('dot_propose_settings')
  })

  it('no tool parameter schema uses oneOf / anyOf / allOf / union type', () => {
    const tools = load()
    const forbidden = ['oneOf', 'anyOf', 'allOf']
    for (const t of tools) {
      const json = JSON.stringify(t.parameters ?? {})
      for (const kw of forbidden) {
        expect(json, `${t.name as string} schema must not contain "${kw}"`).not.toContain(`"${kw}"`)
      }
      // union type like ["string","null"] is also forbidden
      expect(json, `${t.name as string} schema must not use type arrays`).not.toMatch(/"type"\s*:\s*\[/)
    }
  })

  it('brings only dsh-dot itself in cordis.patch.yml (dsh-dev-index removed)', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const rowsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/- id: (\S+)\s+name: '([^']+)'/g)].map(match => ({ id: match[1]!, name: match[2]! }))
    const rows = rowsOf(join(root, 'cordis.patch.yml'))
    expect(rows.map(r => r.name)).toEqual(['@klarkxy/dsh-dot'])
  })

  it('injects a settings-snapshot section between handoff and tools', () => {
    const settings = { current: { ...DEFAULT_SETTINGS, approvals: 'human' as const, scope: 'tracked' as const } }
    const snap = load(settings).sections.find(s => s.name === 'dsh-dot:settings-snapshot')
    expect(snap).toBeDefined()
    expect(snap!.order).toBeGreaterThan(3) // after handoff (order 3)
    const text = snap!.text()
    expect(text).toContain('scope: tracked')
    expect(text).toContain('approvals: human')
    // Live — not frozen by segment
    settings.current = { ...DEFAULT_SETTINGS, approvals: 'deny' as const }
    expect(snap!.text()).toContain('approvals: deny')
  })

  it('renders the persona from the live settings until a segment freezes it', () => {
    const settings: Parameters<typeof load>[0] = { current: DEFAULT_SETTINGS }
    const [section] = load(settings).sections
    expect(section).toMatchObject({ name: 'dsh-dot:persona', order: 1 })
    expect(section!.text()).toContain(DEFAULT_PERSONA)
    expect(section!.text()).toContain('\u201c你\u201d')  // DEFAULT_ADDRESS wrapped in curly quotes
    settings.current = { ...DEFAULT_SETTINGS, persona: 'A calm librarian.', address: '老板' }
    expect(section!.text()).toContain('A calm librarian.')
    expect(section!.text()).not.toContain('鲸鱼娘')
    expect(section!.text()).toContain('\u201c老板\u201d')  // custom address in curly quotes
    settings!.segment = { sessionId: 'dot1', persona: 'FROZEN PERSONA' }
    expect(section!.text()).toBe('FROZEN PERSONA')
    expect(section!.text({ agent: { session: { id: 'dot1' } } })).toBe('FROZEN PERSONA')
    // A session that is not the recorded segment still reads the live settings.
    expect(section!.text({ agent: { session: { id: 'dot2' } } })).toContain('A calm librarian.')
  })

  it('carries the notes between the persona and the handoff, as the segment froze them', () => {
    const settings: Parameters<typeof load>[0] = { current: DEFAULT_SETTINGS, notes: '[your notes]\n- live' }
    const memory = load(settings).sections[1]
    expect(memory).toMatchObject({ name: 'dsh-dot:memory', order: 2 })
    // No segment yet: the notes as they are now.
    expect(memory!.text()).toBe('[your notes]\n- live')
    settings!.segment = { sessionId: 'dot1', persona: 'P', memory: '[your notes]\n- frozen' }
    expect(memory!.text({ agent: { session: { id: 'dot1' } } })).toBe('[your notes]\n- frozen')
    // A session being set up is not the recorded segment and reads the live notes.
    expect(memory!.text({ agent: { session: { id: 'dot2' } } })).toBe('[your notes]\n- live')
    // A segment that started without notes keeps none, whatever was added since.
    settings!.segment = { sessionId: 'dot1', persona: 'P' }
    expect(memory!.text({ agent: { session: { id: 'dot1' } } })).toBe('')
  })

  it('adds the handoff block of the segment after the notes, and nothing in the first segment', () => {
    const settings: Parameters<typeof load>[0] = { current: DEFAULT_SETTINGS }
    const handoff = load(settings).sections[2]
    expect(handoff).toMatchObject({ name: 'dsh-dot:handoff', order: 3 })
    expect(handoff!.text()).toBe('')
    settings!.segment = { sessionId: 'dot1', persona: 'P', opening: '[conversation handoff] …' }
    expect(handoff!.text({ agent: { session: { id: 'dot1' } } })).toBe('[conversation handoff] …')
    expect(handoff!.text({ agent: { session: { id: 'dot2' } } })).toBe('')
  })

  it('does not expose locks or the workspace directory as a self-service setting', async () => {
    const tool = load().find(row => row.name === TOOL.settings) as { execute(args: unknown): Promise<string> }
    // propose with locked field should fail (SelfSettings.propose throws)
    await expect(tool.execute({ action: 'propose', field: 'locks', value: {}, reason: 'unlock' })).resolves.toContain('Error [dot/failed]')
  })
})

describe('settingsSnapshotBlock', () => {
  it('includes all core hard-switch fields', () => {
    const block = settingsSnapshotBlock(DEFAULT_SETTINGS)
    expect(block).toContain('scope: all')
    expect(block).toContain('approvals: dot')
    expect(block).toContain('questions: dot')
    expect(block).toContain('[settings snapshot')
  })

  it('includes taskPermission when present', () => {
    const settings = { ...DEFAULT_SETTINGS, taskPermission: 'workspace-write' } as unknown as DotSettings
    expect(settingsSnapshotBlock(settings)).toContain('taskPermission: workspace-write')
  })

  it('defaults taskPermission to "default" when absent', () => {
    expect(settingsSnapshotBlock(DEFAULT_SETTINGS)).toContain('taskPermission: default')
  })
})

