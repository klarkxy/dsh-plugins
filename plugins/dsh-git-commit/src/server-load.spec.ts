import { expect, it, vi } from 'vitest'

vi.mock('react', () => { throw new Error('React is unavailable in the server runtime') })
vi.mock('react/jsx-runtime', () => { throw new Error('React is unavailable in the server runtime') })

it('loads the server entry without React and waits for settings in its RPC response', async () => {
  const { GitCommitService, handleRpc } = await import('./index.ts')
  let release!: (settings: { revision: number; model: { provider: string; model: string }; allowFallback: boolean }) => void
  const loaded = new Promise<{ revision: number; model: { provider: string; model: string }; allowFallback: boolean }>(resolve => { release = resolve })
  const service = new GitCommitService({
    plugin: 'test',
    llm: { prepareCall: async () => { throw new Error('unused') }, resolveCallConfig: async () => { throw new Error('unused') } },
    sessions: { get: () => undefined },
    settings: { load: () => loaded, save: async () => {} },
  })
  const response = handleRpc(service, 'settings', undefined, new AbortController().signal)
  const settled = vi.fn()
  void response.then(settled)
  await Promise.resolve()
  expect(settled).not.toHaveBeenCalled()
  const stored = { revision: 4, model: { provider: 'saved', model: 'route' }, allowFallback: true }
  release(stored)
  expect(await response).toEqual({ ok: true, value: stored })
  await service.dispose()
})
