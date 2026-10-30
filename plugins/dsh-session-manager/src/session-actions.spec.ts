import { describe, expect, it, vi } from 'vitest'
import type { ListedSession, SessionListSnapshot } from './free-list.ts'
import {
  bindHost,
  createFreeChatModel,
  createRetryModel,
  editRetryRequest,
  type SessionHost,
} from './session-actions.ts'
import { failureText } from './ui-copy.ts'

function row(id: string, patch: Partial<ListedSession> = {}): ListedSession {
    return {
      id,
      displayTitle: patch.displayTitle ?? id,
      running: false,
      updatedAt: 1,
      classification: 'free',
      ...patch,
    }
}

function list(rows: ListedSession[], phase: SessionListSnapshot['phase'] = 'ready'): SessionListSnapshot {
  return { ids: rows.map(item => item.id), byId: Object.fromEntries(rows.map(item => [item.id, item])), phase }
}

function host(snapshot: SessionListSnapshot, extra: Partial<SessionHost> = {}): SessionHost {
  return {
    list: { getSnapshot: () => snapshot, subscribe: () => () => {} },
    ...extra,
  }
}

describe('session actions', () => {
  it('creates a free chat only through sessions.create and opens that id', async () => {
    const create = vi.fn(async () => 'made')
    const openSession = vi.fn()
    const model = createFreeChatModel(host(list([]), {
      capabilities: async () => ({ retry: false, freeSession: true, deleteSession: false }),
      create,
      openSession,
    }))
    await model.reloadCapabilities()
    expect(model.getSnapshot().controls.create).toBe(true)
    await model.create()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[0]).toEqual({ kind: 'free' })
    expect(openSession).toHaveBeenCalledWith('made')
  })

  it('hides create, retry, and delete when the runtime has no capability method', async () => {
    const create = vi.fn()
    const model = createFreeChatModel(host(list([]), { create }))
    await model.reloadCapabilities()
    expect(model.getSnapshot().controls).toMatchObject({ create: false, delete: false, retry: false })
    await model.create()
    expect(create).not.toHaveBeenCalled()
  })

  it('retries delete with the same id until the host reports deleted', async () => {
    const deleteSession = vi.fn()
      .mockResolvedValueOnce({ phase: 'cleanup-pending' })
      .mockResolvedValueOnce({ phase: 'deleted' })
    const model = createFreeChatModel(host(list([
      row('free'),
      row('project', { classification: 'ordinary', displayTitle: 'Project' }),
    ]), {
      capabilities: async () => ({ retry: false, freeSession: false, deleteSession: true }),
      deleteSession,
    }), () => 'req-1')
    await model.reloadCapabilities()
    model.requestDelete('project')
    expect(model.getSnapshot().deleteRequest).toMatchObject({ classification: 'ordinary', requestId: 'req-1' })
    await model.confirmDelete()
    expect(model.getSnapshot().deleteRequest?.failure?.code).toBe('session/delete-pending')
    await model.confirmDelete()
    expect(deleteSession.mock.calls.map(call => call[1])).toEqual(['req-1', 'req-1'])
    expect(model.getSnapshot().deleteRequest).toBeUndefined()
  })

  it('stores a failed create as a notice and clears it on dismiss', async () => {
    const create = vi.fn(async (): Promise<string> => {
      throw Object.assign(new Error('no lifecycle'), { code: 'session/lifecycle-unavailable' })
    })
    const model = createFreeChatModel(host(list([]), {
      capabilities: async () => ({ retry: false, freeSession: true, deleteSession: false }),
      create,
      openSession: () => {},
    }))
    await model.reloadCapabilities()
    await model.create()
    expect(model.getSnapshot().notice).toEqual({ code: 'session/lifecycle-unavailable' })
    model.dismissNotice()
    expect(model.getSnapshot().notice).toBeUndefined()
    model.dismissNotice()
    expect(model.getSnapshot().notice).toBeUndefined()
  })

  it('sends one edited body and reuses the request id after a transport failure', async () => {
    let revision = 7
    const previewRetry = vi.fn(async () => ({ branchRevision: revision, eligible: true, inputRevision: 'in-7' }))
    const retry = vi.fn()
      .mockImplementationOnce(async () => {
        revision = 8
        throw new Error('socket')
      })
      .mockResolvedValueOnce({ sessionId: 'child', sourceSessionId: 's', archived: true })
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, freeSession: false, deleteSession: false }),
      previewRetry,
      retry,
    }), () => 'edit-id')
    await model.load()
    const signal = new AbortController().signal
    await model.beginEdit('s', 'm', 'edited', signal)
    await model.sendEdit('s', 'm', signal)
    expect(model.getSnapshot().failure?.code).toBe('transport')
    await model.sendEdit('s', 'm', signal)
    expect(previewRetry).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledTimes(2)
    const bodies = retry.mock.calls.map(call => call[0] as Record<string, unknown>)
    expect(bodies[0]).toEqual(editRetryRequest({
      sessionId: 's', messageId: 'm', expectedRevision: 7, expectedInputRevision: 'in-7', requestId: 'edit-id', text: 'edited',
    }))
    expect(Object.hasOwn(bodies[0]!, 'text')).toBe(true)
    expect(bodies[1]).toEqual(bodies[0])
  })

  it('sends edited plain text, keeps one submission, and drops a cancelled preview', async () => {
    let release: (value: unknown) => void = () => {}
    const previewRetry = vi.fn(() => new Promise(resolve => { release = resolve }))
    const retry = vi.fn(async () => ({ sessionId: 'child', sourceSessionId: 's', archived: true }))
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, freeSession: true, deleteSession: false }),
      previewRetry,
      retry,
    }), () => 'edit-id')
    await model.load()
    const signal = new AbortController().signal
    const first = model.beginEdit('s', 'm', 'original plain', signal)
    const second = model.beginEdit('s', 'm', 'other', signal)
    expect(previewRetry).toHaveBeenCalledTimes(1)
    release({ branchRevision: 3, eligible: true, inputRevision: 'in-3' })
    await first
    await second
    expect(model.getSnapshot().draft).toBe('original plain')
    await model.sendEdit('s', 'm', signal)
    expect(retry.mock.calls[0]?.[0]).toEqual(editRetryRequest({
      sessionId: 's', messageId: 'm', expectedRevision: 3, expectedInputRevision: 'in-3', requestId: 'edit-id', text: 'original plain',
    }))

    let hang: (value: unknown) => void = () => {}
    previewRetry.mockImplementation(() => new Promise(resolve => { hang = resolve }))
    const pending = model.beginEdit('s', 'm', 'other', signal)
    model.cancel()
    hang({ branchRevision: 9, eligible: true, inputRevision: 'in-9' })
    await pending
    expect(retry).toHaveBeenCalledTimes(1)
    expect(failureText('zh', { code: 'session/retry-blocked', reason: 'running' })).toContain('运行')
    expect(failureText('en', { code: 'session/retry-blocked', reason: 'modified' })).toContain('may have made changes')
  })

  it('keeps the modification warning with an edited draft and sends consent once', async () => {
    const previewRetry = vi.fn(async () => ({ branchRevision: 2, eligible: false, reason: 'modified', inputRevision: 'in-2' }))
    const retry = vi.fn(async () => ({ sessionId: 'child', sourceSessionId: 's', archived: true }))
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, retryModified: true, freeSession: false, deleteSession: false }),
      previewRetry,
      retry,
    }), () => 'edit-modified-id')
    await model.load()
    const signal = new AbortController().signal
    await model.beginEdit('s', 'm', 'original', signal)
    expect(model.getSnapshot()).toMatchObject({ editing: true, modified: true, draft: 'original' })
    model.setDraft('edited')
    await model.sendEdit('s', 'm', signal, undefined, true)
    expect(retry.mock.calls[0]?.[0]).toEqual(editRetryRequest({
      sessionId: 's', messageId: 'm', expectedRevision: 2, expectedInputRevision: 'in-2', requestId: 'edit-modified-id', text: 'edited', allowModified: true,
    }))
    expect(model.getSnapshot()).toMatchObject({ editing: false, modified: false })
  })

  it('does not open an editor for a modified preview without an input token', async () => {
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, freeSession: false, deleteSession: false }),
      previewRetry: async () => ({ branchRevision: 1, eligible: false, reason: 'modified' }),
      retry: vi.fn(),
    }))
    await model.load()
    await model.beginEdit('s', 'm', 'original', new AbortController().signal)
    expect(model.getSnapshot()).toMatchObject({ editing: false, modified: false })
    expect(model.getSnapshot().failure?.reason).toBe('input-revision')
  })

  it('keeps a modified edit blocked when the host lacks confirmation support', async () => {
    const retry = vi.fn()
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, freeSession: false, deleteSession: false }),
      previewRetry: async () => ({ branchRevision: 1, eligible: false, reason: 'modified', inputRevision: 'in-1' }),
      retry,
    }))
    await model.load()
    const signal = new AbortController().signal
    await model.beginEdit('s', 'm', 'original', signal)
    expect(model.getSnapshot().editing).toBe(false)
    expect(model.getSnapshot().failure?.reason).toBe('modified')
    expect(retry).not.toHaveBeenCalled()
  })

  it('replays one committed edit when the reply is lost and the revision has moved', async () => {
    let revision = 0
    let commits = 0
    const previewRetry = vi.fn(async () => ({ branchRevision: revision, eligible: true, inputRevision: 'in-0' }))
    const retry = vi.fn(async (body: { requestId: string; expectedRevision: number; expectedInputRevision: string }) => {
      if (body.requestId === 'id-1' && body.expectedRevision === 0 && body.expectedInputRevision === 'in-0') {
        if (commits === 0) {
          commits += 1
          revision = 1
          throw new Error('lost')
        }
        return { sessionId: 'child', sourceSessionId: 's', archived: true }
      }
      commits += 1
      throw new Error(`second execution ${body.expectedRevision} ${body.requestId}`)
    })
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, freeSession: false, deleteSession: false }),
      previewRetry,
      retry,
    }), () => 'id-1')
    await model.load()
    const signal = new AbortController().signal
    await model.beginEdit('s', 'm', 'edited', signal)
    await model.sendEdit('s', 'm', signal)
    await model.sendEdit('s', 'm', signal)
    expect(commits).toBe(1)
    expect(previewRetry).toHaveBeenCalledTimes(1)
    expect(retry.mock.calls[1]?.[0]).toEqual(retry.mock.calls[0]?.[0])
  })

  it('does not edit when the preview has no input token', async () => {
    const previewRetry = vi.fn(async () => ({ branchRevision: 1, eligible: true }))
    const retry = vi.fn()
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, freeSession: false, deleteSession: false }),
      previewRetry,
      retry,
    }))
    await model.load()
    await model.beginEdit('s', 'm', 'original', new AbortController().signal)
    expect(retry).not.toHaveBeenCalled()
    expect(model.getSnapshot().failure?.reason).toBe('input-revision')
  })

  it('keeps a draft on session A and refuses edit targets on session B', async () => {
    const previewRetry = vi.fn(async () => ({ branchRevision: 2, eligible: true, inputRevision: 'tok' }))
    const retry = vi.fn()
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, freeSession: true, deleteSession: false }),
      previewRetry,
      retry,
    }))
    await model.load()
    const signal = new AbortController().signal
    await model.beginEdit('A', 'm', 'draft A', signal)
    expect(model.getSnapshot()).toMatchObject({ editing: true, sessionId: 'A', messageId: 'm', draft: 'draft A' })
    await model.beginEdit('B', 'm', 'replacement B', signal)
    await model.sendEdit('B', 'm', signal)
    expect(retry).not.toHaveBeenCalled()
    expect(previewRetry).toHaveBeenCalledTimes(1)
    expect(model.getSnapshot()).toMatchObject({ editing: true, sessionId: 'A', draft: 'draft A' })
    model.retire('A', 'm')
    expect(model.getSnapshot().editing).toBe(false)
    expect(model.getSnapshot().draft).toBe('')
  })

  it('publishes a clear busy flag after a retired row finishes so another row can edit', async () => {
    let release: (value: unknown) => void = () => {}
    let started = false
    const previewRetry = vi.fn(async () => ({ branchRevision: 1, eligible: true, inputRevision: 'tok-a' }))
    const retry = vi.fn(() => {
      if (!started) {
        started = true
        return new Promise(resolve => { release = resolve })
      }
      return Promise.resolve({ sessionId: 'child', sourceSessionId: 'B', archived: true })
    })
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, freeSession: true, deleteSession: false }),
      previewRetry,
      retry,
    }), () => 'row-id')
    await model.load()
    const signal = new AbortController().signal
    await model.beginEdit('A', 'm1', 'edited A', signal)
    const pending = model.sendEdit('A', 'm1', signal)
    await vi.waitFor(() => { expect(retry).toHaveBeenCalledTimes(1) })
    model.retire('A', 'm1')
    expect(model.getSnapshot().busy).toBe(true)
    release({ sessionId: 'child', sourceSessionId: 'A', archived: true })
    await pending
    expect(model.getSnapshot().busy).toBe(false)
    expect(model.getSnapshot().editing).toBe(false)
    previewRetry.mockResolvedValue({ branchRevision: 4, eligible: true, inputRevision: 'tok-b' })
    await model.beginEdit('B', 'm2', 'edited B', signal)
    expect(previewRetry).toHaveBeenCalledTimes(2)
    await model.sendEdit('B', 'm2', signal)
    expect(retry).toHaveBeenCalledTimes(2)
    expect(retry.mock.calls[1]?.[0]).toMatchObject({
      sessionId: 'B',
      messageId: 'm2',
      expectedRevision: 4,
      expectedInputRevision: 'tok-b',
    })
  })

  it('closes the matching editor after an exact replay and keeps it after failure or another owner', async () => {
    const previewRetry = vi.fn(async () => ({ branchRevision: 3, eligible: true, inputRevision: 'in-3' }))
    const retry = vi.fn()
      .mockRejectedValueOnce(new Error('lost'))
      .mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce({ sessionId: 'child', sourceSessionId: 'A', archived: true })
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, freeSession: true, deleteSession: false }),
      previewRetry,
      retry,
    }), () => 'edit-id')
    await model.load()
    const signal = new AbortController().signal
    await model.beginEdit('A', 'm', 'edited plain', signal)
    await model.sendEdit('A', 'm', signal)
    const sent = retry.mock.calls[0]?.[0]
    expect(sent).toEqual(editRetryRequest({
      sessionId: 'A', messageId: 'm', expectedRevision: 3, expectedInputRevision: 'in-3', requestId: 'edit-id', text: 'edited plain',
    }))
    expect(model.getSnapshot().editing).toBe(true)
    await model.sendEdit('B', 'm', signal)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(model.getSnapshot()).toMatchObject({ editing: true, sessionId: 'A', messageId: 'm', draft: 'edited plain' })
    await model.sendEdit('A', 'm', signal)
    expect(previewRetry).toHaveBeenCalledTimes(1)
    expect(retry.mock.calls[1]?.[0]).toEqual(sent)
    expect(model.getSnapshot().editing).toBe(true)
    await model.sendEdit('A', 'm', signal)
    expect(previewRetry).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledTimes(3)
    expect(retry.mock.calls[2]?.[0]).toEqual(sent)
    expect(model.getSnapshot().editing).toBe(false)
  })

  it('does not dispatch a pre-aborted edit, and keeps an exact replay after abort', async () => {
    const previewRetry = vi.fn(async () => ({ branchRevision: 0, eligible: true, inputRevision: 'tok' }))
    const retry = vi.fn()
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, freeSession: true, deleteSession: false }),
      previewRetry,
      retry,
    }), () => 'id-1')
    await model.load()
    const pre = new AbortController()
    pre.abort()
    await model.beginEdit('s', 'm', 'plain', pre.signal)
    expect(previewRetry).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()

    let release: (error: Error) => void = () => {}
    let attempts = 0
    retry.mockImplementation(() => {
      attempts += 1
      if (attempts === 1) return new Promise((_resolve, reject) => { release = reject })
      return Promise.resolve({ sessionId: 'child', sourceSessionId: 's', archived: true })
    })
    const live = new AbortController()
    await model.beginEdit('s', 'm', 'plain', live.signal)
    const pending = model.sendEdit('s', 'm', live.signal)
    await vi.waitFor(() => { expect(retry).toHaveBeenCalledTimes(1) })
    live.abort()
    release(new Error('lost'))
    await pending
    expect(previewRetry).toHaveBeenCalledTimes(1)
    await model.sendEdit('s', 'm', new AbortController().signal)
    expect(previewRetry).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledTimes(2)
    expect(retry.mock.calls[1]?.[0]).toEqual(retry.mock.calls[0]?.[0])
  })

  it('does not open or settle anything when create or delete finish after cancel', async () => {
    let releaseCreate: (value: string) => void = () => {}
    const openSession = vi.fn()
    const create = vi.fn(() => new Promise<string>(resolve => { releaseCreate = resolve }))
    const creating = createFreeChatModel(host(list([]), {
      capabilities: async () => ({ retry: false, freeSession: true, deleteSession: false }),
      create,
      openSession,
    }))
    await creating.reloadCapabilities()
    const pendingCreate = creating.create()
    creating.cancel()
    releaseCreate('made')
    await pendingCreate
    expect(openSession).not.toHaveBeenCalled()

    let releaseDelete: (value: unknown) => void = () => {}
    const deleteSession = vi.fn(() => new Promise(resolve => { releaseDelete = resolve }))
    const deleting = createFreeChatModel(host(list([row('free')]), {
      capabilities: async () => ({ retry: false, freeSession: true, deleteSession: true }),
      deleteSession,
    }), () => 'req')
    await deleting.reloadCapabilities()
    deleting.requestDelete('free')
    const pendingDelete = deleting.confirmDelete()
    deleting.cancel()
    releaseDelete({ phase: 'deleted' })
    await pendingDelete
    expect(deleting.getSnapshot().deleteRequest).toBeUndefined()
    expect(deleting.getSnapshot().capabilitiesReady).toBe(true)
  })

  it('binds only methods the live services actually have', () => {
    const face = bindHost({
      sessions: { list: { getSnapshot: () => list([]), subscribe: () => () => {} } },
      uiWorkspace: { openSession: () => {} },
    })
    expect(face.create).toBeUndefined()
    expect(face.deleteSession).toBeUndefined()
    expect(face.previewRetry).toBeUndefined()
    expect(face.openSession).toBeTypeOf('function')
  })
})
