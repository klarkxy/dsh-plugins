import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import {
  commitRetry,
  previewRetry,
  retryCapabilities,
} from './retry-service.ts'
import type { RetryCommitRequest, RetryPreviewRequest } from './retry-contracts.ts'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { RetryJournal, type RetryRecord } from './retry-journal.ts'
import { createRetryModel, type SessionHost } from './session-actions.ts'

const SESSION_ID = 'retry-session'
const CHILD_ID = 'retry-child'
const scratch: string[] = []
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }) })

// Reload JSON bytes, not live objects, to model a new owner after process exit.
function durableStore() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-retry-'))
  scratch.push(dir)
  const path = join(dir, 'requests.json')
  writeFileSync(path, '{}')
  const open = () => {
    const rows = new Map<string, RetryRecord>(Object.entries(JSON.parse(readFileSync(path, 'utf8'))))
    const put = vi.fn(async (key: string, value: RetryRecord) => {
      rows.set(key, structuredClone(value))
      writeFileSync(path, JSON.stringify(Object.fromEntries(rows)))
    })
    const close = vi.fn(async () => {})
    return { journal: new RetryJournal({ table: () => ({ entries: () => rows.entries(), put }), close }), put, close }
  }
  return { open }
}

function ev(seq: number, type: string, data: unknown, extra?: Record<string, unknown>): SessionEvent {
  return { seq, type, data, time: 0, ...extra } as unknown as SessionEvent
}

function prompt(seq: number, id: string, content: readonly unknown[]): SessionEvent {
  return ev(seq, 'user/message', { id, role: 'user', source: { kind: 'user' }, content })
}

function baseEvents(): SessionEvent[] {
  return [
    ev(0, 'turn/start', { turn: 1 }),
    prompt(1, 'm1', [{ type: 'text', text: 'first prompt' }]),
    ev(2, 'step/start', { turn: 1, step: 1 }),
    ev(3, 'turn/end', { turn: 1, reason: 'completed' }),
    ev(4, 'turn/start', { turn: 2 }),
    prompt(5, 'm2', [{ type: 'text', text: 'second prompt' }]),
    ev(6, 'step/start', { turn: 2, step: 1 }),
    ev(7, 'tool/result', { turn: 2, step: 1, message: { id: 'r1', role: 'tool', content: [{ type: 'text', text: 'ok' }] } }),
    ev(8, 'assistant/message', { turn: 2, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'answer' }] } }),
    ev(9, 'turn/end', { turn: 2, reason: 'completed' }),
  ]
}

interface Fakes {
  retryJournal: RetryJournal
  sessionQuery: SessionQueryEngine
  agents: { get(id: string): { status?: string } | undefined }
  sessionController: {
    resolveAgent: ReturnType<typeof vi.fn>
    fork: ReturnType<typeof vi.fn>
    rename: ReturnType<typeof vi.fn>
    prompt: ReturnType<typeof vi.fn>
    attachment: ReturnType<typeof vi.fn>
  }
  workspaceController: {
    follow: (signal: AbortSignal) => AsyncIterable<unknown>
    insertSessionBefore: ReturnType<typeof vi.fn>
    pinSession: ReturnType<typeof vi.fn>
    archiveSession: ReturnType<typeof vi.fn>
  }
  attachments: { readFileStream: (ref: unknown, signal: AbortSignal) => AsyncIterable<Uint8Array> }
  fileUploads: { uploadStream: ReturnType<typeof vi.fn> }
  /** Order of interesting controller calls, for stage sequencing assertions. */
  calls: string[]
}

function services(
  events: readonly SessionEvent[],
  options: {
    header?: Partial<SessionHeader>
    status?: string
    pinned?: boolean
    workspaceId?: string
    controller?: Partial<Fakes['sessionController']>
    workspace?: Partial<Fakes['workspaceController']>
  } = {},
): Fakes {
  const calls: string[] = []
  const records = new Map<string, RetryRecord>()
  const retryJournal = new RetryJournal({
    table: () => ({ entries: () => records.entries(), put: async (key, value) => { records.set(key, structuredClone(value)) } }),
    close: async () => {},
  })
  const sessionQuery = {
    observeSession: async () => ({
      header: { id: SESSION_ID, createdAt: 0, isSeeded: false, ...options.header },
      events,
      cursor: events[events.length - 1]?.seq ?? -1,
      [Symbol.dispose]() {},
    }),
  } as unknown as SessionQueryEngine
  const sessionController = {
    resolveAgent: vi.fn(async () => ({ agent: { status: 'idle' } })),
    fork: vi.fn(async () => { calls.push('fork'); return { sessionId: CHILD_ID } }),
    rename: vi.fn(async () => { calls.push('rename'); return { title: 't', seq: 1 } }),
    prompt: vi.fn(async () => { calls.push('prompt'); return { accepted: true } }),
    attachment: vi.fn(async (request: { attachmentId: string }) => {
      calls.push('attachment')
      return {
        attachment: { attachmentId: request.attachmentId, mediaType: 'image/png', name: 'a.png' },
        data: 'aW1hZ2U=',
      }
    }),
    ...options.controller,
  }
  const workspaceController = {
    follow: () => (async function* () {
      yield {
        type: 'baseline',
        value: {
          items: options.workspaceId === undefined
            ? [{ workspaceId: 'w1', sessionIds: [SESSION_ID] }]
            : options.workspaceId === '' ? [] : [{ workspaceId: options.workspaceId, sessionIds: [SESSION_ID] }],
          pinnedSessionIds: options.pinned === true ? [SESSION_ID] : [],
          archivedSessionIds: [],
        },
      }
    })(),
    insertSessionBefore: vi.fn(async () => { calls.push('insert'); return {} }),
    pinSession: vi.fn(async () => { calls.push('pin'); return {} }),
    archiveSession: vi.fn(async () => { calls.push('archive'); return {} }),
    ...options.workspace,
  }
  const attachments = {
    readFileStream: (_ref: unknown, _signal: AbortSignal) => (async function* () {
      yield new Uint8Array([1, 2, 3])
    })(),
  }
  const fileUploads = { uploadStream: vi.fn(async () => { calls.push('upload'); return { receiptId: 'receipt-1' } }) }
  return {
    retryJournal,
    sessionQuery,
    agents: { get: (id: string) => (id === SESSION_ID ? { status: options.status ?? 'idle' } : undefined) },
    sessionController,
    workspaceController,
    attachments,
    fileUploads,
    calls,
  }
}

const preview: RetryPreviewRequest = { sessionId: SESSION_ID, messageId: 'm2' }

function commit(text: string | undefined, over: Partial<RetryCommitRequest> = {}): RetryCommitRequest {
  return {
    sessionId: SESSION_ID,
    messageId: 'm2',
    expectedRevision: 9,
    expectedInputRevision: JSON.stringify([{ type: 'text', text: 'second prompt' }]),
    requestId: crypto.randomUUID(),
    ...text === undefined ? {} : { text },
    allowModified: true,
    ...over,
  }
}

describe('retry service', () => {
  it('reports capabilities from the available services', () => {
    const svc = services(baseEvents())
    expect(retryCapabilities(svc)).toEqual({ retry: true, retryModified: true, retryContent: false })
    expect(retryCapabilities({ sessionQuery: svc.sessionQuery }))
      .toEqual({ retry: false, retryModified: false, retryContent: false })
  })

  it('previews a later prompt as modified', async () => {
    const value = await previewRetry(services(baseEvents()), preview, new AbortController().signal)
    expect(value.promptSeq).toBe(5)
    expect(value.branchRevision).toBe(9)
    expect(value.eligible).toBe(false)
    expect(value.modified).toBe(true)
    expect(value.reason).toBe('modified')
    expect(value.inputRevision).toBe(JSON.stringify([{ type: 'text', text: 'second prompt' }]))
  })

  it('marks a busy session ineligible without a model call', async () => {
    const value = await previewRetry(services(baseEvents(), { status: 'running' }), preview, new AbortController().signal)
    expect(value).toMatchObject({ eligible: false, reason: 'busy' })
  })

  it('forks before the prompt, places and archives the source, and returns the child', async () => {
    const events = baseEvents()
    const svc = services(events)
    const requestId = crypto.randomUUID()
    const value = await commitRetry(svc, commit('edited prompt', { requestId }), new AbortController().signal)

    expect(svc.sessionController.fork).toHaveBeenCalledWith({ sessionId: SESSION_ID, atSeq: 3 })
    expect(svc.sessionController.prompt).toHaveBeenCalledWith(
      { requestId, sessionId: CHILD_ID, mode: 'queue', content: [{ type: 'text', text: 'edited prompt' }] },
      expect.anything(),
    )
    expect(svc.calls).toEqual(['fork', 'prompt', 'insert', 'archive'])
    expect(svc.sessionController.rename).not.toHaveBeenCalled()
    expect(svc.workspaceController.insertSessionBefore).toHaveBeenCalledWith({
      workspaceId: 'w1', sessionId: CHILD_ID, beforeSessionId: SESSION_ID,
    })
    expect(svc.workspaceController.pinSession).not.toHaveBeenCalled()
    expect(svc.workspaceController.archiveSession).toHaveBeenCalledWith({ sessionId: SESSION_ID })
    expect(value).toEqual({ sessionId: CHILD_ID, sourceSessionId: SESSION_ID, archived: true })
    expect(events).toHaveLength(10)
  })

  it('renames the child to the source title before prompting', async () => {
    const events = [
      ...baseEvents(),
      ev(10, 'session/title', { title: 'Original chat', messageSeqs: [1], source: { kind: 'user' } }),
    ]
    const svc = services(events)
    const request = commit('edited', { expectedRevision: 10 })
    await commitRetry(svc, request, new AbortController().signal)
    expect(svc.sessionController.rename).toHaveBeenCalledWith({ sessionId: CHILD_ID, title: 'Original chat' })
    expect(svc.calls).toEqual(['fork', 'rename', 'prompt', 'insert', 'archive'])
  })

  it('skips the rename when the fork already inherits the title', async () => {
    const events = baseEvents()
    events.splice(3, 0, ev(3, 'session/title', { title: 'Kept title', messageSeqs: [], source: { kind: 'user' } }))
    // Resequence to keep contiguous seqs; the title now sits inside the cut.
    events.forEach((event, index) => { (event as { seq: number }).seq = index })
    const svc = services(events)
    await commitRetry(svc, commit('edited', { expectedRevision: 10 }), new AbortController().signal)
    expect(svc.sessionController.rename).not.toHaveBeenCalled()
  })

  it('keeps images and files in order, reading images from the source and staging files on the child', async () => {
    const content = [
      { type: 'text', text: 'look at these' },
      { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png', name: 'a.png', bytes: 4, width: 1, height: 1 } },
      { type: 'file', attachment: { attachmentId: 'file-1', name: 'doc.pdf', bytes: 3 } },
    ]
    const events = baseEvents()
    events[5] = prompt(5, 'm2', content)
    const svc = services(events)
    const request = commit('see the edit', {
      expectedInputRevision: JSON.stringify(content),
    })
    await commitRetry(svc, request, new AbortController().signal)

    expect(svc.sessionController.attachment).toHaveBeenCalledWith({ sessionId: SESSION_ID, attachmentId: 'img-1' })
    expect(svc.fileUploads.uploadStream).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: CHILD_ID, name: 'doc.pdf',
    }))
    // All image reads finish before any file is staged.
    expect(svc.calls.indexOf('attachment')).toBeLessThan(svc.calls.indexOf('upload'))
    const sent = svc.sessionController.prompt.mock.calls[0]?.[0] as { content: readonly unknown[] }
    expect(sent.content).toEqual([
      { type: 'text', text: 'see the edit' },
      { type: 'image', mediaType: 'image/png', data: 'aW1hZ2U=', name: 'a.png' },
      { type: 'file', receiptId: 'receipt-1' },
    ])
  })

  it('reapplies a title inside the discarded empty turn shell', async () => {
    const events = baseEvents()
    events.splice(5, 0, ev(5, 'session/title', { title: 'Original title', messageSeqs: [], source: { kind: 'user' } }))
    events.forEach((event, seq) => { (event as { seq: number }).seq = seq })
    const svc = services(events)
    await commitRetry(svc, commit('edited', { expectedRevision: 10 }), new AbortController().signal)
    expect(svc.sessionController.fork).toHaveBeenCalledWith({ sessionId: SESSION_ID, atSeq: 3 })
    expect(svc.sessionController.rename).toHaveBeenCalledWith({ sessionId: CHILD_ID, title: 'Original title' })
  })

  it('rejects a stale revision without forking', async () => {
    const svc = services(baseEvents())
    await expect(commitRetry(svc, commit('x', { expectedRevision: 8 }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'session/retry-revision' })
    expect(svc.sessionController.fork).not.toHaveBeenCalled()
  })

  it('preserves file-first and interleaved text positions through attachment staging', async () => {
    const content = [
      { type: 'file', attachment: { attachmentId: 'file-1', name: 'doc.pdf', bytes: 3 } },
      { type: 'text', text: 'left A' },
      { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png', name: 'a.png', bytes: 4, width: 1, height: 1 } },
      { type: 'text', text: ' right' },
    ]
    const events = baseEvents()
    events[5] = prompt(5, 'm2', content)
    const svc = services(events)
    await commitRetry(svc, commit('left B right', { expectedInputRevision: JSON.stringify(content) }), new AbortController().signal)
    expect(svc.sessionController.prompt.mock.calls[0]?.[0].content).toEqual([
      { type: 'file', receiptId: 'receipt-1' },
      { type: 'text', text: 'left B' },
      { type: 'image', mediaType: 'image/png', data: 'aW1hZ2U=', name: 'a.png' },
      { type: 'text', text: ' right' },
    ])
  })

  it('requires explicit confirmation', async () => {
    const svc = services(baseEvents())
    await expect(commitRetry(svc, commit('x', { allowModified: false }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'session/retry-input' })
    expect(svc.sessionController.fork).not.toHaveBeenCalled()
  })

  it('rejects unsupported content replacement', async () => {
    const svc = services(baseEvents())
    await expect(commitRetry(
      svc,
      commit('x', { content: [{ type: 'text', text: 'y' }] }),
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'session/retry-input' })
  })

  it('replays an identical requestId without a second fork', async () => {
    const svc = services(baseEvents())
    const requestId = crypto.randomUUID()
    const first = await commitRetry(svc, commit('once', { requestId }), new AbortController().signal)
    const second = await commitRetry(svc, commit('once', { requestId }), new AbortController().signal)
    expect(second).toEqual(first)
    expect(svc.sessionController.fork).toHaveBeenCalledTimes(1)
    expect(svc.sessionController.prompt).toHaveBeenCalledTimes(1)
  })

  it('rejects the same requestId with a different body', async () => {
    const svc = services(baseEvents())
    const requestId = crypto.randomUUID()
    await commitRetry(svc, commit('once', { requestId }), new AbortController().signal)
    await expect(commitRetry(svc, commit('different', { requestId }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'session/retry-conflict' })
    expect(svc.sessionController.fork).toHaveBeenCalledTimes(1)
  })

  it('resumes with the same child when the prompt failed after the fork', async () => {
    const svc = services(baseEvents())
    svc.sessionController.prompt.mockRejectedValueOnce(new Error('lost reply'))
    const requestId = crypto.randomUUID()
    await expect(commitRetry(svc, commit('retry me', { requestId }), new AbortController().signal))
      .rejects.toMatchObject({ code: 'session/retry-pending' })
    const value = await commitRetry(svc, commit('retry me', { requestId }), new AbortController().signal)
    expect(value).toEqual({ sessionId: CHILD_ID, sourceSessionId: SESSION_ID, archived: true })
    expect(svc.sessionController.fork).toHaveBeenCalledTimes(1)
    expect(svc.sessionController.prompt).toHaveBeenCalledTimes(2)
  })

  it('keeps the client request identity after a structured failure following the fork', async () => {
    const svc = services(baseEvents())
    svc.sessionController.prompt.mockRejectedValueOnce({ code: 'session/agent-busy' })
    const requests: RetryCommitRequest[] = []
    const signal = new AbortController().signal
    const host = {
      capabilities: async () => retryCapabilities(svc),
      previewRetry: (request: RetryPreviewRequest) => previewRetry(svc, request, signal),
      retry: async (request: RetryCommitRequest) => {
        requests.push(request)
        try { return { ok: true, value: await commitRetry(svc, request, signal) } }
        catch (error) { return { ok: false, error } }
      },
    } as unknown as SessionHost
    const ids = vi.fn(() => crypto.randomUUID())
    const model = createRetryModel(host, ids)
    await model.load()
    await model.beginEdit(SESSION_ID, 'm2', 'second prompt', signal)
    await model.sendEdit(SESSION_ID, 'm2', signal, undefined, true)
    expect(model.getSnapshot().failure?.code).toBe('session/retry-pending')
    await model.sendEdit(SESSION_ID, 'm2', signal, undefined, true)
    expect(model.getSnapshot().failure).toBeUndefined()
    expect(model.getSnapshot().editing).toBe(false)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(ids).toHaveBeenCalledTimes(1)
    expect(svc.sessionController.fork).toHaveBeenCalledTimes(1)
  })

  it('resolves with archived:false when archiving fails', async () => {
    const svc = services(baseEvents())
    svc.workspaceController.archiveSession.mockRejectedValue(new Error('still busy'))
    const value = await commitRetry(svc, commit('x'), new AbortController().signal)
    expect(value).toEqual({ sessionId: CHILD_ID, sourceSessionId: SESSION_ID, archived: false })
    expect(svc.workspaceController.insertSessionBefore).toHaveBeenCalled()
  })

  it('replays a completed request after closing and reopening durable storage', async () => {
    const disk = durableStore()
    const svc = services(baseEvents())
    svc.retryJournal = disk.open().journal
    const request = commit('once')
    const signal = new AbortController().signal
    const result = await commitRetry(svc, request, signal)
    await svc.retryJournal.close()
    svc.retryJournal = disk.open().journal
    expect(await commitRetry(svc, request, signal)).toEqual(result)
    expect(svc.sessionController.fork).toHaveBeenCalledTimes(1)
    expect(svc.sessionController.prompt).toHaveBeenCalledTimes(1)
  })

  it('resumes the recorded child after restart and a lost prompt acknowledgement', async () => {
    const disk = durableStore()
    const svc = services(baseEvents())
    svc.retryJournal = disk.open().journal
    const admitted = new Set<string>()
    svc.sessionController.prompt.mockImplementation(async ({ sessionId, requestId }) => {
      // Match the host contract: deduplication is scoped to the target agent.
      const key = `${sessionId}:${requestId}`
      if (!admitted.has(key)) { admitted.add(key); throw new Error('reply lost after admission') }
      return { accepted: true }
    })
    const request = commit('once')
    const signal = new AbortController().signal
    await expect(commitRetry(svc, request, signal)).rejects.toMatchObject({ code: 'session/retry-pending' })
    await svc.retryJournal.close()
    svc.retryJournal = disk.open().journal
    await expect(commitRetry(svc, request, signal)).resolves.toMatchObject({ sessionId: CHILD_ID })
    expect(svc.sessionController.fork).toHaveBeenCalledTimes(1)
    expect(admitted.size).toBe(1)
  })

  it('never forks without saving intent first', async () => {
    const svc = services(baseEvents())
    const store = durableStore().open()
    svc.retryJournal = store.journal
    store.put.mockRejectedValueOnce(new Error('disk full'))
    await expect(commitRetry(svc, commit('once'), new AbortController().signal)).rejects.toMatchObject({ code: 'session/retry-failed' })
    expect(svc.sessionController.fork).not.toHaveBeenCalled()
  })

  it('fails closed after restart if the fork identity could not be saved', async () => {
    const disk = durableStore()
    const store = disk.open()
    const svc = services(baseEvents())
    svc.retryJournal = store.journal
    svc.sessionController.fork.mockImplementationOnce(async () => {
      store.put.mockRejectedValueOnce(new Error('disk full after fork'))
      return { sessionId: CHILD_ID }
    })
    const request = commit('once')
    const signal = new AbortController().signal
    await expect(commitRetry(svc, request, signal)).rejects.toMatchObject({ code: 'session/retry-pending' })
    expect(svc.sessionController.prompt).not.toHaveBeenCalled()
    await svc.retryJournal.close()
    svc.retryJournal = disk.open().journal
    await expect(commitRetry(svc, request, signal)).rejects.toMatchObject({ code: 'session/retry-uncertain' })
    await expect(commitRetry(svc, commit('new attempt'), signal)).rejects.toMatchObject({ code: 'session/retry-uncertain' })
    expect(svc.sessionController.fork).toHaveBeenCalledTimes(1)
  })

  it('retains a live child after its save failed and resumes it without a second fork', async () => {
    const store = durableStore().open()
    const svc = services(baseEvents())
    svc.retryJournal = store.journal
    svc.sessionController.fork.mockImplementationOnce(async () => {
      store.put.mockRejectedValueOnce(new Error('disk full after fork'))
      return { sessionId: CHILD_ID }
    })
    const request = commit('once')
    const signal = new AbortController().signal
    await expect(commitRetry(svc, request, signal)).rejects.toMatchObject({ code: 'session/retry-pending' })
    await expect(commitRetry(svc, request, signal)).resolves.toMatchObject({ sessionId: CHILD_ID })
    expect(svc.sessionController.fork).toHaveBeenCalledTimes(1)
  })

  it('keeps a completed request recoverable while its final receipt cannot be saved', async () => {
    const store = durableStore().open()
    const svc = services(baseEvents())
    svc.retryJournal = store.journal
    svc.workspaceController.archiveSession.mockImplementationOnce(async () => {
      store.put.mockRejectedValueOnce(new Error('disk full')).mockRejectedValueOnce(new Error('still full'))
      return {}
    })
    const request = commit('once')
    const signal = new AbortController().signal
    await expect(commitRetry(svc, request, signal)).rejects.toMatchObject({ code: 'session/retry-pending' })
    await expect(commitRetry(svc, request, signal)).rejects.toMatchObject({ code: 'session/retry-pending' })
    await expect(commitRetry(svc, request, signal)).resolves.toMatchObject({ sessionId: CHILD_ID })
    expect(svc.sessionController.fork).toHaveBeenCalledTimes(1)
    expect(svc.sessionController.prompt).toHaveBeenCalledTimes(1)
  })

  it('drains an active commit before closing storage and refuses new work during disposal', async () => {
    const store = durableStore().open()
    const svc = services(baseEvents())
    svc.retryJournal = store.journal
    let finish!: () => void
    svc.sessionController.prompt.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ accepted: true }) }))
    const signal = new AbortController().signal
    const work = commitRetry(svc, commit('once'), signal)
    await vi.waitFor(() => { expect(svc.sessionController.prompt).toHaveBeenCalled() })
    const closing = svc.retryJournal.close()
    expect(store.close).not.toHaveBeenCalled()
    await expect(commitRetry(svc, commit('new'), signal)).rejects.toMatchObject({ code: 'session-manager/unavailable' })
    finish()
    await work
    await closing
    expect(store.close).toHaveBeenCalledTimes(1)
  })

  it('pins the child when the source is pinned', async () => {
    const svc = services(baseEvents(), { pinned: true })
    await commitRetry(svc, commit('x'), new AbortController().signal)
    expect(svc.workspaceController.pinSession).toHaveBeenCalledWith({ sessionId: CHILD_ID })
    expect(svc.calls).toContain('pin')
  })

  it('rejects subagent sessions and running sources without forking', async () => {
    const subagent = services(baseEvents(), { header: { origin: 'subagent' } })
    await expect(commitRetry(subagent, commit('x'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'session/retry-blocked' })
    expect(subagent.sessionController.fork).not.toHaveBeenCalled()

    const running = services(baseEvents(), { status: 'running' })
    await expect(commitRetry(running, commit('x'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'session-manager/busy' })
    expect(running.sessionController.fork).not.toHaveBeenCalled()
  })

  it('rejects a second concurrent commit for the same source', async () => {
    const svc = services(baseEvents())
    let release: () => void = () => {}
    svc.sessionController.prompt.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ accepted: true }) }))
    const first = commitRetry(svc, commit('first'), new AbortController().signal)
    await vi.waitFor(() => { expect(svc.sessionController.prompt).toHaveBeenCalled() })
    await expect(commitRetry(svc, commit('second'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'session-manager/busy' })
    release()
    await expect(first).resolves.toMatchObject({ sessionId: CHILD_ID })
    expect(svc.sessionController.fork).toHaveBeenCalledTimes(1)
  })

  it('does not let two sources concurrently claim the same request identity', async () => {
    const svc = services(baseEvents())
    let finish!: () => void
    svc.sessionController.prompt.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ accepted: true }) }))
    const request = commit('first')
    const signal = new AbortController().signal
    const first = commitRetry(svc, request, signal)
    await vi.waitFor(() => { expect(svc.sessionController.prompt).toHaveBeenCalled() })
    await expect(commitRetry(svc, request, signal)).rejects.toMatchObject({ code: 'session/retry-pending' })
    await expect(commitRetry(svc, { ...request, sessionId: 'other-source' }, signal))
      .rejects.toMatchObject({ code: 'session/retry-pending' })
    finish()
    await first
    await expect(commitRetry(svc, { ...request, sessionId: 'other-source' }, signal))
      .rejects.toMatchObject({ code: 'session/retry-conflict' })
    expect(svc.sessionController.fork).toHaveBeenCalledTimes(1)
  })
})
