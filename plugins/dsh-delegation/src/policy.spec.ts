import { describe, expect, it } from 'vitest'
import { EXECUTOR_PROMPT, EXECUTOR_REMINDER } from './prompts.ts'
import { delegationSectionText, delegationReminderText, type DelegationLookups, type DelegationSessionLike } from './policy.ts'

const top = (id: string): DelegationSessionLike => ({ id, header: {} })
const sub = (id: string, parentSession: string, delegationDepth = 1): DelegationSessionLike => ({
  id, header: { parentSession, origin: 'subagent', delegationDepth, isSeeded: true },
})
/** A human fork keeps parentSession for lineage but stays a top-level session. */
const fork = (id: string, parentSession: string): DelegationSessionLike => ({
  id, header: { parentSession, isSeeded: true },
})

function lookups(overrides: Partial<DelegationLookups> = {}): DelegationLookups {
  return {
    record: () => undefined,
    session: () => undefined,
    toolVisible: () => false,
    ...overrides,
  }
}

const context = (session: DelegationSessionLike | undefined) => ({
  agent: session === undefined ? undefined : { session },
  scope: { session },
})

describe.each([
  ['system section', delegationSectionText, EXECUTOR_PROMPT],
  ['role reminder', delegationReminderText, EXECUTOR_REMINDER],
] as const)('delegation %s policy', (_name, render, executorText) => {
  it('renders the coordinator text for an enabled top-level session with a visible tool', () => {
    const session = top('s1')
    const text = render(context(session), lookups({
      record: id => id === 's1' ? { enabled: true } : undefined,
      toolVisible: name => name === 'subagent',
    }))
    expect(text).toContain('Delegation mode')
    expect(text).toContain('`subagent`')
    expect(text).not.toContain('`subagent_fork`')
  })

  it('names every visible delegation tool', () => {
    const session = top('s1')
    const text = render(context(session), lookups({
      record: () => ({ enabled: true }),
      toolVisible: () => true,
    }))
    expect(text).toContain('`subagent`')
    expect(text).toContain('`subagent_fork`')
  })

  it('stays empty when the session record is disabled or missing', () => {
    const session = top('s1')
    for (const record of [() => ({ enabled: false }), () => undefined] as const) {
      expect(render(context(session), lookups({ record, toolVisible: () => true }))).toBe('')
    }
  })

  it('stays empty when no delegation tool is visible', () => {
    const session = top('s1')
    expect(render(context(session), lookups({
      record: () => ({ enabled: true }),
      toolVisible: () => false,
    }))).toBe('')
  })

  it('renders the executor text for a subagent whose root session is enabled', () => {
    const root = top('root')
    const child = sub('child', 'root')
    const text = render(context(child), lookups({
      record: id => id === 'root' ? { enabled: true } : undefined,
      session: id => id === 'root' ? root : undefined,
    }))
    expect(text).toBe(executorText)
  })

  it('stays empty for a subagent whose root session is disabled', () => {
    const root = top('root')
    const child = sub('child', 'root')
    expect(render(context(child), lookups({
      record: id => id === 'root' ? { enabled: false } : undefined,
      session: id => id === 'root' ? root : undefined,
    }))).toBe('')
  })

  it('walks nested subagent chains to the top-level root', () => {
    const root = top('root')
    const middle = sub('middle', 'root')
    const leaf = sub('leaf', 'middle', 2)
    const sessions = new Map([['root', root], ['middle', middle]])
    const text = render(context(leaf), lookups({
      record: id => id === 'root' ? { enabled: true } : undefined,
      session: id => sessions.get(id),
    }))
    expect(text).toBe(executorText)
  })

  it('stays empty when the parent chain cycles or goes missing', () => {
    const a = sub('a', 'b')
    const b = sub('b', 'a')
    const loop = new Map([['a', a], ['b', b]])
    expect(render(context(a), lookups({
      record: () => ({ enabled: true }),
      session: id => loop.get(id),
    }))).toBe('')
    const orphan = sub('orphan', 'gone')
    expect(render(context(orphan), lookups({
      record: () => ({ enabled: true }),
      session: () => undefined,
    }))).toBe('')
  })

  it('treats a human fork as top-level and uses its own record', () => {
    const root = top('root')
    const child = fork('fork', 'root')
    const text = render(context(child), lookups({
      record: id => id === 'fork' ? { enabled: true } : undefined,
      session: id => id === 'root' ? root : undefined,
      toolVisible: name => name === 'subagent',
    }))
    expect(text).toContain('Delegation mode')
    // A fork with an enabled parent but no record of its own stays off.
    expect(render(context(child), lookups({
      record: id => id === 'root' ? { enabled: true } : undefined,
      session: id => id === 'root' ? root : undefined,
      toolVisible: () => true,
    }))).toBe('')
  })

  it('stays empty without an agent context', () => {
    expect(render({}, lookups({ record: () => ({ enabled: true }), toolVisible: () => true }))).toBe('')
  })
})
