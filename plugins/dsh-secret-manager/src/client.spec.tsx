import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from './client.tsx'

describe('client registration contract', () => {
  it('registers the request_secret toolview, the settings section and its icon', () => {
    const slots: string[] = []
    const registrations: { spec: Record<string, unknown>; render: unknown }[] = []
    const ctx = {
      effect(run: () => unknown) { run() },
      slots: {
        inject(key: string, callback: () => unknown) {
          slots.push(key)
          return callback() as () => void
        },
        register(spec: Record<string, unknown>, render: unknown) {
          registrations.push({ spec, render })
          return () => {}
        },
      },
      connection: { rpc: { call: async () => ({ ok: true, value: null }) } },
      locale: {
        register: () => () => {},
        getSnapshot: () => ({ active: 'zh' }),
        subscribe: () => () => {},
      },
    }
    apply(ctx as never)
    expect([...inject]).toEqual(['slots', 'connection', 'locale', 'uiWorkspace', 'uiSession'])
    expect(slots).toEqual(['tool.call.toolview', 'settings.section', 'settings.section.icon'])
    expect(registrations[0].spec).toMatchObject({
      name: 'tool.call.toolview', key: 'request_secret', locale: 'secret-manager',
    })
    expect(registrations[1].spec).toMatchObject({
      name: 'settings.section', id: 'secret-manager', order: 170,
    })
    // The label thunk follows the active locale without re-registration.
    const label = (registrations[1].spec as { label: () => string }).label()
    expect(label).toBe('密钥管理器')
    expect(registrations[2].spec).toMatchObject({
      name: 'settings.section.icon', id: 'secret-manager', order: 170,
    })
  })

  it('never logs a transport error body — only endpoint and error kind', async () => {
    const registrations: { spec: Record<string, unknown> }[] = []
    const warnings: unknown[][] = []
    const secret = 'sk-9f4e1c2b-synthetic'
    const ctx = {
      effect(run: () => unknown) { run() },
      slots: {
        inject(_key: string, callback: () => unknown) { callback(); return () => {} },
        register(spec: Record<string, unknown>) { registrations.push({ spec }); return () => {} },
      },
      connection: { rpc: { call: async () => { throw new Error(`transport failure for /dsh-secret-manager: body { "value": "${secret}" }`) } } },
      logger: { warn: (...args: unknown[]) => { warnings.push(args) } },
    }
    apply(ctx as never)
    const spec = registrations[0].spec as { inject: (sessionId: string) => { call: (e: string, p: unknown) => Promise<unknown> } }
    const face = spec.inject('session-1')
    await expect(face.call('submit', { id: 'r', sessionId: 's', callId: 'c', value: secret, grantEnv: true, grantHttp: false })).rejects.toThrow()
    // The client logger forwards one summary string to ctx.logger.warn; the
    // secret must not appear anywhere in it or in any captured argument.
    expect(warnings).toHaveLength(1)
    expect(String(warnings[0][0])).toContain('rpc.call-failed')
    expect(JSON.stringify(warnings)).not.toContain(secret)
  })

  it('injects a session-bound RPC caller into the toolview', () => {
    const registrations: { spec: Record<string, unknown> }[] = []
    const calls: [string, string, unknown][] = []
    const ctx = {
      effect(run: () => unknown) { run() },
      slots: {
        inject(_key: string, callback: () => unknown) { callback(); return () => {} },
        register(spec: Record<string, unknown>) { registrations.push({ spec }); return () => {} },
      },
      connection: { rpc: { call: async (channel: string, endpoint: string, payload: unknown) => { calls.push([channel, endpoint, payload]); return { ok: true } } } },
    }
    apply(ctx as never)
    const spec = registrations[0].spec as { inject: (sessionId: string) => { call: (e: string, p: unknown) => Promise<unknown>; sessionId: string } }
    const face = spec.inject('session-9')
    expect(face.sessionId).toBe('session-9')
    void face.call('pending', { sessionId: 'session-9', callId: 'c' })
    expect(calls).toEqual([['/dsh-secret-manager', 'pending', { sessionId: 'session-9', callId: 'c' }]])
  })
})
