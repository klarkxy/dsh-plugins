/**
 * Single host-RPC registration for the shared plugin channel.
 * webServer prefix routes do not compose, so every endpoint dispatches here.
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import type { RpcResult } from '@klarkxy/dsh-plugin-kit/contracts'
import {
  CONFIG_READ_ENDPOINT,
  CONFIG_WRITE_ENDPOINT,
  CONTINUE_SUGGEST_ENDPOINT,
  EDIT_PREPARE_ENDPOINT,
  EDIT_FILE_ENDPOINT,
  TEMP_WORKSPACE_CHANNEL,
  WELCOME_BACK_COMPACT_ENDPOINT,
  WELCOME_BACK_PREPARE_ENDPOINT,
  type ContinueSuggestRequest,
  type EditPrepareRequest,
  type ResolvedConfig,
  type WelcomeBackCompactRequest,
  type WelcomeBackPrepareRequest,
  type ConfigWriteRequest,
} from './contracts.ts'
import { readPresenceConfig, writePresenceConfig, type PresenceModelStore } from './config-editor.ts'
import { runTemporaryAllocate } from './temporary-directory.ts'
import { prepareEdit } from './edit-prepare.ts'
import { retryDomain, RetryJournal, RetryJournalError, type RetryDomainHandle } from './retry-journal.ts'
import { stageEditFile, type EditFileServices } from './edit-file.ts'
import {
  commitRetry,
  previewRetry,
  retryCapabilities,
  RetryError,
} from './retry-service.ts'
import {
  RETRY_CAPABILITIES_ENDPOINT,
  RETRY_COMMIT_ENDPOINT,
  RETRY_PREVIEW_ENDPOINT,
  type RetryCommitRequest,
  type RetryPreviewRequest,
} from './retry-contracts.ts'
import {
  compactSession,
  createSuggestionCache,
  prepareWelcomeBack,
  presenceServices,
  suggestContinuation,
  PresenceError,
  type PresenceModelHost,
} from './welcome-back.ts'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'

const PROFILE_ERROR = 'Session Manager requires the active profile directory'

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function failure(error: unknown): RpcResult {
  if (error instanceof PresenceError || error instanceof RetryError || error instanceof RetryJournalError) {
    return { ok: false, error: { code: error.code, message: error.message } }
  }
  if (isAbort(error)) return { ok: false, error: { code: 'session-manager/failed', message: 'request cancelled' } }
  // Unknown failures answer with fixed copy instead of leaking host internals.
  return { ok: false, error: { code: 'session-manager/failed', message: 'session manager request failed' } }
}

function payloadKeys(payload: unknown, allowed: readonly string[]): payload is Record<string, unknown> {
  return Boolean(payload) && typeof payload === 'object' && !Array.isArray(payload)
    && Object.keys(payload as Record<string, unknown>).every(key => allowed.includes(key))
}

/**
 * Register every browser endpoint on the shared channel. `transport` carries
 * connection/webServer; business services resolve on the plugin root context
 * because child scopes do not redeclare them.
 */
export function registerSessionManagerRpc(
  root: Context,
  transport: Context & HostRpcContext,
  config: ResolvedConfig,
  models: () => PresenceModelHost | undefined,
  modelStore?: () => PresenceModelStore | undefined,
): () => Promise<void> {
  const profile = transport.get('profileContext') as { dir?: string } | undefined
  if (!profile?.dir) throw new Error(PROFILE_ERROR)
  const sessionQuery = (root as { sessionQuery?: SessionQueryEngine }).sessionQuery
  if (sessionQuery === undefined) throw new Error('Session Manager requires the sessionQuery service')
  const profileDir = profile.dir
  const suggestions = createSuggestionCache()
  const lifetime = new AbortController()
  let journal: Promise<RetryJournal> | undefined
  const retryJournal = async (): Promise<RetryJournal | undefined> => {
    lifetime.signal.throwIfAborted()
    const storage = root.get('storageDomain') as { open(spec: typeof retryDomain): Promise<RetryDomainHandle> } | undefined
    if (!storage) return undefined
    return journal ??= (async () => {
      const domain = await storage.open(retryDomain)
      try { return new RetryJournal(domain) }
      catch (error) { await domain.close(); throw error }
    })()
  }
  const unregister = registerHostRpc(transport, TEMP_WORKSPACE_CHANNEL, async (endpoint, payload, signal) => {
    const merged = AbortSignal.any([signal, lifetime.signal])
    try {
      if (endpoint === 'temporary.allocate') return await runTemporaryAllocate(profileDir, payload, merged)
      const services = presenceServices(root, sessionQuery)
      if (endpoint === WELCOME_BACK_PREPARE_ENDPOINT) {
        if (!payloadKeys(payload, ['sessionId', 'knownLastResponseAt'])) throw new PresenceError('session-manager/invalid-request', 'invalid welcome-back request')
        const value = await prepareWelcomeBack(services, config, models(), payload as unknown as WelcomeBackPrepareRequest, merged)
        return { ok: true, value }
      }
      if (endpoint === WELCOME_BACK_COMPACT_ENDPOINT) {
        if (!payloadKeys(payload, ['sessionId', 'requestId'])) throw new PresenceError('session-manager/invalid-request', 'invalid compaction request')
        const value = await compactSession(services, payload as unknown as WelcomeBackCompactRequest, merged)
        return { ok: true, value }
      }
      if (endpoint === CONTINUE_SUGGEST_ENDPOINT) {
        if (!payloadKeys(payload, ['sessionId', 'knownSeq'])) throw new PresenceError('session-manager/invalid-request', 'invalid continuation request')
        const value = await suggestContinuation(services, config, models(), suggestions, payload as unknown as ContinueSuggestRequest, merged)
        return { ok: true, value }
      }
      if (endpoint === EDIT_PREPARE_ENDPOINT) {
        if (!payloadKeys(payload, ['sessionId', 'promptSeq'])) throw new PresenceError('session-manager/invalid-request', 'invalid edit request')
        const value = await prepareEdit(sessionQuery, payload as unknown as EditPrepareRequest, merged)
        return { ok: true, value }
      }
      if (endpoint === EDIT_FILE_ENDPOINT) {
        if (!payloadKeys(payload, ['sessionId', 'promptSeq', 'attachmentId'])) throw new PresenceError('session-manager/invalid-request', 'invalid attachment request')
        const fileServices: EditFileServices = {
          attachments: root.get('attachments') as EditFileServices['attachments'],
          fileUploads: root.get('fileUploads') as EditFileServices['fileUploads'],
        }
        const value = await stageEditFile(sessionQuery, fileServices, payload as unknown as Parameters<typeof stageEditFile>[2], merged)
        return { ok: true, value }
      }
      if (endpoint === RETRY_CAPABILITIES_ENDPOINT) {
        if (!payloadKeys(payload, [])) throw new PresenceError('session-manager/invalid-request', 'invalid retry capabilities request')
        return { ok: true, value: retryCapabilities({ ...services, retryJournal: await retryJournal() }) }
      }
      if (endpoint === RETRY_PREVIEW_ENDPOINT) {
        if (!payloadKeys(payload, ['sessionId', 'messageId'])) throw new PresenceError('session-manager/invalid-request', 'invalid retry preview request')
        const value = await previewRetry(services, payload as unknown as RetryPreviewRequest, merged)
        return { ok: true, value }
      }
      if (endpoint === RETRY_COMMIT_ENDPOINT) {
        if (!payloadKeys(payload, ['sessionId', 'messageId', 'expectedRevision', 'expectedInputRevision', 'requestId', 'text', 'content', 'allowModified'])) {
          throw new PresenceError('session-manager/invalid-request', 'invalid retry commit request')
        }
        const value = await commitRetry({ ...services, retryJournal: await retryJournal() }, payload as unknown as RetryCommitRequest, merged)
        return { ok: true, value }
      }
      if (endpoint === CONFIG_READ_ENDPOINT) {
        if (!payloadKeys(payload, [])) throw new PresenceError('session-manager/invalid-request', 'invalid config request')
        return { ok: true, value: readPresenceConfig(config, modelStore?.()) }
      }
      if (endpoint === CONFIG_WRITE_ENDPOINT) {
        if (!payloadKeys(payload, ['patch'])) throw new PresenceError('session-manager/invalid-request', 'invalid config write request')
        const value = await writePresenceConfig(root, config, (payload as unknown as ConfigWriteRequest).patch, modelStore?.(), merged)
        return { ok: true, value }
      }
      throw new PresenceError('session-manager/invalid-request', 'unknown Session Manager operation')
    } catch (error) {
      return failure(error)
    }
  }, { requirePayload: true })
  return async () => {
    lifetime.abort()
    suggestions.clear()
    unregister()
    await journal?.then(value => value.close(), () => {})
  }
}
