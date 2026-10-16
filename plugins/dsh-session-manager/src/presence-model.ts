/**
 * Client models for the continue ghost and the welcome-back card.
 * Business state lives here, not in React state, mirroring session-actions.ts.
 */
import {
  CONFIG_READ_ENDPOINT,
  CONFIG_WRITE_ENDPOINT,
  CONTINUE_SUGGEST_ENDPOINT,
  TEMP_WORKSPACE_CHANNEL,
  WELCOME_BACK_COMPACT_ENDPOINT,
  WELCOME_BACK_PREPARE_ENDPOINT,
  type ConfigPatch,
  type ConfigView,
  type RecapPayload,
  type WelcomeBackCompactValue,
  type WelcomeBackPrepareValue,
} from './contracts.ts'
import { HostOperationError, readFailure, unwrap } from './session-actions.ts'
import type { CopyLocale, OperationFailure } from './ui-copy.ts'
import { bindWelcomeContinuationHost } from './welcome-continuation.ts'

export interface PresenceRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

export interface PresenceHost {
  readonly rpc?: PresenceRpc
  /** Native commands use the target session's composed capabilities. */
  readonly compactContext?: (sessionId: string, signal: AbortSignal) => Promise<void>
  readonly continueInNewSession?: (sessionId: string, recap: RecapPayload | null, locale: CopyLocale, signal: AbortSignal) => Promise<void>
}

/** Narrow the plugin client's connection face without redeclaring the Context type. */
export function bindPresenceHost(ctx: unknown): PresenceHost {
  const client = ctx as {
    connection?: { rpc?: PresenceRpc }
    sessions?: {
      using?: <T>(id: string, options: { source: 'controllerOperation'; signal: AbortSignal }, operation: (reference: {
        ready: Promise<{ session: { command(line: string): Promise<unknown> } }>
      }) => Promise<T>) => Promise<T>
    }
  }
  return {
    ...bindWelcomeContinuationHost(ctx),
    ...(typeof client.connection?.rpc?.call === 'function' ? { rpc: client.connection.rpc } : {}),
    ...(typeof client.sessions?.using === 'function' ? {
      compactContext: async (sessionId: string, signal: AbortSignal) => {
        await client.sessions!.using!(sessionId, { source: 'controllerOperation', signal }, async reference => {
          const binding = await reference.ready
          signal.throwIfAborted()
          const result = await unwrap(binding.session.command('/compact')) as { matched?: boolean } | undefined
          // matched is command admission, NOT a successful compaction. The
          // native command/done node owns the eventual outcome in the chat.
          if (result?.matched !== true) throw new HostOperationError('session-manager/unavailable')
        })
      },
    } : {}),
  }
}

function requireRpc(host: PresenceHost): PresenceRpc {
  if (typeof host.rpc?.call !== 'function') throw new HostOperationError('session/lifecycle-unavailable')
  return host.rpc
}

async function callPresence<T>(host: PresenceHost, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const raw = await unwrap(requireRpc(host).call(TEMP_WORKSPACE_CHANNEL, endpoint, payload, signal))
  return raw as T
}

interface Listener {
  (): void
}

function store() {
  const listeners = new Set<Listener>()
  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    emit(): void {
      for (const listener of listeners) listener()
    },
  }
}

/* ------------------------------------------------------------------ */
/* Continue ghost                                                      */
/* ------------------------------------------------------------------ */

export interface ContinueSessionState {
  /** undefined until the first resolve settles; null means the localized client default. */
  readonly text?: string | null
  /** Active-branch sequence this text belongs to. Fixed text has none. */
  readonly seq?: number
}

const EMPTY_CONTINUE: ContinueSessionState = {}

export interface ContinueModel {
  subscribe(listener: Listener): () => void
  /** Stable per-session snapshot identity for useSyncExternalStore selectors. */
  getSnapshot(sessionId: string): ContinueSessionState
  /** Resolve the suggestion for the latest ended turn. Safe to call on every mount. */
  load(sessionId: string): void
  /** The previous turn ended: drop the cached line so the next load generates once. */
  invalidate(sessionId: string): void
  /** Drop every cached line and revoke every pending reply on config changes. */
  invalidateAll(): void
  cancel(): void
}

export function createContinueModel(host: PresenceHost): ContinueModel {
  const events = store()
  const states = new Map<string, ContinueSessionState>()
  const inflight = new Map<string, AbortController>()
  const lifetime = new AbortController()
  let empty = EMPTY_CONTINUE

  function read(sessionId: string): ContinueSessionState {
    return states.get(sessionId) ?? empty
  }
  function write(sessionId: string, next: ContinueSessionState): void {
    if (lifetime.signal.aborted) return
    states.set(sessionId, next)
    events.emit()
  }

  return {
    subscribe: events.subscribe,
    getSnapshot: read,
    load(sessionId) {
      if (sessionId === '' || lifetime.signal.aborted || inflight.has(sessionId)) return
      const current = read(sessionId)
      if (current.text !== undefined && current.seq === undefined) return
      const ticket = new AbortController()
      inflight.set(sessionId, ticket)
      const signal = AbortSignal.any([lifetime.signal, ticket.signal])
      void callContinueSuggest(host, sessionId, current.seq, signal)
        .then(value => {
          if (signal.aborted || inflight.get(sessionId) !== ticket) return
          write(sessionId, value)
        })
        .catch(() => {
          // A rejected RPC is not a settled suggestion: the server owner may
          // have cancelled while our signal stayed active. Preserve the
          // snapshot without emitting, so explicit loads can retry and a
          // mounted empty composer does not start an automatic retry loop.
        })
        .finally(() => {
          if (inflight.get(sessionId) === ticket) inflight.delete(sessionId)
        })
    },
    invalidate(sessionId) {
      if (sessionId === '') return
      inflight.get(sessionId)?.abort()
      inflight.delete(sessionId)
      if (!states.has(sessionId)) return
      states.delete(sessionId)
      events.emit()
    },
    invalidateAll() {
      for (const ticket of inflight.values()) ticket.abort()
      inflight.clear()
      states.clear()
      empty = {}
      events.emit()
    },
    cancel() {
      lifetime.abort()
      for (const ticket of inflight.values()) ticket.abort()
      inflight.clear()
      states.clear()
    },
  }
}

async function callContinueSuggest(
  host: PresenceHost,
  sessionId: string,
  knownSeq: number | undefined,
  signal: AbortSignal,
): Promise<ContinueSessionState> {
  const value = await callPresence<{ text?: unknown; seq?: unknown }>(host, CONTINUE_SUGGEST_ENDPOINT, {
    sessionId,
    ...knownSeq === undefined ? {} : { knownSeq },
  }, signal)
  const text = typeof value?.text === 'string' && value.text.trim() !== '' ? value.text : null
  const seq = typeof value?.seq === 'number' && Number.isSafeInteger(value.seq) && value.seq >= 0 ? value.seq : undefined
  return { text, ...seq === undefined ? {} : { seq } }
}

/* ------------------------------------------------------------------ */
/* Bundle settings (config.read / config.write)                        */
/* ------------------------------------------------------------------ */

export interface PresenceConfigSnapshot {
  readonly phase: 'loading' | 'ready' | 'unavailable'
  readonly values?: ConfigView
  readonly saving: boolean
  /** Set briefly after a write is confirmed by a re-read (the write itself may drop with the reloading fiber). */
  readonly saved: boolean
  readonly failure?: OperationFailure
}

export interface PresenceConfigModel {
  subscribe(listener: Listener): () => void
  getSnapshot(): PresenceConfigSnapshot
  load(): Promise<void>
  save(patch: ConfigPatch): Promise<void>
  cancel(): void
}

export function createPresenceConfigModel(host: PresenceHost, delay: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): PresenceConfigModel {
  const events = store()
  const lifetime = new AbortController()
  let phase: PresenceConfigSnapshot['phase'] = 'loading'
  let values: ConfigView | undefined
  let saving = false
  let saved = false
  let failure: OperationFailure | undefined
  let snapshot: PresenceConfigSnapshot = build()
  let readGeneration = 0

  function build(): PresenceConfigSnapshot {
    return {
      phase,
      ...values === undefined ? {} : { values },
      saving,
      saved,
      ...failure === undefined ? {} : { failure },
    }
  }
  function publish(): void {
    snapshot = build()
    events.emit()
  }
  function sameRoute(
    current: ConfigView['model'] | undefined,
    value: unknown,
  ): boolean {
    const route = value as ConfigView['model'] | undefined
    if (current === null || current === undefined) return route === null || route === undefined
    return route !== null && route !== undefined && current.provider === route.provider && current.model === route.model
      && current.reasoningEffort === route.reasoningEffort
  }
  function same(view: ConfigView | undefined, patch: ConfigPatch): boolean {
    if (view === undefined) return false
    return Object.entries(patch).every(([key, value]) => {
      if (key === 'model' || key === 'ghostModel') return sameRoute(view[key], value)
      return view[key as keyof ConfigView] === value
    })
  }

  return {
    subscribe: events.subscribe,
    getSnapshot: () => snapshot,
    async load() {
      const generation = ++readGeneration
      try {
        const view = await callPresence<ConfigView>(host, CONFIG_READ_ENDPOINT, {}, lifetime.signal)
        if (lifetime.signal.aborted || generation !== readGeneration) return
        values = view
        phase = 'ready'
        failure = undefined
      } catch (error) {
        if (lifetime.signal.aborted || generation !== readGeneration) return
        phase = 'unavailable'
        failure = readFailure(error)
      }
      publish()
    },
    async save(patch) {
      if (saving || lifetime.signal.aborted) return
      saving = true
      ++readGeneration
      saved = false
      failure = undefined
      publish()
      try {
        await callPresence<ConfigView>(host, CONFIG_WRITE_ENDPOINT, { patch }, lifetime.signal)
      } catch {
        // The host fiber reloads with the new config mid-write; confirm by re-reading.
      }
      try {
        for (let attempt = 0; attempt < 10 && !lifetime.signal.aborted; attempt++) {
          await delay(400)
          let view: ConfigView
          try {
            view = await callPresence<ConfigView>(host, CONFIG_READ_ENDPOINT, {}, lifetime.signal)
          } catch (error) {
            // A config edit can temporarily remove the RPC while its Host
            // instance is replaced. One failed read is not a failed save.
            if (lifetime.signal.aborted || attempt === 9) throw error
            continue
          }
          if (same(view, patch)) {
            ++readGeneration
            values = view
            phase = 'ready'
            saved = true
            saving = false
            publish()
            return
          }
        }
        throw new HostOperationError('transport', 'unknown')
      } catch (error) {
        if (lifetime.signal.aborted) return
        saving = false
        failure = readFailure(error)
        publish()
      }
    },
    cancel() {
      lifetime.abort()
    },
  }
}


/* ------------------------------------------------------------------ */
/* Welcome-back card                                                   */
/* ------------------------------------------------------------------ */

export interface WelcomeBackCardState {
  readonly sessionId: string
  readonly idleMinutes: number
  readonly lastResponseAt: number
  readonly recap: RecapPayload | null
  readonly compactSuggested: boolean
  readonly compactAvailable: boolean
  /** Host-resolved threshold so the client can flip the suggestion on live as the idle clock crosses it. */
  readonly compactMinutes: number
}

export interface WelcomeBackSnapshot {
  /** Present while this session's card is visible. */
  readonly card?: WelcomeBackCardState
  readonly compactBusy: boolean
  readonly continueBusy?: boolean
  /** Native command accepted; its own chat node reports success or failure. */
  readonly compactCommandSent?: boolean
  /** null = compacted but the host gave no token count. */
  readonly compactedTokens?: number | null
  readonly compactReason?: 'busy' | 'unavailable' | 'nothing'
  readonly failure?: OperationFailure
}

const EMPTY_WELCOME_BACK: WelcomeBackSnapshot = { compactBusy: false }

export interface WelcomeBackModel {
  subscribe(listener: Listener): () => void
  /** Stable per-session snapshot identity for useSyncExternalStore selectors. */
  getSnapshot(sessionId: string): WelcomeBackSnapshot
  /** Ask the host whether this session deserves the card; events call this on return. */
  check(sessionId: string): Promise<void>
  /** Re-evaluate cached cards and dismissed marks after confirmed threshold changes. */
  invalidate(): void
  dismiss(sessionId: string): void
  compact(sessionId: string): Promise<void>
  continueInNewSession(sessionId: string, locale: CopyLocale): Promise<void>
  cancel(): void
}

export function createWelcomeBackModel(
  host: PresenceHost,
  ids: () => string = () => crypto.randomUUID(),
  minIntervalMs = 10_000,
): WelcomeBackModel {
  const events = store()
  const lifetime = new AbortController()
  /** Sessions already answered for one exact lastResponseAt; new activity re-arms the card. */
  const settled = new Map<string, number>()
  const checkedAt = new Map<string, number>()
  const capMarks = (map: Map<string, number>) => {
    while (map.size > 64) map.delete(map.keys().next().value!)
  }
  /** Per-session card plus its live compact operation fields. */
  const states = new Map<string, {
    card: WelcomeBackCardState
    compactBusy: boolean
    continueBusy?: boolean
    continueAbort?: AbortController
    compactCommandSent?: boolean
    compactedTokens: number | null | undefined
    compactReason: WelcomeBackSnapshot['compactReason']
    failure: OperationFailure | undefined
  }>()
  /** Stable snapshot per session, rebuilt only when its fields change. */
  const snapshots = new Map<string, WelcomeBackSnapshot>()
  const inflight = new Map<string, AbortController>()

  function read(sessionId: string): WelcomeBackSnapshot {
    return snapshots.get(sessionId) ?? EMPTY_WELCOME_BACK
  }
  function publish(sessionId: string): void {
    const state = states.get(sessionId)
    if (state === undefined) {
      snapshots.delete(sessionId)
    } else {
      snapshots.set(sessionId, {
        card: state.card,
        compactBusy: state.compactBusy,
        continueBusy: state.continueBusy === true,
        compactCommandSent: state.compactCommandSent === true,
        ...state.compactedTokens === undefined ? {} : { compactedTokens: state.compactedTokens },
        ...state.compactReason === undefined ? {} : { compactReason: state.compactReason },
        ...state.failure === undefined ? {} : { failure: state.failure },
      })
    }
    events.emit()
  }

  return {
    subscribe: events.subscribe,
    getSnapshot: read,
    async check(sessionId) {
      if (sessionId === '' || lifetime.signal.aborted || states.has(sessionId)) return
      const now = Date.now()
      const last = checkedAt.get(sessionId) ?? 0
      if (now - last < minIntervalMs) return
      if (inflight.has(sessionId)) return
      checkedAt.set(sessionId, now)
      capMarks(checkedAt)
      const ticket = new AbortController()
      inflight.set(sessionId, ticket)
      const signal = AbortSignal.any([lifetime.signal, ticket.signal])
      try {
        const value = await callPresence<WelcomeBackPrepareValue>(host, WELCOME_BACK_PREPARE_ENDPOINT, {
          sessionId,
          ...settled.has(sessionId) ? { knownLastResponseAt: settled.get(sessionId) } : {},
        }, signal)
        if (signal.aborted || inflight.get(sessionId) !== ticket || states.has(sessionId) || value.show !== true) return
        if (value.sessionId !== sessionId) return
        if (settled.get(sessionId) === value.lastResponseAt) return
        states.set(sessionId, {
          card: {
            sessionId,
            idleMinutes: value.idleMinutes,
            lastResponseAt: value.lastResponseAt,
            recap: value.recap,
            compactSuggested: value.compactSuggested,
            compactAvailable: value.compactAvailable,
            compactMinutes: value.compactMinutes,
          },
          compactBusy: false,
          compactedTokens: undefined,
          compactReason: undefined,
          failure: undefined,
        })
        publish(sessionId)
      } catch {
        // A failed or unavailable prepare stays silent: the card is a courtesy, never a blocker.
      } finally {
        if (inflight.get(sessionId) === ticket) inflight.delete(sessionId)
      }
    },
    invalidate() {
      for (const ticket of inflight.values()) ticket.abort()
      inflight.clear()
      checkedAt.clear()
      settled.clear()
      // Explicit operations keep ownership until they settle; configuration
      // refresh must not abort a user's chosen compaction or navigation.
      for (const [sessionId, state] of states) {
        if (state.compactBusy || state.continueBusy) continue
        states.delete(sessionId)
        snapshots.delete(sessionId)
      }
      events.emit()
    },
    dismiss(sessionId) {
      inflight.get(sessionId)?.abort()
      inflight.delete(sessionId)
      const state = states.get(sessionId)
      if (state === undefined) return
      state.continueAbort?.abort()
      settled.set(sessionId, state.card.lastResponseAt)
      capMarks(settled)
      states.delete(sessionId)
      publish(sessionId)
    },
    async compact(sessionId) {
      const state = states.get(sessionId)
      if (state === undefined || state.compactBusy || state.continueBusy || lifetime.signal.aborted) return
      state.compactBusy = true
      state.failure = undefined
      state.compactReason = undefined
      publish(sessionId)
      try {
        if (host.compactContext !== undefined) {
          await host.compactContext(sessionId, lifetime.signal)
          if (lifetime.signal.aborted || states.get(sessionId) !== state) return
          state.compactBusy = false
          state.compactCommandSent = true
          publish(sessionId)
          return
        }
        const value = await callPresence<WelcomeBackCompactValue>(host, WELCOME_BACK_COMPACT_ENDPOINT, {
          sessionId: state.card.sessionId,
          requestId: ids(),
        }, lifetime.signal)
        if (lifetime.signal.aborted || states.get(sessionId) !== state) return
        state.compactBusy = false
        if (value.compacted) state.compactedTokens = value.shadowedTokens
        else state.compactReason = value.reason
        publish(sessionId)
      } catch (error) {
        if (lifetime.signal.aborted || states.get(sessionId) !== state) return
        state.compactBusy = false
        state.failure = readFailure(error)
        publish(sessionId)
      }
    },
    async continueInNewSession(sessionId, locale) {
      const state = states.get(sessionId)
      if (state === undefined || state.compactBusy || state.continueBusy || lifetime.signal.aborted) return
      state.continueBusy = true
      state.continueAbort = new AbortController()
      state.failure = undefined
      publish(sessionId)
      try {
        if (host.continueInNewSession === undefined) throw new HostOperationError('session/lifecycle-unavailable')
        await host.continueInNewSession(sessionId, state.card.recap, locale,
          AbortSignal.any([lifetime.signal, state.continueAbort.signal]))
        if (lifetime.signal.aborted || states.get(sessionId) !== state) return
        settled.set(sessionId, state.card.lastResponseAt)
        capMarks(settled)
        states.delete(sessionId)
        publish(sessionId)
      } catch (error) {
        if (lifetime.signal.aborted || states.get(sessionId) !== state) return
        state.continueBusy = false
        if (!(error instanceof Error && error.name === 'AbortError')) state.failure = readFailure(error)
        publish(sessionId)
      }
    },
    cancel() {
      lifetime.abort()
      inflight.clear()
      states.clear()
      snapshots.clear()
      settled.clear()
      checkedAt.clear()
    },
  }
}
