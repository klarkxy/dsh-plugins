import { describe, expect, it, vi } from 'vitest'
import { freeChatRows, formatQuietTime, matchFreeRows, type ListedSession, type SessionListSnapshot } from './free-list.ts'
import {
  bindHost,
  createFreeChatModel,
  createRetryModel,
  directRetryRequest,
  editRetryRequest,
  type SessionHost,
} from './session-actions.ts'
import { failureText } from './ui-copy.ts'
import { FREE_PANEL_ID } from './contracts.ts'

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

describe('free chat selection', () => {
  it('keeps free chats and independent forks, and ignores cwd', () => {
    const rows = freeChatRows(list([
      row('free', { displayTitle: 'Alpha', cwd: 'C:/secret' }),
      row('ordinary', { classification: 'ordinary', displayTitle: 'Project' }),
      row('child', { origin: 'subagent', displayTitle: 'Owned' }),
      row('fork', { parentId: 'free', displayTitle: 'Alpha (1)' }),
    ]))
    expect(rows.map(item => item.id)).toEqual(['free', 'fork'])
    expect(matchFreeRows(rows, 'secret')).toEqual([])
    expect(matchFreeRows(rows, 'alpha').map(item => item.id)).toEqual(['free', 'fork'])
    const now = Date.parse('2026-10-07T08:30:00Z')
    expect(formatQuietTime(now, 'en', now)).toMatch(/\d/)
    expect(formatQuietTime(now - 86_400_000, 'zh', now).length).toBeGreaterThan(0)
  })
})

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

  it('forks through the workspace and opens the child', async () => {
    const forkSession = vi.fn(async () => 'child')
    const openSession = vi.fn()
    const model = createFreeChatModel(host(list([row('parent')]), { forkSession, openSession }))
    await model.fork('parent')
    expect(forkSession).toHaveBeenCalledWith('parent')
    expect(openSession).toHaveBeenCalledWith('child')
  })

  it('retries delete with the same id until the host reports deleted', async () => {
    const deleteSession = vi.fn()
      .mockResolvedValueOnce({ phase: 'cleanup-pending', releasedSelection: false })
      .mockResolvedValueOnce({ phase: 'deleted', releasedSelection: true })
    const selectPanel = vi.fn()
    const model = createFreeChatModel(host(list([
      row('free'),
      row('project', { classification: 'ordinary', displayTitle: 'Project' }),
    ]), {
      capabilities: async () => ({ retry: false, freeSession: false, deleteSession: true }),
      deleteSession,
      selectPanel,
    }), () => 'req-1')
    await model.reloadCapabilities()
    model.requestDelete('project')
    expect(model.getSnapshot().deleteRequest).toMatchObject({ classification: 'ordinary', requestId: 'req-1' })
    await model.confirmDelete()
    expect(model.getSnapshot().deleteRequest?.failure?.code).toBe('session/delete-pending')
    expect(selectPanel).not.toHaveBeenCalled()
    await model.confirmDelete()
    expect(deleteSession.mock.calls.map(call => call[1])).toEqual(['req-1', 'req-1'])
    expect(selectPanel).toHaveBeenCalledWith(FREE_PANEL_ID)
    expect(model.getSnapshot().focusNonce).toBe(1)
    expect(model.getSnapshot().deleteRequest).toBeUndefined()
  })

  it('omits text on a direct retry and reuses the request id after a transport failure', async () => {
    let revision = 7
    const previewRetry = vi.fn(async () => ({ branchRevision: revision, eligible: true, inputRevision: 'in-7' }))
    const retry = vi.fn()
      .mockImplementationOnce(async () => {
        revision = 8
        throw new Error('socket')
      })
      .mockResolvedValueOnce({ sessionId: 's', branchRevision: 8 })
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, freeSession: false, deleteSession: false }),
      previewRetry,
      retry,
    }), () => 'retry-id')
    await model.load()
    const signal = new AbortController().signal
    await model.retry('s', 'm', signal)
    expect(model.getSnapshot().failure?.code).toBe('transport')
    await model.retry('s', 'm', signal)
    expect(previewRetry).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledTimes(2)
    const bodies = retry.mock.calls.map(call => call[0] as Record<string, unknown>)
    expect(bodies[0]).toEqual(directRetryRequest({
      sessionId: 's', messageId: 'm', expectedRevision: 7, expectedInputRevision: 'in-7', requestId: 'retry-id',
    }))
    expect(Object.hasOwn(bodies[0]!, 'text')).toBe(false)
    expect(bodies[1]).toEqual(bodies[0])
  })

  it('sends edited plain text, keeps one submission, and drops a cancelled preview', async () => {
    let release: (value: unknown) => void = () => {}
    const previewRetry = vi.fn(() => new Promise(resolve => { release = resolve }))
    const retry = vi.fn(async () => ({ sessionId: 's', branchRevision: 2 }))
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
    const pending = model.retry('s', 'm', signal)
    model.cancel()
    hang({ branchRevision: 9, eligible: true, inputRevision: 'in-9' })
    await pending
    expect(retry).toHaveBeenCalledTimes(1)
    expect(failureText('zh', { code: 'session/retry-blocked', reason: 'running' })).toContain('运行')
    expect(failureText('en', { code: 'session/retry-blocked', reason: 'modified' })).toContain('may have made changes')
  })

  it('replays one committed retry when the reply is lost and the revision has moved', async () => {
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
        return { sessionId: 's', branchRevision: revision }
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
    await model.retry('s', 'm', signal)
    await model.retry('s', 'm', signal)
    expect(commits).toBe(1)
    expect(previewRetry).toHaveBeenCalledTimes(1)
    expect(retry.mock.calls[1]?.[0]).toEqual(retry.mock.calls[0]?.[0])
  })

  it('does not retry when the preview has no input token', async () => {
    const previewRetry = vi.fn(async () => ({ branchRevision: 1, eligible: true }))
    const retry = vi.fn()
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, freeSession: false, deleteSession: false }),
      previewRetry,
      retry,
    }))
    await model.load()
    await model.retry('s', 'm', new AbortController().signal)
    expect(retry).not.toHaveBeenCalled()
    expect(model.getSnapshot().failure?.reason).toBe('input-revision')
  })

  it('keeps a draft on session A and refuses the same message id on session B', async () => {
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
    await model.sendEdit('B', 'm', signal)
    expect(retry).not.toHaveBeenCalled()
    expect(model.getSnapshot()).toMatchObject({ editing: true, sessionId: 'A', draft: 'draft A' })
    model.retire('A', 'm')
    expect(model.getSnapshot().editing).toBe(false)
    expect(model.getSnapshot().draft).toBe('')
  })

  it('publishes a clear busy flag after a retired row finishes so another row can retry', async () => {
    let release: (value: unknown) => void = () => {}
    let started = false
    const previewRetry = vi.fn(async () => ({ branchRevision: 1, eligible: true, inputRevision: 'tok-a' }))
    const retry = vi.fn(() => {
      if (!started) {
        started = true
        return new Promise(resolve => { release = resolve })
      }
      return Promise.resolve({ sessionId: 'B', branchRevision: 5 })
    })
    const model = createRetryModel(host(list([]), {
      capabilities: async () => ({ retry: true, freeSession: true, deleteSession: false }),
      previewRetry,
      retry,
    }), () => 'row-id')
    await model.load()
    const signal = new AbortController().signal
    const pending = model.retry('A', 'm1', signal)
    await vi.waitFor(() => { expect(retry).toHaveBeenCalledTimes(1) })
    model.retire('A', 'm1')
    expect(model.getSnapshot().busy).toBe(true)
    release({ sessionId: 'A', branchRevision: 2 })
    await pending
    expect(model.getSnapshot().busy).toBe(false)
    expect(model.getSnapshot().editing).toBe(false)
    previewRetry.mockResolvedValue({ branchRevision: 4, eligible: true, inputRevision: 'tok-b' })
    await model.retry('B', 'm2', signal)
    expect(previewRetry).toHaveBeenCalledTimes(2)
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
      .mockResolvedValueOnce({ sessionId: 'A', branchRevision: 4 })
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
    await model.retry('s', 'm', pre.signal)
    expect(previewRetry).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()

    let release: (error: Error) => void = () => {}
    let attempts = 0
    retry.mockImplementation(() => {
      attempts += 1
      if (attempts === 1) return new Promise((_resolve, reject) => { release = reject })
      return Promise.resolve({ sessionId: 's', branchRevision: 1 })
    })
    const live = new AbortController()
    const pending = model.retry('s', 'm', live.signal)
    await vi.waitFor(() => { expect(retry).toHaveBeenCalledTimes(1) })
    live.abort()
    release(new Error('lost'))
    await pending
    expect(previewRetry).toHaveBeenCalledTimes(1)
    await model.retry('s', 'm', new AbortController().signal)
    expect(previewRetry).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledTimes(2)
    expect(retry.mock.calls[1]?.[0]).toEqual(retry.mock.calls[0]?.[0])
  })

  it('hides fork while free session capability is pending or unsupported', async () => {
    const forkSession = vi.fn()
    const pending = createFreeChatModel(host(list([]), { forkSession }))
    expect(pending.getSnapshot().controls.fork).toBe(false)
    await pending.reloadCapabilities()
    expect(pending.getSnapshot().controls.fork).toBe(false)
    const ready = createFreeChatModel(host(list([]), {
      forkSession,
      capabilities: async () => ({ retry: false, freeSession: true, deleteSession: false }),
    }))
    expect(ready.getSnapshot().controls.fork).toBe(false)
    await ready.reloadCapabilities()
    expect(ready.getSnapshot().controls.fork).toBe(true)
  })

  it('does not open or select a panel when create, fork, or delete finish after cancel', async () => {
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

    let releaseFork: (value: string) => void = () => {}
    const forkSession = vi.fn(() => new Promise<string>(resolve => { releaseFork = resolve }))
    const forking = createFreeChatModel(host(list([row('parent')]), {
      capabilities: async () => ({ retry: false, freeSession: true, deleteSession: false }),
      forkSession,
      openSession,
    }))
    await forking.reloadCapabilities()
    const pendingFork = forking.fork('parent')
    forking.cancel()
    releaseFork('child')
    await pendingFork
    expect(openSession).not.toHaveBeenCalled()

    let releaseDelete: (value: unknown) => void = () => {}
    const selectPanel = vi.fn()
    const deleteSession = vi.fn(() => new Promise(resolve => { releaseDelete = resolve }))
    const deleting = createFreeChatModel(host(list([row('free')]), {
      capabilities: async () => ({ retry: false, freeSession: true, deleteSession: true }),
      deleteSession,
      selectPanel,
    }), () => 'req')
    await deleting.reloadCapabilities()
    deleting.requestDelete('free')
    const pendingDelete = deleting.confirmDelete()
    deleting.cancel()
    releaseDelete({ phase: 'deleted', releasedSelection: true })
    await pendingDelete
    expect(selectPanel).not.toHaveBeenCalled()
    expect(deleting.getSnapshot().focusNonce).toBe(0)
  })

  it('keeps a host list error instead of an empty catalog', () => {
    const model = createFreeChatModel(host({
      ids: [],
      byId: {},
      phase: 'error',
      error: { code: 'session/catalog', message: 'catalog down' },
    }))
    expect(model.getSnapshot().listStatus).toBe('error')
    expect(model.getSnapshot().listFailure).toEqual({ code: 'session/catalog', reason: 'catalog down' })
    expect(model.getSnapshot().rows).toEqual([])
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
