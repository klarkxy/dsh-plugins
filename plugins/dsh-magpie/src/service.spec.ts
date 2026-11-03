import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createMagpieService } from './service.ts'
import type { PlanOp, SettingsDescriptorLike } from './plan.ts'
import type { MagpieOptions } from './contracts.ts'

const fixtures = fileURLToPath(new URL('../test/fixtures/', import.meta.url))
const listing = JSON.parse(readFileSync(`${fixtures}models.deepseek-harness.json`, 'utf8'))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function getPath(value: unknown, path: readonly string[]): unknown {
  let node = value
  for (const key of path) node = isRecord(node) ? node[key] : undefined
  return node
}
function setPath(value: Record<string, unknown>, path: readonly string[], next: unknown): void {
  const [head, ...rest] = path
  if (!rest.length) { value[head] = next; return }
  if (!isRecord(value[head])) value[head] = {}
  setPath(value[head] as Record<string, unknown>, rest, next)
}
function unsetPath(value: Record<string, unknown>, path: readonly string[]): void {
  const [head, ...rest] = path
  if (!rest.length) { Reflect.deleteProperty(value, head); return }
  if (isRecord(value[head])) unsetPath(value[head] as Record<string, unknown>, rest)
}
function mergeLayers(base: unknown, user: unknown): unknown {
  if (!isRecord(base)) return clone(user)
  if (!isRecord(user)) return clone(user) ?? clone(base)
  const out: Record<string, unknown> = { ...clone(base) }
  for (const [key, value] of Object.entries(user)) out[key] = mergeLayers(base[key], value)
  return out
}

/** Minimal faithful stand-in for the host settings CAS store. */
function makeSettings(initial: Record<string, { base?: unknown; user?: unknown }>) {
  const rows = new Map(Object.entries(initial).map(([ns, row]) => [ns, { base: row.base ?? {}, user: row.user ?? {}, revision: 1 }]))
  const calls: { ns: string; ops: PlanOp[] }[] = []
  const describe = (): SettingsDescriptorLike[] => [...rows].map(([ns, row]) => ({
    ns,
    value: mergeLayers(row.base, row.user),
    base: clone(row.base),
    user: Object.keys(row.user as object).length ? clone(row.user) : undefined,
    revision: row.revision,
  }))
  const mutate = async (ns: string, ops: readonly PlanOp[], expectedRevision?: number) => {
    const row = rows.get(ns)
    if (!row) throw new Error(`No configurable plugin entry "${ns}"`)
    if (expectedRevision !== undefined && expectedRevision !== row.revision) {
      const error = new Error('conflict') as Error & { code: string }
      error.code = 'SETTINGS_CONFLICT'
      throw error
    }
    calls.push({ ns, ops: clone(ops) })
    for (const op of ops) {
      const user = row.user as Record<string, unknown>
      if (op.op === 'set') setPath(user, op.path, clone(op.value))
      else {
        const inherited = getPath(row.base, op.path)
        if (inherited === undefined) unsetPath(user, op.path)
        else setPath(user, op.path, clone(inherited))
      }
    }
    row.revision += 1
  }
  return { rows, calls, describe, mutate }
}

function makeCredentials() {
  const store = new Map<string, string>()
  return {
    store,
    resolve: async (ref: string) => store.has(ref) ? { value: store.get(ref)! } : undefined,
    describe: async (ref: string) => ({ configured: store.has(ref), writable: true }),
    set: async (ref: string, value: string) => { store.set(ref, value) },
    unset: async (ref: string) => { store.delete(ref) },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function makeDeps(over: {
  address?: string
  replies?: Record<string, Response>
  writable?: boolean
  options?: Partial<MagpieOptions>
  noCredentials?: boolean
} = {}) {
  const settings = makeSettings({
    'llm-pi-ai': { base: {} },
    'agent-default-model': { base: { provider: 'deepseek-official', model: 'deepseek-flash' } },
    'web-search-deepseek': { base: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
    magpie: {},
  })
  const credentials = makeCredentials()
  const replies = over.replies ?? {
    'http://127.0.0.1:3425/': jsonResponse({ name: 'magpie', version: '0.1.2798' }),
    'http://127.0.0.1:3425/v1/models': jsonResponse(listing),
  }
  const requested: string[] = []
  // Like ctx.config's volatile cells: own-namespace writes are visible live.
  const options = (): MagpieOptions => ({
    address: over.address ?? 'http://127.0.0.1:3425',
    apiKeyEnv: 'MAGPIE_GATEWAY_KEY',
    syncOnStart: true,
    webSearch: false,
    ...over.options,
    ...(settings.rows.get('magpie')!.user as Partial<MagpieOptions>),
  })
  const service = createMagpieService({
    describe: settings.describe,
    mutate: settings.mutate,
    writable: () => over.writable ?? true,
    credentials: () => over.noCredentials ? undefined : credentials,
    ownNamespace: 'magpie',
    options,
    userAgent: 'deepseek-harness dsh-magpie/test',
    fetchImpl: async (url) => {
      requested.push(String(url))
      const reply = replies[String(url)]
      if (!reply) throw new TypeError(`unexpected fetch ${url}`)
      return reply
    },
  })
  return { service, settings, credentials, options, requested }
}

const signal = new AbortController().signal

describe('sync', () => {
  it('writes the three routes, default model, web search, and the placeholder key', async () => {
    const { service, settings, credentials } = makeDeps({ options: { defaultModel: 'auto/deepseek-v4.1-flash', webSearch: true } })
    const status = await service.sync(signal)
    const providers = (settings.rows.get('llm-pi-ai')!.user as { providers: Record<string, { models: unknown[] }> }).providers
    expect(Object.keys(providers)).toEqual(['magpie', 'magpie-responses', 'magpie-anthropic'])
    expect(providers.magpie.models.length).toBe(8)
    expect(providers['magpie-responses'].models.length).toBe(7)
    expect(providers['magpie-anthropic'].models.length).toBe(6)
    expect(credentials.store.get('MAGPIE_GATEWAY_KEY')).toBe('magpie')
    expect(settings.rows.get('agent-default-model')!.user).toMatchObject({ provider: 'magpie', model: 'auto/deepseek-v4.1-flash' })
    expect(settings.rows.get('web-search-deepseek')!.user).toMatchObject({
      apiKeyEnv: 'MAGPIE_GATEWAY_KEY', baseURL: 'http://127.0.0.1:3425/v1', model: 'auto/deepseek-v4.1-flash',
    })
    expect(status.lastError).toBeUndefined()
    expect(status.lastSync?.routes).toEqual({ magpie: 8, 'magpie-responses': 7, 'magpie-anthropic': 6 })
    expect(status.gateway).toEqual({ name: 'magpie', version: '0.1.2798' })
  })

  it('is a no-op on the second run', async () => {
    const { service, settings } = makeDeps({ options: { defaultModel: 'auto/deepseek-v4.1-flash', webSearch: true } })
    await service.sync(signal)
    settings.calls.length = 0
    await service.sync(signal)
    expect(settings.calls).toEqual([])
  })

  it('surfaces gateway and auth failures in status, never throws', async () => {
    const { service } = makeDeps({
      address: 'http://192.168.1.9:3425',
      replies: {
        'http://192.168.1.9:3425/': jsonResponse({ error: 'unauthorized' }, 401),
      },
    })
    const status = await service.sync(signal)
    expect(status.lastError?.message).toContain('requires a key')
    expect(status.lastSync).toBeUndefined()
  })

  it('refuses to write into a read-only profile', async () => {
    const { service, settings } = makeDeps({ writable: false })
    const status = await service.sync(signal)
    expect(status.lastError?.message).toContain('read-only')
    expect(settings.calls).toEqual([])
  })

  it('fails without writes when the listing has no usable models', async () => {
    const { service, settings } = makeDeps({
      replies: {
        'http://127.0.0.1:3425/': jsonResponse({ name: 'magpie', version: '0.1.2798' }),
        'http://127.0.0.1:3425/v1/models': jsonResponse({ data: [] }),
      },
    })
    const status = await service.sync(signal)
    expect(status.lastError?.message).toContain('no usable models')
    expect(status.lastSync).toBeUndefined()
    expect(settings.calls).toEqual([])
    expect((settings.rows.get('llm-pi-ai')!.user as { providers?: object }).providers).toBeUndefined()
  })
})

describe('connection and options RPCs', () => {
  it('saveConnection normalizes the address and stores the key', async () => {
    const { service, settings, credentials } = makeDeps()
    await service.saveConnection({ address: 'http://127.0.0.1:3425/v1/', apiKey: ' gk-1 ' }, signal)
    const own = settings.rows.get('magpie')!.user as { address?: string }
    expect(own.address).toBe('http://127.0.0.1:3425')
    expect(credentials.store.get('MAGPIE_GATEWAY_KEY')).toBe('gk-1')
    const cleared = await service.saveConnection({ clearKey: true }, signal)
    expect(cleared.keyConfigured).toBe(false)
  })

  it('status.models reflects the routes stored in settings', async () => {
    const { service } = makeDeps()
    await service.sync(signal)
    const status = await service.status()
    expect(status.models.length).toBe(21)
    expect(status.models[0]).toMatchObject({ route: 'magpie' })
    expect(status.keyConfigured).toBe(true)
  })

  it('setOptions writes own settings then re-syncs', async () => {
    const { service, settings } = makeDeps()
    const status = await service.setOptions({ defaultModel: 'auto/deepseek-v4.1-flash', webSearch: true }, signal)
    const own = settings.rows.get('magpie')!.user
    expect(own).toMatchObject({ defaultModel: 'auto/deepseek-v4.1-flash', webSearch: true })
    expect(status.options.webSearch).toBe(true)
    expect((settings.rows.get('web-search-deepseek')!.user as { model?: string }).model).toBe('auto/deepseek-v4.1-flash')
  })

  it('test reads the gateway without writing settings', async () => {
    const { service, settings } = makeDeps()
    const result = await service.test(signal)
    expect(result).toEqual({ gateway: { name: 'magpie', version: '0.1.2798' }, models: 21 })
    expect(settings.calls).toEqual([])
  })

  it('rejects a non-magpie service', async () => {
    const { service } = makeDeps({
      replies: { 'http://127.0.0.1:3425/': jsonResponse({ name: 'other' }) },
    })
    await expect(service.test(signal)).rejects.toThrow('not a magpie gateway')
  })

  it('uses the env key and persists nothing on hosts without a credential store', async () => {
    process.env.MAGPIE_GATEWAY_KEY = 'gk-env'
    try {
      const { service, settings } = makeDeps({ noCredentials: true })
      const status = await service.sync(signal)
      expect(status.lastError).toBeUndefined()
      expect(status.keyConfigured).toBe(true)
      expect(status.keyWritable).toBe(false)
      expect((settings.rows.get('llm-pi-ai')!.user as { providers?: object }).providers).toBeDefined()
    } finally {
      delete process.env.MAGPIE_GATEWAY_KEY
    }
  })

  it('sends the loopback placeholder without persisting on hosts without a credential store', async () => {
    delete process.env.MAGPIE_GATEWAY_KEY
    const { service, credentials } = makeDeps({ noCredentials: true })
    const status = await service.sync(signal)
    expect(status.lastError).toBeUndefined()
    expect(status.keyConfigured).toBe(false)
    expect(credentials.store.size).toBe(0)
  })

  it('refuses key writes where no credential store exists', async () => {
    const { service } = makeDeps({ noCredentials: true })
    await expect(service.saveConnection({ apiKey: 'gk' }, signal)).rejects.toThrow('no credential store')
    await expect(service.saveConnection({ clearKey: true }, signal)).rejects.toThrow('no credential store')
  })

  it('disconnect removes the routes, reverts dependents, and keeps the key', async () => {
    const { service, settings, credentials } = makeDeps({ options: { defaultModel: 'auto/deepseek-v4.1-flash', webSearch: true } })
    await service.sync(signal)
    await service.disconnect(signal)
    const providers = (settings.rows.get('llm-pi-ai')!.user as { providers?: object }).providers ?? {}
    expect(providers).toEqual({})
    expect(settings.rows.get('agent-default-model')!.user).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-flash' })
    expect(settings.rows.get('web-search-deepseek')!.user).toMatchObject({ apiKeyEnv: 'DEEPSEEK_API_KEY' })
    expect(credentials.store.get('MAGPIE_GATEWAY_KEY')).toBe('magpie')
    const status = await service.status()
    expect(status.models).toEqual([])
  })
})
