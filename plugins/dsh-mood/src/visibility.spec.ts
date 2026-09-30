import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { thinContract } from './analyze.ts'
import { copy, shouldOfferRecovery, shouldShowCard } from './client.tsx'

const contract = () => thinContract({ id: 'c', sessionId: 's', sourceVersion: 'u', revision: 1, goal: 'task', evidence: [], readiness: 'clear-request', now: 1 })

describe('quiet task-note presentation', () => {
  it('does not show legacy auto-generated contract cards', () => {
    assert.equal(shouldShowCard(false, contract(), false), false)
  })
  it('shows explicitly requested notes, but hides them when stale or the seat is hidden', () => {
    const note = contract()
    note.evidence.push({ sessionId: 's', seq: 1, kind: 'manual' })
    assert.equal(shouldShowCard(false, note, false), true)
    assert.equal(shouldShowCard(true, note, false), false)
    note.readiness = 'stale'
    assert.equal(shouldShowCard(false, note, false), false)
  })
  it('keeps an explicit legacy recovery entry and a manual progress indicator', () => {
    assert.equal(shouldShowCard(false, undefined, false, true), true)
    assert.equal(shouldShowCard(false, undefined, true), true)
  })
  it('does not label optional questions or a pending summary as blocked execution', () => {
    const status = { settings: { mode: 'auto' as const, revision: 0 }, storageFailed: false, session: {
      sessionId: 's', pendingManual: true, held: false, contract: contract(),
      clarification: [{ id: 'q', question: 'Which?', status: 'pending' as const }],
    } }
    assert.equal(shouldOfferRecovery(status), false)
    status.session.held = true
    assert.equal(shouldOfferRecovery(status), true)
  })
  it('describes the plugin in one user-facing sentence in both languages', () => {
    assert.match(copy('zh').hint, /会话/)
    assert.match(copy('en').hint, /session/)
    assert.doesNotMatch(copy('zh').hint, /原生权限/)
  })
})
