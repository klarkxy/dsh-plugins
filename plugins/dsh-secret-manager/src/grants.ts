/**
 * Per-session authorization: which session may use which stored slot, and for
 * what. Keyed by the exact session that approved it — a child thread never
 * inherits its parent's authorization, and a new session never inherits an old
 * one.
 *
 * Replacing or deleting a value revokes every hold on that slot, so a rotated
 * secret is never quietly handed to a session that approved the old one. Grants
 * also expire: `GRANT_TTL_MS` from the approval, never extended implicitly.
 */
import { GRANT_TTL_MS, type SecretScope } from './contracts.ts'
import type { StoredSecret } from './store.ts'

/** What one session may do with one slot. */
export interface SessionGrant {
  readonly sessionId: string
  /** Inject into that session's own model shell calls. */
  readonly env: boolean
  /** Attach to requests that target exactly this origin. */
  readonly http?: { origin: string; authHeader: string; authPrefix: string }
  readonly expiresAt: number
}

export interface GrantCounts {
  env: number
  http: number
}

export class GrantRegistry {
  private readonly bySlot = new Map<string, Map<string, SessionGrant>>()
  private readonly revocations = new Map<string, number>()
  private revision = 0
  private readonly now: () => number

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now
  }

  /** Add one scope for one session, merging with a live grant for the same slot. */
  grant(slot: string, sessionId: string, scope: SecretScope): void {
    const at = this.now()
    const grants = this.bySlot.get(slot) ?? new Map<string, SessionGrant>()
    const current = grants.get(sessionId)
    const live = current && current.expiresAt > at ? current : undefined
    const env = live?.env === true || scope.kind === 'env'
    const http = scope.kind === 'http'
      ? { origin: scope.origin, authHeader: scope.authHeader, authPrefix: scope.authPrefix }
      : live?.http
    grants.set(sessionId, {
      sessionId,
      env,
      ...(http ? { http } : {}),
      expiresAt: at + GRANT_TTL_MS,
    })
    this.bySlot.set(slot, grants)
  }

  /** Revoke one session's hold, or every hold on the slot. Returns how many were removed. */
  revoke(slot: string, sessionId?: string): number {
    this.revocations.set(sessionId === undefined ? slot : `${slot}\0${sessionId}`, ++this.revision)
    const grants = this.bySlot.get(slot)
    if (!grants) return 0
    if (sessionId === undefined) {
      const removed = grants.size
      this.bySlot.delete(slot)
      return removed
    }
    return grants.delete(sessionId) ? 1 : 0
  }

  /** Explicit revocation must win over a submission already awaiting storage. */
  revocationVersion(slot: string, sessionId: string): number {
    return Math.max(this.revocations.get(slot) ?? 0, this.revocations.get(`${slot}\0${sessionId}`) ?? 0)
  }

  /** A value changed or vanished: nothing that approved the old one keeps access. */
  clearSlot(slot: string): void {
    this.bySlot.delete(slot)
  }

  clearAll(): void {
    this.bySlot.clear()
  }

  /**
   * The value this session may have injected, or undefined. Requires an env
   * grant, a live cache entry and an unexpired approval — the three facts never
   * live in one place, so a revocation between shell calls wins.
   */
  envValue(slot: string, sessionId: string, stored: StoredSecret | undefined): string | undefined {
    if (!stored) return undefined
    const grant = this.live(slot, sessionId)
    if (!grant?.env) return undefined
    return stored.secret
  }

  /** The HTTP scope this session approved for exactly this origin, if any. */
  httpScope(slot: string, sessionId: string, origin: string): SessionGrant['http'] | undefined {
    const grant = this.live(slot, sessionId)
    if (!grant?.http || grant.http.origin !== origin) return undefined
    return grant.http
  }

  counts(slot: string): GrantCounts {
    const grants = this.bySlot.get(slot)
    if (!grants) return { env: 0, http: 0 }
    const at = this.now()
    let env = 0
    let http = 0
    for (const grant of grants.values()) {
      if (grant.expiresAt <= at) continue
      if (grant.env) env += 1
      if (grant.http) http += 1
    }
    return { env, http }
  }

  /** Whether one named session currently holds each scope. */
  heldBy(slot: string, sessionId: string | undefined): { envGranted: boolean; httpGranted: boolean } {
    if (sessionId === undefined) return { envGranted: false, httpGranted: false }
    const grant = this.live(slot, sessionId)
    return { envGranted: grant?.env === true, httpGranted: grant?.http !== undefined }
  }

  /** Drop expired grants; returns how many were removed. */
  sweep(): number {
    const at = this.now()
    let removed = 0
    for (const [slot, grants] of [...this.bySlot]) {
      for (const [sessionId, grant] of [...grants]) {
        if (grant.expiresAt > at) continue
        grants.delete(sessionId)
        removed += 1
      }
      if (grants.size === 0) this.bySlot.delete(slot)
    }
    return removed
  }

  private live(slot: string, sessionId: string): SessionGrant | undefined {
    const grant = this.bySlot.get(slot)?.get(sessionId)
    if (!grant) return undefined
    if (grant.expiresAt <= this.now()) {
      this.bySlot.get(slot)?.delete(sessionId)
      return undefined
    }
    return grant
  }
}
