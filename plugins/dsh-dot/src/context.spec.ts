import { describe, expect, it } from 'vitest'
import { compactThreshold, contextView, EMPTY_SCAN, foldScan, rolloverThreshold, usageFromEvents } from './context.ts'
import { formatPercent, formatTokens } from './ui-copy.ts'
import { assembledSurface, officialSurfaceParts } from './context-surface.ts'
import type { RawEvent } from './chat.ts'

const ev = (seq: number, type: string, data: unknown): RawEvent => ({ seq, time: 1_000 + seq, type, data })

describe('context scan', () => {
  it('counts compactions and keeps the latest routed model', () => {
    const scan = foldScan(EMPTY_SCAN, [
      { type: 'request/header', data: { config: { provider: 'a', model: 'm1', maxTokens: 32_000 } } },
      { type: 'compaction/summary', time: 10 },
      { type: 'request/header', data: { config: { provider: 'b', model: 'm2' } } },
      { type: 'compaction/summary', time: 20 },
      { type: 'compaction/prune', time: 30 },
    ], 5)
    expect(scan).toEqual({ seq: 5, compactions: 2, lastCompactionAt: 20, provider: 'b', model: 'm2' })
    expect(foldScan(scan, [{ type: 'compaction/summary', time: 40 }], 6)).toMatchObject({ seq: 6, compactions: 3, lastCompactionAt: 40, model: 'm2' })
  })
})

describe('current context surface', () => {
  it('folds all seven categories from real event shapes and replaces tools and system', () => {
    const events = [
      ev(0, 'request/header', { header: { tools: [{ name: 'dot_overview', description: 'Show tasks' }], config: { provider: 'p', model: 'm', maxTokens: 4096 } } }),
      ev(1, 'system/message', { message: { content: [{ type: 'text', text: 'Old system' }] } }),
      ev(2, 'user/message', { content: [{ type: 'text', text: 'Hello Dorothy' }], source: { kind: 'user' } }),
      ev(3, 'user/message', { content: [{ type: 'text', text: 'Workspace: H:/work' }], source: { kind: 'plugin', plugin: 'dsh-test', form: 'snapshot' } }),
      ev(4, 'user/message', { content: [{ type: 'text', text: 'Use the demo skill' }], source: { kind: 'skill-invocation', name: 'demo' } }),
      ev(5, 'assistant/message', { message: { content: [{ type: 'text', text: 'Working on it' }] } }),
      ev(6, 'tool/call', { callId: 'c1', name: 'dot_overview', arguments: '{}' }),
      ev(7, 'tool/result', { message: { source: { callId: 'c1' }, content: [{ type: 'text', text: 'No tasks' }] } }),
      ev(8, 'tool/result', { message: { source: { callId: 'c2' }, content: [{ type: 'text', text: '<skill_content name="guide">Read this first</skill_content>' }] } }),
      ev(9, 'request/header', { header: { tools: [{ name: 'dot_read', description: 'Read a session' }] } }),
      ev(10, 'system/message', { message: { content: [{ type: 'text', text: 'New system' }] } }),
    ]
    const first = foldScan(EMPTY_SCAN, events.slice(0, 8), 8)
    const scan = foldScan(first, events.slice(8), 11)
    expect(scan).toMatchObject({ provider: 'p', model: 'm', maxTokens: 4096 })
    expect(scan.surface?.nodes.map(node => node.category)).toEqual(['user', 'inject', 'skill', 'assistant', 'tool', 'skill', 'tools', 'system'])
    expect(scan.surface?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'tools', name: 'dot_read', text: '{"name":"dot_read","description":"Read a session"}' }),
      expect.objectContaining({ category: 'system', text: 'New system' }),
      expect.objectContaining({ category: 'user', text: 'Hello Dorothy' }),
      expect.objectContaining({ category: 'inject', name: 'dsh-test', text: 'Workspace: H:/work' }),
      expect.objectContaining({ category: 'skill', name: 'demo', text: 'Use the demo skill' }),
      expect.objectContaining({ category: 'skill', name: 'guide', text: '<skill_content name="guide">Read this first</skill_content>' }),
      expect.objectContaining({ category: 'assistant', text: 'Working on it' }),
      expect.objectContaining({ category: 'tool', name: 'dot_overview', text: 'No tasks' }),
    ]))
    expect(scan.surface?.nodes.some(node => node.name === 'dot_overview' && node.category === 'tools')).toBe(false)
    expect(scan.surface?.nodes.some(node => node.text === 'Old system')).toBe(false)
    expect(scan.surface?.nodes.every(node => node.tokens > 0)).toBe(true)
  })

  it('removes compacted messages and keeps the current system and tools', () => {
    const scan = foldScan(EMPTY_SCAN, [
      ev(0, 'request/header', { header: { tools: [{ name: 'dot_read' }] } }),
      ev(1, 'system/message', { message: { content: [{ type: 'text', text: 'System' }] } }),
      ev(2, 'user/message', { content: [{ type: 'text', text: 'Old question' }], source: { kind: 'user' } }),
      ev(3, 'assistant/message', { message: { content: [{ type: 'text', text: 'Old answer' }] } }),
      ev(4, 'tool/result', { message: { content: [{ type: 'text', text: 'Old result' }] } }),
      ev(5, 'compaction/summary', { shadowedSeqs: [2, 3, 4] }),
      ev(6, 'user/message', { content: [{ type: 'text', text: 'New question' }], source: { kind: 'user' } }),
    ], 7)
    expect(scan.surface?.nodes.map(node => [node.category, node.text])).toEqual([
      ['tools', '{"name":"dot_read"}'], ['system', 'System'], ['user', 'New question'],
    ])
    expect(scan.surface && contextView(scan, {}).surface?.parts).toMatchObject({ assistant: 0, tool: 0 })
  })

  it('splits official message tokens by live shares without rounding drift', () => {
    const parts = officialSurfaceParts(
      { system: 7, tools: 20, user: 10, inject: 20, skill: 30, assistant: 40, tool: 0 },
      { system: 100, tools: 200, messages: 1000 },
    )
    expect(parts).toEqual({ system: 100, tools: 200, user: 100, inject: 200, skill: 300, assistant: 400, tool: 0 })
    const rounded = officialSurfaceParts(
      { system: 0, tools: 0, user: 1, inject: 1, skill: 1, assistant: 1, tool: 1 },
      { system: 0, tools: 0, messages: 3 },
    )
    expect(rounded.user + rounded.inject + rounded.skill + rounded.assistant + rounded.tool).toBe(3)
    expect(Object.values(rounded).every(value => value >= 0)).toBe(true)
  })
})

describe('compaction threshold', () => {
  it('follows compaction-basic: window fraction capped by output and headroom', () => {
    expect(compactThreshold(1_000_000)).toBe(900_000)
    expect(compactThreshold(200_000, 64_000)).toBe(200_000 - 64_000 - 16_384)
    expect(compactThreshold(16_000)).toBeUndefined()
    expect(compactThreshold(0)).toBeUndefined()
  })

  it('puts the rollover line below it, on what the output reservation leaves', () => {
    expect(rolloverThreshold(1_000_000)).toBe(700_000)
    expect(rolloverThreshold(200_000, 64_000)).toBe(95_200)
    expect(rolloverThreshold(200_000, 64_000)!).toBeLessThan(compactThreshold(200_000, 64_000)!)
    expect(rolloverThreshold(64_000, 8_000)!).toBeLessThan(compactThreshold(64_000, 8_000)!)
    // A small window: the compaction headroom would undercut the share, so the line stops at it.
    expect(rolloverThreshold(40_000, 2_000)).toBe(compactThreshold(40_000, 2_000))
    expect(rolloverThreshold(0)).toBeUndefined()
  })
})

describe('context view', () => {
  it('joins the projections with the scan', () => {
    const view = contextView({ seq: 3, compactions: 1, provider: 'p', model: 'm', maxTokens: 0 }, {
      contextPressure: { pressureTokens: 90_000, projectedTokens: 100_000, contextWindow: 1_000_000 },
      contextBreakdown: { systemTokens: 5_000, toolsTokens: 3_000, messageTokens: 70_000 },
      tokenUsage: { uncachedInputTokens: 10, cacheReadTokens: 90, cacheWriteTokens: 0, outputTokens: 7 },
    })
    expect(view).toEqual({
      live: true, provider: 'p', model: 'm', contextWindow: 1_000_000, usedTokens: 100_000, compactAt: 900_000, rolloverAt: 700_000, reservedOutput: 0,
      breakdown: { system: 5_000, tools: 3_000, messages: 70_000 },
      usage: { input: 10, cacheRead: 90, cacheWrite: 0, output: 7 },
      compactions: 1,
    })
  })

  it('uses the fallback window and leaves out what is missing', () => {
    const view = contextView(EMPTY_SCAN, {}, 128_000)
    expect(view).toEqual({ live: true, contextWindow: 128_000, compactAt: 128_000 - 16_384, rolloverAt: 89_600, compactions: 0 })
  })

  it('populates pre-first-turn breakdown and surface from the assembled prompt before step 1', () => {
    const assembly = assembledSurface({
      sections: [
        { name: 'dsh-dot:persona', text: 'You are Dorothy in {{cwd}}.' },
        { name: 'dsh-dot:handoff', text: '[conversation handoff]\nCarried context from {{cwd}}', interpolate: false },
      ],
      contexts: [{ name: 'time-context', text: 'Current date: 2026-11-12' }],
      variables: { cwd: 'H:/dot' },
      tools: [{ name: 'dot_overview', description: 'Show tracked tasks' }],
    })
    const preTurn = contextView(EMPTY_SCAN, {
      contextBreakdown: { systemTokens: 0, toolsTokens: 0, messageTokens: 0 },
    }, 1_000_000, assembly)
    expect(preTurn.usedTokens).toBeUndefined()
    expect(preTurn.breakdown?.system).toBeGreaterThan(0)
    expect(preTurn.breakdown?.tools).toBeGreaterThan(0)
    expect(preTurn.breakdown?.messages).toBeGreaterThan(0)
    expect(preTurn.surface?.nodes).toEqual([
      expect.objectContaining({ category: 'system', name: 'dsh-dot:persona', text: 'You are Dorothy in H:/dot.' }),
      expect.objectContaining({ category: 'system', name: 'dsh-dot:handoff', text: '[conversation handoff]\nCarried context from {{cwd}}' }),
      expect.objectContaining({ category: 'tools', name: 'dot_overview' }),
      expect.objectContaining({ category: 'inject', name: 'time-context', text: 'Current date: 2026-11-12' }),
    ])
    expect(officialSurfaceParts(preTurn.surface!.parts, preTurn.breakdown)).toEqual({
      system: preTurn.breakdown!.system,
      tools: preTurn.breakdown!.tools,
      user: 0,
      inject: preTurn.breakdown!.messages,
      skill: 0,
      assistant: 0,
      tool: 0,
    })

    const afterFirstTurn = foldScan(EMPTY_SCAN, [
      ev(0, 'request/header', { header: { tools: [{ name: 'dot_read' }] } }),
      ev(1, 'system/message', { message: { content: [{ type: 'text', text: 'Committed system' }] } }),
    ], 2)
    const committed = contextView(afterFirstTurn, {
      contextPressure: { pressureTokens: 500, projectedTokens: 500, contextWindow: 1_000_000 },
      contextBreakdown: { systemTokens: 200, toolsTokens: 300, messageTokens: 0 },
    }, 1_000_000, assembly)
    expect(committed.usedTokens).toBe(500)
    expect(committed.surface?.nodes.map(node => node.text)).toContain('Committed system')
    expect(committed.surface?.nodes.some(node => node.id.startsWith('pre:'))).toBe(false)
  })

  it('folds fallback token usage across assistant messages and replaces duplicate step buckets', () => {
    expect(usageFromEvents([
      ev(1, 'assistant/message', { turn: 1, step: 1, usage: { inputTokens: 100, cacheReadTokens: 250, cacheWriteTokens: 40, outputTokens: 30 } }),
      ev(2, 'assistant/message', { turn: 1, step: 1, usage: { inputTokens: 120, cacheReadTokens: 300, cacheWriteTokens: 40, outputTokens: 50 } }),
      ev(3, 'assistant/message', { turn: 1, step: 2, usage: { inputTokens: 30, cacheReadTokens: 100, outputTokens: 20 } }),
    ])).toEqual({ input: 150, cacheRead: 400, cacheWrite: 40, output: 70 })
  })
})

describe('number formats', () => {
  it('shortens tokens and percentages', () => {
    expect(formatTokens(860)).toBe('860')
    expect(formatTokens(12_400)).toBe('12.4K')
    expect(formatTokens(12_000)).toBe('12K')
    expect(formatTokens(512_000)).toBe('512K')
    expect(formatTokens(1_050_000)).toBe('1.05M')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatPercent(0.0123)).toBe('1.2%')
    expect(formatPercent(0.456)).toBe('46%')
  })
})
