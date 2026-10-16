import type { ShortcutContext } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type {
  CommandPalette,
  CommandPaletteCommand,
  CommandPaletteModelOptions,
  CommandPaletteSnapshot,
  CommandPaletteSource,
} from './contracts.ts'

interface Registration {
  readonly command: CommandPaletteCommand
  readonly release: () => void
}

function restoreTarget(context: ShortcutContext): void {
  const target = context.target
  if (target?.isConnected && 'focus' in target && typeof target.focus === 'function') {
    target.focus({ preventScroll: true })
  }
}

/** Pure model. The Cordis service wrapper owns ctx.effect(register) and disposal. */
export class CommandPaletteModel implements CommandPalette {
  private readonly registrations = new Map<ShortcutCommandId, Registration>()
  private readonly listeners = new Set<() => void>()
  private snapshot: CommandPaletteSnapshot = Object.freeze({ open: false, error: null, commands: Object.freeze([]) })
  private context: ShortcutContext | null = null
  private executing = false
  private disposed = false

  readonly state: CommandPaletteSource = {
    getSnapshot: () => this.snapshot,
    subscribe: (listener) => {
      if (this.disposed) return () => {}
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }

  constructor(private readonly options: CommandPaletteModelOptions) {}

  register(command: CommandPaletteCommand): () => void {
    if (this.disposed) throw new Error('Command palette has been disposed.')
    if (this.registrations.has(command.id)) throw new Error(`Duplicate command: ${command.id}`)
    // Register first: native duplicate/default conflicts must not leave a palette-only ghost.
    const registration: Registration = { command, release: this.options.shortcuts.register(command) }
    this.registrations.set(command.id, registration)
    this.publishCommands()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.registrations.get(command.id) !== registration) return
      this.registrations.delete(command.id)
      try {
        registration.release()
      } finally {
        this.publishCommands()
      }
    }
  }

  isRegistered(id: ShortcutCommandId): boolean {
    return this.registrations.has(id)
  }

  /** The context of the open session, or null while the palette is closed. */
  currentContext(): ShortcutContext | null {
    return this.context
  }

  open(context: ShortcutContext): void {
    // A second open must not replace the pre-palette target with the search input.
    if (this.disposed || this.snapshot.open || this.executing) return
    this.context = Object.freeze({ ...context, source: 'menu' })
    this.publish({ open: true, error: null })
  }

  close(): void {
    this.context = null
    if (this.snapshot.open) this.publish({ open: false })
  }

  clearError(): void {
    if (this.snapshot.error !== null) this.publish({ error: null })
  }

  async execute(id: ShortcutCommandId): Promise<boolean> {
    if (this.disposed || this.executing || !this.snapshot.open || !this.context) return false
    const registration = this.registrations.get(id)
    if (!registration) {
      this.publish({ error: `Command is not registered with the palette: ${id}` })
      return false
    }
    const context = this.context
    this.executing = true
    try {
      const command = registration.command
      if (!command.regions.includes(context.region) || (context.modal !== null && !command.modals.includes(context.modal))) {
        this.publish({ error: 'Command is not available in the original input context.' })
        return false
      }
      // Resolve before closing: owners capture their business target synchronously.
      const resolution = command.resolve(context)
      if (resolution.status !== 'handled') {
        this.publish({ error: resolution.status === 'blocked' ? resolution.reason : 'Command is not available in the original input context.' })
        return false
      }
      this.publish({ error: null })
      this.close()
      await this.options.afterClose?.()
      // Unloading the contributing plugin while the modal closes cancels the action.
      if (this.disposed || this.registrations.get(id) !== registration) return false
      await (this.options.restoreFocus ?? restoreTarget)(context)
      if (this.disposed || this.registrations.get(id) !== registration) return false
      // Native run is typed void, but async implementations must still be awaited.
      await resolution.run()
      return true
    } catch (error) {
      if (!this.disposed) this.publish({ error: error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      this.executing = false
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.context = null
    const registrations = [...this.registrations.values()]
    this.registrations.clear()
    let failure: unknown
    let failed = false
    for (const registration of registrations) {
      try { registration.release() } catch (error) { failed = true; failure ??= error }
    }
    this.publish({ open: false, commands: Object.freeze([]) })
    this.listeners.clear()
    if (failed) throw failure
  }

  private publishCommands(): void {
    this.publish({ commands: Object.freeze([...this.registrations.values()].map(({ command }) => command)) })
  }

  private publish(change: Partial<CommandPaletteSnapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...change })
    for (const listener of [...this.listeners]) listener()
  }
}
