/**
 * Host-side controller: gateway reads, serialized syncs, and the RPC surface
 * the settings page calls. Every failure lands in `lastError`; the plugin
 * itself never crashes on a bad gateway or a read-only profile.
 */
import { normalizeGatewayAddress, AddressError } from './address.ts'
import { GatewayError, fetchGatewayInfo, fetchModels } from './gateway.ts'
import { buildRoutes } from './mapping.ts'
import { planDisconnect, planSync, type PlanOp, type SettingsDescriptorLike } from './plan.ts'
import {
  LOOPBACK_PLACEHOLDER_KEY, NS_LLM, ROUTE_NAMES, RPC_ENDPOINTS,
  type GatewayInfo, type MagpieOptions, type MagpieStatus, type RouteModel,
  type RpcResult, type SaveConnectionInput, type SetOptionsInput, type TestResult,
} from './contracts.ts'

export class MagpieError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MagpieError'
    this.code = code
  }
}

export interface CredentialsLike {
  resolve(ref: string): Promise<{ value: string } | undefined>
  describe(ref: string): Promise<{ configured: boolean; writable: boolean }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

export interface MagpieServiceDeps {
  describe(): SettingsDescriptorLike[]
  mutate(ns: string, ops: readonly PlanOp[], expectedRevision?: number): Promise<void>
  /** Whether the active profile accepts settings writes. */
  writable(): boolean
  /** The host credential store; absent on hosts that ship none (e.g. headless). */
  credentials(): CredentialsLike | undefined
  /** Own settings namespace (the profile entry id of this plugin). */
  ownNamespace: string
  options(): MagpieOptions
  fetchImpl?: typeof fetch
  userAgent: string
  logger?: { warn(message: string, ...args: unknown[]): void }
  now?: () => Date
}

const REF_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

function fail(error: unknown): RpcResult<never> {
  if (error instanceof MagpieError) return { ok: false, error: { code: error.code, message: error.message } }
  if (error instanceof GatewayError) return { ok: false, error: { code: error.code, message: error.message } }
  if (error instanceof AddressError) return { ok: false, error: { code: 'invalid-address', message: error.message } }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code: 'internal', message } }
}

function isConflict(error: unknown): boolean {
  return (error as { code?: string })?.code === 'SETTINGS_CONFLICT'
}

export function createMagpieService(deps: MagpieServiceDeps) {
  const now = () => (deps.now?.() ?? new Date()).toISOString()
  let queue: Promise<unknown> = Promise.resolve()
  let syncing = false
  let gateway: GatewayInfo | undefined
  let lastSync: MagpieStatus['lastSync']
  let lastError: MagpieStatus['lastError']

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task)
    queue = result.catch(() => {})
    return result
  }

  const ownDescriptor = (): SettingsDescriptorLike => {
    const descriptor = deps.describe().find(entry => entry.ns === deps.ownNamespace)
    if (!descriptor) throw new MagpieError('unavailable', 'this profile cannot edit the magpie settings entry')
    return descriptor
  }

  /** CAS writes on any namespace with one describe-and-replan retry. */
  const applyPlan = async (plan: (descriptors: SettingsDescriptorLike[]) => { namespaces: { ns: string; revision: number; ops: PlanOp[] }[]; warnings: string[] }) => {
    let warnings: string[] = []
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = plan(deps.describe())
      try {
        for (const item of current.namespaces) await deps.mutate(item.ns, item.ops, item.revision)
        warnings = current.warnings
        break
      } catch (error) {
        if (attempt === 0 && isConflict(error)) continue
        throw error instanceof MagpieError ? error : new MagpieError('write-failed', `settings write failed: ${(error as Error).message}`)
      }
    }
    return warnings
  }

  const writeOwn = async (ops: PlanOp[]): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const descriptor = ownDescriptor()
      try {
        await deps.mutate(deps.ownNamespace, ops, descriptor.revision)
        return
      } catch (error) {
        if (attempt === 0 && isConflict(error)) continue
        throw error instanceof MagpieError ? error : new MagpieError('write-failed', `settings write failed: ${(error as Error).message}`)
      }
    }
  }

  /** Stored credential, ambient env, or the loopback placeholder — persisted only during sync. */
  const resolveKey = async (options: MagpieOptions, loopback: boolean, store: boolean): Promise<string | undefined> => {
    if (!REF_NAME.test(options.apiKeyEnv)) {
      throw new MagpieError('invalid-ref', `credential reference "${options.apiKeyEnv}" is not a valid environment-variable name`)
    }
    const credentials = deps.credentials()
    if (!credentials) {
      const ambient = process.env[options.apiKeyEnv]?.trim()
      if (ambient) return ambient
      return loopback ? LOOPBACK_PLACEHOLDER_KEY : undefined
    }
    const existing = await credentials.resolve(options.apiKeyEnv)
    if (existing?.value) return existing.value
    if (!loopback) return undefined
    if (store) await credentials.set(options.apiKeyEnv, LOOPBACK_PLACEHOLDER_KEY)
    return LOOPBACK_PLACEHOLDER_KEY
  }

  const gatewayDeps = (key: string | undefined) => ({ fetchImpl: deps.fetchImpl, userAgent: deps.userAgent, key })

  const readGateway = async (signal?: AbortSignal): Promise<{ root: string; loopback: boolean; info: GatewayInfo; models: unknown[]; key?: string }> => {
    const options = deps.options()
    const { root, loopback } = normalizeGatewayAddress(options.address)
    const key = await resolveKey(options, loopback, false)
    const client = gatewayDeps(key)
    const info = await fetchGatewayInfo(root, client, signal)
    const models = await fetchModels(root, client, signal)
    return { root, loopback, info, models, key }
  }

  const routeModels = (): RouteModel[] => {
    const descriptor = deps.describe().find(entry => entry.ns === NS_LLM)
    const providers = (descriptor?.value as { providers?: Record<string, { models?: { id?: unknown; name?: unknown }[] }> } | undefined)?.providers
    if (!providers) return []
    return ROUTE_NAMES.flatMap(route =>
      (providers[route]?.models ?? [])
        .filter(model => typeof model?.id === 'string')
        .map(model => ({ id: model.id as string, name: typeof model.name === 'string' ? model.name : undefined, route })))
  }

  const status = async (): Promise<MagpieStatus> => {
    const options = deps.options()
    let keyConfigured = false
    let keyWritable = false
    const credentials = deps.credentials()
    if (!credentials) {
      keyConfigured = Boolean(process.env[options.apiKeyEnv]?.trim())
    } else {
      try {
        const info = await credentials.describe(options.apiKeyEnv)
        keyConfigured = info.configured
        keyWritable = info.writable
      } catch { /* an invalid ref reports as unconfigured */ }
    }
    return {
      address: options.address,
      apiKeyEnv: options.apiKeyEnv,
      keyConfigured,
      keyWritable,
      options: {
        syncOnStart: options.syncOnStart,
        defaultModel: options.defaultModel,
        webSearch: options.webSearch,
        webSearchModel: options.webSearchModel,
      },
      writable: deps.writable(),
      gateway,
      syncing,
      lastSync,
      lastError,
      models: routeModels(),
    }
  }

  const performSync = async (signal?: AbortSignal): Promise<void> => {
    if (!deps.writable()) throw new MagpieError('read-only', 'profile settings are read-only here; save connection details but sync cannot write them')
    const options = deps.options()
    const { root, loopback } = normalizeGatewayAddress(options.address)
    const key = await resolveKey(options, loopback, true)
    const client = gatewayDeps(key)
    const info = await fetchGatewayInfo(root, client, signal)
    const entries = await fetchModels(root, client, signal)
    const routes = buildRoutes({ data: entries as { id?: unknown }[] }, root, options.apiKeyEnv)
    const desired = {
      routes,
      apiKeyEnv: options.apiKeyEnv,
      defaultModel: options.defaultModel?.trim() || undefined,
      webSearch: options.webSearch,
      webSearchModel: options.webSearchModel?.trim() || undefined,
    }
    if (!Object.keys(routes).length) {
      throw new MagpieError('empty-listing', 'the gateway returned no usable models; nothing was changed')
    }
    const warnings = await applyPlan(descriptors => planSync(descriptors, desired, root))
    gateway = info
    lastSync = {
      at: now(),
      routes: Object.fromEntries(Object.entries(routes).map(([name, profile]) => [name, (profile as { models?: unknown[] }).models?.length ?? 0])),
      warnings,
    }
    lastError = undefined
  }

  const sync = (signal?: AbortSignal): Promise<MagpieStatus> => enqueue(async () => {
    syncing = true
    try {
      await performSync(signal)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastError = { at: now(), message }
      deps.logger?.warn('magpie: sync failed: %s', message)
    } finally {
      syncing = false
    }
    return status()
  })

  const saveConnection = async (input: SaveConnectionInput, signal?: AbortSignal): Promise<MagpieStatus> => {
    signal?.throwIfAborted()
    const wantsKey = input.clearKey === true || (typeof input.apiKey === 'string' && Boolean(input.apiKey.trim()))
    const credentials = deps.credentials()
    if (wantsKey && !credentials) {
      throw new MagpieError('no-credential-store',
        `this host has no credential store; set ${deps.options().apiKeyEnv} in the environment`)
    }
    const ops: PlanOp[] = []
    if (input.address !== undefined) {
      const { root } = normalizeGatewayAddress(input.address)
      ops.push({ op: 'set', path: ['address'], value: root })
    }
    if (ops.length) await writeOwn(ops)
    if (input.clearKey) await credentials!.unset(deps.options().apiKeyEnv)
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      await credentials!.set(deps.options().apiKeyEnv, input.apiKey.trim())
    }
    return status()
  }

  const setOptions = async (input: SetOptionsInput, signal?: AbortSignal): Promise<MagpieStatus> => {
    signal?.throwIfAborted()
    const ops: PlanOp[] = []
    if (input.syncOnStart !== undefined) {
      if (typeof input.syncOnStart !== 'boolean') throw new MagpieError('bad-request', 'syncOnStart must be a boolean')
      ops.push({ op: 'set', path: ['syncOnStart'], value: input.syncOnStart })
    }
    for (const key of ['defaultModel', 'webSearchModel'] as const) {
      const value = input[key]
      if (value === undefined) continue
      if (value === null || value === '') ops.push({ op: 'unset', path: [key] })
      else if (typeof value === 'string') ops.push({ op: 'set', path: [key], value })
      else throw new MagpieError('bad-request', `${key} must be a string`)
    }
    if (input.webSearch !== undefined) {
      if (typeof input.webSearch !== 'boolean') throw new MagpieError('bad-request', 'webSearch must be a boolean')
      ops.push({ op: 'set', path: ['webSearch'], value: input.webSearch })
    }
    if (ops.length) await writeOwn(ops)
    // Options affect only what sync writes; rerun it against the same gateway.
    return sync(signal)
  }

  const disconnect = async (signal?: AbortSignal): Promise<MagpieStatus> => enqueue(async () => {
    signal?.throwIfAborted()
    const options = deps.options()
    const { root } = normalizeGatewayAddress(options.address)
    if (!deps.writable()) throw new MagpieError('read-only', 'profile settings are read-only here; routes cannot be removed')
    await applyPlan(descriptors => planDisconnect(descriptors, root))
    gateway = undefined
    lastSync = undefined
    return status()
  })

  const test = async (signal?: AbortSignal): Promise<TestResult> => {
    const { info, models } = await readGateway(signal)
    gateway = info
    return { gateway: info, models: models.length }
  }

  const handleRpc = (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> => (async () => {
    try {
      const body = (payload ?? {}) as Record<string, unknown>
      switch (endpoint) {
        case RPC_ENDPOINTS.status: return { ok: true, value: await status() }
        case RPC_ENDPOINTS.saveConnection: return { ok: true, value: await saveConnection(body as SaveConnectionInput, signal) }
        case RPC_ENDPOINTS.test: return { ok: true, value: await test(signal) }
        case RPC_ENDPOINTS.sync: return { ok: true, value: await sync(signal) }
        case RPC_ENDPOINTS.setOptions: return { ok: true, value: await setOptions(body as SetOptionsInput, signal) }
        case RPC_ENDPOINTS.disconnect: return { ok: true, value: await disconnect(signal) }
        default: return { ok: false, error: { code: 'not-found', message: `unknown endpoint: ${endpoint}` } }
      }
    } catch (error) {
      return fail(error)
    }
  })()

  return { status, sync, saveConnection, setOptions, disconnect, test, handleRpc }
}

export type MagpieService = ReturnType<typeof createMagpieService>
