/**
 * The stored half: one `ctx.credentials` record per slot, owned by this plugin.
 *
 * Records (the `<scope>/<id>` key space) are the only storage used here. The
 * reference half of the same seam resolves through process environment and
 * `.env` files, so a removed value would silently come back from ambient
 * configuration — exactly the "unset resurrects an old secret" failure this
 * plugin must not have. A record has no fallback layer: its presence is the
 * whole fact.
 *
 * Every write is serialized per slot. A `credentials/record-updated`
 * notification can arrive from another process between a read and a write, so
 * the caller's read-decide-write runs under the same {@link SlotLock} that
 * handles invalidation, and a stale read can never be committed back as a
 * fresh grant.
 */
import { credentialKey, type CredentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { CREDENTIAL_SCOPE, ENV_KEY_RE, envKeyOf, isSlot } from './contracts.ts'

/** The decoded payload this plugin writes into one record. */
export interface StoredSecret {
  /** Never logged, never returned to a Client, never placed in a tool result. */
  secret: string
  envKey: string
}

interface GrantPayload {
  v: 1
  envKey: string
  secret: string
}

const PAYLOAD_VERSION = 1

export interface SecretStoreOptions {
  now?: () => number
}

/**
 * Serializes work per slot. `run` never rejects: the caller's error surfaces
 * through the returned promise, while the chain always continues, so one failed
 * write cannot wedge every later operation on that slot.
 */
export class SlotLock {
  private readonly tails = new Map<string, Promise<unknown>>()

  run<T>(slot: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(slot) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.tails.set(slot, next.then(() => undefined, () => undefined))
    return next
  }
}

export class SecretStore {
  private readonly cache = new Map<string, StoredSecret>()
  private readonly versions = new Map<string, number>()
  private generation = 0
  private readonly now: () => number

  private readonly credentials: CredentialProvider

  constructor(credentials: CredentialProvider, options: SecretStoreOptions = {}) {
    this.credentials = credentials
    this.now = options.now ?? Date.now
  }

  /**
   * Monotonic counter for one slot's stored value. A caller that captured a
   * value can prove nothing replaced or removed it before acting on it.
   */
  version(slot: string): number {
    return this.versions.get(slot) ?? 0
  }

  private bump(slot: string): void {
    this.versions.set(slot, this.version(slot) + 1)
  }

  /** The record address for a slot. Slot grammar is checked before branding. */
  keyOf(slot: string): CredentialKey {
    if (!isSlot(slot)) throw new TypeError('invalid slot')
    return credentialKey(CREDENTIAL_SCOPE, slot)
  }

  /** True when the address names a record this plugin owns. */
  static owns(key: string): boolean {
    return key.startsWith(`${CREDENTIAL_SCOPE}/`)
  }

  /** Synchronous cache read for the shell resolver, which cannot await. */
  cached(slot: string): StoredSecret | undefined {
    return this.cache.get(slot)
  }

  /** Load one record into the cache; `undefined` when nothing is stored. */
  async prime(slot: string): Promise<StoredSecret | undefined> {
    if (!isSlot(slot)) return undefined
    const version = this.version(slot)
    const generation = this.generation
    const stored = this.decode(slot, await this.credentials.readRecord(this.keyOf(slot)))
    // A read started before rotation, deletion or unload must not resurrect
    // that snapshot after a newer operation has changed the cache.
    if (version !== this.version(slot) || generation !== this.generation) return this.cache.get(slot)
    if (stored) this.cache.set(slot, stored)
    else this.cache.delete(slot)
    return stored
  }

  /** Store a value and return its decoded form; callers hold the slot lock. */
  async write(slot: string, secret: string): Promise<StoredSecret> {
    if (!isSlot(slot)) throw new TypeError('invalid slot')
    if (secret.length === 0) throw new TypeError('refusing to store an empty value')
    const payload: GrantPayload = { v: PAYLOAD_VERSION, envKey: envKeyOf(slot), secret }
    const record = await this.credentials.modifyRecord(this.keyOf(slot), async () => ({
      kind: 'grant',
      payload,
    } as CredentialRecord))
    const stored = this.decode(slot, record) ?? { secret, envKey: payload.envKey }
    this.cache.set(slot, stored)
    this.bump(slot)
    return stored
  }

  /** Remove one record; removing an absent record is a no-op. */
  async remove(slot: string): Promise<void> {
    if (!isSlot(slot)) return
    await this.credentials.deleteRecord(this.keyOf(slot))
    this.cache.delete(slot)
    this.bump(slot)
  }

  /** Slots this plugin has a record for, in stable order. */
  async slots(): Promise<string[]> {
    const entries = await this.credentials.listRecords()
    const slots: string[] = []
    for (const entry of entries) {
      const key = String(entry.key)
      if (!SecretStore.owns(key)) continue
      const slot = key.slice(CREDENTIAL_SCOPE.length + 1)
      if (isSlot(slot) && entry.kind === 'grant') slots.push(slot)
    }
    return slots.sort()
  }

  /** Drop one cached value; the next resolver call reads the record again. */
  invalidate(slot: string): void {
    this.cache.delete(slot)
    this.bump(slot)
  }

  invalidateAll(): void {
    this.generation += 1
    this.cache.clear()
    for (const slot of [...this.versions.keys()]) this.bump(slot)
  }

  /**
   * Decode a record this plugin wrote. A payload in another shape is treated as
   * absent rather than trusted: only this plugin's own version is understood.
   */
  private decode(slot: string, record: CredentialRecord | undefined): StoredSecret | undefined {
    if (!record || record.kind !== 'grant') return undefined
    const payload = record.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
    const candidate = payload as Partial<GrantPayload>
    if (candidate.v !== PAYLOAD_VERSION) return undefined
    if (typeof candidate.secret !== 'string' || candidate.secret.length === 0) return undefined
    if (typeof candidate.envKey !== 'string' || !ENV_KEY_RE.test(candidate.envKey)) return undefined
    // The derived name wins when it disagrees: injection keys must match slots.
    if (candidate.envKey !== envKeyOf(slot)) return undefined
    return { secret: candidate.secret, envKey: candidate.envKey }
  }
}
