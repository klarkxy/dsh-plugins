/**
 * Open secret dialogs, addressed by the tool call that raised them.
 *
 * A dialog is only answerable with all three of its identities: the
 * unpredictable pending id minted here, the session the tool ran in, and the
 * tool call id. A stale page, a reloaded session or a replayed call therefore
 * fails as `stale` instead of answering whatever question happens to be open
 * now. The winning submit removes the entry before any credential write, so two
 * concurrent submissions cannot both store.
 */
import { randomUUID } from 'node:crypto'
import { PENDING_TTL_MS, type PendingSecretRequest, type SubmitOutcome } from './contracts.ts'

/** What the blocking tool call finally observes. */
export type PendingAnswer =
  | { kind: 'submitted'; outcome: SubmitOutcome }
  | { kind: 'cancelled' }
  | { kind: 'timeout' }

/** What a tool passes in; the registry owns identity and expiry. */
export type PendingSpec = Omit<PendingSecretRequest, 'id' | 'expiresAt'>

export type TakeResult =
  | { ok: true; request: PendingSecretRequest }
  | { ok: false; reason: 'stale' | 'expired' }

type Entry = {
  request: PendingSecretRequest
  settle(answer: PendingAnswer): void
}

function callKey(sessionId: string, callId: string): string {
  // A separator that cannot occur in either checked identifier.
  return `${sessionId}\u0000${callId}`
}

export class PendingRegistry {
  private readonly byId = new Map<string, Entry>()
  private readonly byCall = new Map<string, string>()
  private readonly inflight = new Map<string, Entry>()
  private readonly makeId: () => string
  private readonly now: () => number

  constructor(options: { makeId?: () => string; now?: () => number } = {}) {
    this.makeId = options.makeId ?? randomUUID
    this.now = options.now ?? Date.now
  }

  /**
   * Register one question. The returned promise settles exactly once, when the
   * human answers, cancels, or the request expires.
   */
  create(spec: PendingSpec): { request: PendingSecretRequest; answer: Promise<PendingAnswer>; abandon(): void } {
    const request: PendingSecretRequest = { ...spec, id: this.makeId(), expiresAt: this.now() + PENDING_TTL_MS }
    let settle: (answer: PendingAnswer) => void = () => {}
    const answer = new Promise<PendingAnswer>((resolve) => { settle = resolve })
    const entry: Entry = { request, settle }
    this.byId.set(request.id, entry)
    this.byCall.set(callKey(request.sessionId, request.callId), request.id)
    return {
      request,
      answer,
      abandon: () => {
        if (!this.byId.delete(request.id)) return
        this.byCall.delete(callKey(request.sessionId, request.callId))
        settle({ kind: 'cancelled' })
      },
    }
  }

  /** The dialog a mounting Client should show, if this call still waits. */
  view(sessionId: string, callId: string): PendingSecretRequest | undefined {
    const id = this.byCall.get(callKey(sessionId, callId))
    if (id === undefined) return undefined
    const entry = this.byId.get(id)
    if (!entry) return undefined
    if (entry.request.expiresAt <= this.now()) {
      this.expire(entry)
      return undefined
    }
    // The view must not let a second caller learn another session's identity.
    return entry.request.sessionId === sessionId ? entry.request : undefined
  }

  /**
   * Claim one pending request for answering. Removing the lookups first is what
   * makes concurrent submits safe: the loser sees `stale`.
   */
  take(payload: { id: string; sessionId: string; callId: string }): TakeResult {
    const entry = this.byId.get(payload.id)
    if (!entry) return { ok: false, reason: 'stale' }
    if (entry.request.sessionId !== payload.sessionId || entry.request.callId !== payload.callId) {
      return { ok: false, reason: 'stale' }
    }
    this.byId.delete(payload.id)
    this.byCall.delete(callKey(entry.request.sessionId, entry.request.callId))
    if (entry.request.expiresAt <= this.now()) {
      this.settleEntry(entry, { kind: 'timeout' })
      return { ok: false, reason: 'expired' }
    }
    this.inflight.set(payload.id, entry)
    return { ok: true, request: entry.request }
  }

  /** Hand the claimed request back and settle its call; safe to call twice. */
  settle(id: string, answer: PendingAnswer): void {
    const entry = this.inflight.get(id)
    if (!entry) return
    this.inflight.delete(id)
    entry.settle(answer)
  }

  /**
   * Whether the request is still the one that was claimed. A dialog abandoned
   * while its write was queued must not grant anything afterwards.
   */
  isClaimed(id: string): boolean {
    return this.inflight.has(id)
  }

  /** The tool was cancelled while waiting; the dialog must stop being answerable. */
  abandon(id: string): void {
    const entry = this.inflight.get(id) ?? this.byId.get(id)
    if (!entry) return
    this.inflight.delete(id)
    this.byId.delete(id)
    this.byCall.delete(callKey(entry.request.sessionId, entry.request.callId))
    entry.settle({ kind: 'cancelled' })
  }

  /** Expire every overdue request; returns how many were closed. */
  sweep(): number {
    let closed = 0
    for (const entry of [...this.byId.values()]) {
      if (entry.request.expiresAt > this.now()) continue
      this.byId.delete(entry.request.id)
      this.byCall.delete(callKey(entry.request.sessionId, entry.request.callId))
      this.settleEntry(entry, { kind: 'timeout' })
      closed += 1
    }
    return closed
  }

  /** Close everything, e.g. when the plugin unloads. */
  clear(): void {
    for (const entry of [...this.byId.values()]) {
      this.byId.delete(entry.request.id)
      this.byCall.delete(callKey(entry.request.sessionId, entry.request.callId))
      entry.settle({ kind: 'cancelled' })
    }
    for (const entry of [...this.inflight.values()]) {
      this.inflight.delete(entry.request.id)
      entry.settle({ kind: 'cancelled' })
    }
  }

  private expire(entry: Entry): void {
    this.byId.delete(entry.request.id)
    this.byCall.delete(callKey(entry.request.sessionId, entry.request.callId))
    this.settleEntry(entry, { kind: 'timeout' })
  }

  private settleEntry(entry: Entry, answer: PendingAnswer): void {
    this.inflight.delete(entry.request.id)
    entry.settle(answer)
  }
}
