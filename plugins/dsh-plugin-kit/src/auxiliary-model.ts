/**
 * Shared auxiliary-model default: host-side lifecycle.
 *
 * The default model is repository-shared infrastructure, not one plugin's
 * business state. Its owner is a dedicated Cordis fiber started on the root
 * context by the first participant and disposed by the last release, so the
 * storage domain, the Typert change stream, the RPC channel and the
 * model-settings provider all live and die with the shared owner — never
 * with a business plugin's fiber. Every bundler's own copy of this module
 * rendezvous through `ctx.root`, so no participant depends on another being
 * enabled.
 *
 * Concurrency:
 * - Writes serialize on `state.tail`; the revision check and the bump both
 *   happen inside the queued commit, so two callers carrying the same
 *   expectedRevision cannot both succeed.
 * - `state.closing` is the single teardown promise: it settles init, drains
 *   queued writes, disposes the owner fiber (route, stream, provider,
 *   domain) and only then unprovides the state, so a re-entrant retain can
 *   always await it and reinstall cleanly.
 * - Initialization and stored-row failures are sticky (`state.error`) and
 *   rethrow from `snapshot()`: a storage error must never read as "no
 *   default" and silently fall back to another model.
 */
import type { Context } from '@deepseek-ai/cordis'
import { modelRouteOverride, normalizeModelRoute, type ModelRoute } from '@klarkxy/dsh-model-route'
import {
  AUXILIARY_MODEL_CHANNEL, AUXILIARY_MODEL_CHANGES_IDENTITY, AUXILIARY_MODEL_NS,
  AUXILIARY_MODEL_SERVICE, type AuxiliaryModelDefaults, type AuxiliaryModelShared, type RpcResult,
} from './contracts.ts'
import { registerHostRpc, type HostRpcContext } from './host-rpc.ts'
import { createPluginLogger } from './logger.ts'
import { createModelSettingsChanges } from './model-settings-changes.ts'
import { registerModelSettings, notifyModelSettingsChanged, type ModelSettingsEvents } from './model-settings.ts'

const DOMAIN_NAME = 'dsh_auxiliary'
const DOMAIN_VERSION = 1
const TABLE = 'settings'
const KEY = 'defaults'
const INJECT = ['storageDomain', 'webServer', 'connection'] as const

interface DomainHandle {
  table(name: string): {
    get(key: string): { revision: number; model: ModelRoute | null } | undefined
    put(key: string, value: unknown): Promise<void>
  }
  close(): Promise<void>
}

interface Scope extends HostRpcContext, ModelSettingsEvents {
  storageDomain: { open(spec: unknown): Promise<DomainHandle> }
  effect(callback: () => (() => void) | Promise<(() => void) | void>): unknown
}

interface RootLike {
  get(name: string, strict?: boolean): unknown
  provide(name: string, value: unknown): () => void
  inject(deps: readonly string[], callback: (scope: Scope) => void): { dispose(): Promise<void> } & PromiseLike<unknown>
}

interface SharedState extends AuxiliaryModelShared {
  ready: Promise<void>
  users: number
  closed: boolean
  /** True only while the owner fiber's domain is open; snapshot() gates on it. */
  available: boolean
  /** Generation of the latest scope init; a stale run must not win. */
  generation: number
  /** Sticky init/storage failure; snapshot() rethrows it. */
  error?: unknown
  closing?: Promise<void>
  domain?: DomainHandle
  data: AuxiliaryModelDefaults
  tail: Promise<void>
  fiber?: { dispose(): Promise<void> }
  scopeInit?: Promise<void>
  stopUnprovide?: () => void
  teardown(): Promise<void>
}

/** Marker on the benign "released while the domain was still opening" error. */
const RECOVERABLE = Symbol.for('klarkxy.dsh.auxiliary-model.recoverable')
function recoverable<T extends object>(error: T): T & { [RECOVERABLE]?: boolean } {
  (error as Record<symbol, unknown>)[RECOVERABLE] = true
  return error as T & { [RECOVERABLE]?: boolean }
}

async function openSharedDomain(scope: Scope): Promise<DomainHandle> {
  const [{ defineDomain, domainTable }, { z }] = await Promise.all([
    import('@deepseek-ai/dsh-storage-domain'), import('zod'),
  ])
  // Strict, write-side semantics at the durable boundary: identifiers must be
  // non-blank, already trimmed and control-free, or the row is rejected —
  // a malformed stored route must never normalize into "no default".
  const identifier = z.string().min(1).max(250).refine(
    value => value === value.trim() && !/[\x00-\x1f\x7f]/.test(value),
    'model route identifiers must be non-blank, trimmed and control-free',
  )
  const model = z.union([
    z.object({
      provider: identifier,
      model: identifier,
      reasoningEffort: identifier.max(80).optional(),
    }).strict(),
    z.null(),
  ])
  return scope.storageDomain.open(defineDomain({
    name: DOMAIN_NAME, version: DOMAIN_VERSION,
    tables: {
      [TABLE]: domainTable(z.object({
        revision: z.number().int().nonnegative(),
        model,
      }).strict()),
    },
  }))
}

/** Marks an optimistic-lock conflict so the RPC envelope can carry 'conflict'. */
function conflictError(message: string): Error & { conflict: true } {
  return Object.assign(new Error(message), { conflict: true as const })
}

/** RPC-visible error classification; storage failures stay sanitized. */
function rpcFailure(error: unknown): RpcResult {
  if (error && typeof error === 'object' && 'conflict' in error) {
    return { ok: false, error: { code: 'auxiliary-model/conflict', message: error instanceof Error ? error.message : 'Revision conflict' } }
  }
  if (error instanceof Error && /Invalid model route|valid expected revision|Unknown auxiliary model setting/.test(error.message)) {
    return { ok: false, error: { code: 'auxiliary-model/rejected', message: error.message } }
  }
  return { ok: false, error: { code: 'auxiliary-model/store', message: 'Auxiliary model store request failed' } }
}

/**
 * Serialized optimistic-lock write; resolves after the durable put commits.
 * Revision verification happens inside the queue: two writers carrying the
 * same expectedRevision race for one slot and only the first commits.
 * Notification fires only after commit, so a failed observer can never turn
 * an already committed write into an apparent save failure.
 */
function setSharedModel(state: SharedState, ctx: Context, input: unknown, expectedRevision: unknown): Promise<AuxiliaryModelDefaults> {
  if (!Number.isSafeInteger(expectedRevision)) return Promise.reject(conflictError('A valid expected revision is required; reload and retry'))
  const row = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : undefined
  const validField = (value: unknown): value is string =>
    typeof value === 'string' && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value)
  if (!row || ['provider', 'model', 'reasoningEffort'].some(key => row[key] !== undefined && !validField(row[key]))) {
    return Promise.reject(new Error('Invalid model route'))
  }
  const normalized = normalizeModelRoute(row)
  if ((Boolean(row.provider) || Boolean(row.model)) && !modelRouteOverride(normalized)) {
    return Promise.reject(new Error('Invalid model route'))
  }
  const commit = state.tail.then(async (): Promise<AuxiliaryModelDefaults> => {
    if (state.closed || !state.domain) throw new Error('Auxiliary model settings are unloading; retry in a moment')
    if (expectedRevision !== state.data.revision) {
      createPluginLogger(ctx, 'dsh-plugin-kit', { forwardHostWarnError: false }).warn(
        'auxiliary-model.conflict',
        'Auxiliary model update rejected due to revision conflict.',
        undefined,
        { expectedRevision: Number(expectedRevision), currentRevision: state.data.revision },
      )
      throw conflictError('Auxiliary model settings changed; reload and retry')
    }
    const next: AuxiliaryModelDefaults = { revision: state.data.revision + 1, model: modelRouteOverride(normalized) ?? null }
    await state.domain.table(TABLE).put(KEY, { revision: next.revision, model: next.model })
    state.data = next
    createPluginLogger(ctx, 'dsh-plugin-kit', { forwardHostWarnError: false }).info(
      'auxiliary-model.updated',
      'Updated global auxiliary model default.',
      { revision: next.revision, provider: next.model?.provider ?? null, model: next.model?.model ?? null },
    )
    notifyModelSettingsChanged(ctx.root, AUXILIARY_MODEL_NS, next.revision)
    return next
  })
  // The tail itself never rejects: a failed commit must not poison later writes.
  state.tail = commit.then(() => {}, () => {})
  return commit
}

function initScope(state: SharedState, ctx: Context, scope: Scope): Promise<void> {
  const log = createPluginLogger(ctx, 'dsh-plugin-kit', { forwardHostWarnError: false })
  // A dependency loss unloads this fiber (running its disposers) and a
  // remount re-runs the callback (bumping state.generation), so an init that
  // was still opening always detects its own supersession through these two
  // public signals. Service identity is intentionally NOT compared anywhere:
  // `ctx.<service>` reads hand out a fresh traceable proxy per access for
  // every tracker'd impl (all Service subclasses — storageDomain, webServer,
  // connection), so identity comparisons reported a fake dep swap after each
  // await and aborted every open with 'released during open'.
  const generation = ++state.generation
  let disposed = false
  // Registered synchronously while the callback runs; a throw means the
  // fiber is already inactive and this init must not open anything.
  scope.effect(() => () => { disposed = true })
  const stale = () => state.closed || disposed || state.generation !== generation
  const run = (async () => {
    // Reads must stay unavailable until this init completes.
    state.available = false
    const domain = await openSharedDomain(scope)
    if (stale()) { await domain.close(); throw recoverable(new Error('Auxiliary model store released during open')) }
    state.domain = domain
    // scope.effect throws on an inactive fiber (disposed mid-open): close the
    // domain directly so it is never leaked, then rethrow — a store that
    // cannot register its own cleanup must not publish data.
    try { scope.effect(() => () => domain.close()) } catch (error) { await domain.close(); throw error }
    // Strict schema: a malformed stored row fails the open path instead of
    // silently collapsing to "no default".
    const stored = domain.table(TABLE).get(KEY)
    if (stale()) { await domain.close(); throw recoverable(new Error('Auxiliary model store superseded during open')) }
    state.data = { revision: stored?.revision ?? 0, model: stored?.model ?? null }
    state.error = undefined
    state.available = true
    log.info('auxiliary-model.opened', 'Shared auxiliary model store opened.', {
      generation, revision: state.data.revision, hasModel: Boolean(state.data.model),
    })
    scope.effect(() => registerModelSettings(scope, {
      ns: AUXILIARY_MODEL_NS,
      title: { zh: '辅助模型', en: 'Auxiliary model' },
      read(signal) {
        signal.throwIfAborted()
        const { revision, model } = state.data
        return {
          revision,
          fields: [{
            path: ['model'],
            label: { zh: '全局辅助模型', en: 'Global auxiliary model' },
            current: model ?? undefined,
            allowFollow: true,
            followLabel: { zh: '当前会话模型', en: 'Current conversation model' },
          }],
        }
      },
      async write(path, route, expectedRevision, signal) {
        signal.throwIfAborted()
        if (path.length !== 1 || path[0] !== 'model') throw new Error('Unknown auxiliary model setting')
        return setSharedModel(state, ctx, route, expectedRevision)
      },
    }))
    scope.effect(() => registerHostRpc(scope, AUXILIARY_MODEL_CHANNEL, async (endpoint, payload, signal) => {
      signal.throwIfAborted()
      if (state.closed) return { ok: false, error: { code: 'auxiliary-model/unloading', message: 'Auxiliary model settings are unloading; retry in a moment' } } satisfies RpcResult
      if (!state.available) {
        return state.error
          ? { ok: false, error: { code: 'auxiliary-model/store', message: 'Auxiliary model store request failed' } } satisfies RpcResult
          : { ok: false, error: { code: 'auxiliary-model/unavailable', message: 'Auxiliary model settings are unavailable; retry in a moment' } } satisfies RpcResult
      }
      if (endpoint === 'defaults.get') {
        const { revision, model } = state.data
        return { ok: true, value: { revision, model } } satisfies RpcResult
      }
      if (endpoint === 'defaults.set') {
        try {
          const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
          const value = await setSharedModel(state, ctx, body.model, body.expectedRevision)
          signal.throwIfAborted()
          return { ok: true, value } satisfies RpcResult
        } catch (error) {
          if (signal.aborted) throw error
          return rpcFailure(error)
        }
      }
      return { ok: false, error: { code: 'auxiliary-model/unknown-endpoint', message: `Unknown endpoint: ${endpoint}` } } satisfies RpcResult
    }, { isEndpoint: endpoint => /^[a-z.]+$/.test(endpoint), logger: log }))
    // The change stream lives and dies with this shared fiber.
    createModelSettingsChanges(scope as unknown as Context, AUXILIARY_MODEL_CHANGES_IDENTITY, AUXILIARY_MODEL_NS)
    // Disposers run LIFO on unload: registered last, this runs FIRST when a
    // dependency remount tears the scope down — reads go unavailable before
    // the domain closes, so no stale default ever leaks. Gated on generation
    // alone: the same generation's unload must clear state even when its dep
    // impl just changed; only a superseded scope's teardown stays out.
    scope.effect(() => () => { if (state.generation === generation) { state.available = false; state.domain = undefined } })
  })().catch(error => {
    if (error && typeof error === 'object' && (error as Record<symbol, unknown>)[RECOVERABLE]) {
      log.debug('auxiliary-model.superseded', 'Shared auxiliary model init superseded during open.', { generation })
    } else {
      log.error('auxiliary-model.init-failed', 'Shared auxiliary model store failed to open.', error, { generation })
    }
    // Tag the failure with its generation so ready.catch can distinguish a
    // superseded init's rejection from the live scope's.
    if (error && typeof error === 'object') (error as Record<string, unknown>).auxGeneration = generation
    // Only THIS generation's failure poisons the store: a superseded init's
    // rejection must not clear a newer scope's available state.
    if (state.generation === generation) {
      state.available = false
      state.error = error
    }
    throw error
  })
  // Retainers always await the CURRENT init: re-arm state.ready so nobody is
  // left waiting on a superseded generation's settled promise. Both promises
  // get a handled branch so a rejected init never surfaces as an unhandled
  // rejection while awaiters still see it.
  run.catch(() => {})
  const armed = run.then(() => {})
  armed.catch(() => {})
  state.ready = armed
  return run
}

function teardown(state: SharedState, ctx: Context): Promise<void> {
  if (!state.closing) {
    state.closed = true
    const root = ctx.root as unknown as RootLike
    state.closing = (async () => {
      // A still-opening init settles here so its domain/fiber are disposed.
      await state.scopeInit?.catch(() => {})
      await state.tail.catch(() => {})
      try { await state.fiber?.dispose() } catch (error) {
        createPluginLogger(ctx, 'dsh-plugin-kit', { forwardHostWarnError: false }).fault(
          'auxiliary-model.dispose-failed',
          'Shared auxiliary model owner fiber failed to dispose.',
          error,
        )
        // A failed dispose may leave the domain open; log loudly so the next
        // open's 'already open' error is attributable instead of mysterious.
        try { (ctx as unknown as { logger?: { warn(...args: unknown[]): void } }).logger?.warn('auxiliary-model: fiber dispose failed', error) }
        catch { /* no logger */ }
      }
      try {
        if (root.get(AUXILIARY_MODEL_SERVICE, false) === state) state.stopUnprovide?.()
      } catch { /* root already gone */ }
      state.stopUnprovide = undefined
    })()
  }
  return state.closing
}

function createSharedState(ctx: Context): SharedState {
  const root = ctx.root as unknown as RootLike
  const state: SharedState = {
    users: 0, closed: false, available: false, generation: 0, tail: Promise.resolve(),
    data: { revision: 0, model: null },
    snapshot() {
      // A persisted-open failure propagates: falling back to another model
      // after a storage error would silently switch what the user pays for.
      if (this.error) throw this.error
      // While the owner fiber re-initializes after a dependency remount, the
      // stored default is unreadable: reads fail instead of serving stale data.
      if (!this.available) throw new Error('Auxiliary model store is unavailable; retry in a moment')
      return this.data
    },
    ready: Promise.resolve(),
    teardown() { return teardown(this, ctx) },
  }
  // Strict requirement: every service must already be ACTIVE. Callers are
  // plugins declaring these in inject — Cordis only runs their apply once the
  // deps are active, so a missing or still-pending service is a hard error,
  // not something to wait on. Retry is the caller's Cordis lifecycle, not ours.
  const inactive = INJECT.filter(service => {
    try { return root.get(service, true) === undefined } catch { return true }
  })
  if (inactive.length) {
    throw new Error(`retainAuxiliaryModel requires active ${inactive.join(', ')}; declare them in inject`)
  }
  state.fiber = root.inject(INJECT, scope => { state.scopeInit = initScope(state, ctx, scope) })
  state.ready = Promise.resolve(state.fiber).then(() => {
    // The owner fiber ran to settle: its scope must have started init, and
    // that init must complete before the store reads as ready. A dep dropping
    // between the strict check and inject leaves the fiber PENDING; Cordis
    // re-runs it when the dep returns — never a silent half-initialized read.
    if (!state.scopeInit) throw recoverable(new Error('Auxiliary model owner fiber settled without initializing its scope'))
    return state.scopeInit
  })
  // A failed open must not leave a live-looking state behind: mark it
  // closed and tear it down so the next retain reinstalls. A rejection
  // tagged with a superseded generation describes a scope this state has
  // already moved past — it must not tear down a newer, live scope.
  state.ready.catch(error => {
    const tag = (error as { auxGeneration?: number }).auxGeneration
    if (tag !== undefined && tag !== state.generation) return
    state.error = state.error ?? error
    state.closed = true
    void state.teardown()
  })
  // Publish only after construction completes: another retainer can now
  // either reuse this state or watch its closed flag.
  state.stopUnprovide = root.provide(AUXILIARY_MODEL_SERVICE, state)
  return state
}

async function obtainShared(ctx: Context): Promise<SharedState> {
  const root = ctx.root as unknown as RootLike
  for (;;) {
    const existing = root.get(AUXILIARY_MODEL_SERVICE, false) as SharedState | undefined
    if (existing) {
      if (!existing.closed) return existing
      // closing always settles; wait for it, then re-lookup.
      await existing.closing
      continue
    }
    return createSharedState(ctx)
  }
}

/**
 * Retain the shared auxiliary-model store for the calling plugin.
 *
 * Resolves once storage is open and the read/write surfaces are live, with a
 * release function; register it as `ctx.effect(() => release)` so the store
 * unloads with the plugin. The first participant opens the shared owner
 * fiber; `await release()` drains pending writes and fully tears the owner
 * down when the last participant leaves. Requires `storageDomain`,
 * `webServer` and `connection` to exist on the host.
 *
 * Concurrent retainers share one owner; a retain arriving during teardown
 * waits for the closing owner and then reinstalls — it never inherits a
 * half-torn-down state.
 */
export async function retainAuxiliaryModel(ctx: Context): Promise<() => Promise<void>> {
  for (;;) {
    const state = await obtainShared(ctx)
    // One await, one answer: a failed or superseded init rejects the retainer
    // once. The caller's plugin lifecycle (inject refresh) drives any retry —
    // no same-state spin here.
    await state.ready
    if (state.closed) continue
    state.users += 1
    let released = false
    return async () => {
      if (released) return
      released = true
      state.users -= 1
      if (state.users <= 0) await state.teardown()
      else await state.tail.catch(() => {})
    }
  }
}

/**
 * Re-exported here so consumers reading the shared default use the same
 * subpath as the store lifecycle: '@klarkxy/dsh-plugin-kit/auxiliary-model'.
 */
export { getAuxiliaryModel } from './contracts.ts'
