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
    expect(dotDomain.version).toBe(3)
    expect(dotDomain.compatibleVersions).toEqual([1, 2])
  })

  it('admits untouched v1 records at the real domain validation boundary', () => {
    const decoded = dotDomain.tables.state.valueSchema.parse(legacy)
    expect(decoded).toMatchObject(legacy)
    expect(parseState(decoded)).toMatchObject(legacy)
  })

  it('round trips card state without overwriting existing settings or knowledge', () => {
    const value = { ...legacy, agreements: '- ask me', cognition: 'keep answers brief', cardSequence: 8, cards: [{
      id: 'dot-card-8', number: 8, sessionId: 'dot-v1', callId: 'c8', title: 'Choice',
      view: { type: 'confirm', id: 'confirm' }, expired: true,
    }], lastReplyAt: 250, lastConversationAt: 300 }
    const decoded = dotDomain.tables.state.valueSchema.parse(value)
    expect(parseState(decoded)).toMatchObject(value)
    expect(parseState(decoded).settings?.taskPermission).toBe('default')
  })

  it('does not reject the settings row when a historical view is no longer supported', () => {
    const value = { ...legacy, cards: [{ id: 'old', number: 1, sessionId: 'dot-v1', callId: 'c', title: 'Old card', view: { type: 'retired-component' }, expired: true }] }
    const decoded = dotDomain.tables.state.valueSchema.parse(value)
    expect(parseState(decoded).settings?.taskPermission).toBe('default')
    expect(parseState(decoded).cards).toHaveLength(1)
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
