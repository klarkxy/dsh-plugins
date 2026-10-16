import type { ModelRoute } from '@klarkxy/dsh-model-route'
import type { PresenceModelStore, PresenceWriteOptions } from './config-editor.ts'
import { SETTINGS_KEY, parsePresenceSettings, type PresenceSettings } from './storage.ts'

export interface PresenceDomainHandle {
  table(name: 'settings'): {
    entries(): IterableIterator<[unknown, unknown]>
    get(key: string): unknown
    put(key: string, value: unknown): Promise<void>
  }
  close(): Promise<void>
}

const MAX_GHOST_SUGGESTIONS = 200

/** Serialize transforms, rather than snapshots, over the durable whole-row put. */
export class PresenceSettingsStore implements PresenceModelStore {
  private row: PresenceSettings
  private tail: Promise<unknown> = Promise.resolve()
  private closing: Promise<void> | undefined
  private readonly lifetime = new AbortController()
  readonly signal = this.lifetime.signal

  constructor(private readonly domain: PresenceDomainHandle) {
    this.row = parsePresenceSettings(domain.table('settings').get(SETTINGS_KEY))
      ?? { revision: 0, model: null, ghostModel: null, suggestions: {} }
  }

  read(): PresenceSettings { return this.row }

  write(model: ModelRoute | null, options?: PresenceWriteOptions): Promise<number> {
    return this.commit(row => ({ ...row, model }), options)
  }

  writeGhost(ghostModel: ModelRoute | null, options?: PresenceWriteOptions): Promise<number> {
    return this.commit(row => ({ ...row, ghostModel }), options)
  }

  suggestion(sessionId: string) { return this.row.suggestions[sessionId] }

  async rememberSuggestion(sessionId: string, seq: number, text: string | null, signal?: AbortSignal): Promise<void> {
    await this.commit(row => {
      const suggestions = { ...row.suggestions, [sessionId]: { seq, text } }
      const ids = Object.keys(suggestions)
      if (ids.length > MAX_GHOST_SUGGESTIONS) delete suggestions[ids[0]!]
      return { ...row, suggestions }
    }, { signal })
  }

  private commit(transform: (row: PresenceSettings) => PresenceSettings, options?: PresenceWriteOptions): Promise<number> {
    if (this.signal.aborted) return Promise.reject(new Error('Session Manager settings owner unloaded'))
    const operation = this.tail.then(async () => {
      this.signal.throwIfAborted()
      options?.signal?.throwIfAborted()
      if (options?.expectedRevision !== undefined && options.expectedRevision !== this.row.revision) {
        throw new Error('Session Manager settings changed; refresh and retry')
      }
      const next = { ...transform(this.row), revision: this.row.revision + 1 }
      // No await between the live-row transform/CAS and put admission. Once
      // admitted, cancellation cannot roll back the durable write.
      await this.domain.table('settings').put(SETTINGS_KEY, next)
      this.row = next
      return next.revision
    })
    this.tail = operation.catch(() => {})
    return operation
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.lifetime.abort()
    this.closing = this.tail.then(() => this.domain.close())
    return this.closing
  }
}
