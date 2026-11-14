import { describe, expect, it } from 'vitest'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { ENV_KEY_RE } from './contracts.ts'
import { SecretStore, SlotLock } from './store.ts'

type Key = { toString(): string }

/** A minimal stand-in for the credential seam's record half. */
function fakeCredentials() {
  const records = new Map<string, CredentialRecord>()
  const provider = {
    records,
    async readRecord(key: Key) { return records.get(String(key)) },
    async modifyRecord(key: Key, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
      const next = await mutate(records.get(String(key)))
      if (next !== undefined) records.set(String(key), next)
      return records.get(String(key))
    },
    async deleteRecord(key: Key) { records.delete(String(key)) },
    async listRecords() {
      return [...records.entries()].map(([key, record]) => ({ key: key as never, kind: record.kind }))
    },
  }
  return provider as typeof provider & CredentialProvider
}

const grant = (payload: unknown): CredentialRecord => ({ kind: 'grant', payload })

describe('SecretStore', () => {
  it('writes one record under this plugin scope and reads it back', async () => {
    const credentials = fakeCredentials()
    const store = new SecretStore(credentials, { now: () => 1_000 })
    const stored = await store.write('db-prod', 'dummy-secret-value')
    expect(stored.envKey).toBe('DSH_SECRET_DB_PROD')
    expect(stored.envKey).toMatch(ENV_KEY_RE)
    expect([...credentials.records.keys()]).toEqual(['secret-manager/db-prod'])
    const payload = credentials.records.get('secret-manager/db-prod')?.payload as { v: number; secret: string }
    expect(payload.v).toBe(1)
    expect(payload.secret).toBe('dummy-secret-value')
    expect((await store.prime('db-prod'))?.secret).toBe('dummy-secret-value')
    expect(store.cached('db-prod')?.secret).toBe('dummy-secret-value')
  })

  it('replaces the value in place rather than adding a record', async () => {
    const credentials = fakeCredentials()
    const store = new SecretStore(credentials)
    await store.write('db-prod', 'first-value-1234')
    await store.write('db-prod', 'second-value-5678')
    expect(credentials.records.size).toBe(1)
    expect(store.cached('db-prod')?.secret).toBe('second-value-5678')
  })

  it('treats a foreign or stale payload as absent instead of trusting it', async () => {
    const credentials = fakeCredentials()
    credentials.records.set('secret-manager/db-prod', grant({ v: 2, envKey: 'DSH_SECRET_DB_PROD', secret: 'dummy-secret-value' }))
    const store = new SecretStore(credentials)
    expect(await store.prime('db-prod')).toBeUndefined()

    credentials.records.set('secret-manager/db-prod', grant({ v: 1, envKey: 'DSH_SECRET_OTHER', secret: 'dummy-secret-value' }))
    expect(await store.prime('db-prod')).toBeUndefined()

    credentials.records.set('secret-manager/db-prod', grant({ v: 1, envKey: 'DSH_SECRET_DB_PROD', secret: '' }))
    expect(await store.prime('db-prod')).toBeUndefined()

    credentials.records.set('secret-manager/db-prod', { kind: 'api-key', key: 'dummy-secret-value' })
    expect(await store.prime('db-prod')).toBeUndefined()
  })

  it('lists only slots this plugin owns', async () => {
    const credentials = fakeCredentials()
    credentials.records.set('someone-else/route', grant({}))
    const store = new SecretStore(credentials)
    await store.write('db-prod', 'dummy-secret-value')
    await store.write('aws', 'dummy-secret-value')
    expect(await store.slots()).toEqual(['aws', 'db-prod'])
  })

  it('removes a record and drops the cache entry', async () => {
    const credentials = fakeCredentials()
    const store = new SecretStore(credentials)
    await store.write('db-prod', 'dummy-secret-value')
    await store.remove('db-prod')
    expect(credentials.records.size).toBe(0)
    expect(store.cached('db-prod')).toBeUndefined()
    await expect(store.remove('db-prod')).resolves.toBeUndefined()
  })

  it('refuses an empty value and an invalid slot', async () => {
    const store = new SecretStore(fakeCredentials())
    await expect(store.write('db-prod', '')).rejects.toThrow(TypeError)
    await expect(store.write('Bad Slot', 'dummy-secret-value')).rejects.toThrow(TypeError)
    expect(store.keyOf('db-prod').toString()).toBe('secret-manager/db-prod')
  })

  it('bumps the version on every value change', async () => {
    const store = new SecretStore(fakeCredentials())
    const initial = store.version('db-prod')
    await store.write('db-prod', 'dummy-secret-value')
    const afterWrite = store.version('db-prod')
    expect(afterWrite).toBeGreaterThan(initial)
    store.invalidate('db-prod')
    expect(store.version('db-prod')).toBeGreaterThan(afterWrite)
    await store.remove('db-prod')
    expect(store.version('db-prod')).toBeGreaterThan(afterWrite + 1)
  })

  it('invalidates one cached value', async () => {
    const store = new SecretStore(fakeCredentials())
    await store.write('db-prod', 'dummy-secret-value')
    store.invalidate('db-prod')
    expect(store.cached('db-prod')).toBeUndefined()
  })

  it.each(['replace', 'delete', 'invalidate', 'unload'] as const)(
    'does not restore a stale read after %s',
    async operation => {
      const credentials = fakeCredentials()
      const store = new SecretStore(credentials)
      await store.write('db-prod', 'old-value')
      const old = credentials.records.get('secret-manager/db-prod')
      let release: (record: CredentialRecord | undefined) => void = () => {}
      credentials.readRecord = () => new Promise(resolve => { release = resolve })
      const reading = store.prime('db-prod')
      if (operation === 'replace') await store.write('db-prod', 'new-value')
      else if (operation === 'delete') await store.remove('db-prod')
      else if (operation === 'invalidate') store.invalidate('db-prod')
      else store.invalidateAll()
      release(old)
      const expected = operation === 'replace' ? 'new-value' : undefined
      expect((await reading)?.secret).toBe(expected)
      expect(store.cached('db-prod')?.secret).toBe(expected)
    },
  )
})

describe('SlotLock', () => {
  it('runs tasks for one slot strictly in order', async () => {
    const lock = new SlotLock()
    const order: string[] = []
    const slow = lock.run('slot', async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      order.push('first')
    })
    const fast = lock.run('slot', async () => { order.push('second') })
    await Promise.all([slow, fast])
    expect(order).toEqual(['first', 'second'])
  })

  it('keeps the chain alive after a task fails', async () => {
    const lock = new SlotLock()
    const failed = lock.run('slot', async () => { throw new Error('write failed') })
    await expect(failed).rejects.toThrow('write failed')
    await expect(lock.run('slot', async () => 'next')).resolves.toBe('next')
  })

  it('does not serialize different slots', async () => {
    const lock = new SlotLock()
    const order: string[] = []
    const a = lock.run('a', async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      order.push('a')
    })
    const b = lock.run('b', async () => { order.push('b') })
    await Promise.all([a, b])
    expect(order).toEqual(['b', 'a'])
  })
})
