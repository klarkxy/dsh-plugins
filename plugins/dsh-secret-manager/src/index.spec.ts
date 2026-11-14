import { describe, expect, it } from 'vitest'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { PENDING_TTL_MS } from './contracts.ts'
import { GrantRegistry } from './grants.ts'
import { createRpc, resolveShellValues, type SecretRuntime } from './index.ts'
import { PendingRegistry } from './pending.ts'
import { Redactor } from './redact.ts'
import { SecretStore, SlotLock } from './store.ts'
import { createRequestSecretTool, createSecretHttpTool, createSecretStatusTool } from './tools.ts'

const SECRET = 'dummy-secret-value'
const NEXT = 'rotated-secret-value'

function fakeCredentials() {
  const records = new Map<string, CredentialRecord>()
  const provider = {
    records,
    async readRecord(key: { toString(): string }) { return records.get(String(key)) },
    async modifyRecord(key: { toString(): string }, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
      const next = await mutate(records.get(String(key)))
      if (next !== undefined) records.set(String(key), next)
      return records.get(String(key))
    },
    async deleteRecord(key: { toString(): string }) { records.delete(String(key)) },
    async listRecords() {
      return [...records.entries()].map(([key, record]) => ({ key: key as never, kind: record.kind }))
    },
  }
  return provider as typeof provider & CredentialProvider
}

type Harness = {
  runtime: SecretRuntime
  store: SecretStore
  grants: GrantRegistry
  pending: PendingRegistry
  redactor: Redactor
  lock: SlotLock
  fetchCalls: URL[]
  records: Map<string, CredentialRecord>
  rpc: ReturnType<typeof createRpc>
  signal: AbortSignal
}

function harness(): Harness {
  const credentials = fakeCredentials()
  const store = new SecretStore(credentials)
  const grants = new GrantRegistry()
  const pending = new PendingRegistry()
  const redactor = new Redactor()
  const lock = new SlotLock()
  const knownSlots = new Set<string>()
  const selfWrite = new Set<string>()
  const fetchCalls: URL[] = []
  const runtime: SecretRuntime = {
    store, grants, pending, redactor, lock,
    fetch: (async (url: string | URL) => {
      fetchCalls.push(new URL(String(url)))
      return new Response('{"ok":true}', { status: 200 })
    }) as typeof fetch,
    knownSlots, selfWrite,
    isSubagent: (session: unknown) => (session as { subagent?: boolean } | undefined)?.subagent === true,
    noteDialog: () => {},
    prime: async (slot) => {
      const stored = await store.prime(slot)
      if (stored) knownSlots.add(slot)
      else knownSlots.delete(slot)
      return stored
    },
    ensurePrimed: () => {},
    refreshShell: () => {},
  }
  return {
    runtime, store, grants, pending, redactor, lock, fetchCalls, records: credentials.records,
    rpc: createRpc(runtime),
    signal: new AbortController().signal,
  }
}

const exec = (callId = 'call-1', sessionId = 'session-a', session: unknown = {}) => ({
  callId,
  agent: { id: sessionId, session },
  signal: new AbortController().signal,
})

const request = (overrides: Record<string, unknown> = {}) => ({
  slot: 'db-prod',
  purpose: 'Read the production database.',
  ...overrides,
})

/** Start request_secret and wait until its dialog exists. */
async function startRequestSecret(h: Harness, args: Record<string, unknown>, run = exec()) {
  const tool = createRequestSecretTool(h.runtime) as { execute(args: unknown, exec: unknown): Promise<{ status: string; envGranted: boolean; httpGranted: boolean; ref?: string }> }
  const result = tool.execute(args, run)
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const pending = h.pending.view(run.agent.id, run.callId)
    if (pending) return { result, pending }
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('request_secret opened no dialog')
}

describe('request_secret → dialog → grant', () => {
  it('stores the submitted value and grants only the calling session', async () => {
    const h = harness()
    const { result, pending } = await startRequestSecret(h, request({ request_env: true }))
    const answer = await h.rpc('submit', {
      id: pending.id, sessionId: 'session-a', callId: 'call-1', value: SECRET, grantEnv: true, grantHttp: false,
    }, h.signal)
    expect(answer.ok).toBe(true)
    const settled = await result
    expect(settled).toMatchObject({ status: 'ready', envGranted: true, httpGranted: false, ref: 'secret://db-prod' })
    expect(JSON.stringify(settled)).not.toContain(SECRET)
    expect(h.grants.heldBy('db-prod', 'session-a')).toEqual({ envGranted: true, httpGranted: false })
    expect(h.grants.heldBy('db-prod', 'session-b')).toEqual({ envGranted: false, httpGranted: false })
    expect(h.store.cached('db-prod')?.secret).toBe(SECRET)
  })

  it('refuses a dialog for a delegated child thread', async () => {
    const h = harness()
    const tool = createRequestSecretTool(h.runtime) as { execute(args: unknown, exec: unknown): Promise<{ status: string }> }
    const result = await tool.execute(request(), exec('call-1', 'child', { subagent: true }))
    expect(result.status).toBe('unavailable')
    expect(h.pending.view('child', 'call-1')).toBeUndefined()
  })

  it('answers stale for an unknown pending id, and grants nothing', async () => {
    const h = harness()
    await startRequestSecret(h, request())
    const answer = await h.rpc('submit', {
      id: 'not-a-real-id', sessionId: 'session-a', callId: 'call-1', value: SECRET, grantEnv: true, grantHttp: false,
    }, h.signal)
    expect(answer.ok).toBe(false)
    expect(h.grants.counts('db-prod')).toEqual({ env: 0, http: 0 })
  })

  it('answers stale once the deadline passed, and settles the tool as a timeout', async () => {
    const h = harness()
    const { result, pending } = await startRequestSecret(h, request())
    expect(pending.expiresAt).toBeLessThanOrEqual(Date.now() + PENDING_TTL_MS)
    pending.expiresAt = 0
    const answer = await h.rpc('submit', {
      id: pending.id, sessionId: 'session-a', callId: 'call-1', value: SECRET, grantEnv: true, grantHttp: false,
    }, h.signal)
    expect(answer.ok).toBe(false)
    expect((await result).status).toBe('timeout')
    expect(h.grants.counts('db-prod')).toEqual({ env: 0, http: 0 })
  })
})

describe('regressions', () => {
  it('B: saving a replacement revokes every session that approved the old value', async () => {
    const h = harness()
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)
    h.grants.grant('db-prod', 'session-a', { kind: 'env' })
    expect(h.grants.heldBy('db-prod', 'session-a').envGranted).toBe(true)

    await h.rpc('save', { slot: 'db-prod', value: NEXT }, h.signal)
    expect(h.grants.heldBy('db-prod', 'session-a')).toEqual({ envGranted: false, httpGranted: false })
    expect(h.grants.envValue('db-prod', 'session-a', h.store.cached('db-prod'))).toBeUndefined()
    expect(h.store.cached('db-prod')?.secret).toBe(NEXT)
  })

  it('B2: never hands a replaced value out under an old grant (microtask probe)', async () => {
    const h = harness()
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)
    h.grants.grant('db-prod', 'session-a', { kind: 'env' })

    const observed: Record<string, string>[] = []
    const shell = () => resolveShellValues(
      h.runtime,
      { agent: { id: 'session-a', session: {} } } as unknown as ToolExecution,
    )
    // The probe runs after the store adopted the new value and before the caller's
    // own continuation: exactly the window a synchronous shell resolver can use.
    const realWrite = h.store.write.bind(h.store)
    h.store.write = async (slot: string, value: string) => {
      const stored = await realWrite(slot, value)
      queueMicrotask(() => {
        observed.push(shell())
        queueMicrotask(() => observed.push(shell()))
      })
      return stored
    }

    await h.rpc('save', { slot: 'db-prod', value: NEXT }, h.signal)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(observed).toEqual([{}, {}])
    expect(JSON.stringify(observed)).not.toContain(NEXT)
  })

  it('C: a dialog abandoned while its write was queued grants nothing', async () => {
    const h = harness()
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)

    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    // Occupy the slot lock so the submit has to queue behind it.
    const occupying = h.lock.run('db-prod', () => gate)

    const { pending } = await startRequestSecret(h, request({ request_env: true }), exec('call-B', 'session-b'))
    const submitting = h.rpc('submit', {
      id: pending.id, sessionId: 'session-b', callId: 'call-B', value: NEXT, grantEnv: true, grantHttp: false,
    }, h.signal)
    // The claim happens before the lock: abandon it while the write is queued.
    await Promise.resolve()
    h.pending.abandon(pending.id)
    release()
    await occupying

    const answer = await submitting
    expect(answer.ok).toBe(false)
    expect(h.grants.heldBy('db-prod', 'session-b')).toEqual({ envGranted: false, httpGranted: false })
  })

  it('D: a revocation during the value read stops the HTTP call before it is sent', async () => {
    const h = harness()
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)
    h.grants.grant('db-prod', 'session-a', {
      kind: 'http', origin: 'https://api.example.com', authHeader: 'Authorization', authPrefix: 'Bearer ',
    })

    let readStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => { readStarted = resolve })
    let releaseRead: () => void = () => {}
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
    const realPrime = h.store.prime.bind(h.store)
    h.store.prime = async (slot: string) => {
      readStarted()
      await readGate
      return realPrime(slot)
    }

    const tool = createSecretHttpTool(h.runtime) as { execute(args: unknown, exec: unknown): Promise<{ status: string }> }
    const pendingResult = tool.execute({ ref: 'secret://db-prod', url: 'https://api.example.com/v1' }, exec())
    await started
    h.grants.revoke('db-prod')
    releaseRead()

    const result = await pendingResult
    expect(result.status).toBe('denied')
    expect(h.fetchCalls).toEqual([])
  })

  it('does not open a dialog when secret_http has no authorization', async () => {
    const h = harness()
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)
    const tool = createSecretHttpTool(h.runtime) as { execute(args: unknown, exec: unknown): Promise<{ status: string; summary: string }> }
    const result = await tool.execute({ ref: 'secret://db-prod', url: 'https://api.example.com/v1' }, exec())
    expect(result.status).toBe('denied')
    expect(result.summary).toContain('request_secret')
    expect(h.pending.view('session-a', 'call-1')).toBeUndefined()
    expect(h.fetchCalls).toEqual([])
  })

  it('keeps a revocation that arrives while a submitted value is being stored', async () => {
    const h = harness()
    const { result, pending } = await startRequestSecret(h, request({ request_env: true }))
    let started: () => void = () => {}
    const writing = new Promise<void>(resolve => { started = resolve })
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const write = h.store.write.bind(h.store)
    h.store.write = async (slot, value) => {
      started()
      await gate
      return write(slot, value)
    }
    const submitting = h.rpc('submit', {
      id: pending.id, sessionId: 'session-a', callId: 'call-1', value: SECRET, grantEnv: true,
    }, h.signal)
    await writing
    await h.rpc('revoke', { slot: 'db-prod', sessionId: 'session-a' }, h.signal)
    release()
    expect(await submitting).toMatchObject({ ok: true, value: { status: 'stored', envGranted: false } })
    expect(await result).toMatchObject({ status: 'stored', envGranted: false })
    expect(h.grants.heldBy('db-prod', 'session-a').envGranted).toBe(false)
  })

  it('sends once the session holds the exact origin grant', async () => {
    const h = harness()
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)
    h.grants.grant('db-prod', 'session-a', {
      kind: 'http', origin: 'https://api.example.com', authHeader: 'Authorization', authPrefix: 'Bearer ',
    })
    const tool = createSecretHttpTool(h.runtime) as { execute(args: unknown, exec: unknown): Promise<{ status: string; body?: string }> }
    const result = await tool.execute({ ref: 'secret://db-prod', url: 'https://api.example.com/v1' }, exec())
    expect(result.status).toBe('ok')
    expect(h.fetchCalls.map(url => url.origin)).toEqual(['https://api.example.com'])
  })

  it('lists stored slots with per-session flags and never a value', async () => {
    const h = harness()
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)
    h.grants.grant('db-prod', 'session-a', { kind: 'env' })
    const listed = await h.rpc('list', { sessionId: 'session-a' }, h.signal)
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    const entries = (listed.value as { entries: Record<string, unknown>[] }).entries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ slot: 'db-prod', envGranted: true, httpGranted: false, envGrantedSessions: 1 })
    expect(JSON.stringify(listed)).not.toContain(SECRET)
  })

  it('revokes one session or all of them without deleting the record', async () => {
    const h = harness()
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)
    h.grants.grant('db-prod', 'session-a', { kind: 'env' })
    h.grants.grant('db-prod', 'session-b', { kind: 'env' })
    expect(await h.rpc('revoke', { slot: 'db-prod', sessionId: 'session-a' }, h.signal)).toEqual({ ok: true, value: { revoked: 1 } })
    expect(h.store.cached('db-prod')?.secret).toBe(SECRET)
    expect(await h.rpc('revoke', { slot: 'db-prod' }, h.signal)).toEqual({ ok: true, value: { revoked: 1 } })
  })

  it('deletes the record and every hold on it', async () => {
    const h = harness()
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)
    h.grants.grant('db-prod', 'session-a', { kind: 'env' })
    expect(await h.rpc('delete', { slot: 'db-prod' }, h.signal)).toEqual({ ok: true, value: true })
    expect(h.records.size).toBe(0)
    expect(h.store.cached('db-prod')).toBeUndefined()
    expect(h.grants.heldBy('db-prod', 'session-a')).toEqual({ envGranted: false, httpGranted: false })
  })

  it('revokes grants made by a submit queued before deletion', async () => {
    const h = harness()
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)
    const { result, pending } = await startRequestSecret(h, request({ request_env: true }))
    let release: () => void = () => {}
    const occupying = h.lock.run('db-prod', () => new Promise<void>(resolve => { release = resolve }))
    await Promise.resolve()
    const submitting = h.rpc('submit', {
      id: pending.id, sessionId: 'session-a', callId: 'call-1', grantEnv: true,
    }, h.signal)
    const deleting = h.rpc('delete', { slot: 'db-prod' }, h.signal)
    release()
    await occupying
    expect((await submitting).ok).toBe(true)
    await result
    expect((await deleting).ok).toBe(true)
    expect(h.grants.heldBy('db-prod', 'session-a').envGranted).toBe(false)
    expect(h.store.cached('db-prod')).toBeUndefined()
  })
})

describe('secret_status', () => {
  type StatusTool = {
    execute(args: unknown): Promise<{
      entries: { ref: string; slot: string; envKey: string; configured: boolean }[]
      summary: string
    }>
  }
  const statusTool = (h: Harness) => createSecretStatusTool(h.runtime) as StatusTool

  it('reports nothing for a slot that was never stored', async () => {
    const h = harness()
    const result = await statusTool(h).execute({ slot: 'smoke-unconfigured' })
    expect(result.entries).toEqual([])
    expect(result.summary).toContain('not stored')
    expect(result.summary).toContain('request_secret')
  })

  it('reports a stored slot with its reference and derived variable', async () => {
    const h = harness()
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)
    const result = await statusTool(h).execute({ slot: 'db-prod' })
    expect(result.entries).toEqual([{ ref: 'secret://db-prod', slot: 'db-prod', envKey: 'DSH_SECRET_DB_PROD', configured: true }])
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('stops reporting a slot once its record is deleted', async () => {
    const h = harness()
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)
    expect(await statusTool(h).execute({ slot: 'db-prod' })).toMatchObject({ entries: [{ slot: 'db-prod' }] })
    await h.rpc('delete', { slot: 'db-prod' }, h.signal)
    const after = await statusTool(h).execute({ slot: 'db-prod' })
    expect(after.entries).toEqual([])
    expect(after.summary).toContain('request_secret')
  })

  it('lists every stored slot when no slot is named', async () => {
    const h = harness()
    expect((await statusTool(h).execute({})).entries).toEqual([])
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)
    await h.rpc('save', { slot: 'aws', value: NEXT }, h.signal)
    const result = await statusTool(h).execute({})
    expect(result.entries.map(entry => entry.slot)).toEqual(['aws', 'db-prod'])
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(JSON.stringify(result)).not.toContain(NEXT)
  })
})

describe('shell injection', () => {
  const execution = (agent: unknown) => ({ agent } as unknown as ToolExecution)

  it('injects only into the granted session, and never into a child thread', async () => {
    const h = harness()
    await h.rpc('save', { slot: 'db-prod', value: SECRET }, h.signal)
    h.grants.grant('db-prod', 'session-a', { kind: 'env' })

    expect(resolveShellValues(h.runtime, execution({ id: 'session-a', session: {} })))
      .toEqual({ DSH_SECRET_DB_PROD: SECRET })
    expect(resolveShellValues(h.runtime, execution({ id: 'session-b', session: {} }))).toEqual({})
    expect(resolveShellValues(h.runtime, execution({ id: 'session-a', session: { subagent: true } }))).toEqual({})
    expect(resolveShellValues(h.runtime, execution(undefined))).toEqual({})
  })
})
