import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { modelMenuOverride } from '@klarkxy/dsh-plugin-kit/model-menu'
import { defaultModelRoute, emptyFusionState } from '../src/contracts.ts'
import { validateState } from '../src/validation.ts'
import { createFusionStore, FUSION_STATE_KEY } from '../src/storage.ts'

function baseState(settings = { revision: 0, model: defaultModelRoute() }) {
  return { ...emptyFusionState(), settings }
}

describe('fusion plugin-page model settings', () => {
  it('defaults to an empty route so the session model and host default resolve', () => {
    assert.deepEqual(defaultModelRoute(), { provider: '', model: '' })
    assert.equal(modelMenuOverride(defaultModelRoute()), undefined)
    assert.deepEqual(modelMenuOverride({ provider: 'p', model: 'm' }), { provider: 'p', model: 'm' })
    assert.deepEqual(modelMenuOverride({ provider: 'p', model: 'm', reasoningEffort: 'high' }), { provider: 'p', model: 'm', reasoningEffort: 'high' })
  })

  it('accepts a saved route and keeps it through a store round-trip', async () => {
    const saved = { revision: 3, model: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' } }
    const rows = new Map([[FUSION_STATE_KEY, baseState(saved)]])
    const store = createFusionStore({
      get: key => rows.get(key),
      put: (key, value) => { rows.set(key, value); return Promise.resolve() },
    })
    assert.deepEqual(store.load().settings, saved)
    await store.save(baseState(saved))
    assert.deepEqual(rows.get(FUSION_STATE_KEY).settings, saved)
  })

  it('fills defaults for v1 rows that have no settings record', () => {
    const legacy = { version: 1, revision: 2, pairs: [] }
    assert.deepEqual(validateState(legacy), { version: 1, revision: 2, pairs: [], settings: { revision: 0, model: defaultModelRoute() } })
    assert.equal(modelMenuOverride(validateState(legacy).settings.model), undefined)
  })

  it('rejects a malformed settings model', () => {
    assert.throws(() => validateState(baseState({ revision: 1, model: { provider: 'p' } })))
    assert.throws(() => validateState({ version: 3, revision: 0, pairs: [] }), { code: 'INVALID_STATE' })
  })
})
