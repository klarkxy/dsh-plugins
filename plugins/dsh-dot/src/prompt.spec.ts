import { describe, expect, it } from 'vitest'
import { DOT_INSTRUCTIONS } from './prompt.ts'
import { formatNotices } from './batcher.ts'

describe('dot approval instructions', () => {
  it('keeps approval principles resident while notices contain only request facts', () => {
    for (const phrase of ['deleting data outside the project', 'pushing or publishing', 'spending money', 'credentials or secrets', 'allowed-once', 'explicit agreements']) {
      expect(DOT_INSTRUCTIONS).toContain(phrase)
    }
    const notice = formatNotices([{ sessionId: 'task', kind: 'approval', requestId: 'ap-1', text: 'ap-1 · task title · pwsh · sandbox boundary', at: 0 }])
    expect(notice).toContain('ap-1')
    expect(notice).toContain('sandbox boundary')
    expect(notice).not.toContain('credentials')
    expect(notice).not.toContain('Ask the human')
    expect(DOT_INSTRUCTIONS).not.toContain('instruction attached to it')
  })

  it('states human hard gates and applies the same approval rules to every preset', () => {
    expect(DOT_INSTRUCTIONS).toContain('When approvals=human, relay every approval to the human and never decide it yourself')
    expect(DOT_INSTRUCTIONS).toContain('When questions=human, relay every question unchanged and wait')
    expect(DOT_INSTRUCTIONS).toContain('including cordis tasks')
    expect(DOT_INSTRUCTIONS).not.toContain('allow all')
  })

  it('explains settled requests, permission boundaries and Windows retries', () => {
    expect(DOT_INSTRUCTIONS).toContain('Already settled')
    expect(DOT_INSTRUCTIONS).toContain('do not retry')
    expect(DOT_INSTRUCTIONS).toContain('spawn EPERM')
    expect(DOT_INSTRUCTIONS).toContain('taskPermission is independent')
    expect(DOT_INSTRUCTIONS).toContain('approval routing is not a sandbox or a guarantee')
  })

  it('closes every user-facing reply with one show_view card and keeps the background silent', () => {
    expect(DOT_INSTRUCTIONS).toContain('Every reply to the human ends with one show_view card')
    expect(DOT_INSTRUCTIONS).toContain('Calling it ends the turn at once')
    expect(DOT_INSTRUCTIONS).toContain('every ViewNode needs a "type" field')
    expect(DOT_INSTRUCTIONS).toContain('correct it and call it again in the same turn')
    expect(DOT_INSTRUCTIONS).toContain('A background wake-up with nothing the human must see')
    expect(DOT_INSTRUCTIONS).toContain('end that turn silently with no message')
  })

  it('allows small talk from memory only with an unverified caveat and checks exact answers in a task', () => {
    expect(DOT_INSTRUCTIONS).toContain('from memory and unverified')
    expect(DOT_INSTRUCTIONS).toContain('start a task to check rather than guess')
  })
})
