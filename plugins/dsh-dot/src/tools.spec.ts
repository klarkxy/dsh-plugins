import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { apply } from './tools.ts'
import { DEFAULT_SETTINGS, TOOL, type DotSettings } from './contracts.ts'
import { DEFAULT_PERSONA } from './persona.ts'

/** Load the preset row against a recording host: every definition must compile. */
function load(settings: { current: DotSettings; segment?: { sessionId: string; persona: string; opening?: string; memory?: string }; notes?: string } = { current: DEFAULT_SETTINGS }) {
  const registered: Array<Record<string, unknown>> = []
  const sections: Array<{ name: string; order: number; text: (context?: { agent?: { session?: { id?: string } } }) => string }> = []
  const ctx = {
    tools: { register(definition: Record<string, unknown>) { registered.push(definition); return () => {} } },
    systemPrompt: { section(section: (typeof sections)[number]) { sections.push(section); return () => {} } },
    dot: { store: { get settings() { return settings.current }, get segment() { return settings.segment } }, currentNotesBlock: () => settings.notes ?? '' },
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
    expect(readOnly).toEqual([TOOL.listModels, TOOL.listWorkspaces, TOOL.overview, TOOL.read, TOOL.readHistory, TOOL.readSettings, TOOL.scheduleList, TOOL.searchHistory].sort())
  })

  it('brings its companion plugin as a dependency, under the id its own bundle uses', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const rowsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/- id: (\S+)\s+name: '([^']+)'/g)].map(match => ({ id: match[1]!, name: match[2]! }))
    const rows = rowsOf(join(root, 'cordis.patch.yml'))
    const dependencies = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies
    // The host resolves a row's package through the bundle that declares it as a dependency.
    expect(rows.map(row => row.name)).toEqual(['@klarkxy/dsh-dev-index', '@klarkxy/dsh-dot'])
    for (const row of rows.slice(0, -1)) {
      expect(dependencies).toHaveProperty([row.name])
      // Same id as in the plugin's own patch, so installing it separately does not mount it twice.
      expect(rowsOf(join(root, '..', row.name.split('/')[1]!, 'cordis.patch.yml'))).toContainEqual(row)
    }
  })

  it('renders the persona from the live settings until a segment freezes it', () => {
    const settings: Parameters<typeof load>[0] = { current: DEFAULT_SETTINGS }
    const [section] = load(settings).sections
    expect(section).toMatchObject({ name: 'dsh-dot:persona', order: 1 })
    expect(section!.text()).toContain(DEFAULT_PERSONA)
    expect(section!.text()).toContain('称呼用户为“你”')
    settings.current = { ...DEFAULT_SETTINGS, persona: 'A calm librarian.', address: '老板' }
    expect(section!.text()).toContain('A calm librarian.')
    expect(section!.text()).not.toContain('鲸鱼娘')
    expect(section!.text()).toContain('自然地称呼用户为“老板”')
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
    const tool = load().find(row => row.name === TOOL.proposeSettings) as { execute(args: unknown): Promise<string> }
    await expect(tool.execute({ field: 'locks', value: {}, reason: 'unlock' })).resolves.toContain('Error [dot/failed]')
  })
})
