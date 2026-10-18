import { describe, expect, it } from 'vitest'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { DELETE_DIALOG_ID, PLUGIN_NAME, USER_ACTIONS_SLOT } from './contracts.ts'
import { apply } from './client.tsx'

describe('session menu registration', () => {
  it('removes the delete row when the client unloads and does not add a copy-id row', () => {
    const disposed: string[] = []
    let unload = () => {}
    const specs: Array<Record<string, unknown>> = []
    const order: string[] = []
    const ctx = {
      inject(deps: string[], callback?: (scope: unknown) => void) {
        order.push(deps.length === 1 && deps[0] === 'remote' ? 'mount' : deps.join(','))
        if (deps.length === 1 && deps[0] === 'remote') callback?.({ remote: { $mount: async () => async () => {} }, effect() {} })
        return { dispose() {} }
      },
      effect(callback: () => () => void) { unload = callback() },
      slots: {
        entriesOfSlot: () => [], spec: () => undefined, subscribe: () => () => {},
        inject(_key: string, callback: () => () => void) {
          const inner = callback()
          return () => { disposed.push('inject'); inner() }
        },
        register(spec: Record<string, unknown>) {
          specs.push(spec)
          return () => disposed.push(String(spec['id'] ?? spec['key']))
        },
      },
      locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe: () => () => {} },
    }
    apply(ctx as never)
    expect(order[0]).toBe('mount')
    expect(order[1]).toBe(`remote,remote.${modelSettingsChangesIdentity(PLUGIN_NAME).namespace}`)
    expect(disposed).toEqual([])
    expect(specs).toContainEqual({
      name: 'sidebar.workspaces.session.menu.item',
      id: DELETE_DIALOG_ID,
      order: 510,
    })
    expect(specs.some(spec => String(spec['id'] ?? '').includes('copy'))).toBe(false)
    expect(specs.map(spec => spec['name'])).toEqual([
      'sidebar.workspaces.session.menu.item',
      'conversation.hero.workspace',
      USER_ACTIONS_SLOT,
      'conversation.input.overlay',
      'conversation.chat.turnTail',
      'plugins.bundle.config',
      'shell.overlay',
    ])
    unload()
    expect(disposed.filter(item => item === 'inject')).toHaveLength(7)
    expect(disposed).toContain(DELETE_DIALOG_ID)
  })
})
