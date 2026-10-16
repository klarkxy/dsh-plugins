import { describe, expect, it, vi } from 'vitest'
import { createPresenceConfigModel, createWelcomeBackModel } from './presence-model.ts'
import { CONFIG_READ_ENDPOINT, CONFIG_WRITE_ENDPOINT, WELCOME_BACK_PREPARE_ENDPOINT } from './contracts.ts'

const card = (compactMinutes = 60) => ({ show: true, sessionId: 's', lastResponseAt: 1000,
  idleMinutes: 20, recap: { summary: 'Summary', progress: '', nextStep: '' },
  compactSuggested: compactMinutes <= 20, compactAvailable: false, compactMinutes })

describe('welcome-back threshold changes', () => {
  it('replaces an existing card after a confirmed config change, including disabling it', async () => {
    let value: unknown = card()
    const call = vi.fn(async () => ({ ok: true, value }))
    const model = createWelcomeBackModel({ rpc: { call } })
    await model.check('s')
    expect(model.getSnapshot('s').card?.compactMinutes).toBe(60)
    value = card(1)
    model.invalidate()
    await model.check('s')
    expect(model.getSnapshot('s').card?.compactMinutes).toBe(1)
    value = { show: false }
    model.invalidate()
    await model.check('s')
    expect(model.getSnapshot('s').card).toBeUndefined()
  })

  it('rechecks a dismissed activity after changing thresholds without sending its old dismissal mark', async () => {
    const call = vi.fn(async () => ({ ok: true, value: card() }))
    const model = createWelcomeBackModel({ rpc: { call } })
    await model.check('s')
    model.dismiss('s')
    model.invalidate()
    await model.check('s')
    expect(call).toHaveBeenLastCalledWith(expect.any(String), WELCOME_BACK_PREPARE_ENDPOINT,
      { sessionId: 's' }, expect.any(AbortSignal))
    expect(model.getSnapshot('s').card).toBeDefined()
  })

  it('ignores an old threshold response arriving after invalidation', async () => {
    let release!: (value: unknown) => void
    const call = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
      .mockResolvedValue({ ok: true, value: card(1) })
    const model = createWelcomeBackModel({ rpc: { call } })
    const old = model.check('s')
    model.invalidate()
    await model.check('s')
    release({ ok: true, value: card(60) })
    await old
    expect(model.getSnapshot('s').card?.compactMinutes).toBe(1)
  })

  it('checks a switched session without waiting for another session recap to finish', async () => {
    let release!: (value: unknown) => void
    const call = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
      .mockResolvedValue({ ok: true, value: { ...card(1), sessionId: 'other' } })
    const model = createWelcomeBackModel({ rpc: { call } })
    const old = model.check('s')
    await model.check('other')
    expect(model.getSnapshot('other').card).toBeDefined()
    release({ ok: true, value: card() })
    await old
  })

  it('confirms a saved threshold through temporary RPC failures during host reload', async () => {
    const config = { recapMinutes: 1, compactMinutes: 1, continueText: '', continueMode: 'fixed', model: null, ghostModel: null }
    let reads = 0
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint === CONFIG_WRITE_ENDPOINT) throw new Error('old fiber disposed')
      if (endpoint === CONFIG_READ_ENDPOINT && reads++ < 2) throw new Error('reloading')
      return { ok: true, value: config }
    })
    const model = createPresenceConfigModel({ rpc: { call } }, async () => {})
    await model.save({ recapMinutes: 1, compactMinutes: 1 })
    expect(model.getSnapshot()).toMatchObject({ saved: true, saving: false, values: config })
    expect(reads).toBe(3)
  })
})
