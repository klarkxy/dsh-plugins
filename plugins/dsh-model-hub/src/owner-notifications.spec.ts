import { describe, expect, it } from 'vitest'
import { CurrentTitleService } from '../../dsh-current-title/src/service.ts'
import { GitCommitService } from '../../dsh-git-commit/src/service.ts'

describe('owner commit invalidations', () => {
  for (const kind of ['title', 'git'] as const) {
    it(`${kind} publishes the adopted revision only after persistence and isolates observer failure`, async () => {
      let finish!: () => void
      let fail = false
      const saving = new Promise<void>(resolve => { finish = resolve })
      const observed: number[] = []
      const notify = (revision: number) => { observed.push(revision); throw new Error('observer failed') }
      const save = async () => { await saving; if (fail) throw new Error('disk failed') }
      const title = new CurrentTitleService({ plugin: 'title', onSettingsChanged: notify, store: { load: () => undefined, save } })
      const git = new GitCommitService({ plugin: 'git', onSettingsChanged: notify,
        llm: {} as never, sessions: { get: () => undefined }, settings: { load: async () => ({ revision: 0, model: { provider: '', model: '' }, allowFallback: false }), save } })
      const write = (revision: number) => kind === 'title'
        ? title.updateSettings({ model: { provider: 'ocg', model: 'mimo-v2.6-flash' }, expectedRevision: revision })
        : git.updateSettings({ model: { provider: 'ocg', model: 'mimo-v2.6-flash' }, allowFallback: false }, revision)
      const pending = write(0)
      await Promise.resolve(); expect(observed).toEqual([])
      finish(); await expect(pending).resolves.toMatchObject({ revision: 1 })
      expect(observed).toEqual([1])
      await expect(write(0)).rejects.toThrow(); expect(observed).toEqual([1])
      fail = true
      await expect(write(1)).rejects.toThrow('disk failed'); expect(observed).toEqual([1])
      await title.dispose(); await git.dispose()
    })
  }
})
