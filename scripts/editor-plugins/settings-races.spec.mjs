import { expect, it, vi } from 'vitest'
import { CurrentTitleService } from '../../plugins/dsh-current-title/src/service.ts'
import { GitCommitService } from '../../plugins/dsh-git-commit/src/service.ts'

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

it.each(['title', 'git'])('%s accepts only one concurrent same-revision settings save', async kind => {
  const gate = deferred()
  const rows = []
  const save = async row => { rows.push(structuredClone(row)); await gate.promise }
  const service = kind === 'title'
    ? new CurrentTitleService({ plugin: 'test', store: { load: () => undefined, save } })
    : new GitCommitService({ plugin: 'test', sessions: { get: () => undefined }, llm: {},
        settings: { load: async () => ({ revision: 0, model: { provider: '', model: '' }, allowFallback: false }), save } })
  const update = revision => kind === 'title'
    ? service.updateSettings({ prompt: 'saved', expectedRevision: revision })
    : service.updateSettings({ model: { provider: 'p', model: 'm' }, allowFallback: false }, revision)
  const first = update(0)
  const second = update(0)
  const outcome = Promise.allSettled([first, second])
  await vi.waitFor(() => expect(rows).toHaveLength(1))
  gate.resolve()
  const results = await outcome
  expect(results.map(row => row.status)).toEqual(['fulfilled', 'rejected'])
  expect(rows).toHaveLength(1)
  expect((await update(1)).revision).toBe(2)
  await service.dispose()
})

it('git settings await the persisted revision before accepting a mutation', async () => {
  const loaded = deferred()
  const save = vi.fn(async () => {})
  const service = new GitCommitService({ plugin: 'test', sessions: { get: () => undefined }, llm: {},
    settings: { load: () => loaded.promise, save } })
  const saving = service.updateSettings({ model: { provider: '', model: '' }, allowFallback: true }, 0)
  const rejected = expect(saving).rejects.toMatchObject({ code: 'stale' })
  loaded.resolve({ revision: 4, model: { provider: '', model: '' }, allowFallback: false })
  await rejected
  expect(save).not.toHaveBeenCalled()
  expect(service.getSettings().revision).toBe(4)
  await service.dispose()
})
