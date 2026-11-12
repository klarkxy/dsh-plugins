import { describe, expect, it } from 'vitest'
import { dotDomain, parseState } from './storage.ts'

// DotStore doubles do not validate records on open; exercise the real domain
// boundary too, since rejecting a v1 state here would prevent migration entirely.
describe('knowledge storage compatibility', () => {
  const legacy = {
    dotSessionId: 'dot-v1',
    dotWorkspaceId: 'workspace-v1',
    settings: {
      policy: '推送前问我',
      taskPermission: 'default',
      locks: { memory: true },
    },
    segment: {
      sessionId: 'dot-v1',
      startedAt: 100,
      persona: 'persona-v1',
      memory: '[your notes]\n- 普通开发任务用标准预设，不用破限',
      memorySeen: '[your notes]\n- updated',
    },
    memoryUndo: '- previous note\n',
    usageCarry: { input: 10, cacheRead: 20, cacheWrite: 0, output: 5 },
  }

  it('declares the previous domain version as readable', () => {
    expect(dotDomain.version).toBe(2)
    expect(dotDomain.compatibleVersions).toContain(1)
  })

  it('admits untouched v1 records at the real domain validation boundary', () => {
    const decoded = dotDomain.tables.state.valueSchema.parse(legacy)
    expect(decoded).toMatchObject(legacy)
    expect(parseState(decoded)).toMatchObject(legacy)
  })

  it('keeps old rows readable under the new unit version without knowledge fields', () => {
    const decoded = dotDomain.tables.state.valueSchema.parse({
      ...legacy,
      pastSegments: [{ sessionId: 'older', startedAt: 0, endedAt: 100, reason: 'manual' }],
    })
    expect(decoded.settings).toMatchObject({ taskPermission: 'default' })
    expect(decoded.dotSessionId).toBe('dot-v1')
    expect(decoded.segment?.memory).toContain('普通开发任务用标准预设，不用破限')
    expect(parseState(decoded).pastSegments).toHaveLength(1)
  })
})
