import { describe, expect, it, vi } from 'vitest'
import type { ShortcutContext } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type { CommandPaletteCommand, CommandPaletteModelOptions } from './contracts.ts'
import { CommandPaletteModel } from './core.ts'

const id = (value: string) => value as ShortcutCommandId
const context: ShortcutContext = { region: 'page', modal: null, target: null, source: 'keyboard' }
const command = (overrides: Partial<CommandPaletteCommand> = {}): CommandPaletteCommand => ({
  id: id('test.action'), label: () => 'Action', aliases: ['action'], defaults: {}, regions: ['page'], modals: [],
  resolve: () => ({ status: 'handled', run: () => {} }), ...overrides,
})

function setup(options: Omit<CommandPaletteModelOptions, 'shortcuts'> = {}) {
  const releases: ReturnType<typeof vi.fn>[] = []
  const register = vi.fn(() => { const release = vi.fn(); releases.push(release); return release })
  const model = new CommandPaletteModel({ shortcuts: { register }, ...options })
  return { model, register, releases }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('CommandPaletteModel', () => {
  it('registers unbound commands with native shortcuts and publishes stable snapshots', () => {
    const { model, register, releases } = setup()
    const listener = vi.fn()
    const unsubscribe = model.state.subscribe(listener)
    const initial = model.state.getSnapshot()
    expect(model.state.getSnapshot()).toBe(initial)
    const contribution = command()
    const dispose = model.register(contribution)
    expect(register).toHaveBeenCalledWith(contribution)
    expect(model.state.getSnapshot().commands).toEqual([contribution])
    expect(model.isRegistered(contribution.id)).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    dispose()
    dispose()
    expect(releases[0]).toHaveBeenCalledTimes(1)
    expect(model.state.getSnapshot().commands).toEqual([])
    expect(model.isRegistered(contribution.id)).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('rejects duplicate ids and rolls back native registration failures', () => {
    const { model, register } = setup()
    model.register(command())
    expect(() => model.register(command())).toThrow('Duplicate command')
    expect(register).toHaveBeenCalledTimes(1)
    register.mockImplementationOnce(() => { throw new Error('Default conflict') })
    expect(() => model.register(command({ id: id('test.other') }))).toThrow('Default conflict')
    expect(model.isRegistered(id('test.other'))).toBe(false)
    expect(model.state.getSnapshot().commands).toHaveLength(1)
  })

  it('never invokes commands that exist only in the native catalog', async () => {
    const { model } = setup()
    model.open(context)
    expect(await model.execute(id('native.action'))).toBe(false)
    expect(model.state.getSnapshot()).toMatchObject({ open: true, error: expect.stringContaining('not registered') })
  })

  it('captures original context, resolves before closing, restores focus, then runs once', async () => {
    const steps: string[] = []
    const closing = deferred()
    const originalTarget = {} as Element
    const captured: ShortcutContext = { ...context, region: 'editable', target: originalTarget }
    const restoreFocus = vi.fn((received: ShortcutContext) => {
      expect(received).toMatchObject({ region: 'editable', target: originalTarget, source: 'menu' })
      steps.push('focus')
    })
    const { model } = setup({ afterClose: () => { steps.push('closed'); return closing.promise }, restoreFocus })
    const run = vi.fn(() => { steps.push('run') })
    const resolve = vi.fn((received: ShortcutContext) => {
      expect(received).toMatchObject({ region: 'editable', target: originalTarget, source: 'menu' })
      expect(model.state.getSnapshot().open).toBe(true)
      steps.push('resolve')
      return { status: 'handled' as const, run }
    })
    model.register(command({ regions: ['editable'], resolve }))
    model.open(captured)
    model.open(context)
    const selected = model.execute(id('test.action'))
    expect(model.state.getSnapshot().open).toBe(false)
    expect(await model.execute(id('test.action'))).toBe(false)
    expect(steps).toEqual(['resolve', 'closed'])
    closing.resolve()
    expect(await selected).toBe(true)
    expect(steps).toEqual(['resolve', 'closed', 'focus', 'run'])
    expect(await model.execute(id('test.action'))).toBe(false)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('restores a connected original input without depending on a browser global', async () => {
    const focus = vi.fn()
    const target = { isConnected: true, focus } as unknown as Element
    const { model } = setup()
    const run = vi.fn(() => expect(focus).toHaveBeenCalledWith({ preventScroll: true }))
    model.register(command({ resolve: () => ({ status: 'handled', run }) }))
    model.open({ ...context, target })
    expect(await model.execute(id('test.action'))).toBe(true)
    expect(focus).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each(['pass', 'blocked'] as const)('keeps %s resolutions open with a visible reason', async (status) => {
    const { model } = setup()
    model.register(command({ resolve: () => status === 'pass' ? { status } : { status, reason: 'No active session' } }))
    model.open(context)
    expect(await model.execute(id('test.action'))).toBe(false)
    expect(model.state.getSnapshot()).toMatchObject({ open: true, error: expect.any(String) })
    if (status === 'blocked') expect(model.state.getSnapshot().error).toBe('No active session')
    model.clearError()
    expect(model.state.getSnapshot().error).toBeNull()
  })

  it('enforces the original region and modal restrictions before resolving', async () => {
    const { model } = setup()
    const resolve = vi.fn(() => ({ status: 'handled' as const, run: vi.fn() }))
    model.register(command({ resolve }))
    model.open({ ...context, region: 'editable' })
    expect(await model.execute(id('test.action'))).toBe(false)
    model.close()
    model.open({ ...context, modal: 'settings' })
    expect(await model.execute(id('test.action'))).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'run', 'async run', 'focus'] as const)('exposes %s errors without unhandled rejection', async (stage) => {
    const { model } = setup({ restoreFocus: () => { if (stage === 'focus') throw new Error('Failed focus') } })
    model.register(command({ resolve: () => {
      if (stage === 'resolve') throw new Error('Failed resolve')
      return { status: 'handled', run: () => {
        if (stage === 'async run') return Promise.reject(new Error('Failed async run'))
        if (stage === 'run') throw new Error('Failed run')
      } }
    } }))
    model.open(context)
    expect(await model.execute(id('test.action'))).toBe(false)
    expect(model.state.getSnapshot().error).toBe(`Failed ${stage}`)
    model.close()
    model.open(context)
    expect(model.state.getSnapshot().error).toBeNull()
  })

  it('cancels a pending selection if the owner unregisters or replaces it', async () => {
    const closing = deferred()
    const { model } = setup({ afterClose: () => closing.promise })
    const run = vi.fn()
    const release = model.register(command({ resolve: () => ({ status: 'handled', run }) }))
    model.open(context)
    const selected = model.execute(id('test.action'))
    release()
    model.register(command())
    closing.resolve()
    expect(await selected).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('disposes registrations, cancels pending execution, and clears subscribers', async () => {
    const closing = deferred()
    const { model, releases } = setup({ afterClose: () => closing.promise })
    const run = vi.fn()
    const release = model.register(command({ resolve: () => ({ status: 'handled', run }) }))
    model.register(command({ id: id('test.other') }))
    model.open(context)
    const selected = model.execute(id('test.action'))
    const listener = vi.fn()
    model.state.subscribe(listener)
    model.dispose()
    model.dispose()
    release()
    closing.resolve()
    expect(await selected).toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(releases.every((entry) => entry.mock.calls.length === 1)).toBe(true)
    expect(model.state.getSnapshot()).toMatchObject({ open: false, commands: [] })
    expect(listener).toHaveBeenCalledTimes(1)
    model.open(context)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(() => model.register(command())).toThrow('disposed')
  })

  it('releases all registrations even when one native disposer throws', () => {
    const { model, releases } = setup()
    model.register(command())
    model.register(command({ id: id('test.other') }))
    releases[0]!.mockImplementationOnce(() => { throw new Error('Release failed') })
    expect(() => model.dispose()).toThrow('Release failed')
    expect(releases[1]).toHaveBeenCalledTimes(1)
    expect(model.state.getSnapshot().commands).toEqual([])
  })
})
