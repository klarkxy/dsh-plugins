/**
 * Host half of the secret manager.
 *
 * One owner for four things: `ctx.credentials` records (the only store in that
 * seam with no ambient fallback), per-session authorization, the authenticated
 * RPC the Web UI answers dialogs through, and the `DSH_*` shell facts a granted
 * session receives. The model never sees a value: tools return a `secret://`
 * reference, and every value write arrives from the UI the human just
 * confirmed.
 *
 * Self-writes and `credentials/record-updated` notifications are coordinated:
 * this plugin's own commit must not revoke the grant it is about to make, while
 * an edit from elsewhere must revoke everything that approved the old value.
 * The per-slot lock plus {@link SecretRuntime.selfWrite} is that coordination.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { isSubagentSession } from '@klarkxy/dsh-plugin-kit/contracts'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { installPluginLogger, type PluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import {
  CREDENTIAL_SCOPE,
  ENV_KEY_RE,
  PLUGIN_ID,
  PLUGIN_NAME,
  RPC,
  RPC_CHANNEL,
  envKeyOf,
  isBoundedId,
  isRecord,
  isSlot,
  secretRefOf,
  valueProblem,
  type ListOutcome,
  type PendingSecretRequest,
  type RevokeOutcome,
  type RpcResult,
  type SaveOutcome,
  type SecretEntry,
  type SecretScope,
  type SubmitOutcome,
} from './contracts.ts'
import { GrantRegistry } from './grants.ts'
import { PendingRegistry } from './pending.ts'
import { Redactor, createRedactionListener } from './redact.ts'
import { ShellBridge, type ShellEnvRegistryLike } from './shell.ts'
import { SecretStore, SlotLock, type StoredSecret } from './store.ts'
import { createRequestSecretTool, createSecretHttpTool, createSecretStatusTool } from './tools.ts'

export const name = PLUGIN_ID
export const inject = ['tools', 'credentials', 'connection', 'webServer'] as const

/** Shared mutable state of the Host half, handed to the tools and the RPC handler. */
export interface SecretRuntime {
  readonly store: SecretStore
  readonly grants: GrantRegistry
  readonly pending: PendingRegistry
  readonly redactor: Redactor
  readonly lock: SlotLock
  readonly log?: PluginLogger
  /** Network entry point; injected so specs can replace it. */
  readonly fetch: typeof fetch
  /** Slots currently known to hold a record, kept in sync for the sync resolver. */
  readonly knownSlots: Set<string>
  /** Slots this plugin is writing right now; their own update event must not revoke. */
  readonly selfWrite: Set<string>
  isSubagent(session: unknown): boolean
  noteDialog(sessionId: string, callId: string): void
  prime(slot: string): Promise<StoredSecret | undefined>
  /** Read once into the cache; a repeat call while a read is in flight is a no-op. */
  ensurePrimed(slot: string): void
  refreshShell(): void
}

type AgentLike = { id: string; session?: unknown }

type Host = Context & HostRpcContext & {
  tools: {
    get(name: string, scope?: object): unknown
    register(definition: Record<string, unknown>): () => void
  }
  credentials: CredentialProvider
  effect(target: () => void | (() => void), label?: string): void
  on(event: string, listener: (...args: any[]) => unknown): () => void
  inject(deps: string[], callback: (ctx: Context) => void): unknown
}

const ok = <T,>(value: T): RpcResult<T> => ({ ok: true, value })
const fail = (code: string, message: string): RpcResult<never> => ({ ok: false, error: { code, message } })
const reasonOf = (error: unknown): string => (error instanceof Error ? error.name : 'unknown')

export async function apply(ctx: Context): Promise<void> {
  const host = ctx as unknown as Host
  const logger = installPluginLogger(ctx, PLUGIN_NAME, { forwardHostWarnError: false })
  const store = new SecretStore(host.credentials)
  const grants = new GrantRegistry()
  const pending = new PendingRegistry()
  const redactor = new Redactor()
  const lock = new SlotLock()
  const knownSlots = new Set<string>()
  const selfWrite = new Set<string>()
  const priming = new Set<string>()
  let bridge: ShellBridge | undefined

  const syncShell = () => {
    const keys = [...knownSlots].map(slot => envKeyOf(slot)).filter(key => ENV_KEY_RE.test(key))
    bridge?.sync(keys)
  }

  const prime = async (slot: string): Promise<StoredSecret | undefined> => {
    const stored = await store.prime(slot)
    if (stored) knownSlots.add(slot)
    else knownSlots.delete(slot)
    return stored
  }

  const ensurePrimed = (slot: string) => {
    if (store.cached(slot) || priming.has(slot)) return
    priming.add(slot)
    void prime(slot)
      .then((stored) => { if (stored) syncShell() })
      .catch(() => { /* a read failure leaves the slot un-injected */ })
      .finally(() => { priming.delete(slot) })
  }

  const runtime: SecretRuntime = {
    store,
    grants,
    pending,
    redactor,
    lock,
    log: logger,
    fetch: globalThis.fetch.bind(globalThis),
    knownSlots,
    selfWrite,
    isSubagent: (session: unknown) => {
      try { return isSubagentSession(session) } catch { return true }
    },
    noteDialog: (sessionId: string, callId: string) => {
      logger.debug('dialog.opened', 'Secret dialog opened for a tool call.', { sessionId, callId })
    },
    prime,
    ensurePrimed,
    refreshShell: syncShell,
  }

  // A slot that changes underneath us — another process, another plugin, a hand
  // edit of the store — loses its cached value and every session that approved
  // the old one. Our own commit is excluded because the writer grants explicitly
  // after it, inside the same locked section.
  ctx.effect(() => ctx.on('credentials/record-updated', (key: unknown) => {
    const text = String(key)
    if (!text.startsWith(`${CREDENTIAL_SCOPE}/`)) return
    const slot = text.slice(CREDENTIAL_SCOPE.length + 1)
    if (!isSlot(slot) || selfWrite.has(slot)) return
    // The shell resolver does not acquire the slot lock. Revoke immediately,
    // including while another operation is still holding that lock.
    store.invalidate(slot)
    grants.clearSlot(slot)
    // Queue behind whatever this plugin is already doing on that slot, but never
    // await here: the provider awaits its listeners and a writer holds the lock.
    void lock.run(slot, async () => {
      store.invalidate(slot)
      grants.clearSlot(slot)
      const stored = await store.prime(slot)
      if (stored) knownSlots.add(slot)
      else knownSlots.delete(slot)
      syncShell()
    }).catch(error => {
      logger.error('record.refresh-failed', 'Refreshing an externally changed credential failed.', undefined, {
        slot, reason: reasonOf(error),
      })
    })
    logger.debug('record.external-change', 'Credential record changed outside this plugin; access revoked.', { slot })
  }), 'secret-manager.record-updated')

  // Prime what exists, then let the resolver declare exactly those keys.
  void store.slots().then(async (slots) => {
    for (const slot of slots) {
      const stored = await store.prime(slot)
      if (stored) knownSlots.add(slot)
    }
    syncShell()
  }).catch(() => { /* an empty registry is a valid start */ })

  ctx.effect(() => {
    const register = (definition: Record<string, unknown>, toolName: string) => {
      if (host.tools.get(toolName)) {
        logger.warn('tool.already-registered', 'Tool is already registered by another plugin; skipping.', { tool: toolName })
        return () => {}
      }
      try { return host.tools.register(definition) }
      catch (error) {
        logger.warn('tool.register-failed', 'Tool registration failed.', { tool: toolName, reason: reasonOf(error) })
        return () => {}
      }
    }
    const disposers = [
      register(createRequestSecretTool(runtime) as unknown as Record<string, unknown>, 'request_secret'),
      register(createSecretStatusTool(runtime) as unknown as Record<string, unknown>, 'secret_status'),
      register(createSecretHttpTool(runtime) as unknown as Record<string, unknown>, 'secret_http'),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'secret-manager.tools')

  ctx.effect(() => registerHostRpc(host, RPC_CHANNEL, createRpc(runtime), { maxBodyBytes: 32 * 1024, logger }), 'secret-manager.rpc')

  // Optional: a composition without the shell tool family has no registry, and
  // the plugin still stores values and authorizes HTTP scopes.
  host.inject(['shellEnv'], (inner) => {
    const registry = (inner as unknown as { shellEnv?: Partial<ShellEnvRegistryLike> }).shellEnv
    if (!registry || typeof registry.register !== 'function') return
    bridge = new ShellBridge({
      registry: registry as ShellEnvRegistryLike,
      redactor,
      valuesFor: (execution: ToolExecution) => resolveShellValues(runtime, execution),
      warn: (event, message, detail) => logger.warn(event, message, detail),
    })
    syncShell()
    inner.effect(() => () => { bridge?.dispose(); bridge = undefined }, 'secret-manager.shell-env')
  })

  // Expiry is also enforced on read; this timer is what ends a dialog the human
  // never answered, so the agent is not parked until the call is cancelled.
  ctx.effect(() => {
    const timer = setInterval(() => {
      pending.sweep()
      grants.sweep()
    }, 15_000)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'secret-manager.sweep')

  // Defense in depth, not a guarantee. The policy lives in redact.ts so the
  // committed decision (content, canonical value, block feedback, contexts) is
  // covered, not only what the chat renders.
  ctx.effect(() => ctx.on('tools/post-execute', createRedactionListener(redactor) as never), 'secret-manager.redact')

  ctx.effect(() => () => {
    pending.clear()
    grants.clearAll()
    store.invalidateAll()
    redactor.clear()
    bridge?.dispose()
    bridge = undefined
  }, 'secret-manager.dispose')

  logger.info('host.ready', 'Secret manager host half loaded.', { channel: RPC_CHANNEL })
}

/** The `DSH_*` values one shell execution may receive. Fail closed on every doubt. */
export function resolveShellValues(runtime: SecretRuntime, execution: ToolExecution): Record<string, string> {
  const agent = execution.agent as AgentLike | undefined
  if (!agent || typeof agent.id !== 'string') return {}
  if (runtime.isSubagent(agent.session)) return {}
  const values: Record<string, string> = {}
  for (const slot of runtime.knownSlots) {
    const stored = runtime.store.cached(slot)
    if (!stored) {
      runtime.ensurePrimed(slot)
      continue
    }
    const value = runtime.grants.envValue(slot, agent.id, stored)
    if (value === undefined) continue
    values[stored.envKey] = value
  }
  return values
}

export function createRpc(runtime: SecretRuntime) {
  const { store, grants, pending, lock, selfWrite } = runtime
  const log = runtime.log

  /**
   * Store (or keep) one slot's value. Callers already hold the slot lock.
   *
   * Revocation happens **before** the write, not only after it. `store.write`
   * adopts the new value into the cache synchronously before it resolves, and
   * the shell resolver is synchronous and does not take the slot lock, so an
   * old grant that survived into that moment would be handed the new value
   * between two microtasks. Clearing first fails closed: a failed write costs
   * the authorization, never the other way round. The post-write clear stays as
   * belt and braces, because the `record-updated` event is suppressed for our
   * own commit and nothing else can revoke it.
   */
  const writeInline = async (slot: string, value: string | undefined): Promise<StoredSecret | undefined> => {
    if (value === undefined) return store.cached(slot) ?? await store.prime(slot)
    selfWrite.add(slot)
    grants.clearSlot(slot)
    try {
      const stored = await store.write(slot, value)
      runtime.knownSlots.add(slot)
      grants.clearSlot(slot)
      return stored
    } finally {
      selfWrite.delete(slot)
    }
  }

  const entryOf = (slot: string, sessionId: string | undefined): SecretEntry => {
    const counts = grants.counts(slot)
    const held = grants.heldBy(slot, sessionId)
    return {
      ref: secretRefOf(slot),
      slot,
      envKey: envKeyOf(slot),
      configured: true,
      envGrantedSessions: counts.env,
      httpGrantedSessions: counts.http,
      envGranted: held.envGranted,
      httpGranted: held.httpGranted,
    }
  }

  return async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> => {
    if (!isRecord(payload)) return fail('bad-request', 'A JSON object payload is required')

    if (endpoint === RPC.pending) {
      if (!isBoundedId(payload.sessionId) || !isBoundedId(payload.callId)) return fail('bad-request', 'sessionId and callId are required')
      const request = pending.view(payload.sessionId, payload.callId)
      return ok<PendingSecretRequest | null>(request ?? null)
    }

    if (endpoint === RPC.cancel) {
      if (!isBoundedId(payload.id) || !isBoundedId(payload.sessionId) || !isBoundedId(payload.callId)) {
        return fail('bad-request', 'id, sessionId and callId are required')
      }
      if (signal.aborted) return fail('cancelled', 'The request was cancelled')
      if (!pending.take({ id: payload.id, sessionId: payload.sessionId, callId: payload.callId }).ok) return ok(false)
      pending.settle(payload.id, { kind: 'cancelled' })
      log?.debug('dialog.cancelled', 'Secret dialog cancelled by the human.', { sessionId: payload.sessionId })
      return ok(true)
    }

    if (endpoint === RPC.submit) {
      if (!isBoundedId(payload.id) || !isBoundedId(payload.sessionId) || !isBoundedId(payload.callId)) {
        return fail('bad-request', 'id, sessionId and callId are required')
      }
      if (payload.grantEnv !== undefined && typeof payload.grantEnv !== 'boolean') return fail('bad-request', 'grantEnv must be a boolean')
      if (payload.grantHttp !== undefined && typeof payload.grantHttp !== 'boolean') return fail('bad-request', 'grantHttp must be a boolean')
      const grantEnv = payload.grantEnv === true
      const grantHttp = payload.grantHttp === true
      let value: string | undefined
      if (payload.value !== undefined && payload.value !== null) {
        const pasted = payload.value
        if (typeof pasted !== 'string') return fail('invalid', 'value: expected text')
        const problem = valueProblem(pasted)
        if (problem) return fail('invalid', problem)
        value = pasted
      }
      if (signal.aborted) return fail('cancelled', 'The request was cancelled')

      const taken = pending.take({ id: payload.id, sessionId: payload.sessionId, callId: payload.callId })
      if (!taken.ok) return fail('stale', 'This request is no longer open')
      const request = taken.request
      const revocationVersion = grants.revocationVersion(request.slot, request.sessionId)
      if (grantHttp && !request.httpOrigin) {
        pending.settle(payload.id, { kind: 'cancelled' })
        return fail('invalid', 'grantHttp was requested but this dialog asked for no HTTP scope')
      }
      // One critical section per slot: claim check, write, stale-grant removal,
      // claim re-check, grant. Nothing may slip between the write and the grant,
      // and a dialog abandoned while this work was queued grants nothing.
      type Claimed =
        | { kind: 'ok'; outcome: SubmitOutcome }
        | { kind: 'cancelled' }
        | { kind: 'missing' }
      let claimed: Claimed
      try {
        claimed = await lock.run(request.slot, async (): Promise<Claimed> => {
          if (!pending.isClaimed(request.id)) return { kind: 'cancelled' }
          const stored = await writeInline(request.slot, value)
          if (!stored) return { kind: 'missing' }
          if (!pending.isClaimed(request.id)) return { kind: 'cancelled' }
          const scopes: SecretScope[] = []
          const revoked = revocationVersion !== grants.revocationVersion(request.slot, request.sessionId)
          if (grantEnv && !revoked) scopes.push({ kind: 'env' })
          if (grantHttp && request.httpOrigin && !revoked) {
            scopes.push({ kind: 'http', origin: request.httpOrigin, authHeader: request.authHeader, authPrefix: request.authPrefix })
          }
          for (const scope of scopes) grants.grant(request.slot, request.sessionId, scope)
          runtime.refreshShell()
          return {
            kind: 'ok',
            outcome: {
              status: scopes.length > 0 ? 'ready' : 'stored',
              ref: request.ref,
              slot: request.slot,
              envKey: request.envKey,
              configured: true,
              envGranted: grantEnv && !revoked,
              httpGranted: grantHttp && !revoked,
              ...(grantHttp && request.httpOrigin && !revoked ? { httpOrigin: request.httpOrigin } : {}),
            },
          }
        })
      } catch (error) {
        pending.settle(payload.id, { kind: 'cancelled' })
        log?.error('dialog.store-failed', 'Storing a submitted credential failed.', undefined, {
          slot: request.slot,
          reason: reasonOf(error),
        })
        return fail('internal', 'The credential could not be stored')
      }
      if (claimed.kind === 'cancelled') {
        pending.settle(payload.id, { kind: 'cancelled' })
        return fail('cancelled', 'The dialog was cancelled before it was stored')
      }
      if (claimed.kind === 'missing') {
        pending.settle(payload.id, { kind: 'cancelled' })
        return fail('invalid', 'No value is stored for this slot; enter one')
      }
      pending.settle(payload.id, { kind: 'submitted', outcome: claimed.outcome })
      log?.info('dialog.submitted', 'Secret dialog answered and stored.', {
        sessionId: request.sessionId,
        slot: request.slot,
        envGranted: claimed.outcome.envGranted,
        httpGranted: claimed.outcome.httpGranted,
      })
      return ok(claimed.outcome)
    }

    if (endpoint === RPC.list) {
      if (payload.sessionId !== undefined && !isBoundedId(payload.sessionId)) return fail('bad-request', 'sessionId must be a bounded identifier')
      if (signal.aborted) return fail('cancelled', 'The request was cancelled')
      try {
        const slots = await store.slots()
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : undefined
        return ok<ListOutcome>({ entries: slots.map(slot => entryOf(slot, sessionId)) })
      } catch (error) {
        log?.error('list.failed', 'Listing stored credentials failed.', undefined, { reason: reasonOf(error) })
        return fail('internal', 'The stored credentials could not be listed')
      }
    }

    if (endpoint === RPC.save) {
      if (!isSlot(payload.slot)) return fail('bad-request', 'slot is required')
      const value = payload.value
      if (typeof value !== 'string') return fail('bad-request', 'value is required')
      const problem = valueProblem(value)
      if (problem) return fail('invalid', problem)
      if (signal.aborted) return fail('cancelled', 'The request was cancelled')
      const slot = payload.slot
      try {
        // A value on disk is not an authorization: saving grants nothing, and a
        // replacement revokes every session that approved the previous value.
        await lock.run(slot, () => writeInline(slot, value))
        runtime.refreshShell()
        log?.info('secret.saved', 'Credential stored from the management page.', { slot })
        return ok<SaveOutcome>({ ref: secretRefOf(slot), slot, envKey: envKeyOf(slot), configured: true })
      } catch (error) {
        log?.error('secret.save-failed', 'Storing a credential from the management page failed.', undefined, { slot, reason: reasonOf(error) })
        return fail('internal', 'The credential could not be stored')
      }
    }

    if (endpoint === RPC.delete) {
      if (!isSlot(payload.slot)) return fail('bad-request', 'slot is required')
      if (signal.aborted) return fail('cancelled', 'The request was cancelled')
      const slot = payload.slot
      try {
        await lock.run(slot, async () => {
          selfWrite.add(slot)
          // Revoke under the same lock as deletion: a preceding queued submit
          // may have created a new grant after this RPC was received.
          grants.clearSlot(slot)
          try { await store.remove(slot) }
          finally { selfWrite.delete(slot) }
        })
        runtime.knownSlots.delete(slot)
        runtime.refreshShell()
        log?.info('secret.deleted', 'Stored credential deleted.', { slot })
        return ok(true)
      } catch (error) {
        log?.error('secret.delete-failed', 'Deleting a credential failed.', undefined, { slot, reason: reasonOf(error) })
        return fail('internal', 'The credential could not be deleted')
      }
    }

    if (endpoint === RPC.revoke) {
      if (!isSlot(payload.slot)) return fail('bad-request', 'slot is required')
      if (payload.sessionId !== undefined && !isBoundedId(payload.sessionId)) return fail('bad-request', 'sessionId must be a bounded identifier')
      const revoked = grants.revoke(payload.slot, typeof payload.sessionId === 'string' ? payload.sessionId : undefined)
      log?.info('secret.revoked', 'Session authorization revoked.', { slot: payload.slot, revoked })
      return ok<RevokeOutcome>({ revoked })
    }

    return fail('not-found', 'Unknown endpoint')
  }
}
