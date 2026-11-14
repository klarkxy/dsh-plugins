import { describe, expect, it } from 'vitest'
import { GRANT_TTL_MS } from './contracts.ts'
import { GrantRegistry } from './grants.ts'

const http = (origin = 'https://api.example.com') => ({
  kind: 'http' as const, origin, authHeader: 'Authorization', authPrefix: 'Bearer ',
})

describe('GrantRegistry', () => {
  it('keeps authorization to the exact session that approved it', () => {
    const grants = new GrantRegistry({ now: () => 1_000 })
    grants.grant('db-prod', 'session-a', { kind: 'env' })
    expect(grants.envValue('db-prod', 'session-a', { secret: 'dummy-secret-value', envKey: 'DSH_SECRET_DB_PROD' }))
      .toBe('dummy-secret-value')
    expect(grants.envValue('db-prod', 'session-b', { secret: 'dummy-secret-value', envKey: 'DSH_SECRET_DB_PROD' }))
      .toBeUndefined()
    expect(grants.envValue('other', 'session-a', { secret: 'dummy-secret-value', envKey: 'DSH_SECRET_OTHER' }))
      .toBeUndefined()
  })

  it('requires an env grant even when a value is cached', () => {
    const grants = new GrantRegistry({ now: () => 1_000 })
    grants.grant('db-prod', 'session-a', http())
    expect(grants.envValue('db-prod', 'session-a', { secret: 'dummy-secret-value', envKey: 'DSH_SECRET_DB_PROD' }))
      .toBeUndefined()
  })

  it('scopes an HTTP grant to one exact origin', () => {
    const grants = new GrantRegistry({ now: () => 1_000 })
    grants.grant('db-prod', 'session-a', http())
    expect(grants.httpScope('db-prod', 'session-a', 'https://api.example.com')?.authPrefix).toBe('Bearer ')
    expect(grants.httpScope('db-prod', 'session-a', 'https://other.example.com')).toBeUndefined()
    expect(grants.httpScope('db-prod', 'session-b', 'https://api.example.com')).toBeUndefined()
  })

  it('merges a second scope into one live grant', () => {
    const grants = new GrantRegistry({ now: () => 1_000 })
    grants.grant('db-prod', 'session-a', { kind: 'env' })
    grants.grant('db-prod', 'session-a', http())
    expect(grants.heldBy('db-prod', 'session-a')).toEqual({ envGranted: true, httpGranted: true })
    expect(grants.counts('db-prod')).toEqual({ env: 1, http: 1 })
  })

  it('expires exactly one TTL after approval without extending on use', () => {
    let now = 1_000
    const grants = new GrantRegistry({ now: () => now })
    grants.grant('db-prod', 'session-a', { kind: 'env' })
    now = 1_000 + GRANT_TTL_MS - 1
    expect(grants.envValue('db-prod', 'session-a', { secret: 'dummy-secret-value', envKey: 'DSH_SECRET_DB_PROD' }))
      .toBe('dummy-secret-value')
    now = 1_000 + GRANT_TTL_MS
    expect(grants.envValue('db-prod', 'session-a', { secret: 'dummy-secret-value', envKey: 'DSH_SECRET_DB_PROD' }))
      .toBeUndefined()
  })

  it('revokes one session or all of them', () => {
    const grants = new GrantRegistry({ now: () => 1_000 })
    grants.grant('db-prod', 'session-a', { kind: 'env' })
    grants.grant('db-prod', 'session-b', { kind: 'env' })
    grants.grant('db-prod', 'session-b', http())
    expect(grants.revoke('db-prod', 'session-a')).toBe(1)
    expect(grants.revoke('db-prod', 'session-a')).toBe(0)
    expect(grants.heldBy('db-prod', 'session-a')).toEqual({ envGranted: false, httpGranted: false })
    expect(grants.revoke('db-prod')).toBe(1)
    expect(grants.counts('db-prod')).toEqual({ env: 0, http: 0 })
  })

  it('drops every hold on a slot whose value changed', () => {
    const grants = new GrantRegistry({ now: () => 1_000 })
    grants.grant('db-prod', 'session-a', { kind: 'env' })
    grants.grant('db-prod', 'session-a', http())
    grants.clearSlot('db-prod')
    expect(grants.heldBy('db-prod', 'session-a')).toEqual({ envGranted: false, httpGranted: false })
  })

  it('reports no authorization when no session was asked about', () => {
    const grants = new GrantRegistry({ now: () => 1_000 })
    grants.grant('db-prod', 'session-a', { kind: 'env' })
    expect(grants.heldBy('db-prod', undefined)).toEqual({ envGranted: false, httpGranted: false })
    expect(grants.counts('db-prod')).toEqual({ env: 1, http: 0 })
  })

  it('sweeps expired grants', () => {
    let now = 1_000
    const grants = new GrantRegistry({ now: () => now })
    grants.grant('db-prod', 'session-a', { kind: 'env' })
    grants.grant('other', 'session-a', { kind: 'env' })
    now = 1_000 + GRANT_TTL_MS + 1
    expect(grants.sweep()).toBe(2)
    expect(grants.sweep()).toBe(0)
  })
})
