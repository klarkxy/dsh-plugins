import { describe, expect, it } from 'vitest'
import { isCanonicalOrigin, isSlot, PLUGIN_ID, valueProblem } from './contracts.ts'
import { readListOutcome, readPendingView, readSubmitOutcome, readSecretEntry, readToolResult } from './client-wire.ts'

const pending = {
  id: 'req-1', sessionId: 'session-1', callId: 'call-1', kind: 'http',
  slot: 'github-token', envKey: 'DSH_SECRET_GITHUB_TOKEN', ref: 'secret://github-token',
  purpose: 'call the GitHub API', requestEnv: true, configured: true,
  authHeader: 'Authorization', authPrefix: 'Bearer',
  httpOrigin: 'https://api.github.com', expiresAt: 1_800_000_000_000,
}

describe('wire readers', () => {
  it('reads a full pending view', () => {
    const view = readPendingView(pending)
    expect(view).toMatchObject({
      id: 'req-1', kind: 'http', slot: 'github-token',
      requestEnv: true, configured: true, httpOrigin: 'https://api.github.com',
    })
  })
  it('defaults missing auth shape to Authorization/Bearer and drops a bad origin', () => {
    const { authHeader: _h, authPrefix: _p, httpOrigin: _o, ...rest } = pending
    const view = readPendingView({ ...rest, httpOrigin: 'javascript:alert(1)' })
    expect(view?.authHeader).toBe('Authorization')
    expect(view?.authPrefix).toBe('Bearer ')
    expect(view?.httpOrigin).toBeUndefined()
    expect(readPendingView({ ...rest, kind: 'other' })).toBeUndefined()
    expect(readPendingView({ ...rest, expiresAt: 'soon' })).toBeUndefined()
    expect(readPendingView(null)).toBeUndefined()
  })
  it('reads submit outcomes and list entries without leaking a value', () => {
    expect(readSubmitOutcome({ status: 'ready', ref: 'secret://a', slot: 'a', envKey: 'DSH_SECRET_A', envGranted: true, httpGranted: false }))
      .toMatchObject({ status: 'ready', envGranted: true })
    expect(readSubmitOutcome({ status: 'other', ref: 'x', slot: 'a', envKey: 'k', envGranted: true, httpGranted: true })).toBeUndefined()
    const entries = readListOutcome({ entries: [{
      ref: 'secret://a', slot: 'a', envKey: 'DSH_SECRET_A', configured: true,
      envGrantedSessions: 2, httpGrantedSessions: 0, envGranted: true, httpGranted: false,
    }] })
    expect(entries).toHaveLength(1)
    expect(entries?.[0]).toMatchObject({ envGrantedSessions: 2, envGranted: true })
    expect(readListOutcome({ entries: [{ ref: 1 }] })).toBeUndefined()
    // Missing grant flags read as not-granted — never as granted.
    expect(readSecretEntry({ ref: 'secret://a', slot: 'a', envKey: 'K', configured: true, envGrantedSessions: 0, httpGrantedSessions: 0 }))
      .toMatchObject({ envGranted: false, httpGranted: false })
  })
  it('reads the persisted tool result only when it belongs to this plugin', () => {
    const meta = { owner: PLUGIN_ID, status: 'ready', configured: true, envGranted: true, httpGranted: false, summary: 'ready' }
    expect(readToolResult(meta)).toMatchObject({ status: 'ready', envGranted: true })
    expect(readToolResult({ owner: 'other', status: 'ready', summary: 'x' })).toBeUndefined()
    expect(readToolResult({ owner: PLUGIN_ID })).toBeUndefined()
  })
})

describe('contract guards used by the UI', () => {
  it('keeps slot names in the model-facing grammar', () => {
    expect(isSlot('github-token')).toBe(true)
    expect(isSlot('GitHub')).toBe(false)
    expect(isSlot('a'.repeat(42))).toBe(false)
    expect(isSlot('-lead')).toBe(false)
  })
  it('accepts only canonical https origins', () => {
    expect(isCanonicalOrigin('https://api.github.com')).toBe(true)
    expect(isCanonicalOrigin('https://api.github.com:8443')).toBe(true)
    expect(isCanonicalOrigin('http://api.github.com')).toBe(false)
    expect(isCanonicalOrigin('https://api.github.com/path')).toBe(false)
    expect(isCanonicalOrigin('https://user@api.github.com')).toBe(false)
  })
  it('rejects values that could smuggle a header line or a huge paste', () => {
    expect(valueProblem('sk-live-1')).toBeUndefined()
    expect(valueProblem(' padded-value ')).toMatch(/whitespace/)
    expect(valueProblem('a\nbcdefgh')).toMatch(/line breaks/)
    expect(valueProblem('')).toMatch(/required/)
  })
})
