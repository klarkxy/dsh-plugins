import { describe, expect, it, vi } from 'vitest'
import { forkSession, sendSessionMessage, type ActionServices, type ActionSessionController, type ActionWorkspaceRegistry } from './agent-actions.ts'

/** The caller the tool pipeline supplies through ToolExecution.agent. */
function caller(seqs: readonly number[] = [0, 1, 2]) {
  const events = seqs.map(seq => ({ seq }))
  return {
    agent: {
      session: {
        id: 'caller-1',
        header: {},
        snapshotEvents: () => events,
      },
    },
  } as never
}

function services(over: {
  controller?: Partial<ActionSessionController>
  registry?: ActionWorkspaceRegistry | 'absent'
} = {}): ActionServices {
  return {
    sessionController: {
      resolveAgent: vi.fn(async () => ({ agent: { id: 'agent-x', followup: vi.fn() } })),
      fork: vi.fn(async () => ({ sessionId: 'child-1' })),
      ...over.controller,
    },
    ...over.registry === 'absent'
      ? {}
      : { workspaceRegistry: over.registry ?? { archivedSessionIds: [] } },
  }
}

const signal = () => new AbortController().signal
const on = () => true

describe('fork_session action', () => {
  it('fails closed while the switch is off', async () => {
    const controller = { fork: vi.fn(), resolveAgent: vi.fn() }
    const outcome = await forkSession(services({ controller }), { prompt: 'go' }, caller(), signal(), () => false)
    expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_DISABLED' })
    expect(controller.fork).not.toHaveBeenCalled()
  })

  it('requires a calling agent, a prompt, a controller, and a non-empty log', async () => {
    expect(await forkSession(services(), { prompt: 'go' }, {}, signal(), on))
      .toMatchObject({ status: 'failed', code: 'SESSION_ACTION_INVALID' })
    expect(await forkSession(services(), { prompt: '  ' }, caller(), signal(), on))
      .toMatchObject({ status: 'failed', code: 'SESSION_ACTION_INVALID' })
    expect(await forkSession({ workspaceRegistry: { archivedSessionIds: [] } }, { prompt: 'go' }, caller(), signal(), on))
      .toMatchObject({ status: 'failed', code: 'SESSION_ACTION_UNAVAILABLE' })
    const forkless = services({ controller: { fork: undefined, resolveAgent: vi.fn() } })
    expect(await forkSession(forkless, { prompt: 'go' }, caller(), signal(), on))
      .toMatchObject({ status: 'failed', code: 'SESSION_ACTION_UNAVAILABLE' })
    expect(await forkSession(services(), { prompt: 'go' }, caller([]), signal(), on))
      .toMatchObject({ status: 'failed', code: 'SESSION_ACTION_INVALID' })
  })

  it('fails closed when the archive set cannot be read', async () => {
    for (const registry of [
      {},
      { archivedSessionIds: 'not-an-array' },
      { archivedSessionIds: undefined },
    ] as ActionWorkspaceRegistry[]) {
      const fork = vi.fn()
      const outcome = await forkSession(
        services({ controller: { fork }, registry }),
        { prompt: 'go' }, caller(), signal(), on)
      expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_UNAVAILABLE' })
      expect(fork).not.toHaveBeenCalled()
    }
  })

  it('forks at the caller log\'s latest seq and seeds the child with the verbatim prompt', async () => {
    const fork = vi.fn(async () => ({ sessionId: 'child-9' }))
    const followup = vi.fn()
    const resolveAgent = vi.fn(async () => ({ agent: { followup } }))
    const outcome = await forkSession(
      services({ controller: { fork, resolveAgent } }),
      { prompt: 'finish the audit' }, caller([0, 1, 7]), signal(), on)
    expect(outcome).toMatchObject({ status: 'ok', sessionId: 'child-9' })
    expect(typeof outcome.messageId).toBe('string')
    expect(fork).toHaveBeenCalledWith({ sessionId: 'caller-1', atSeq: 7 })
    expect(resolveAgent).toHaveBeenCalledWith('child-9')
    const message = followup.mock.calls[0]![0] as { source: Record<string, unknown>; content: { text: string }[] }
    expect(message.source).toMatchObject({ kind: 'agent-message', form: 'relay', senderSessionId: 'caller-1' })
    expect(message.content[0]).toEqual({ type: 'text', text: 'finish the audit' })
  })

  it('maps a rejected fork verbatim and never pretends a branch exists', async () => {
    const fork = vi.fn(async () => { throw Object.assign(new Error('no completed turn'), { code: 'session/fork-unavailable' }) })
    const outcome = await forkSession(services({ controller: { fork } }), { prompt: 'go' }, caller(), signal(), on)
    expect(outcome).toMatchObject({ status: 'failed', code: 'session/fork-unavailable' })
    expect(outcome).not.toMatchObject({ sessionId: expect.anything() })
    expect('partial' in outcome).toBe(false)
  })

  it('preserves the child id the host reports inside a failed fork', async () => {
    const fork = vi.fn(async () => {
      throw Object.assign(new Error('attach failed'), {
        code: 'session/workspace-attach-failed',
        details: { sessionId: 'child-attach', workspaceId: 'w1' },
      })
    })
    const outcome = await forkSession(services({ controller: { fork } }), { prompt: 'go' }, caller(), signal(), on)
    expect(outcome).toMatchObject({ status: 'failed', code: 'session/workspace-attach-failed', sessionId: 'child-attach', partial: true })
  })

  it('marks every failure after child creation as partial with the session id', async () => {
    for (const resolved of [
      { error: { code: 'session/writer-held', message: 'held' } },
      { agent: undefined },
      { agent: { followup: undefined } },
    ]) {
      const resolveAgent = vi.fn(async () => resolved as never)
      const outcome = await forkSession(
        services({ controller: { resolveAgent } }), { prompt: 'go' }, caller(), signal(), on)
      expect(outcome).toMatchObject({ status: 'failed', sessionId: 'child-1', partial: true })
    }
    const throwing = vi.fn(async () => { throw Object.assign(new Error('boom'), { code: 'gateway/internal' }) })
    const thrown = await forkSession(
      services({ controller: { resolveAgent: throwing } }), { prompt: 'go' }, caller(), signal(), on)
    expect(thrown).toMatchObject({ status: 'failed', code: 'gateway/internal', sessionId: 'child-1', partial: true })
  })

  it('does not deliver the prompt when the switch flips after the child exists', async () => {
    let allowed = true
    const followup = vi.fn()
    const resolveAgent = vi.fn(async () => { allowed = false; return { agent: { followup } } })
    const outcome = await forkSession(
      services({ controller: { resolveAgent } }), { prompt: 'go' }, caller(), signal(), () => allowed)
    expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_DISABLED', sessionId: 'child-1', partial: true })
    expect(followup).not.toHaveBeenCalled()
  })

  it('does not deliver the prompt when the call aborts after the child exists', async () => {
    const controller = new AbortController()
    const followup = vi.fn()
    const resolveAgent = vi.fn(async () => { controller.abort(); return { agent: { followup } } })
    const outcome = await forkSession(
      services({ controller: { resolveAgent } }), { prompt: 'go' }, caller(), controller.signal, on)
    expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_ABORTED', sessionId: 'child-1', partial: true })
    expect(followup).not.toHaveBeenCalled()
  })

  it('refuses an archived child and reports the partial fork', async () => {
    const outcome = await forkSession(
      services({ registry: { archivedSessionIds: ['child-1'] } }),
      { prompt: 'go' }, caller(), signal(), on)
    expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_ARCHIVED', sessionId: 'child-1', partial: true })
  })

  it('aborts a cancelled call without forking', async () => {
    const fork = vi.fn()
    const aborted = new AbortController()
    aborted.abort()
    const outcome = await forkSession(
      services({ controller: { fork } }), { prompt: 'go' }, caller(), aborted.signal, on)
    expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_ABORTED' })
    expect(fork).not.toHaveBeenCalled()
  })
})

describe('send_session_message action', () => {
  it('fails closed while the switch is off and resolves nothing', async () => {
    const resolveAgent = vi.fn()
    const outcome = await sendSessionMessage(
      services({ controller: { resolveAgent } }), { sessionId: 't', message: 'hi' }, caller(), signal(), () => false)
    expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_DISABLED' })
    expect(resolveAgent).not.toHaveBeenCalled()
  })

  it('requires a caller, another target, a message, and both host services', async () => {
    expect(await sendSessionMessage(services(), { sessionId: 't', message: 'hi' }, {}, signal(), on))
      .toMatchObject({ status: 'failed', code: 'SESSION_ACTION_INVALID' })
    expect(await sendSessionMessage(services(), { sessionId: 'caller-1', message: 'hi' }, caller(), signal(), on))
      .toMatchObject({ status: 'failed', code: 'SESSION_ACTION_INVALID' })
    expect(await sendSessionMessage(services(), { sessionId: ' ', message: 'hi' }, caller(), signal(), on))
      .toMatchObject({ status: 'failed', code: 'SESSION_ACTION_INVALID' })
    expect(await sendSessionMessage(services(), { sessionId: 't', message: ' ' }, caller(), signal(), on))
      .toMatchObject({ status: 'failed', code: 'SESSION_ACTION_INVALID' })
    expect(await sendSessionMessage({ workspaceRegistry: { archivedSessionIds: [] } }, { sessionId: 't', message: 'hi' }, caller(), signal(), on))
      .toMatchObject({ status: 'failed', code: 'SESSION_ACTION_UNAVAILABLE' })
    expect(await sendSessionMessage({ sessionController: services().sessionController }, { sessionId: 't', message: 'hi' }, caller(), signal(), on))
      .toMatchObject({ status: 'failed', code: 'SESSION_ACTION_UNAVAILABLE' })
  })

  it('fails closed when the archive set cannot be read', async () => {
    for (const registry of [
      {},
      { archivedSessionIds: 'not-an-array' },
      { archivedSessionIds: undefined },
    ] as ActionWorkspaceRegistry[]) {
      const resolveAgent = vi.fn()
      const outcome = await sendSessionMessage(
        services({ controller: { resolveAgent }, registry }),
        { sessionId: 't', message: 'hi' }, caller(), signal(), on)
      expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_UNAVAILABLE' })
      expect(resolveAgent).not.toHaveBeenCalled()
    }
  })

  it('refuses an archived target before any resolve', async () => {
    const resolveAgent = vi.fn()
    const outcome = await sendSessionMessage(
      services({ controller: { resolveAgent }, registry: { archivedSessionIds: ['t'] } }),
      { sessionId: 't', message: 'hi' }, caller(), signal(), on)
    expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_ARCHIVED' })
    expect(resolveAgent).not.toHaveBeenCalled()
  })

  it('rechecks the archive after the async resolve and never delivers', async () => {
    let archived: readonly string[] = []
    // The real registry replaces the array per projection, never mutates it:
    // the second check must read a FRESH list, not reuse a captured snapshot.
    const registry = { get archivedSessionIds() { return archived } }
    const followup = vi.fn()
    const resolveAgent = vi.fn(async () => {
      archived = ['t']
      return { agent: { followup } }
    })
    const outcome = await sendSessionMessage(
      services({ controller: { resolveAgent }, registry }),
      { sessionId: 't', message: 'hi' }, caller(), signal(), on)
    expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_ARCHIVED' })
    expect(followup).not.toHaveBeenCalled()
  })

  it('still catches the race when the registry swaps in a new array mid-flight', async () => {
    let archived: readonly string[] = []
    const registry = { get archivedSessionIds() { return archived } }
    const followup = vi.fn()
    const resolveAgent = vi.fn(async () => {
      // Swap in a brand-new array; a stale snapshot would miss this entry.
      archived = [...archived, 't-race']
      return { agent: { followup } }
    })
    const outcome = await sendSessionMessage(
      services({ controller: { resolveAgent }, registry }),
      { sessionId: 't-race', message: 'hi' }, caller(), signal(), on)
    expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_ARCHIVED' })
    expect(followup).not.toHaveBeenCalled()
  })

  it('maps resolve failures and delivers an agent-attributed wake otherwise', async () => {
    const busy = vi.fn(async () => ({ error: { code: 'session/agent-busy', message: 'subagent routing' } }))
    expect(await sendSessionMessage(
      services({ controller: { resolveAgent: busy } }), { sessionId: 't', message: 'hi' }, caller(), signal(), on))
      .toMatchObject({ status: 'failed', code: 'session/agent-busy' })
    const missing = vi.fn(async () => ({ error: { code: 'session/not-found', message: 'gone' } }))
    expect(await sendSessionMessage(
      services({ controller: { resolveAgent: missing } }), { sessionId: 't', message: 'hi' }, caller(), signal(), on))
      .toMatchObject({ status: 'failed', code: 'session/not-found' })

    const followup = vi.fn()
    const resolveAgent = vi.fn(async () => ({ agent: { followup } }))
    const outcome = await sendSessionMessage(
      services({ controller: { resolveAgent } }), { sessionId: 't-2', message: 'status?' }, caller(), signal(), on)
    expect(outcome).toMatchObject({ status: 'ok', sessionId: 't-2' })
    const message = followup.mock.calls[0]![0] as { id: string; source: Record<string, unknown>; content: { text: string }[] }
    expect((outcome as { messageId?: string }).messageId).toBe(message.id)
    expect(message.source).toMatchObject({ kind: 'agent-message', form: 'relay', senderSessionId: 'caller-1' })
    expect(message.content[0]).toEqual({ type: 'text', text: 'Agent caller-1 sent a message: status?' })
  })

  it('refuses a resolved subagent target and does not deliver', async () => {
    const followup = vi.fn()
    const resolveAgent = vi.fn(async () => ({
      agent: {
        followup,
        session: { id: 'child', header: { origin: 'subagent', delegationDepth: 1, parentSession: 'lead' } },
      },
    }))
    const outcome = await sendSessionMessage(
      services({ controller: { resolveAgent } }),
      { sessionId: 'child', message: 'hi' }, caller(), signal(), on)
    expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_INVALID' })
    expect(followup).not.toHaveBeenCalled()
  })

  it('does not deliver when the switch flips during the resolve', async () => {
    let allowed = true
    const followup = vi.fn()
    const resolveAgent = vi.fn(async () => { allowed = false; return { agent: { followup } } })
    const outcome = await sendSessionMessage(
      services({ controller: { resolveAgent } }), { sessionId: 't', message: 'hi' }, caller(), signal(), () => allowed)
    expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_DISABLED' })
    expect(followup).not.toHaveBeenCalled()
  })

  it('aborts between resolve and delivery without delivering', async () => {
    const controller = new AbortController()
    const followup = vi.fn()
    const resolveAgent = vi.fn(async () => {
      controller.abort()
      return { agent: { followup } }
    })
    const outcome = await sendSessionMessage(
      services({ controller: { resolveAgent } }), { sessionId: 't', message: 'hi' }, caller(), controller.signal, on)
    expect(outcome).toMatchObject({ status: 'failed', code: 'SESSION_ACTION_ABORTED' })
    expect(followup).not.toHaveBeenCalled()
  })
})
