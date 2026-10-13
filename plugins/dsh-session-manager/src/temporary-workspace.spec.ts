import { describe, expect, it, vi } from 'vitest'
import { createTemporaryWorkspaceModel } from './temporary-workspace.ts'

function fixture() {
  let navigation = new AbortController()
  const host = {
    beginNavigation: () => { navigation.abort(); navigation = new AbortController(); return navigation.signal },
    allocate: vi.fn(async (requestId: string) => ({ requestId, path: `/owned/${requestId}` })),
    createWorkspace: vi.fn(async (path: string) => ({ workspaceId: path })),
    renameWorkspace: vi.fn(async (_id: string, _title: string) => {}),
    openWorkspace: vi.fn(async (_id: string, beforeOpen: () => void) => {
      navigation.abort(); navigation = new AbortController(); beforeOpen()
    }),
  }
  let id = 0
  const model = createTemporaryWorkspaceModel(host, () => `request-${++id}`)
  return { host, model, move: () => navigation.abort() }
}

describe('temporary workspace creation', () => {
  it('allocates distinct actions but reuses pending stages after failures', async () => {
    const { host, model } = fixture()
    host.allocate.mockRejectedValueOnce(new Error('lost reply'))
    await model.create(); await model.create()
    expect(host.allocate.mock.calls.map(call => call[0])).toEqual(['request-1', 'request-1'])
    host.openWorkspace.mockRejectedValueOnce(new Error('open failed'))
    await model.create()
    const before = [host.allocate.mock.calls.length, host.createWorkspace.mock.calls.length]
    await model.create()
    expect([host.allocate.mock.calls.length, host.createWorkspace.mock.calls.length]).toEqual(before)
    expect(host.openWorkspace).toHaveBeenLastCalledWith('/owned/request-2', expect.any(Function))
    await model.create()
    expect(host.allocate).toHaveBeenLastCalledWith('request-3', expect.any(AbortSignal))
  })

  it('retries adoption of the same directory when a Workspace response is lost', async () => {
    const { host, model } = fixture()
    host.createWorkspace.mockRejectedValueOnce(new Error('lost adoption response'))
    await model.create(); await model.create()
    expect(host.allocate).toHaveBeenCalledOnce()
    expect(host.createWorkspace.mock.calls).toEqual([['/owned/request-1'], ['/owned/request-1']])
  })

  it.each(['navigation', 'unload'])('blocks duplicate clicks and late adoption after %s during allocation', async reason => {
    const { host, model, move } = fixture()
    let resolve!: (value: { requestId: string; path: string }) => void
    host.allocate.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const active = model.create()
    await model.create()
    expect(host.allocate).toHaveBeenCalledOnce()
    if (reason === 'navigation') move(); else model.cancel()
    resolve({ requestId: 'request-1', path: '/owned/request-1' })
    await active
    expect(host.createWorkspace).not.toHaveBeenCalled()
    expect(host.openWorkspace).not.toHaveBeenCalled()
    expect(model.getSnapshot().failure).toBeUndefined()
  })

  it('does not navigate when the user moves during Workspace adoption', async () => {
    const { host, model, move } = fixture()
    let resolve!: (value: { workspaceId: string }) => void
    host.createWorkspace.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const active = model.create()
    await vi.waitFor(() => expect(host.createWorkspace).toHaveBeenCalledOnce())
    move(); resolve({ workspaceId: 'adopted' }); await active
    expect(host.openWorkspace).not.toHaveBeenCalled()
    await model.create()
    expect(host.createWorkspace).toHaveBeenCalledOnce()
    expect(host.openWorkspace).toHaveBeenCalledWith('adopted', expect.any(Function))
  })

  it('prevents final selection after unload while native open is waiting, and reports ordinary open failures', async () => {
    const { host, model } = fixture()
    let finish!: () => void
    const selection = vi.fn()
    host.openWorkspace.mockImplementationOnce(async (_id, beforeOpen) => {
      host.beginNavigation()
      await new Promise<void>(resolve => { finish = resolve })
      beforeOpen(); selection()
    })
    const active = model.create()
    await vi.waitFor(() => expect(host.openWorkspace).toHaveBeenCalledOnce())
    model.cancel(); finish(); await active
    expect(selection).not.toHaveBeenCalled()
    const next = fixture()
    next.host.openWorkspace.mockImplementationOnce(async () => {
      next.host.beginNavigation(); throw new Error('session creation failed')
    })
    await next.model.create()
    expect(next.model.getSnapshot().failure).toBe('session creation failed')
  })
})
