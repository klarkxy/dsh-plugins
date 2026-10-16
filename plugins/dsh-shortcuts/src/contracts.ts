import type { ShortcutCommand, ShortcutContext, Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/protocol'

/**
 * Use the native command contract; defaults: {} allows a palette-only command.
 * Client consumers import these declarations with `import type {}` and declare
 * `inject = ['commandPalette']`. Their dsh.client.inject includes this package.
 * Registration follows the caller's Cordis lifetime; no runtime import is needed.
 *
 * @example
 * import type {} from '@klarkxy/dsh-shortcuts/contracts'
 * import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/protocol'
 * export const inject = ['commandPalette']
 * export function apply(ctx: Context) {
 *   ctx.commandPalette.register({
 *     id: 'my-plugin.refresh' as ShortcutCommandId,
 *     label: () => 'Refresh my plugin', aliases: ['refresh'], defaults: {},
 *     regions: ['page', 'editable'], modals: [],
 *     resolve: () => ({ status: 'handled', run: () => refreshMyPlugin() }),
 *   })
 * }
 */
export type CommandPaletteCommand = ShortcutCommand

export interface CommandPaletteSnapshot {
  readonly open: boolean
  readonly error: string | null
  /** Only commands contributed through this service, not the native catalog. */
  readonly commands: readonly CommandPaletteCommand[]
}

export interface CommandPaletteSource {
  getSnapshot(): CommandPaletteSnapshot
  subscribe(listener: () => void): () => void
}

export interface CommandPalette {
  readonly state: CommandPaletteSource
  register(command: CommandPaletteCommand): () => void
  isRegistered(id: ShortcutCommandId): boolean
  /** Capture target, region and modal before mounting the palette. */
  open(context: ShortcutContext): void
  /**
   * The context of the currently open session, or null while closed. A seat
   * that interrupts its own palette needs this to resume afterwards; it is
   * not a retained origin: it is null the moment the palette closes.
   */
  currentContext(): ShortcutContext | null
  close(): void
  clearError(): void
  /** A selection consumes one open session; concurrent/repeated calls cannot rerun it. */
  execute(id: ShortcutCommandId): Promise<boolean>
}

export interface CommandPaletteModelOptions {
  readonly shortcuts: Pick<Shortcuts, 'register'>
  /** Resolve after the modal unmounts and releases its focus trap. */
  readonly afterClose?: () => void | Promise<void>
  /** Restore the original input target before running the captured action. */
  readonly restoreFocus?: (context: ShortcutContext) => void | Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    commandPalette: CommandPalette
  }
}
