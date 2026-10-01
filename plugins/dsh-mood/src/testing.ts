import { defaultSettings } from './contracts.ts'
import type { SessionEventLike } from './evidence.ts'
import { toolRequestSchema } from './schema.ts'
import { MoodService, type MoodPersistedState } from './service.ts'

export function human(id = 'u1', text = 'Fix the bug without changing the public API', seq = 1): SessionEventLike {
  return { type: 'user/message', seq, data: { id, source: { kind: 'user' }, content: [{ type: 'text', text }] } }
}
export function draft(goal = 'Fix the bug', expectedRevision = 0, sourceVersion = 'u1') {
  const result = toolRequestSchema.parse({ action: 'record', expectedRevision, sourceVersion, requirements: { goal } })
  if (result.action !== 'record') throw new Error('fixture')
  return result
}
export function fixture(initial?: MoodPersistedState, save?: (state: MoodPersistedState) => Promise<void>) {
  const events: Record<string, SessionEventLike[]> = { s1: [human()], s2: [human('u2', 'Another task')] }
  let disk = structuredClone(initial ?? { settings: defaultSettings(), sessions: {} })
  let writes = 0
  const options = {
    store: {
      load: () => structuredClone(disk),
      save: async (state: MoodPersistedState) => {
        writes++
        if (save) await save(state)
        disk = structuredClone(state)
      },
    },
    readEvents: (id: string) => events[id],
    id: () => 'requirement-id', now: () => 100,
  }
  return { service: new MoodService(options), options, events, disk: () => structuredClone(disk), writes: () => writes }
}
export const signal = () => new AbortController().signal
export function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
